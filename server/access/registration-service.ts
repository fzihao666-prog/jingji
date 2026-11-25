import { db } from '../core/db.ts';
import { validateAccountAreas } from '../../shared/account-regions.ts';
import { canManageRole, SYSTEM_MANAGEMENT_ROLES, type AreaLevel, type Role } from '../../shared/access.ts';
import { isProject } from '../../shared/projects.ts';
import { PROVINCES } from '../../shared/regions.ts';
import {
  accountPermissions,
  canManageAccount,
  initializeAccountScope,
  permissionsAllowProjectTeam,
} from '../core/permissions.ts';
import { DEFAULT_COACH_CATEGORY, type CoachCategory } from '../../shared/coach-categories.ts';
import type { AuthUser } from '../core/shared-server.ts';

// 仅业务错误允许返回客户端，数据库等内部异常使用统一提示。
class RegistrationActivationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const provinceSet = new Set<string>(PROVINCES);

const REGISTRATION_APPROVAL_KEY = 'registration_approval_enabled';

export function registrationApprovalEnabled(): boolean {
  const row = db
    .prepare('SELECT value FROM app_metadata WHERE key = ?')
    .get(REGISTRATION_APPROVAL_KEY) as { value: string } | undefined;
  return row ? row.value !== '0' : true;
}

export function setRegistrationApprovalEnabled(enabled: boolean): void {
  db.prepare(
    `
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `
  ).run(REGISTRATION_APPROVAL_KEY, enabled ? '1' : '0');
}

export type RegistrationActivationRow = {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  requested_role: 'ATL' | 'SCC';
  coach_category: CoachCategory | null;
  project: string;
  team: string;
  create_team: number;
  gender: string | null;
  status: string;
  birth_date: string | null;
  native_place: string | null;
  phone: string | null;
};

export type ActivationOutcome =
  { ok: true; userId: number } | { ok: false; status: number; message: string };

type Origin = { province: string; city: string; county: string };

function registrationOrigin(nativePlace: string | null): Origin {
  const [province = '', city = '', ...rest] = (nativePlace || '').split('/');
  if (rest.length || validateAccountAreas([{ areaLevel: 'city', province, city, county: '' }])) {
    return { province: '', city: '', county: '' };
  }
  return { province, city, county: '' };
}

export function canReviewRegistration(
  reviewer: AuthUser,
  request: {
    requestedRole: Role;
    project: string;
    team: string;
    nativePlace: string | null;
    username: string;
    displayName: string;
    status: string;
  },
  permissions = accountPermissions(reviewer.id)
) {
  if (!SYSTEM_MANAGEMENT_ROLES.includes(reviewer.role) || !canManageRole(reviewer.role, request.requestedRole)) return false;

  const linked = request.status !== 'pending'
    ? db.prepare(`SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId,
        session_version AS sessionVersion FROM users WHERE username=?`).get(request.username) as AuthUser | undefined
    : undefined;
  if (linked && (linked.role !== 'ATL' || request.requestedRole !== 'ATL'))
    return canManageAccount(reviewer, linked);

  return permissionsAllowProjectTeam(permissions, request.project, request.team);
}

export function activateRegistrationRequest(
  requestId: number,
  reviewer: AuthUser | null
): ActivationOutcome {
  const request = db
    .prepare(
      `
    SELECT id, username, password_hash, display_name, requested_role, coach_category,
      project, team, create_team, gender, birth_date, native_place, phone, status
    FROM registration_requests WHERE id = ?
  `
    )
    .get(requestId) as RegistrationActivationRow | undefined;
  if (!request) return { ok: false, status: 404, message: '注册申请不存在。' };
  if (request.status !== 'pending') return { ok: false, status: 409, message: '该申请已经处理。' };
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(request.username)) {
    return { ok: false, status: 409, message: '账号已存在，无法重复审核。' };
  }
  if (reviewer) {
    if (
      !canReviewRegistration(reviewer, {
        ...request,
        requestedRole: request.requested_role,
        displayName: request.display_name,
        nativePlace: request.native_place,
      })
    ) {
      return { ok: false, status: 403, message: '该申请超出当前账号的管辖范围。' };
    }
  } else if (!request.create_team) {
    const team = db
      .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
      .get(request.project, request.team);
    if (!team) return { ok: false, status: 400, message: '申请所属队伍不存在或已停用。' };
  }

  db.exec('BEGIN');
  try {
    const activeTeam = db.prepare(
      'SELECT id, active FROM project_teams WHERE project = ? AND name = ?'
    ).get(request.project, request.team) as { id: number; active: number } | undefined;
    if (request.create_team) {
      if (request.requested_role !== 'SCC' || !isProject(request.project) ||
          request.team.trim() !== request.team || request.team.length < 2 || request.team.length > 30) {
        throw new RegistrationActivationError('新增队伍申请无效。');
      }
      if (activeTeam && !activeTeam.active) {
        throw new RegistrationActivationError('该队伍已停用，请联系管理员。');
      }
      if (!activeTeam) {
        db.prepare('INSERT INTO project_teams (project, name, active) VALUES (?, ?, 1)')
          .run(request.project, request.team);
      }
    } else if (!activeTeam?.active) {
      throw new RegistrationActivationError('申请所属队伍不存在或已停用。');
    }
    let athleteId: number | null = null;
    if (request.requested_role === 'ATL') {
      const team = db
        .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
        .get(request.project, request.team) as { id: number } | undefined;
      if (!team) throw new RegistrationActivationError('申请所属队伍不存在或已停用。');
      const roster = db.prepare(`
        SELECT id, gender, birth_date FROM athletes WHERE name = ? AND project = ? AND team_id = ?`
      ).all(request.display_name, request.project, team.id) as Array<{
        id: number; gender: string | null; birth_date: string | null;
      }>;
      if (!reviewer && roster.length)
        throw new RegistrationActivationError('同名同队的运动员档案已存在，已暂停开通，请联系管理员核对身份后审核。');
      const compatible = roster.filter(athlete =>
        (!athlete.gender || !request.gender || athlete.gender === request.gender) &&
        (!athlete.birth_date || !request.birth_date || athlete.birth_date === request.birth_date)
      );
      if (compatible.length > 1)
        throw new RegistrationActivationError('同队有多个符合申请资料的档案，请按运动员编号核对后再审核。');
      const athlete = compatible[0] ?? (roster.length === 1 ? roster[0] : undefined);
      if (!athlete && roster.length)
        throw new RegistrationActivationError('姓名与既有档案身份信息不一致，请联系管理员核对档案或申请信息。');
      if (athlete) {
        const linkedUser = db
          .prepare("SELECT id FROM users WHERE athlete_id = ? AND role = 'ATL'")
          .get(athlete.id);
        if (linkedUser) throw new RegistrationActivationError('该运动员已有登录账户。');
        if (
          (athlete.gender && request.gender && athlete.gender !== request.gender) ||
          (athlete.birth_date && request.birth_date && athlete.birth_date !== request.birth_date)
        ) {
          throw new RegistrationActivationError(
            '姓名与既有档案身份信息不一致，请联系管理员核对档案或申请信息。'
          );
        }
        athleteId = athlete.id;
      } else {
        if (reviewer) {
          const other = db
            .prepare(
              `SELECT a.project, COALESCE(pt.name, a.team, '') AS team
            FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
            WHERE a.name = ? AND (a.project <> ? OR COALESCE(a.team_id, -1) <> ?)
            ORDER BY a.id LIMIT 1`
            )
            .get(request.display_name, request.project, team.id) as
            { project: string; team: string } | undefined;
          if (other)
            throw new RegistrationActivationError(
              `该姓名已存在于项目「${other.project} / ${other.team}」，与申请的项目「${request.project} / ${request.team}」不一致。请核对姓名或联系管理员。`
            );
        }
        const result = db
          .prepare(
            `INSERT INTO athletes (name, project, team, team_id, gender, birth_date, source, profile_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'incomplete')`
          )
          .run(
            request.display_name,
            request.project,
            request.team,
            team.id,
            request.gender,
            request.birth_date || null,
            reviewer ? 'registration_verified' : 'self_registered'
          );
        athleteId = Number(result.lastInsertRowid);
      }
      const estimated = registrationOrigin(request.native_place);
      // 籍贯只能提供推测归属；已确认的正式归属永不被注册资料覆盖。
      db.prepare(
        `INSERT INTO athlete_origins (athlete_id, province, city, county, source, quality)
        VALUES (?, ?, ?, ?, 'registration', 'estimated')
        ON CONFLICT(athlete_id) DO UPDATE SET province=excluded.province, city=excluded.city,
          county=excluded.county, source=excluded.source, quality=excluded.quality
        WHERE athlete_origins.quality <> 'valid'`
      ).run(athleteId, estimated.province, estimated.city, estimated.county);
      const origin = db
        .prepare('SELECT province,city,county FROM athlete_origins WHERE athlete_id=?')
        .get(athleteId) as Origin;
      db.prepare('UPDATE athletes SET region=?,city=?,county=? WHERE id=?').run(
        origin.province,
        origin.city,
        origin.county,
        athleteId
      );
      if (reviewer)
        db.prepare(
          "UPDATE athletes SET source='registration_verified' WHERE id=? AND source='self_registered'"
        ).run(athleteId);
      const profileBirthDate = request.birth_date || null;
      if (athleteId && profileBirthDate) {
        db.prepare(
          "UPDATE athletes SET birth_date = COALESCE(NULLIF(birth_date, ''), ?), gender = COALESCE(NULLIF(gender, ''), ?) WHERE id = ?"
        ).run(profileBirthDate, request.gender, athleteId);
      }
      db.prepare(
        `
      INSERT INTO athlete_profiles (athlete_id, native_place, phone, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(athlete_id) DO UPDATE SET
        native_place = COALESCE(NULLIF(excluded.native_place, ''), athlete_profiles.native_place),
        phone = COALESCE(NULLIF(excluded.phone, ''), athlete_profiles.phone),
        updated_at = CURRENT_TIMESTAMP
    `
      ).run(athleteId, request.native_place || '', request.phone || '');
    }

    const result = db
      .prepare(
        `
      INSERT INTO users (username, password_hash, display_name, role, athlete_id)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(
        request.username,
        request.password_hash,
        request.display_name,
        request.requested_role,
        athleteId
      );
    const newUserId = Number(result.lastInsertRowid);
    if (request.requested_role === 'SCC') {
      db.prepare('INSERT OR IGNORE INTO coach_profiles (user_id, category) VALUES (?, ?)').run(
        newUserId,
        request.coach_category ?? DEFAULT_COACH_CATEGORY
      );
    }
    let accountArea = { areaLevel: 'national' as AreaLevel, province: '', city: '', county: '' };
    if (request.requested_role === 'ATL') {
      // 保留正式归属或注册推测归属；缺失区县仍明确标记待完善。
      const origin = db
        .prepare('SELECT province, city, county FROM athlete_origins WHERE athlete_id = ?')
        .get(athleteId) as { province: string; city: string; county: string } | undefined;
      accountArea = { areaLevel: 'county', province: '', city: '', county: '' };
      if (origin && provinceSet.has(origin.province)) {
        accountArea.province = origin.province;
        const cityArea = { ...accountArea, areaLevel: 'city' as const, city: origin.city };
        if (!validateAccountAreas([cityArea])) accountArea.city = origin.city;
        const countyArea = { ...accountArea, county: origin.county };
        if (!validateAccountAreas([countyArea])) accountArea.county = origin.county;
      }
    }
    initializeAccountScope({
      userId: newUserId,
      role: request.requested_role,
      parentUserId: reviewer?.id ?? null,
      province: accountArea.province,
      city: accountArea.city,
      county: accountArea.county,
      project: request.project,
      team: request.team,
      grantedBy: reviewer?.id ?? newUserId,
      areaLevel: accountArea.areaLevel,
    });
    db.prepare(
      `
      UPDATE registration_requests SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
    `
    ).run(reviewer?.id ?? null, requestId);
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(
      reviewer?.id ?? newUserId,
      reviewer ? 'APPROVE_REGISTRATION' : 'AUTO_APPROVE_REGISTRATION',
      'user',
      newUserId,
      JSON.stringify({ requestId, role: request.requested_role, system: !reviewer })
    );
    db.exec('COMMIT');
    return { ok: true, userId: newUserId };
  } catch (error) {
    db.exec('ROLLBACK');
    return {
      ok: false,
      status: error instanceof RegistrationActivationError ? error.status : 400,
      message:
        error instanceof RegistrationActivationError ? error.message : '审核失败，请联系管理员。',
    };
  }
}

export function verifyRegistrationTeam(
  requestId: number,
  reviewer: AuthUser,
  approved: boolean
): ActivationOutcome {
  const candidate = db
    .prepare(
      `SELECT u.id AS userId, a.id AS athleteId, a.project, pt.name AS team,
      COALESCE(ao.province, '') AS province, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county
    FROM registration_requests r JOIN users u ON u.username=r.username AND u.role='ATL'
    JOIN athletes a ON a.id=u.athlete_id JOIN project_teams pt ON pt.id=a.team_id AND pt.project=a.project
    LEFT JOIN athlete_origins ao ON ao.athlete_id=a.id
    WHERE r.id=? AND r.status='approved' AND a.source='self_registered' AND a.active=1 AND pt.active=1`
    )
    .get(requestId) as
    (Origin & { userId: number; athleteId: number; project: string; team: string }) | undefined;
  if (!candidate) return { ok: false, status: 409, message: '该申请没有待核实的入队记录。' };
  if (
    !SYSTEM_MANAGEMENT_ROLES.includes(reviewer.role) || !canManageRole(reviewer.role, 'ATL') ||
    !permissionsAllowProjectTeam(accountPermissions(reviewer.id), candidate.project, candidate.team)
  ) {
    return { ok: false, status: 403, message: '该申请超出当前账号的管辖范围。' };
  }
  db.exec('BEGIN');
  try {
    if (approved) {
      db.prepare("UPDATE athletes SET source='registration_verified' WHERE id=?").run(
        candidate.athleteId
      );
      db.prepare('UPDATE account_profiles SET parent_user_id=? WHERE user_id=?').run(
        reviewer.id,
        candidate.userId
      );
    } else {
      // 拒绝入队只停用账号及档案，保留历史训练事实，便于追溯和恢复。
      db.prepare("UPDATE athletes SET source='self_registration_rejected',active=0 WHERE id=?").run(
        candidate.athleteId
      );
      db.prepare('UPDATE users SET active=0,session_version=session_version+1 WHERE id=?').run(
        candidate.userId
      );
    }
    db.prepare(
      `UPDATE registration_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(approved ? 'approved' : 'rejected', reviewer.id, requestId);
    db.prepare(
      'INSERT INTO audit_logs (user_id,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?)'
    ).run(
      reviewer.id,
      approved ? 'VERIFY_REGISTRATION_TEAM' : 'REJECT_REGISTRATION_TEAM',
      'athlete',
      candidate.athleteId,
      JSON.stringify({
        requestId,
        userId: candidate.userId,
        project: candidate.project,
        team: candidate.team,
      })
    );
    db.exec('COMMIT');
    return { ok: true, userId: candidate.userId };
  } catch (error) {
    db.exec('ROLLBACK');
    return {
      ok: false,
      status: error instanceof RegistrationActivationError ? error.status : 500,
      message:
        error instanceof RegistrationActivationError
          ? error.message
          : '入队核实失败，请联系管理员。',
    };
  }
}
