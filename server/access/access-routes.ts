import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { db, upsertAthleteOrigin } from '../core/db.ts';
import {
  accessibleAthleteIds,
  accountPermissions,
  accountCodeFor,
  canManageAccount,
  hasAthleteAccess,
  parseScopePayload,
  permissionsAllowAthlete,
  permissionsAllowProjectTeam,
  permissionsContain,
  replaceAccountScope,
  standardAccountName,
  validateScopePayload,
  selectableProjects,
} from '../core/permissions.ts';
import { cleanString, userById, validatePersonName } from '../core/utils.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import {
  ROLES,
  ROLE_META,
  ROLE_HIERARCHY,
  AREA_LEVEL_META,
  canManageRole,
  type Role,
} from '../../shared/access.ts';
import { PROVINCES } from '../../shared/regions.ts';
import { PROJECTS } from '../../shared/projects.ts';
import { DEFAULT_COACH_CATEGORY, isCoachCategory } from '../../shared/coach-categories.ts';
import {
  registrationApprovalEnabled,
  setRegistrationApprovalEnabled,
  activateRegistrationRequest,
} from './registration-service.ts';
import type { AuthUser, AreaPermission } from '../core/shared-server.ts';

export type AccountRow = AuthUser & {
  active: number;
  parentUserId: number | null;
  parentName: string | null;
  accountCode: string;
};

export function allAccountRows() {
  return db
    .prepare(
      `
    SELECT u.id, u.username, u.display_name AS displayName, u.role,
      u.athlete_id AS athleteId, u.active,
      ap.parent_user_id AS parentUserId, parent.display_name AS parentName,
      COALESCE(ap.account_code, '') AS accountCode
    FROM users u
    LEFT JOIN account_profiles ap ON ap.user_id = u.id
    LEFT JOIN users parent ON parent.id = ap.parent_user_id
    ORDER BY CASE u.role
      WHEN 'DMD' THEN 5 WHEN 'TD' THEN 4 WHEN 'PRJ' THEN 3
      WHEN 'REG' THEN 3 WHEN 'SCC' THEN 2 ELSE 1 END DESC,
      u.display_name, u.id
  `
    )
    .all() as AccountRow[];
}

export function serializeAccount(row: AccountRow) {
  const permissions = accountPermissions(row.id);
  return {
    ...row,
    roleLabel: ROLE_META[row.role].label,
    roleLevel: ROLE_META[row.role].level,
    standardName: standardAccountName({
      displayName: row.displayName,
      role: row.role,
      areas: permissions.areas,
      projects: permissions.projects,
      teams: permissions.teams,
    }),
    areas: permissions.areas,
    projects: permissions.projects,
    teams: permissions.teams,
  };
}

export function resolveParent(
  currentUser: AuthUser,
  targetRole: Role,
  parentUserId: number,
  targetPermissions: ReturnType<typeof parseScopePayload>
) {
  const parent = userById(parentUserId);
  if (!parent || !canManageRole(parent.role, targetRole))
    return { error: '上级账号层级不符合要求。', parent: null };
  if (parent.id !== currentUser.id && !canManageAccount(currentUser, parent)) {
    return { error: '不能选择权限范围外的上级账号。', parent: null };
  }
  if (!permissionsContain(accountPermissions(parent.id), targetPermissions)) {
    return { error: '账号权限范围不能超出上级账号。', parent: null };
  }
  return { error: '', parent };
}

export function registerAccessRoutes(app: Express) {
  app.get(
    '/api/admin/registrations/approval',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (_req, res) => {
      res.json({ enabled: registrationApprovalEnabled() });
    }
  );

  app.put(
    '/api/admin/registrations/approval',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ message: '开关参数无效。' });
      }
      const enabled = req.body.enabled as boolean;
      const previous = registrationApprovalEnabled();
      setRegistrationApprovalEnabled(enabled);
      if (previous !== enabled) {
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          req.authUser!.id,
          'UPDATE_REGISTRATION_APPROVAL',
          'setting',
          null,
          JSON.stringify({ from: previous, to: enabled })
        );
      }
      res.json({ enabled });
    }
  );

  app.get(
    '/api/admin/registrations',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const requestedStatus = cleanString(req.query.status);
      const status = ['pending', 'approved', 'rejected'].includes(requestedStatus)
        ? requestedStatus
        : 'pending';
      const allRequests = db
        .prepare(
          `
      SELECT id, username, display_name AS displayName, requested_role AS requestedRole,
        project, team, gender, identity_number AS identityNumber, native_place AS nativePlace, phone, status,
        created_at AS createdAt, reviewed_at AS reviewedAt
      FROM registration_requests WHERE status = ? ORDER BY created_at ASC
    `
        )
        .all(status) as Array<{
        id: number;
        username: string;
        displayName: string;
        requestedRole: 'ATL' | 'SCC';
        project: string;
        team: string;
        gender: string | null;
        identityNumber: string | null;
        nativePlace: string | null;
        phone: string | null;
        status: string;
        createdAt: string;
        reviewedAt: string | null;
      }>;
      const reviewer = req.authUser!;
      const permissions = accountPermissions(reviewer.id);
      const requests = allRequests.filter(
        (request) =>
          canManageRole(reviewer.role, request.requestedRole) &&
          permissionsAllowProjectTeam(permissions, request.project, request.team)
      );
      const pending =
        status === 'pending'
          ? requests.length
          : (
              db
                .prepare(
                  `
      SELECT requested_role AS requestedRole, project, team
      FROM registration_requests WHERE status = 'pending'
    `
                )
                .all() as Array<{ requestedRole: 'ATL' | 'SCC'; project: string; team: string }>
            ).filter(
              (request) =>
                canManageRole(reviewer.role, request.requestedRole) &&
                permissionsAllowProjectTeam(permissions, request.project, request.team)
            ).length;
      res.json({ requests, pending });
    }
  );

  app.put(
    '/api/admin/registrations/:id/name',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const requestId = Number(req.params.id);
      const registration = db
        .prepare(
          `
      SELECT id, username, display_name AS displayName, requested_role AS requestedRole, status
      FROM registration_requests WHERE id = ?
    `
        )
        .get(requestId) as
        | {
            id: number;
            username: string;
            displayName: string;
            requestedRole: 'ATL' | 'SCC';
            status: 'pending' | 'approved' | 'rejected';
          }
        | undefined;
      if (!registration) return res.status(404).json({ message: '注册申请不存在。' });
      const registrationScope = db
        .prepare(
          `
      SELECT requested_role AS requestedRole, project, team
      FROM registration_requests WHERE id = ?
    `
        )
        .get(requestId) as { requestedRole: Role; project: string; team: string };
      if (
        !canManageRole(req.authUser!.role, registrationScope.requestedRole) ||
        !permissionsAllowProjectTeam(
          accountPermissions(req.authUser!.id),
          registrationScope.project,
          registrationScope.team
        )
      )
        return res.status(403).json({ message: '无权修改该注册申请。' });
      const { name, error } = validatePersonName(req.body?.name);
      if (error) return res.status(400).json({ message: error });

      db.exec('BEGIN');
      try {
        db.prepare('UPDATE registration_requests SET display_name = ? WHERE id = ?').run(
          name,
          requestId
        );
        if (registration.status === 'approved') {
          const linkedUser = db
            .prepare('SELECT id, athlete_id AS athleteId FROM users WHERE username = ?')
            .get(registration.username) as
            | {
                id: number;
                athleteId: number | null;
              }
            | undefined;
          if (linkedUser) {
            db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, linkedUser.id);
            if (registration.requestedRole === 'ATL' && linkedUser.athleteId) {
              db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(
                name,
                linkedUser.athleteId
              );
            }
          }
        }
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          req.authUser!.id,
          'UPDATE_REGISTRATION_NAME',
          'registration_request',
          requestId,
          JSON.stringify({ from: registration.displayName, to: name })
        );
        db.exec('COMMIT');
        res.json({ message: '申请姓名已修改。', displayName: name });
      } catch (renameError) {
        db.exec('ROLLBACK');
        const message =
          renameError instanceof Error && renameError.message.includes('UNIQUE')
            ? '该姓名已被其他运动员使用。'
            : '姓名修改失败。';
        res.status(409).json({ message });
      }
    }
  );

  app.post(
    '/api/admin/registrations/:id/approve',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const requestId = Number(req.params.id);
      const outcome = activateRegistrationRequest(requestId, req.authUser!);
      if (!outcome.ok) return res.status(outcome.status).json({ message: outcome.message });
      res.json({ message: '账户已开通。' });
    }
  );

  app.post(
    '/api/admin/registrations/:id/reject',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const requestId = Number(req.params.id);
      const registration = db
        .prepare(
          `
      SELECT requested_role AS requestedRole, project, team
      FROM registration_requests WHERE id = ?
    `
        )
        .get(requestId) as
        | {
            requestedRole: Role;
            project: string;
            team: string;
          }
        | undefined;
      if (!registration) return res.status(404).json({ message: '注册申请不存在。' });
      if (
        !canManageRole(req.authUser!.role, registration.requestedRole) ||
        !permissionsAllowProjectTeam(
          accountPermissions(req.authUser!.id),
          registration.project,
          registration.team
        )
      )
        return res.status(403).json({ message: '无权处理该注册申请。' });
      const result = db
        .prepare(
          `
      UPDATE registration_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `
        )
        .run(req.authUser!.id, requestId);
      if (!result.changes) return res.status(409).json({ message: '申请不存在或已经处理。' });
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
      ).run(req.authUser!.id, 'REJECT_REGISTRATION', 'registration_request', requestId);
      res.json({ message: '申请已拒绝。' });
    }
  );

  app.get(
    '/api/admin/assignments',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const ids = accessibleAthleteIds(req.authUser!);
      if (!ids.length) return res.json({ athletes: [], coaches: [] });
      const placeholders = ids.map(() => '?').join(',');
      const athletes = db
        .prepare(
          `
      SELECT a.id, a.name, a.project, COALESCE(pt.name, '') AS team, a.gender, COALESCE(ao.province, '未设置') AS region, COALESCE(ao.province, '未设置') AS province, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county,
        COALESCE(GROUP_CONCAT(u.display_name, '、'), '') AS coaches,
        COALESCE(GROUP_CONCAT(u.id, ','), '') AS coachIds
      FROM athletes a
      LEFT JOIN project_teams pt ON pt.id = a.team_id
      LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
      LEFT JOIN coach_athletes ca ON ca.athlete_id = a.id
      LEFT JOIN users u ON u.id = ca.coach_user_id
      WHERE a.id IN (${placeholders}) AND a.active = 1
      GROUP BY a.id ORDER BY a.project, pt.name, a.name
    `
        )
        .all(...ids);
      const allCoaches = db
        .prepare(
          `
      SELECT u.id, u.username, u.display_name AS displayName, u.role, u.athlete_id AS athleteId,
        COALESCE(cp.category, '体能教练') AS category
      FROM users u
      LEFT JOIN coach_profiles cp ON cp.user_id = u.id
      WHERE u.role = 'SCC' AND u.active = 1 ORDER BY u.id
    `
        )
        .all() as Array<AuthUser & { displayName: string; category: string }>;
      const coaches = allCoaches
        .filter((coach) => coach.id === req.authUser!.id || canManageAccount(req.authUser!, coach))
        .map(({ id, displayName, category }) => ({ id, displayName, category }));
      res.json({ athletes, coaches });
    }
  );

  app.put(
    '/api/admin/coaches/:id/category',
    requireAuth,
    requireRole('PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const coachId = Number(req.params.id);
      const category = cleanString(req.body?.category);
      const coach = userById(coachId);
      if (!coach || coach.role !== 'SCC' || !canManageAccount(currentUser, coach)) {
        return res.status(404).json({ message: '教练不存在或不在可管理范围内。' });
      }
      if (!isCoachCategory(category)) return res.status(400).json({ message: '教练类别无效。' });
      db.prepare(
        `
      INSERT INTO coach_profiles (user_id, category, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET category = excluded.category, updated_at = CURRENT_TIMESTAMP
    `
      ).run(coachId, category);
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
      ).run(currentUser.id, 'UPDATE_COACH_CATEGORY', 'user', coachId, JSON.stringify({ category }));
      res.json({ message: '教练类别已更新。', category });
    }
  );

  app.put(
    '/api/admin/assignments/:athleteId',
    requireAuth,
    requireRole('PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const athleteId = Number(req.params.athleteId);
      const coachIds = Array.isArray(req.body?.coachIds)
        ? req.body.coachIds.map(Number).filter(Number.isFinite)
        : [];
      const region = cleanString(req.body?.region);
      const city = cleanString(req.body?.city);
      const county = cleanString(req.body?.county);
      const currentUser = req.authUser!;
      const validCoaches = new Set(
        (
          db
            .prepare(
              `
        SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId
        FROM users WHERE role = 'SCC' AND active = 1
      `
            )
            .all() as AuthUser[]
        )
          .filter((coach) => canManageAccount(currentUser, coach))
          .map((row) => row.id)
      );
      const athlete = db
        .prepare('SELECT id, project, team FROM athletes WHERE id = ?')
        .get(athleteId) as
        | {
            id: number;
            project: string;
            team: string;
          }
        | undefined;
      const targetScope = {
        id: athleteId,
        region,
        city,
        county,
        project: athlete?.project || '',
        team: athlete?.team || '',
      };
      if (
        !athlete ||
        !hasAthleteAccess(currentUser, athleteId) ||
        coachIds.some((id: number) => !validCoaches.has(id)) ||
        !(PROVINCES as readonly string[]).includes(region) ||
        city.length < 2 ||
        county.length < 2 ||
        !permissionsAllowAthlete(accountPermissions(currentUser.id), targetScope)
      ) {
        return res.status(400).json({ message: '运动员或教练信息无效。' });
      }
      db.exec('BEGIN');
      try {
        upsertAthleteOrigin({
          athleteId,
          province: region,
          city,
          county,
          source: 'manual',
          quality: 'valid',
        });
        const athleteUser = db
          .prepare("SELECT id FROM users WHERE athlete_id = ? AND role = 'ATL'")
          .get(athleteId) as { id: number } | undefined;
        if (athleteUser) {
          db.prepare('DELETE FROM user_area_permissions WHERE user_id = ?').run(athleteUser.id);
          db.prepare(
            `
          INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
          VALUES (?, 'county', ?, ?, ?, ?)
        `
          ).run(athleteUser.id, region, city, county, currentUser.id);
        }
        db.prepare('DELETE FROM coach_athletes WHERE athlete_id = ?').run(athleteId);
        const insert = db.prepare(
          'INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)'
        );
        for (const coachId of coachIds) insert.run(coachId, athleteId);
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          currentUser.id,
          'UPDATE_ASSIGNMENT',
          'athlete',
          athleteId,
          JSON.stringify({ coachIds, region, city, county })
        );
        db.exec('COMMIT');
        res.json({ updated: true });
      } catch (error) {
        db.exec('ROLLBACK');
        res.status(500).json({
          message: `更新关系失败：${error instanceof Error ? error.message : '未知错误'}`,
        });
      }
    }
  );

  app.get(
    '/api/access/accounts',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const rows = allAccountRows();
      const current = rows.find((row) => row.id === currentUser.id);
      const accounts = rows.filter(
        (row) => row.id !== currentUser.id && canManageAccount(currentUser, row)
      );
      const visibleParents = rows.filter(
        (row) =>
          row.active === 1 &&
          (row.id === currentUser.id || canManageAccount(currentUser, row)) &&
          canManageRole(currentUser.role, 'ATL')
      );
      res.json({
        current: current ? serializeAccount(current) : null,
        accounts: accounts.map(serializeAccount),
        possibleParents: visibleParents.map((row) => ({
          id: row.id,
          displayName: row.displayName,
          role: row.role,
          roleLabel: ROLE_META[row.role].label,
        })),
        meta: {
          roles: ROLE_META,
          hierarchy: ROLE_HIERARCHY,
          areaLevels: AREA_LEVEL_META,
          provinces: PROVINCES,
          projects: [...PROJECTS],
        },
      });
    }
  );

  app.post(
    '/api/access/accounts',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const username = cleanString(req.body?.username).toLowerCase();
      const password = cleanString(req.body?.password);
      const displayNameResult = validatePersonName(req.body?.displayName);
      const role = cleanString(req.body?.role) as Role;
      const parentUserId = Number(req.body?.parentUserId);
      const gender = cleanString(req.body?.gender);
      const coachCategory = cleanString(req.body?.coachCategory) || DEFAULT_COACH_CATEGORY;
      const permissions = parseScopePayload(req.body);
      const errors: string[] = [];
      if (!/^[a-z0-9_]{4,24}$/.test(username)) errors.push('账号须为4—24位字母、数字或下划线');
      if (
        password.length < 8 ||
        password.length > 72 ||
        !/[A-Za-z]/.test(password) ||
        !/\d/.test(password)
      ) {
        errors.push('密码须为8—72位，并同时包含字母和数字');
      }
      if (displayNameResult.error) errors.push(displayNameResult.error);
      if (!ROLES.includes(role) || !canManageRole(currentUser.role, role))
        errors.push('不能创建该层级的账号');
      const scopeError = validateScopePayload(permissions);
      if (scopeError) errors.push(scopeError);
      if (!permissionsContain(accountPermissions(currentUser.id), permissions))
        errors.push('账号权限范围不能超出当前账号');
      if (role === 'ATL') {
        if (permissions.areas.length !== 1 || permissions.areas[0].areaLevel !== 'county') {
          errors.push('运动员必须绑定一个省、市、区县');
        }
        if (permissions.projects.length !== 1 || permissions.projects[0] === '*')
          errors.push('运动员必须绑定一个具体项目');
        if (permissions.teams.length !== 1 || permissions.teams[0].team === '*')
          errors.push('运动员必须绑定一个具体队伍');
        if (!['男', '女'].includes(gender)) errors.push('请选择运动员性别');
      }
      if (role === 'SCC') {
        if (!isCoachCategory(coachCategory)) errors.push('请选择有效的教练类别');
        if (permissions.projects.includes('*')) errors.push('教练必须绑定具体项目，不能使用通配符');
        if (
          permissions.teams.some(
            (team: { project: string; team: string }) => team.project === '*' || team.team === '*'
          )
        )
          errors.push('教练必须绑定具体队伍，不能使用通配符');
      }
      const parentResult = Number.isFinite(parentUserId)
        ? resolveParent(currentUser, role, parentUserId, permissions)
        : { error: '请选择上级管理账号。', parent: null };
      if (parentResult.error) errors.push(parentResult.error);
      if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
        return res.status(409).json({ message: '该登录账号已存在。' });
      }

      db.exec('BEGIN');
      try {
        let athleteId: number | null = null;
        const area = permissions.areas[0];
        const project = permissions.projects[0];
        const team = permissions.teams[0].team;
        if (role === 'ATL') {
          const teamRow = db
            .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
            .get(project, team) as { id: number } | undefined;
          if (!teamRow) throw new Error('所选队伍不存在或已停用。');
          const athleteResult = db
            .prepare(
              `INSERT INTO athletes (name, project, team, team_id, gender) VALUES (?, ?, ?, ?, ?)`
            )
            .run(displayNameResult.name, project, team, teamRow.id, gender);
          athleteId = Number(athleteResult.lastInsertRowid);
          upsertAthleteOrigin({
            athleteId,
            province: area.province,
            city: area.city,
            county: area.county,
            source: 'manual',
            quality: 'valid',
          });
          db.prepare(
            `
          INSERT INTO athlete_profiles (athlete_id, created_at)
          VALUES (?, CURRENT_TIMESTAMP)
        `
          ).run(athleteId);
        }
        const userResult = db
          .prepare(
            `
        INSERT INTO users (username, password_hash, display_name, role, athlete_id, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `
          )
          .run(username, bcrypt.hashSync(password, 11), displayNameResult.name, role, athleteId);
        const userId = Number(userResult.lastInsertRowid);
        if (role === 'SCC') {
          db.prepare('INSERT INTO coach_profiles (user_id, category) VALUES (?, ?)').run(
            userId,
            coachCategory
          );
        }
        db.prepare(
          `
        INSERT INTO account_profiles (user_id, parent_user_id, account_code)
        VALUES (?, ?, ?)
      `
        ).run(userId, parentUserId, accountCodeFor(userId, role, area.province, project));
        replaceAccountScope({ userId, role, parentUserId, permissions, grantedBy: currentUser.id });
        if (role === 'ATL' && athleteId && parentResult.parent?.role === 'SCC') {
          db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(
            parentUserId,
            athleteId
          );
        }
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          currentUser.id,
          'CREATE_ACCOUNT',
          'user',
          userId,
          JSON.stringify({ username, role, parentUserId, permissions })
        );
        db.exec('COMMIT');
        res.status(201).json({ message: '账号已创建并完成权限绑定。', id: userId });
      } catch (error) {
        db.exec('ROLLBACK');
        const message =
          error instanceof Error && error.message.includes('UNIQUE')
            ? '姓名或账号已存在，请核对后再试。'
            : error instanceof Error
              ? error.message
              : '创建账号失败。';
        res.status(400).json({ message });
      }
    }
  );

  app.put(
    '/api/access/accounts/:id',
    requireAuth,
    requireRole('PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const targetId = Number(req.params.id);
      const target = userById(targetId);
      if (!target || !canManageAccount(currentUser, target)) {
        return res.status(404).json({ message: '账号不存在或不在可管理范围内。' });
      }
      const role = cleanString(req.body?.role) as Role;
      const parentUserId = Number(req.body?.parentUserId);
      const permissions = parseScopePayload(req.body);
      const scopeError = validateScopePayload(permissions);
      if (!ROLES.includes(role) || !canManageRole(currentUser.role, role)) {
        return res.status(400).json({ message: '目标角色层级无效。' });
      }
      if ((target.role === 'ATL') !== (role === 'ATL')) {
        return res.status(400).json({ message: '运动员账号不能与管理岗位相互转换。' });
      }
      if (scopeError) return res.status(400).json({ message: scopeError });
      if (!permissionsContain(accountPermissions(currentUser.id), permissions)) {
        return res.status(403).json({ message: '新的权限范围不能超出当前账号。' });
      }
      const parentResult = resolveParent(currentUser, role, parentUserId, permissions);
      if (parentResult.error) return res.status(400).json({ message: parentResult.error });
      if (parentUserId === targetId)
        return res.status(400).json({ message: '上级账号不能选择本人。' });
      if (target.role === 'ATL') {
        if (
          permissions.areas.length !== 1 ||
          permissions.areas[0].areaLevel !== 'county' ||
          permissions.projects.length !== 1 ||
          permissions.projects[0] === '*' ||
          permissions.teams.length !== 1 ||
          permissions.teams[0].team === '*'
        ) {
          return res.status(400).json({ message: '运动员必须绑定一个具体区县、项目和队伍。' });
        }
      }
      if (role === 'SCC') {
        if (permissions.projects.includes('*')) {
          return res.status(400).json({ message: '教练必须绑定具体项目，不能使用通配符。' });
        }
        if (
          permissions.teams.some(
            (team: { project: string; team: string }) => team.project === '*' || team.team === '*'
          )
        ) {
          return res.status(400).json({ message: '教练必须绑定具体队伍，不能使用通配符。' });
        }
      }

      db.exec('BEGIN');
      try {
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
        replaceAccountScope({
          userId: targetId,
          role,
          parentUserId,
          permissions,
          grantedBy: currentUser.id,
        });
        if (target.role === 'ATL' && target.athleteId) {
          const area = permissions.areas[0];
          const project = permissions.projects[0];
          const team = permissions.teams[0].team;
          const teamRow = db
            .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
            .get(project, team) as { id: number } | undefined;
          if (!teamRow) throw new Error('所选队伍不存在或已停用。');
          db.prepare(`UPDATE athletes SET project = ?, team_id = ? WHERE id = ?`).run(
            project,
            teamRow.id,
            target.athleteId
          );
          upsertAthleteOrigin({
            athleteId: target.athleteId,
            province: area.province,
            city: area.city,
            county: area.county,
            source: 'manual',
            quality: 'valid',
          });
          db.prepare('DELETE FROM coach_athletes WHERE athlete_id = ?').run(target.athleteId);
          if (parentResult.parent?.role === 'SCC') {
            db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(
              parentUserId,
              target.athleteId
            );
          }
        }
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          currentUser.id,
          'UPDATE_ACCOUNT_ACCESS',
          'user',
          targetId,
          JSON.stringify({ role, parentUserId, permissions })
        );
        db.exec('COMMIT');
        res.json({ message: '角色、上级账号和数据范围已更新。' });
      } catch (error) {
        db.exec('ROLLBACK');
        res
          .status(500)
          .json({ message: error instanceof Error ? error.message : '权限更新失败。' });
      }
    }
  );

  app.put(
    '/api/access/accounts/:id/status',
    requireAuth,
    requireRole('PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const currentUser = req.authUser!;
      const targetId = Number(req.params.id);
      const target = userById(targetId);
      if (!target || !canManageAccount(currentUser, target)) {
        return res.status(404).json({ message: '账号不存在或不在可管理范围内。' });
      }
      const active = req.body?.active === true;
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, targetId);
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
      ).run(
        currentUser.id,
        active ? 'ENABLE_ACCOUNT' : 'DISABLE_ACCOUNT',
        'user',
        targetId,
        JSON.stringify({ active })
      );
      res.json({ message: active ? '账号已启用。' : '账号已停用。', active });
    }
  );

  app.get('/api/access/audit-logs', requireAuth, requireRole('DMD'), (req, res) => {
    const currentUser = req.authUser!;
    const visibleIds = allAccountRows()
      .filter((row) => row.id === currentUser.id || canManageAccount(currentUser, row))
      .map((row) => row.id);
    if (!visibleIds.length) return res.json({ logs: [] });
    const placeholders = visibleIds.map(() => '?').join(',');
    const logs = db
      .prepare(
        `
      SELECT l.id, l.action, l.entity_type AS entityType, l.entity_id AS entityId,
        l.detail, l.created_at AS createdAt,
        u.id AS actorId, u.display_name AS actorName, u.username AS actorUsername
      FROM audit_logs l
      JOIN users u ON u.id = l.user_id
      WHERE l.user_id IN (${placeholders})
      ORDER BY l.id DESC LIMIT 200
    `
      )
      .all(...visibleIds);
    res.json({ logs });
  });
}
