import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import {
  clearRateLimit,
  consumeRateLimit,
  jwtSecret,
  requireAuth,
  requireRole,
} from '../core/auth.ts';
import {
  accessibleAthleteIds,
  accountPermissions,
  accountCodeFor,
  canManageAccount,
  initializeAccountScope,
  permissionsAllowProjectTeam,
  replaceAccountScope,
  selectableProjects,
} from '../core/permissions.ts';
import {
  birthDateFromIdentityNumber,
  cleanString,
  userById,
  validatePersonName,
} from '../core/utils.ts';
import { db } from '../core/db.ts';
import { PROVINCE_CITIES } from '../../shared/regions.ts';
import { PROJECTS } from '../../shared/projects.ts';

import type { AuthUser, Project } from '../core/shared-server.ts';
import type { Role } from '../../shared/access.ts';
import {
  registrationApprovalEnabled,
  activateRegistrationRequest,
} from './registration-service.ts';

export function registerAuthRoutes(app: Express) {
  app.get('/api/registration/teams', (_req, res) => {
    const teams = db.prepare('SELECT id, project, name FROM project_teams WHERE active = 1 ORDER BY project, name').all();
    res.json({ teams });
  });

  app.get('/api/teams', requireAuth, (req, res) => {
    const permissions = accountPermissions(req.authUser!.id);
    const athleteIds = accessibleAthleteIds(req.authUser!);
    const scopedCounts = athleteIds.length ? db.prepare(`SELECT team_id AS teamId, COUNT(*) AS count
      FROM athletes WHERE active = 1 AND id IN (${athleteIds.map(() => '?').join(',')}) GROUP BY team_id`)
      .all(...athleteIds) as Array<{ teamId: number; count: number }> : [];
    const countByTeam = new Map(scopedCounts.map((row) => [row.teamId, row.count]));
    const teams = (db
      .prepare(
        `
      SELECT pt.id, pt.project, pt.name
      FROM project_teams pt WHERE pt.active = 1 ORDER BY pt.project, pt.name
    `
      )
      .all() as Array<{ id: number; project: string; name: string }> )
      .filter((team) => permissionsAllowProjectTeam(permissions, team.project, team.name))
      .map((team) => ({ ...team, athleteCount: countByTeam.get(team.id) || 0 }));
    res.json({ teams });
  });

  app.get(
    '/api/admin/teams',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const permissions = accountPermissions(currentUser.id);
      const allTeams = db
        .prepare(
          `
      SELECT id, project, name FROM project_teams WHERE active = 1 ORDER BY project, name
    `
        )
        .all() as Array<{ id: number; project: string; name: string }>;
      const athleteIds = accessibleAthleteIds(currentUser);
      const visibleAthletes = athleteIds.length
        ? (db
            .prepare(
              `
      SELECT a.project, COALESCE(pt.name, '') AS team FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id WHERE a.id IN (${athleteIds.map(() => '?').join(',')}) AND a.active = 1
    `
            )
            .all(...athleteIds) as Array<{ project: string; team: string }>)
        : [];
      const athleteCounts = new Map<string, number>();
      for (const athlete of visibleAthletes) {
        const key = `${athlete.project}\u0000${athlete.team}`;
        athleteCounts.set(key, (athleteCounts.get(key) || 0) + 1);
      }
      const teams = allTeams
        .filter((team) => permissionsAllowProjectTeam(permissions, team.project, team.name))
        .map((team) => ({
          ...team,
          athleteCount: athleteCounts.get(`${team.project}\u0000${team.name}`) || 0,
          canDelete: currentUser.role !== 'SCC',
        }));
      const canCreateProjects =
        currentUser.role === 'SCC'
          ? []
          : PROJECTS.filter(
              (project) =>
                (permissions.projects.includes('*') || permissions.projects.includes(project)) &&
                permissions.teams.some(
                  (item) => (item.project === '*' || item.project === project) && item.team === '*'
                )
            );
      res.json({ teams, canCreateProjects });
    }
  );

  app.post(
    '/api/admin/teams',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const project = cleanString(req.body?.project);
      const name = cleanString(req.body?.name);
      if (!PROJECTS.includes(project)) return res.status(400).json({ message: '请选择有效项目。' });
      if (name.length < 2 || name.length > 30)
        return res.status(400).json({ message: '队伍名称须为2—30个字符。' });
      const permissions = accountPermissions(req.authUser!.id);
      const canCreate =
        req.authUser!.role !== 'SCC' &&
        (permissions.projects.includes('*') || permissions.projects.includes(project)) &&
        permissions.teams.some(
          (item) => (item.project === '*' || item.project === project) && item.team === '*'
        );
      if (!canCreate) return res.status(403).json({ message: '无权在该项目下新增队伍。' });
      const existing = db
        .prepare('SELECT id, active FROM project_teams WHERE project = ? AND name = ?')
        .get(project, name) as { id: number; active: number } | undefined;
      if (existing?.active) return res.status(409).json({ message: '该项目下已存在同名队伍。' });
      if (existing) {
        db.prepare('UPDATE project_teams SET active = 1 WHERE id = ?').run(existing.id);
        return res.status(201).json({ message: '队伍已恢复。', id: existing.id });
      }
      const result = db
        .prepare('INSERT INTO project_teams (project, name) VALUES (?, ?)')
        .run(project, name);
      res.status(201).json({ message: '队伍已添加。', id: Number(result.lastInsertRowid) });
    }
  );

  app.delete(
    '/api/admin/teams/:id',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const id = Number(req.params.id);
      const team = db
        .prepare('SELECT id, project, name FROM project_teams WHERE id = ? AND active = 1')
        .get(id) as { id: number; project: string; name: string } | undefined;
      if (!team) return res.status(404).json({ message: '队伍不存在。' });
      if (
        req.authUser!.role === 'SCC' ||
        !permissionsAllowProjectTeam(accountPermissions(req.authUser!.id), team.project, team.name)
      ) {
        return res.status(403).json({ message: '无权删除该队伍。' });
      }
      const athleteCount = (
        db
          .prepare('SELECT COUNT(*) AS count FROM athletes WHERE team_id = ? AND active = 1')
          .get(team.id) as { count: number }
      ).count;
      const pendingCount = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM registration_requests WHERE project = ? AND team = ? AND status = 'pending'"
          )
          .get(team.project, team.name) as { count: number }
      ).count;
      if (athleteCount || pendingCount)
        return res.status(409).json({ message: '该队伍仍有运动员或待审核申请，不能删除。' });
      db.prepare('UPDATE project_teams SET active = 0 WHERE id = ?').run(id);
      res.json({ message: '队伍已删除。' });
    }
  );

  app.post('/api/auth/register', (req, res) => {
    if (consumeRateLimit(req, 'register', 30, 15 * 60 * 1000)) {
      return res.status(429).json({ message: '申请次数过多，请稍后再试。' });
    }
    const username = cleanString(req.body?.username).toLowerCase();
    const password = cleanString(req.body?.password);
    const displayName = cleanString(req.body?.displayName);
    const requestedRoleInput = cleanString(req.body?.role);
    const requestedRole =
      requestedRoleInput === 'athlete'
        ? 'ATL'
        : requestedRoleInput === 'coach'
          ? 'SCC'
          : requestedRoleInput;
    const project = cleanString(req.body?.project);
    const team = cleanString(req.body?.team);
    const identityNumber = cleanString(req.body?.identityNumber).toUpperCase();
    const gender = /^\d{17}[\dX]$/.test(identityNumber)
      ? Number(identityNumber[16]) % 2
        ? '男'
        : '女'
      : '';
    const nativePlace = cleanString(req.body?.nativePlace);
    const phone = cleanString(req.body?.phone).replace(/[\s-]/g, '');
    const errors: string[] = [];
    const [nativePlaceProvince = '', nativePlaceCity = '', ...nativePlaceRest] =
      nativePlace.split('/');

    if (!/^[a-z0-9_]{4,24}$/.test(username)) errors.push('账号须为4—24位字母、数字或下划线');
    if (
      password.length < 8 ||
      password.length > 72 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      errors.push('密码须为8—72位，并同时包含字母和数字');
    }
    if (displayName.length < 2 || displayName.length > 20) errors.push('姓名须为2—20个字符');
    if (requestedRole !== 'ATL' && requestedRole !== 'SCC') errors.push('仅支持注册运动员或教练');
    if (!PROJECTS.includes(project)) errors.push('请选择赛艇、皮划艇或激流');
    const validTeam = db
      .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
      .get(project, team);
    if (!validTeam) errors.push('请选择该项目下的有效队伍');
    if (requestedRole === 'ATL') {
      if (!/^\d{17}[\dX]$/.test(identityNumber))
        errors.push('身份证号须为18位，前17位为数字，末位为数字或X');
      if (
        nativePlaceRest.length ||
        !PROVINCE_CITIES[nativePlaceProvince]?.includes(nativePlaceCity)
      ) {
        errors.push('请选择有效且对应的籍贯省市');
      }
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) errors.push('手机号须为11位大陆手机号');
    if (errors.length) return res.status(400).json({ message: errors.join('；') });

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) return res.status(409).json({ message: '该账号已存在。' });
    const existingRequest = db
      .prepare('SELECT id, status FROM registration_requests WHERE username = ?')
      .get(username) as { id: number; status: string } | undefined;
    if (existingRequest?.status === 'pending')
      return res.status(409).json({ message: '该账号正在审核中。' });
    if (existingRequest?.status === 'approved')
      return res.status(409).json({ message: '该账号已通过审核，请直接登录。' });

    const passwordHash = bcrypt.hashSync(password, 11);
    let registrationId: number;
    if (existingRequest?.status === 'rejected') {
      db.prepare(
        `
        UPDATE registration_requests SET password_hash = ?, display_name = ?, requested_role = ?,
          project = ?, team = ?, gender = ?, identity_number = ?, native_place = ?, phone = ?, region = NULL, city = NULL, county = NULL, status = 'pending', reviewed_by = NULL,
          reviewed_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?
      `
      ).run(
        passwordHash,
        displayName,
        requestedRole,
        project,
        team,
        gender,
        identityNumber,
        nativePlace,
        phone,
        existingRequest.id
      );
      registrationId = existingRequest.id;
    } else {
      const insertResult = db
        .prepare(
          `
        INSERT INTO registration_requests (
          username, password_hash, display_name, requested_role, project, team, gender, identity_number, native_place, phone
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          username,
          passwordHash,
          displayName,
          requestedRole,
          project,
          team,
          gender,
          identityNumber,
          nativePlace,
          phone
        );
      registrationId = Number(insertResult.lastInsertRowid);
    }

    if (!registrationApprovalEnabled()) {
      const activation = activateRegistrationRequest(registrationId, null);
      if (activation.ok) {
        return res.status(201).json({ message: '注册成功，可直接登录。', status: 'approved' });
      }
      return res
        .status(201)
        .json({ message: '申请已提交，审核通过后即可登录。', status: 'pending' });
    }
    res.status(201).json({ message: '申请已提交，审核通过后即可登录。', status: 'pending' });
  });

  app.post('/api/auth/login', (req, res) => {
    if (consumeRateLimit(req, 'login', 12, 15 * 60 * 1000)) {
      return res.status(429).json({ message: '登录尝试过多，请稍后再试。' });
    }
    const username = cleanString(req.body?.username).toLowerCase();
    const password = cleanString(req.body?.password);
    const row = db
      .prepare(
        'SELECT id, username, password_hash, display_name, role, athlete_id FROM users WHERE username = ? AND active = 1'
      )
      .get(username) as
      | {
          id: number;
          username: string;
          password_hash: string;
          display_name: string;
          role: Role;
          athlete_id: number | null;
        }
      | undefined;

    if (!row) {
      const request = db
        .prepare('SELECT status FROM registration_requests WHERE username = ?')
        .get(username) as { status: string } | undefined;
      if (request?.status === 'pending')
        return res.status(403).json({ message: '账户正在审核中。' });
      if (request?.status === 'rejected')
        return res.status(403).json({ message: '注册申请未通过，请联系管理员。' });
    }
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ message: '账号或密码不正确。' });
    }

    const user: AuthUser = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      athleteId: row.athlete_id,
    };
    const token = jwt.sign(user, jwtSecret, { expiresIn: '12h' });
    clearRateLimit(req, 'login');
    res.json({ token, user });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    const user = userById(req.authUser!.id);
    if (!user) return res.status(404).json({ message: '账户不存在。' });
    res.json({ user });
  });

  app.get('/api/preferences/current-project', requireAuth, (req, res) => {
    const projects = selectableProjects(req.authUser!);
    const row = db
      .prepare(
        `
      SELECT layout_json AS value FROM user_dashboard_preferences
      WHERE user_id = ? AND dashboard = 'app-context' AND project = '*' AND scope = 'current-project'
    `
      )
      .get(req.authUser!.id) as { value: string } | undefined;
    let project: Project | null = null;
    try {
      const saved = JSON.parse(row?.value || '{}') as { project?: unknown };
      if (typeof saved.project === 'string' && projects.includes(saved.project))
        project = saved.project;
    } catch {
      /* 损坏偏好不影响进入系统 */
    }
    res.json({ project, projects });
  });

  app.put('/api/preferences/current-project', requireAuth, (req, res) => {
    const project = cleanString(req.body?.project);
    const projects = selectableProjects(req.authUser!);
    if (!PROJECTS.includes(project)) return res.status(400).json({ message: '项目参数无效。' });
    if (!projects.includes(project)) return res.status(403).json({ message: '无权选择该项目。' });
    db.prepare(
      `
      INSERT INTO user_dashboard_preferences (user_id, dashboard, project, scope, layout_json, updated_at)
      VALUES (?, 'app-context', '*', 'current-project', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, dashboard, project, scope) DO UPDATE SET layout_json = excluded.layout_json, updated_at = CURRENT_TIMESTAMP
    `
    ).run(req.authUser!.id, JSON.stringify({ project }));
    res.json({ project });
  });

  app.put('/api/profile/name', requireAuth, (req, res) => {
    const { name, error } = validatePersonName(req.body?.name);
    if (error) return res.status(400).json({ message: error });
    const current = userById(req.authUser!.id);
    if (!current) return res.status(404).json({ message: '账户不存在。' });

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, current.id);
      if (current.role === 'ATL' && current.athleteId) {
        db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(name, current.athleteId);
      }
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
      ).run(
        current.id,
        'UPDATE_OWN_NAME',
        'user',
        current.id,
        JSON.stringify({ from: current.displayName, to: name })
      );
      db.exec('COMMIT');
      res.json({ message: '姓名已修改。', user: { ...current, displayName: name } });
    } catch (renameError) {
      db.exec('ROLLBACK');
      const message =
        renameError instanceof Error && renameError.message.includes('UNIQUE')
          ? '该姓名已被其他运动员使用。'
          : '姓名修改失败。';
      res.status(409).json({ message });
    }
  });

  app.put('/api/users/:id/name', requireAuth, (req, res) => {
    const targetId = Number(req.params.id);
    const target = userById(targetId);
    if (!target) return res.status(404).json({ message: '账户不存在。' });
    const requester = req.authUser!;
    const canRename = canManageAccount(requester, target);
    if (!canRename) return res.status(403).json({ message: '当前账户没有修改该姓名的权限。' });
    const { name, error } = validatePersonName(req.body?.name);
    if (error) return res.status(400).json({ message: error });

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, target.id);
      if (target.role === 'ATL' && target.athleteId) {
        db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(name, target.athleteId);
      }
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
      ).run(
        requester.id,
        'UPDATE_USER_NAME',
        'user',
        target.id,
        JSON.stringify({ from: target.displayName, to: name })
      );
      db.exec('COMMIT');
      res.json({ message: '姓名已修改。', displayName: name });
    } catch (renameError) {
      db.exec('ROLLBACK');
      const message =
        renameError instanceof Error && renameError.message.includes('UNIQUE')
          ? '该姓名已被其他运动员使用。'
          : '姓名修改失败。';
      res.status(409).json({ message });
    }
  });
}
