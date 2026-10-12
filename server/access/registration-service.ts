import { db } from '../core/db.ts';
import { validateAccountAreas } from '../../shared/account-regions.ts';
import { canManageRole, type AreaLevel } from '../../shared/access.ts';
import { PROVINCES } from '../../shared/regions.ts';
import {
  accountPermissions,
  initializeAccountScope,
  permissionsAllowProjectTeam,
} from '../core/permissions.ts';
import { DEFAULT_COACH_CATEGORY } from '../../shared/coach-categories.ts';
import type { AuthUser } from '../core/shared-server.ts';

// 仅业务错误允许返回客户端，数据库等内部异常使用统一提示。
class RegistrationActivationError extends Error {}

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
  project: string;
  team: string;
  gender: string | null;
  status: string;
  birth_date: string | null;
  native_place: string | null;
  phone: string | null;
};

export type ActivationOutcome =
  { ok: true; userId: number } | { ok: false; status: number; message: string };

export function activateRegistrationRequest(
  requestId: number,
  reviewer: AuthUser | null
): ActivationOutcome {
  const request = db
    .prepare(
      `
    SELECT id, username, password_hash, display_name, requested_role,
      project, team, gender, birth_date, native_place, phone, status
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
      !canManageRole(reviewer.role, request.requested_role) ||
      !permissionsAllowProjectTeam(accountPermissions(reviewer.id), request.project, request.team)
    ) {
      return { ok: false, status: 403, message: '该申请超出当前账号的管辖范围。' };
    }
  } else {
    const team = db
      .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
      .get(request.project, request.team);
    if (!team) return { ok: false, status: 400, message: '申请所属队伍不存在或已停用。' };
  }

  db.exec('BEGIN');
  try {
    let athleteId: number | null = null;
    if (request.requested_role === 'ATL') {
      const team = db
        .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
        .get(request.project, request.team) as { id: number } | undefined;
      if (!team) throw new RegistrationActivationError('申请所属队伍不存在或已停用。');
      // 系统自动开通只允许新建，绝不认领已有训练档案。
      const athlete = reviewer
        ? (db
            .prepare(
              `SELECT a.id, a.gender, a.birth_date FROM athletes a
            WHERE a.name = ? AND a.project = ? AND a.team_id = ?`
            )
            .get(request.display_name, request.project, team.id) as
            { id: number; gender: string | null; birth_date: string | null } | undefined)
        : undefined;
      if (athlete) {
        const linkedUser = db
          .prepare("SELECT id FROM users WHERE athlete_id = ? AND role = 'ATL'")
          .get(athlete.id);
        if (linkedUser) throw new RegistrationActivationError('该运动员已有登录账户。');
        if (
          (athlete.gender && request.gender && athlete.gender !== request.gender) ||
          (athlete.birth_date && request.birth_date && athlete.birth_date !== request.birth_date)
        ) {
          throw new RegistrationActivationError('姓名与既有档案身份信息不一致，请联系管理员核对档案或申请信息。');
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
        try {
          const result = db
            .prepare(
              `INSERT INTO athletes (name, project, team, team_id, gender, birth_date) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
              request.display_name,
              request.project,
              request.team,
              team.id,
              request.gender,
              request.birth_date || null
            );
          athleteId = Number(result.lastInsertRowid);
        } catch (error) {
          if (
            error instanceof Error &&
            'errcode' in error &&
            error.errcode === 2067 && // SQLITE_CONSTRAINT_UNIQUE

            db
              .prepare('SELECT id FROM athletes WHERE name = ? AND project = ? AND team = ?')
              .get(request.display_name, request.project, request.team)
          ) {
            throw new RegistrationActivationError('同名同队的运动员档案已存在，已暂停开通，请联系管理员核对身份后审核。');
          }
          throw error;
        }
      }
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
        DEFAULT_COACH_CATEGORY
      );
    }
    let accountArea = reviewer
      ? accountPermissions(reviewer.id).areas[0] || {
          areaLevel: 'national' as AreaLevel,
          province: '',
          city: '',
          county: '',
        }
      : {
          areaLevel: 'national' as AreaLevel,
          province: '',
          city: '',
          county: '',
        };
    if (request.requested_role === 'ATL') {
      // 籍贯仅保留在资料中，行政归属以运动员档案为准，不继承审核人的权限。
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
      status: 400,
      message: error instanceof RegistrationActivationError ? error.message : '审核失败，请联系管理员。',
    };
  }
}
