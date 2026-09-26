import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearRateLimit, consumeRateLimit, requireAuth, requireRole } from '../core/auth.ts';
import {
  accountPermissions,
  accountCodeFor,
  canManageAccount,
  hasAthleteAccess,
  permissionsAllowAthlete,
  permissionsAllowProjectTeam,
  replaceAccountScope,
  accessibleAthleteIds,
} from '../core/permissions.ts';
import {
  birthDateFromIdentityNumber,
  cleanString,
  isValidIsoDate,
  numberOrNull,
  parseDate,
  userById,
  validatePersonName,
} from '../core/utils.ts';
import { db, upsertAthleteOrigin } from '../core/db.ts';
import { canManageRole } from '../../shared/access.ts';
import { athletePhotoRoot, photoUpload } from '../core/uploads.ts';
import {
  athleteHealthStatuses,
  athletePayloadErrors,
  athleteProfileComplete,
  athleteScopeError,
  athleteTrainingStatuses,
  bodyCompositionFields,
  injuryRecordById,
  injuryStatuses,
  injurySides,
  readAthleteAdminPayload,
  selfAthleteProfileSchema,
  selfAthleteProfileValidationMessage,
  upsertAthleteProfile,
} from './athlete-module.ts';

export function registerAthleteRoutes(app: Express) {
  app.put('/api/me/athlete-profile', requireAuth, (req, res) => {
    const currentUser = req.authUser!;
    if (currentUser.role !== 'ATL' || !currentUser.athleteId) {
      return res.status(403).json({ message: '只有运动员本人可以修改个人资料。' });
    }
    const parsed = selfAthleteProfileSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: selfAthleteProfileValidationMessage(parsed.error) });

    const athleteId = currentUser.athleteId;
    if (!hasAthleteAccess(currentUser, athleteId)) {
      return res.status(403).json({ message: '无权修改该运动员资料。' });
    }
    const athlete = db
      .prepare(
        `
        SELECT a.id, a.project, COALESCE(pt.name, a.team, '') AS team,
          COALESCE(ao.province, '未设置') AS region, COALESCE(ao.city, '') AS city,
          COALESCE(ao.county, '') AS county
        FROM athletes a
        LEFT JOIN project_teams pt ON pt.id = a.team_id
        LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
        WHERE a.id = ? AND a.active = 1
      `
      )
      .get(athleteId) as
      | { id: number; project: string; team: string; region: string; city: string; county: string }
      | undefined;
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });

    const payload = readAthleteAdminPayload({
      ...parsed.data,
      project: athlete.project,
      team: athlete.team,
      region: athlete.region,
      city: athlete.city,
      county: athlete.county,
    });
    const errors = athletePayloadErrors(payload);
    if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });
    const selectedTeam = db
      .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
      .get(payload.project, payload.team) as { id: number } | undefined;

    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE athletes SET name = ?, project = ?, team = ?, team_id = ?, gender = ?, birth_date = ?, region = ?, city = ?, county = ?, profile_status = ? WHERE id = ?`
      ).run(
        payload.name,
        payload.project,
        payload.team,
        selectedTeam!.id,
        payload.gender,
        payload.birthDate || null,
        payload.region,
        payload.city,
        payload.county,
        athleteProfileComplete(payload) ? 'complete' : 'incomplete',
        athleteId
      );
      upsertAthleteOrigin({
        athleteId,
        province: payload.region,
        city: payload.city,
        county: payload.county,
      });
      upsertAthleteProfile(athleteId, payload);
      db.prepare("UPDATE users SET display_name = ? WHERE id = ? AND role = 'ATL'").run(
        payload.name,
        currentUser.id
      );
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
      ).run(currentUser.id, 'UPDATE_OWN_ATHLETE_PROFILE', 'athlete', athleteId);
      db.exec('COMMIT');
      res.json({ message: '个人资料已更新。' });
    } catch (error) {
      db.exec('ROLLBACK');
      res.status(409).json({
        message:
          error instanceof Error && error.message.includes('UNIQUE')
            ? '该姓名已被其他运动员使用。'
            : '个人资料更新失败。',
      });
    }
  });
  app.post(
    '/api/admin/athletes',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const payload = readAthleteAdminPayload(req.body || {});
      const username = cleanString(req.body?.username).toLowerCase();
      const password = cleanString(req.body?.password);
      const createAccount = req.body?.createAccount === true;
      const errors = athletePayloadErrors(payload);
      if (createAccount && currentUser.role === 'SCC')
        errors.push('教练可创建和维护运动员档案，但不能直接创建登录账号');
      if (createAccount && !/^[a-z0-9_]{4,24}$/.test(username))
        errors.push('登录账号须为4—24位字母、数字或下划线');
      if (
        createAccount &&
        (password.length < 8 ||
          password.length > 72 ||
          !/[A-Za-z]/.test(password) ||
          !/\d/.test(password))
      )
        errors.push('初始密码须为8—72位，并同时包含字母和数字');
      const permissions = {
        areas: [
          {
            areaLevel: 'county' as const,
            province: payload.region,
            city: payload.city,
            county: payload.county,
          },
        ],
        projects: [payload.project],
        teams: [{ project: payload.project, team: payload.team }],
      };
      const scopeError = athleteScopeError(currentUser, payload);
      if (scopeError) errors.push(scopeError);
      if (
        createAccount &&
        [payload.region, payload.city, payload.county].some((value) => value === '未设置')
      )
        errors.push('创建登录账号前请补全省、市、区县');
      if (createAccount && db.prepare('SELECT id FROM users WHERE username = ?').get(username))
        errors.push('该登录账号已存在');
      const selectedTeam = db
        .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
        .get(payload.project, payload.team) as { id: number } | undefined;
      if (
        selectedTeam &&
        db
          .prepare('SELECT id FROM athletes WHERE name = ? AND project = ? AND team_id = ?')
          .get(payload.name, payload.project, selectedTeam.id)
      )
        errors.push('该队伍中已存在同名运动员');
      const coach = payload.coachId ? userById(payload.coachId) : null;
      if (
        currentUser.role !== 'SCC' &&
        payload.coachId &&
        (!coach || coach.role !== 'SCC' || !canManageAccount(currentUser, coach))
      )
        errors.push('请选择可管理范围内的教练');
      if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });

      db.exec('BEGIN');
      try {
        const athleteResult = db
          .prepare(
            `
      INSERT INTO athletes (name, project, team, team_id, gender, birth_date, region, city, county, profile_status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
    `
          )
          .run(
            payload.name,
            payload.project,
            payload.team,
            selectedTeam!.id,
            payload.gender,
            payload.birthDate || null,
            payload.region,
            payload.city,
            payload.county,
            athleteProfileComplete(payload) ? 'complete' : 'incomplete'
          );
        const athleteId = Number(athleteResult.lastInsertRowid);
        upsertAthleteOrigin({
          athleteId,
          province: payload.region,
          city: payload.city,
          county: payload.county,
        });
        upsertAthleteProfile(athleteId, payload);
        let userId: number | null = null;
        if (createAccount) {
          const userResult = db
            .prepare(
              `INSERT INTO users (username, password_hash, display_name, role, athlete_id, active) VALUES (?, ?, ?, 'ATL', ?, 1)`
            )
            .run(username, bcrypt.hashSync(password, 11), payload.name, athleteId);
          userId = Number(userResult.lastInsertRowid);
          db.prepare(
            'INSERT INTO account_profiles (user_id, parent_user_id, account_code) VALUES (?, ?, ?)'
          ).run(
            userId,
            currentUser.id,
            accountCodeFor(userId, 'ATL', payload.region, payload.project)
          );
          replaceAccountScope({
            userId,
            role: 'ATL',
            parentUserId: currentUser.id,
            permissions,
            grantedBy: currentUser.id,
          });
        }
        const assignedCoachId = currentUser.role === 'SCC' ? currentUser.id : payload.coachId;
        if (assignedCoachId)
          db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(
            assignedCoachId,
            athleteId
          );
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          currentUser.id,
          'CREATE_ATHLETE',
          'athlete',
          athleteId,
          JSON.stringify({
            username: createAccount ? username : '',
            createAccount,
            project: payload.project,
            team: payload.team,
          })
        );
        db.exec('COMMIT');
        res.status(201).json({
          message: createAccount
            ? '运动员及登录账号已创建。'
            : '运动员档案已创建，暂未创建登录账号。',
          id: athleteId,
          accountId: userId,
        });
      } catch (error) {
        db.exec('ROLLBACK');
        res.status(409).json({
          message:
            error instanceof Error && error.message.includes('UNIQUE')
              ? '运动员姓名或登录账号已存在。'
              : '运动员创建失败。',
        });
      }
    }
  );
  app.put(
    '/api/admin/athletes/:id',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const athleteId = Number(req.params.id);
      if (!hasAthleteAccess(currentUser, athleteId))
        return res.status(404).json({ message: '运动员不存在或不在可管理范围内。' });
      const payload = readAthleteAdminPayload(req.body || {});
      const errors = athletePayloadErrors(payload);
      const permissions = {
        areas: [
          {
            areaLevel: 'county' as const,
            province: payload.region,
            city: payload.city,
            county: payload.county,
          },
        ],
        projects: [payload.project],
        teams: [{ project: payload.project, team: payload.team }],
      };
      const scopeError = athleteScopeError(currentUser, payload);
      if (scopeError) errors.push(scopeError);
      const coach = payload.coachId ? userById(payload.coachId) : null;
      if (
        currentUser.role !== 'SCC' &&
        payload.coachId &&
        (!coach || coach.role !== 'SCC' || !canManageAccount(currentUser, coach))
      )
        errors.push('请选择可管理范围内的教练');
      if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });

      db.exec('BEGIN');
      try {
        const selectedTeam = db
          .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
          .get(payload.project, payload.team) as { id: number } | undefined;
        db.prepare(
          `UPDATE athletes SET name = ?, project = ?, team = ?, team_id = ?, gender = ?, birth_date = ?, region = ?, city = ?, county = ?, profile_status = ? WHERE id = ?`
        ).run(
          payload.name,
          payload.project,
          payload.team,
          selectedTeam!.id,
          payload.gender,
          payload.birthDate || null,
          payload.region,
          payload.city,
          payload.county,
          athleteProfileComplete(payload) ? 'complete' : 'incomplete',
          athleteId
        );
        upsertAthleteOrigin({
          athleteId,
          province: payload.region,
          city: payload.city,
          county: payload.county,
        });
        upsertAthleteProfile(athleteId, payload);
        db.prepare("UPDATE users SET display_name = ? WHERE role = 'ATL' AND athlete_id = ?").run(
          payload.name,
          athleteId
        );
        const athleteUser = db
          .prepare(
            "SELECT u.id, ap.parent_user_id AS parentUserId FROM users u LEFT JOIN account_profiles ap ON ap.user_id = u.id WHERE u.role = 'ATL' AND u.athlete_id = ?"
          )
          .get(athleteId) as { id: number; parentUserId: number | null } | undefined;
        if (athleteUser)
          replaceAccountScope({
            userId: athleteUser.id,
            role: 'ATL',
            parentUserId: athleteUser.parentUserId || currentUser.id,
            permissions,
            grantedBy: currentUser.id,
          });
        if (currentUser.role !== 'SCC') {
          db.prepare('DELETE FROM coach_athletes WHERE athlete_id = ?').run(athleteId);
          if (payload.coachId)
            db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(
              payload.coachId,
              athleteId
            );
        }
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
        ).run(currentUser.id, 'UPDATE_ATHLETE_PROFILE', 'athlete', athleteId);
        db.exec('COMMIT');
        res.json({ message: '运动员资料已更新。' });
      } catch (error) {
        db.exec('ROLLBACK');
        res.status(409).json({
          message:
            error instanceof Error && error.message.includes('UNIQUE')
              ? '该运动员姓名已存在。'
              : '运动员资料更新失败。',
        });
      }
    }
  );
  app.put(
    '/api/admin/athletes/bulk/profile',
    requireAuth,
    requireRole('PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const ids = Array.isArray(req.body?.ids)
        ? ([...new Set(req.body.ids.map(Number).filter(Number.isFinite))] as number[])
        : [];
      if (!ids.length || ids.some((id) => !hasAthleteAccess(req.authUser!, id)))
        return res.status(400).json({ message: '请选择可管理范围内的运动员。' });
      const allowed = [
        ['technicalLevel', 'technical_level'],
        ['athletePosition', 'position'],
        ['healthStatus', 'health_status'],
        ['currentEvent', 'current_event'],
        ['athleteStatus', 'athlete_status'],
        ['trainingPhase', 'training_phase'],
      ] as const;
      const changes = allowed
        .map(([key, column]) => ({ column, value: cleanString(req.body?.[key]) }))
        .filter((item) => item.value);
      if (!changes.length) return res.status(400).json({ message: '请至少填写一项批量修改内容。' });
      if (
        changes.some(
          (item) => item.column === 'health_status' && !athleteHealthStatuses.has(item.value)
        )
      )
        return res.status(400).json({ message: '身体状态无效。' });
      if (
        changes.some(
          (item) => item.column === 'athlete_status' && !athleteTrainingStatuses.has(item.value)
        )
      )
        return res.status(400).json({ message: '运动员状态无效。' });
      db.exec('BEGIN');
      try {
        for (const id of ids) {
          db.prepare('INSERT OR IGNORE INTO athlete_profiles (athlete_id) VALUES (?)').run(id);
          for (const change of changes)
            db.prepare(
              `UPDATE athlete_profiles SET ${change.column} = ?, updated_at = CURRENT_TIMESTAMP WHERE athlete_id = ?`
            ).run(change.value, id);
          db.prepare(
            'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
          ).run(req.authUser!.id, 'BULK_UPDATE_ATHLETE', 'athlete', id);
        }
        db.exec('COMMIT');
        res.json({ message: `已更新 ${ids.length} 名运动员。` });
      } catch {
        db.exec('ROLLBACK');
        res.status(500).json({ message: '批量修改失败。' });
      }
    }
  );
  app.post(
    '/api/admin/athletes/bulk/delete',
    requireAuth,
    requireRole('PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const ids = Array.isArray(req.body?.ids)
        ? ([...new Set(req.body.ids.map(Number).filter(Number.isFinite))] as number[])
        : [];
      if (!ids.length || ids.some((id) => !hasAthleteAccess(req.authUser!, id)))
        return res.status(400).json({ message: '请选择可管理范围内的运动员。' });
      const placeholders = ids.map(() => '?').join(',');
      db.exec('BEGIN');
      try {
        db.prepare(`UPDATE athletes SET active = 0 WHERE id IN (${placeholders})`).run(...ids);
        db.prepare(
          `UPDATE users SET active = 0 WHERE role = 'ATL' AND athlete_id IN (${placeholders})`
        ).run(...ids);
        for (const id of ids)
          db.prepare(
            'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
          ).run(req.authUser!.id, 'DELETE_ATHLETE', 'athlete', id);
        db.exec('COMMIT');
        res.json({ message: `已删除 ${ids.length} 名运动员。` });
      } catch {
        db.exec('ROLLBACK');
        res.status(500).json({ message: '运动员删除失败。' });
      }
    }
  );
  app.delete(
    '/api/admin/athletes/:id',
    requireAuth,
    requireRole('PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const athleteId = Number(req.params.id);
      if (!hasAthleteAccess(req.authUser!, athleteId))
        return res.status(404).json({ message: '运动员不存在或不在可管理范围内。' });
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE athletes SET active = 0 WHERE id = ?').run(athleteId);
        db.prepare("UPDATE users SET active = 0 WHERE role = 'ATL' AND athlete_id = ?").run(
          athleteId
        );
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
        ).run(req.authUser!.id, 'DELETE_ATHLETE', 'athlete', athleteId);
        db.exec('COMMIT');
        res.json({ message: '运动员已删除。' });
      } catch {
        db.exec('ROLLBACK');
        res.status(500).json({ message: '运动员删除失败。' });
      }
    }
  );
  app.put('/api/admin/athletes/:id/name', requireAuth, (req, res) => {
    const athleteId = Number(req.params.id);
    if (!canManageRole(req.authUser!.role, 'ATL') || !hasAthleteAccess(req.authUser!, athleteId)) {
      return res.status(403).json({ message: '当前账户不能修改该运动员姓名。' });
    }
    const athlete = db.prepare('SELECT id, name FROM athletes WHERE id = ?').get(athleteId) as
      { id: number; name: string } | undefined;
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
    const { name, error } = validatePersonName(req.body?.name);
    if (error) return res.status(400).json({ message: error });

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(name, athleteId);
      db.prepare("UPDATE users SET display_name = ? WHERE athlete_id = ? AND role = 'ATL'").run(
        name,
        athleteId
      );
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
      ).run(
        req.authUser!.id,
        'UPDATE_ATHLETE_NAME',
        'athlete',
        athleteId,
        JSON.stringify({ from: athlete.name, to: name })
      );
      db.exec('COMMIT');
      res.json({ message: '运动员姓名已修改。', name });
    } catch (renameError) {
      db.exec('ROLLBACK');
      const message =
        renameError instanceof Error && renameError.message.includes('UNIQUE')
          ? '该姓名已被其他运动员使用。'
          : '姓名修改失败。';
      res.status(409).json({ message });
    }
  });
  app.post('/api/auth/change-password', requireAuth, (req, res) => {
    if (consumeRateLimit(req, 'change-password', 6, 15 * 60 * 1000)) {
      return res.status(429).json({ message: '操作次数过多，请稍后再试。' });
    }
    const currentPassword = cleanString(req.body?.currentPassword);
    const newPassword = cleanString(req.body?.newPassword);
    if (
      newPassword.length < 8 ||
      newPassword.length > 72 ||
      !/[A-Za-z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      return res.status(400).json({ message: '新密码须为8—72位，并同时包含字母和数字。' });
    }
    if (currentPassword === newPassword)
      return res.status(400).json({ message: '新密码不能与当前密码相同。' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.authUser!.id) as
      { password_hash: string } | undefined;
    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(401).json({ message: '当前密码不正确。' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(newPassword, 11),
      req.authUser!.id
    );
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
    ).run(req.authUser!.id, 'CHANGE_PASSWORD', 'user', req.authUser!.id);
    clearRateLimit(req, 'change-password');
    res.json({ message: '密码已修改。' });
  });
  app.get('/api/athletes', requireAuth, (req, res) => {
    const ids = accessibleAthleteIds(req.authUser!);
    if (!ids.length) return res.json({ athletes: [] });
    const placeholders = ids.map(() => '?').join(',');
    const athletes = db
      .prepare(
        `
    SELECT a.id, a.name, a.project, COALESCE(pt.name, a.team, '') AS team, a.gender, COALESCE(ao.province, '未设置') AS region, COALESCE(ao.province, '未设置') AS province, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county,
      a.photo_url AS photoUrl, a.birth_date AS birthDate, a.profile_status AS profileStatus, a.source,
      EXISTS(SELECT 1 FROM users athlete_user WHERE athlete_user.role = 'ATL' AND athlete_user.athlete_id = a.id AND athlete_user.active = 1) AS hasAccount,
      COALESCE(ap.identity_number, '') AS identityNumber,
      COALESCE(ap.ethnicity, '汉族') AS ethnicity, COALESCE(ap.phone, '') AS phone,
      COALESCE(ap.blood_type, '') AS bloodType, COALESCE(ap.emergency_contact, '') AS emergencyContact,
      COALESCE(ap.emergency_phone, '') AS emergencyPhone, COALESCE(ap.education, '') AS education,
      COALESCE(ap.technical_level, '') AS technicalLevel, COALESCE(ap.position, '') AS athletePosition,
      COALESCE(ap.best_result, '') AS bestResult,
      COALESCE(ap.native_place, '') AS nativePlace, COALESCE(ap.home_address, '') AS homeAddress,
      COALESCE(ap.athlete_status, '在训') AS athleteStatus, COALESCE(ap.start_sport_date, '') AS startSportDate,
      COALESCE(ap.training_venue, '') AS trainingVenue, COALESCE(ap.current_event, '') AS currentEvent,
      COALESCE(ap.training_phase, '') AS trainingPhase, COALESCE(ap.camp_period, '') AS campPeriod,
      COALESCE(ap.origin_place, '') AS originPlace, COALESCE(ap.origin_unit, '') AS originUnit,
      COALESCE(ap.origin_coach, '') AS originCoach, COALESCE(ap.specialties, '') AS specialties,
      COALESCE(ap.notes, '') AS notes, COALESCE(ap.created_at, '2026-01-01 00:00:00') AS createdAt,
      COALESCE((SELECT CASE ir.status WHEN 'healthy' THEN '健康' WHEN 'observation' THEN '观察' WHEN 'rehab' THEN '康复中' ELSE '训练受限' END
        FROM injury_records ir WHERE ir.athlete_id = a.id ORDER BY datetime(ir.created_at) DESC, ir.id DESC LIMIT 1), ap.health_status, '健康') AS healthStatus,
      (SELECT bm.height_cm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS heightCm,
      (SELECT bm.weight_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS weightKg,
      (SELECT bm.body_fat_pct FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS bodyFatPct,
      (SELECT bm.skeletal_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS skeletalMuscleKg,
      (SELECT bm.muscle_mass_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS muscleMassKg,
      (SELECT bm.upper_limb_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS upperLimbMuscleKg,
      (SELECT bm.lower_limb_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS lowerLimbMuscleKg,
      (SELECT bm.trunk_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS trunkMuscleKg,
      (SELECT bm.subcutaneous_fat_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS subcutaneousFatMm,
      (SELECT bm.triceps_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS tricepsSkinfoldMm,
      (SELECT bm.abdominal_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS abdominalSkinfoldMm,
      (SELECT bm.thigh_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS thighSkinfoldMm,
      (SELECT bm.calf_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS calfSkinfoldMm,
      (SELECT bm.visceral_fat_level FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS visceralFatLevel,
      (SELECT bm.basal_metabolism_kcal FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS basalMetabolismKcal,
      (SELECT bm.total_body_water_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS totalBodyWaterKg,
      (SELECT bm.ecw_tbw_ratio FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS ecwTbwRatio,
      (SELECT bm.phase_angle_deg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS phaseAngleDeg,
      (SELECT bm.visceral_fat_area_cm2 FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS visceralFatAreaCm2,
      (SELECT bm.left_arm_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS leftArmLeanKg,
      (SELECT bm.right_arm_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS rightArmLeanKg,
      (SELECT bm.trunk_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS trunkLeanKg,
      (SELECT bm.left_leg_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS leftLegLeanKg,
      (SELECT bm.right_leg_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS rightLegLeanKg,
      (SELECT bm.measurement_date FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS bodyMeasurementDate,
      COALESCE((SELECT bm.note FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1), '') AS bodyMeasurementNote,
      GROUP_CONCAT(u.display_name, '、') AS coaches
    FROM athletes a
    LEFT JOIN project_teams pt ON pt.id = a.team_id
    LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
    LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
    LEFT JOIN coach_athletes ca ON ca.athlete_id = a.id
    LEFT JOIN users u ON u.id = ca.coach_user_id
    WHERE a.id IN (${placeholders}) AND a.active = 1
    GROUP BY a.id ORDER BY a.project, pt.name, a.name
  `
      )
      .all(...ids) as Array<{
      id: number;
      name: string;
      project: string;
      team: string;
      gender: string;
      region: string;
      province: string;
      city: string;
      county: string;
      photoUrl: string;
      birthDate: string | null;
      profileStatus: 'incomplete' | 'complete';
      source: string;
      hasAccount: number;
      heightCm: number | null;
      weightKg: number | null;
      bodyFatPct: number | null;
      skeletalMuscleKg: number | null;
      muscleMassKg: number | null;
      upperLimbMuscleKg: number | null;
      lowerLimbMuscleKg: number | null;
      trunkMuscleKg: number | null;
      subcutaneousFatMm: number | null;
      tricepsSkinfoldMm: number | null;
      abdominalSkinfoldMm: number | null;
      thighSkinfoldMm: number | null;
      calfSkinfoldMm: number | null;
      visceralFatLevel: number | null;
      basalMetabolismKcal: number | null;
      totalBodyWaterKg: number | null;
      ecwTbwRatio: number | null;
      phaseAngleDeg: number | null;
      visceralFatAreaCm2: number | null;
      leftArmLeanKg: number | null;
      rightArmLeanKg: number | null;
      trunkLeanKg: number | null;
      leftLegLeanKg: number | null;
      rightLegLeanKg: number | null;
      bodyMeasurementDate: string | null;
      bodyMeasurementNote: string;
      identityNumber: string;
      ethnicity: string;
      phone: string;
      bloodType: string;
      emergencyContact: string;
      emergencyPhone: string;
      education: string;
      technicalLevel: string;
      athletePosition: string;
      healthStatus: string;
      bestResult: string;
      nativePlace: string;
      homeAddress: string;
      athleteStatus: string;
      startSportDate: string;
      trainingVenue: string;
      currentEvent: string;
      trainingPhase: string;
      campPeriod: string;
      originPlace: string;
      originUnit: string;
      originCoach: string;
      specialties: string;
      notes: string;
      createdAt: string;
      coaches: string | null;
    }>;
    const coachRows = db
      .prepare(
        `
    SELECT ca.athlete_id AS athleteId, u.id, u.display_name AS displayName
    FROM coach_athletes ca
    JOIN users u ON u.id = ca.coach_user_id
    WHERE ca.athlete_id IN (${placeholders})
    ORDER BY u.display_name
  `
      )
      .all(...ids) as Array<{ athleteId: number; id: number; displayName: string }>;
    res.json({
      athletes: athletes.map((athlete) => ({
        ...athlete,
        coaches: athlete.coaches || '',
        coachUsers: coachRows
          .filter((coach) => coach.athleteId === athlete.id)
          .map(({ id, displayName }) => ({ id, displayName })),
      })),
    });
  });
  app.put('/api/athletes/:id/position', requireAuth, (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.params.id);
    if (!athleteId || !hasAthleteAccess(user, athleteId)) {
      return res.status(403).json({ message: '无权维护该运动员的位置/号位。' });
    }
    if (user.role === 'ATL' && user.athleteId !== athleteId) {
      return res.status(403).json({ message: '运动员只能修改本人的位置/号位。' });
    }
    const athletePosition = cleanString(req.body?.athletePosition);
    if (athletePosition.length > 40)
      return res.status(400).json({ message: '位置/号位不能超过40个字符。' });
    const athlete = db
      .prepare('SELECT id FROM athletes WHERE id = ? AND active = 1')
      .get(athleteId);
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
    db.prepare('INSERT OR IGNORE INTO athlete_profiles (athlete_id) VALUES (?)').run(athleteId);
    db.prepare(
      'UPDATE athlete_profiles SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE athlete_id = ?'
    ).run(athletePosition, athleteId);
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(
      user.id,
      'UPDATE_ATHLETE_POSITION',
      'athlete',
      athleteId,
      JSON.stringify({ athletePosition })
    );
    res.json({ message: '位置/号位已保存。', athletePosition });
  });
  app.get('/api/athletes/:id/body-composition', requireAuth, (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.params.id);
    if (!athleteId || !hasAthleteAccess(user, athleteId)) {
      return res.status(403).json({ message: '无权查看该运动员的身体成分数据。' });
    }
    const athlete = db
      .prepare('SELECT id FROM athletes WHERE id = ? AND active = 1')
      .get(athleteId);
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
    const history = db
      .prepare(
        `
    SELECT measurement_date AS measurementDate,
      height_cm AS heightCm, weight_kg AS weightKg, body_fat_pct AS bodyFatPct,
      skeletal_muscle_kg AS skeletalMuscleKg, muscle_mass_kg AS muscleMassKg,
      upper_limb_muscle_kg AS upperLimbMuscleKg, lower_limb_muscle_kg AS lowerLimbMuscleKg,
      trunk_muscle_kg AS trunkMuscleKg, subcutaneous_fat_mm AS subcutaneousFatMm,
      triceps_skinfold_mm AS tricepsSkinfoldMm, abdominal_skinfold_mm AS abdominalSkinfoldMm,
      thigh_skinfold_mm AS thighSkinfoldMm, calf_skinfold_mm AS calfSkinfoldMm,
      visceral_fat_level AS visceralFatLevel, basal_metabolism_kcal AS basalMetabolismKcal,
      total_body_water_kg AS totalBodyWaterKg, ecw_tbw_ratio AS ecwTbwRatio,
      phase_angle_deg AS phaseAngleDeg, visceral_fat_area_cm2 AS visceralFatAreaCm2,
      left_arm_lean_kg AS leftArmLeanKg, right_arm_lean_kg AS rightArmLeanKg,
      trunk_lean_kg AS trunkLeanKg, left_leg_lean_kg AS leftLegLeanKg,
      right_leg_lean_kg AS rightLegLeanKg, COALESCE(note, '') AS note
    FROM athlete_body_measurements
    WHERE athlete_id = ?
    ORDER BY measurement_date DESC, id DESC
    LIMIT 24
  `
      )
      .all(athleteId);
    res.json({ history });
  });
  app.put('/api/athletes/:id/body-composition', requireAuth, (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.params.id);
    if (!athleteId || !hasAthleteAccess(user, athleteId)) {
      return res.status(403).json({ message: '无权维护该运动员的身体成分数据。' });
    }
    if (user.role === 'ATL' && user.athleteId !== athleteId) {
      return res.status(403).json({ message: '运动员只能填写本人的身体成分数据。' });
    }
    const athlete = db
      .prepare('SELECT id FROM athletes WHERE id = ? AND active = 1')
      .get(athleteId);
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
    const measurementDate = parseDate(req.body?.measurementDate);
    if (!measurementDate || !isValidIsoDate(measurementDate))
      return res.status(400).json({ message: '测量日期格式无效。' });

    const values: Record<string, number | null> = {};
    for (const [inputKey, , min, max] of bodyCompositionFields) {
      const value = numberOrNull(req.body?.[inputKey]);
      if (value !== null && (value < min || value > max)) {
        return res.status(400).json({ message: `${inputKey}超出合理范围。` });
      }
      values[inputKey] = value;
    }
    if (Object.values(values).every((value) => value === null)) {
      return res.status(400).json({ message: '请至少填写一项身体成分指标。' });
    }
    const note = cleanString(req.body?.note).slice(0, 300);
    db.prepare(
      `
    INSERT INTO athlete_body_measurements (
      athlete_id, measurement_date, height_cm, weight_kg, body_fat_pct,
      skeletal_muscle_kg, muscle_mass_kg, upper_limb_muscle_kg, lower_limb_muscle_kg,
      trunk_muscle_kg, subcutaneous_fat_mm, triceps_skinfold_mm, abdominal_skinfold_mm,
      thigh_skinfold_mm, calf_skinfold_mm, visceral_fat_level, basal_metabolism_kcal,
      total_body_water_kg, ecw_tbw_ratio, phase_angle_deg, visceral_fat_area_cm2,
      left_arm_lean_kg, right_arm_lean_kg, trunk_lean_kg, left_leg_lean_kg, right_leg_lean_kg,
      note, source, quality
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'valid')
    ON CONFLICT(athlete_id, measurement_date) DO UPDATE SET
      height_cm = excluded.height_cm, weight_kg = excluded.weight_kg, body_fat_pct = excluded.body_fat_pct,
      skeletal_muscle_kg = excluded.skeletal_muscle_kg, muscle_mass_kg = excluded.muscle_mass_kg,
      upper_limb_muscle_kg = excluded.upper_limb_muscle_kg, lower_limb_muscle_kg = excluded.lower_limb_muscle_kg,
      trunk_muscle_kg = excluded.trunk_muscle_kg, subcutaneous_fat_mm = excluded.subcutaneous_fat_mm,
      triceps_skinfold_mm = excluded.triceps_skinfold_mm, abdominal_skinfold_mm = excluded.abdominal_skinfold_mm,
      thigh_skinfold_mm = excluded.thigh_skinfold_mm, calf_skinfold_mm = excluded.calf_skinfold_mm,
      visceral_fat_level = excluded.visceral_fat_level, basal_metabolism_kcal = excluded.basal_metabolism_kcal,
      total_body_water_kg = excluded.total_body_water_kg, ecw_tbw_ratio = excluded.ecw_tbw_ratio,
      phase_angle_deg = excluded.phase_angle_deg, visceral_fat_area_cm2 = excluded.visceral_fat_area_cm2,
      left_arm_lean_kg = excluded.left_arm_lean_kg, right_arm_lean_kg = excluded.right_arm_lean_kg,
      trunk_lean_kg = excluded.trunk_lean_kg, left_leg_lean_kg = excluded.left_leg_lean_kg,
      right_leg_lean_kg = excluded.right_leg_lean_kg,
      note = excluded.note, source = 'manual', quality = 'valid'
  `
    ).run(
      athleteId,
      measurementDate,
      values.heightCm,
      values.weightKg,
      values.bodyFatPct,
      values.skeletalMuscleKg,
      values.muscleMassKg,
      values.upperLimbMuscleKg,
      values.lowerLimbMuscleKg,
      values.trunkMuscleKg,
      values.subcutaneousFatMm,
      values.tricepsSkinfoldMm,
      values.abdominalSkinfoldMm,
      values.thighSkinfoldMm,
      values.calfSkinfoldMm,
      values.visceralFatLevel,
      values.basalMetabolismKcal,
      values.totalBodyWaterKg,
      values.ecwTbwRatio,
      values.phaseAngleDeg,
      values.visceralFatAreaCm2,
      values.leftArmLeanKg,
      values.rightArmLeanKg,
      values.trunkLeanKg,
      values.leftLegLeanKg,
      values.rightLegLeanKg,
      note
    );
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(
      user.id,
      'UPSERT_BODY_COMPOSITION',
      'athlete',
      athleteId,
      JSON.stringify({ measurementDate })
    );
    res.json({ message: '身体成分数据已保存。' });
  });
  app.post('/api/athletes/:id/photo', requireAuth, photoUpload.single('photo'), (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.params.id);
    if (!athleteId || !hasAthleteAccess(user, athleteId)) {
      return res.status(403).json({ message: '无权维护该运动员的证件照。' });
    }
    if (user.role === 'ATL' && user.athleteId !== athleteId) {
      return res.status(403).json({ message: '运动员只能上传本人的证件照。' });
    }
    const athlete = db
      .prepare('SELECT id FROM athletes WHERE id = ? AND active = 1')
      .get(athleteId);
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
    if (!req.file) return res.status(400).json({ message: '请选择一张证件照。' });
    const extension = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    const filename = `athlete-${athleteId}-${randomUUID()}.${extension}`;
    writeFileSync(resolve(athletePhotoRoot, filename), req.file.buffer);
    const photoUrl = `/uploads/athlete-photos/${filename}`;
    db.prepare('UPDATE athletes SET photo_url = ? WHERE id = ?').run(photoUrl, athleteId);
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(user.id, 'UPLOAD_ATHLETE_PHOTO', 'athlete', athleteId, JSON.stringify({ photoUrl }));
    res.json({ message: '证件照已保存，并已绑定到该运动员。', photoUrl });
  });
  app.get('/api/athletes/:id/injuries', requireAuth, (req, res) => {
    const athleteId = Number(req.params.id || 0);
    if (!athleteId || !hasAthleteAccess(req.authUser!, athleteId)) {
      return res.status(403).json({ message: '无权查看该运动员的伤病记录。' });
    }
    const records = db
      .prepare(
        `
    SELECT ir.id, ir.athlete_id AS athleteId, ir.record_type AS recordType,
      ir.injury_name AS injuryName, ir.body_part AS bodyPart, ir.side, ir.status,
      ir.pain_score AS painScore, ir.onset_date AS onsetDate,
      ir.restrictions, ir.rehab_plan AS rehabPlan, ir.review_date AS reviewDate,
      ir.note, u.display_name AS createdBy, u.role AS creatorRole, ir.created_at AS createdAt
    FROM injury_records ir
    JOIN users u ON u.id = ir.created_by
    WHERE ir.athlete_id = ?
    ORDER BY datetime(ir.created_at) DESC, ir.id DESC
    LIMIT 100
  `
      )
      .all(athleteId);
    res.json({ records });
  });
  app.post('/api/athletes/:id/injuries', requireAuth, (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.params.id || 0);
    if (!athleteId || !hasAthleteAccess(user, athleteId)) {
      return res.status(403).json({ message: '无权为该运动员新增伤病记录。' });
    }
    const isAthleteFeedback = user.role === 'ATL';
    if (isAthleteFeedback && user.athleteId !== athleteId) {
      return res.status(403).json({ message: '运动员只能提交本人的疼痛反馈。' });
    }
    const bodyPart = cleanString(req.body?.bodyPart);
    const injuryName = cleanString(req.body?.injuryName);
    const side = cleanString(req.body?.side) || 'unspecified';
    const requestedStatus = cleanString(req.body?.status);
    const painScore = Number(req.body?.painScore);
    const onsetDate = cleanString(req.body?.onsetDate);
    const reviewDate = cleanString(req.body?.reviewDate);
    const restrictions = isAthleteFeedback ? '' : cleanString(req.body?.restrictions);
    const rehabPlan = isAthleteFeedback ? '' : cleanString(req.body?.rehabPlan);
    const note = cleanString(req.body?.note);
    const status = isAthleteFeedback ? 'observation' : requestedStatus;
    const errors: string[] = [];
    if (!bodyPart || bodyPart.length > 30) errors.push('请选择或填写有效的伤病部位');
    if (!injuryName || injuryName.length > 80)
      errors.push(isAthleteFeedback ? '请填写不适情况' : '请填写问题名称或诊断');
    if (!injurySides.has(side)) errors.push('请选择有效的身体侧别');
    if (!injuryStatuses.has(status)) errors.push('请选择有效的健康状态');
    if (!Number.isInteger(painScore) || painScore < 0 || painScore > 10)
      errors.push('疼痛评分应为0至10的整数');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(onsetDate)) errors.push('请选择首次出现日期');
    if (reviewDate && !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) errors.push('复查日期格式错误');
    if (restrictions.length > 500 || rehabPlan.length > 500 || note.length > 800)
      errors.push('文字内容过长');
    if (errors.length) return res.status(400).json({ message: errors.join('；') });

    const result = db
      .prepare(
        `
    INSERT INTO injury_records
      (athlete_id, record_type, injury_name, body_part, side, status, pain_score,
       onset_date, restrictions, rehab_plan, review_date, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
      )
      .run(
        athleteId,
        isAthleteFeedback ? 'feedback' : 'formal',
        injuryName,
        bodyPart,
        side,
        status,
        painScore,
        onsetDate,
        restrictions,
        rehabPlan,
        reviewDate,
        note,
        user.id
      );
    const recordId = Number(result.lastInsertRowid);
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(
      user.id,
      isAthleteFeedback ? 'SUBMIT_INJURY_FEEDBACK' : 'CREATE_INJURY_RECORD',
      'injury_record',
      recordId,
      JSON.stringify({ athleteId, bodyPart, status, painScore })
    );
    res.status(201).json({
      message: isAthleteFeedback ? '疼痛反馈已提交，等待教练确认。' : '伤病与恢复记录已保存。',
      record: injuryRecordById(recordId),
    });
  });
}
