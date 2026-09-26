import { db, upsertAthleteOrigin } from '../core/db.ts';
import { canManageRole, type AreaLevel } from '../../shared/access.ts';
import { PROVINCES } from '../../shared/regions.ts';
import {
  accountPermissions,
  initializeAccountScope,
  permissionsAllowProjectTeam,
} from '../core/permissions.ts';
import { DEFAULT_COACH_CATEGORY } from '../../shared/coach-categories.ts';
import { birthDateFromIdentityNumber } from '../core/utils.ts';
import type { AuthUser } from '../core/shared-server.ts';

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
  identity_number: string | null;
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
      project, team, gender, identity_number, native_place, phone, status
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
      const athlete = db
        .prepare(
          `SELECT a.id, a.project, COALESCE(pt.name, '') AS team FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id WHERE a.name = ?`
        )
        .get(request.display_name) as { id: number; project: string; team: string } | undefined;
      if (athlete) {
        const linkedUser = db
          .prepare("SELECT id FROM users WHERE athlete_id = ? AND role = 'ATL'")
          .get(athlete.id);
        if (linkedUser) throw new Error('该运动员已有登录账户。');
        if (athlete.project !== request.project || athlete.team !== request.team) {
          throw new Error(
            `该姓名已存在于项目「${athlete.project} / ${athlete.team}」，与申请的项目「${request.project} / ${request.team}」不一致。请核对姓名或联系管理员。`
          );
        }
        athleteId = athlete.id;
      } else {
        const team = db
          .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
          .get(request.project, request.team) as { id: number } | undefined;
        if (!team) throw new Error('申请所属队伍不存在或已停用。');
        const birthDate = birthDateFromIdentityNumber(request.identity_number || '') || null;
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
            birthDate
          );
        athleteId = Number(result.lastInsertRowid);
      }
      const profileBirthDate = birthDateFromIdentityNumber(request.identity_number || '') || null;
      if (athleteId && profileBirthDate) {
        db.prepare('UPDATE athletes SET birth_date = COALESCE(birth_date, ?) WHERE id = ?').run(
          profileBirthDate,
          athleteId
        );
      }
      db.prepare(
        `
      INSERT INTO athlete_profiles (athlete_id, identity_number, native_place, phone, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(athlete_id) DO UPDATE SET
        identity_number = COALESCE(NULLIF(excluded.identity_number, ''), athlete_profiles.identity_number),
        native_place = COALESCE(NULLIF(excluded.native_place, ''), athlete_profiles.native_place),
        phone = COALESCE(NULLIF(excluded.phone, ''), athlete_profiles.phone),
        updated_at = CURRENT_TIMESTAMP
    `
      ).run(
        athleteId,
        request.identity_number || '',
        request.native_place || '',
        request.phone || ''
      );
      const [originProvince = '', originCity = '', originCounty = ''] = (
        request.native_place || ''
      ).split('/');
      if (athleteId && provinceSet.has(originProvince) && originCity) {
        upsertAthleteOrigin({
          athleteId,
          province: originProvince,
          city: originCity,
          county: originCounty,
          source: 'registration',
          quality: 'valid',
        });
      }
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
    const inheritedArea = reviewer
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
    initializeAccountScope({
      userId: newUserId,
      role: request.requested_role,
      parentUserId: reviewer?.id ?? null,
      province: inheritedArea.province,
      city: inheritedArea.city,
      county: inheritedArea.county,
      project: request.project,
      team: request.team,
      grantedBy: reviewer?.id ?? newUserId,
      areaLevel: inheritedArea.areaLevel,
    });
    if (reviewer && request.requested_role === 'ATL' && reviewer.role === 'SCC' && athleteId) {
      db.prepare(
        'INSERT OR IGNORE INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)'
      ).run(reviewer.id, athleteId);
    }
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
      message: error instanceof Error ? error.message : '审核失败。',
    };
  }
}
