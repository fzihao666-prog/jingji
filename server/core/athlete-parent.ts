import { canManageRole, type Role } from '../../shared/access.ts';
import { db } from './db.ts';
import {
  accountPermissions,
  permissionsContain,
  permissionsAllowProjectTeam,
} from './permissions.ts';
import type { AuthUser } from './shared-server.ts';

export function parentCoversAthleteScope(
  userId: number,
  permissions: ReturnType<typeof accountPermissions>
) {
  const parent = db.prepare('SELECT role, active FROM users WHERE id = ?').get(userId) as
    { role: Role; active: number } | undefined;
  if (!parent || !parent.active || !canManageRole(parent.role, 'ATL')) return false;
  const parentPermissions = accountPermissions(userId);
  if (parent.role === 'SCC') {
    return (
      permissions.projects.length > 0 &&
      permissions.teams.length > 0 &&
      permissions.teams.every(({ project, team }) =>
        permissionsAllowProjectTeam(parentPermissions, project, team)
      )
    );
  }
  return permissionsContain(parentPermissions, permissions);
}

// 调用方须在档案和账号范围更新所在事务内调用，失败时一并回滚。
export function resolveAthleteParent(input: {
  athleteId: number;
  parentUserId: number | null;
  currentUser: AuthUser;
  permissions: ReturnType<typeof accountPermissions>;
}) {
  if (input.parentUserId && parentCoversAthleteScope(input.parentUserId, input.permissions))
    return input.parentUserId;
  if (!parentCoversAthleteScope(input.currentUser.id, input.permissions))
    throw new Error('运动员新范围超出可绑定上级范围。');
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(
    input.currentUser.id,
    'UPDATE_ATHLETE_PARENT',
    'athlete',
    input.athleteId,
    JSON.stringify({ from: input.parentUserId, to: input.currentUser.id })
  );
  return input.currentUser.id;
}
