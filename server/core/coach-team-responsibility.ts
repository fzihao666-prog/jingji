import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const coachScopeConflict = {
  code: 'COACH_SCOPE_DERIVED_FROM_TEAM',
  message: '教练责任范围由队伍自动确定，请调整负责队伍。',
} as const;

// 仅兼容旧表单的数字字符串；禁止将其他输入静默转换成“未选择”。
export const legacyCoachIdSchema = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? 0 : value),
  z.union([
    z.number().int().nonnegative(),
    z
      .string()
      .regex(/^\d{1,12}$/)
      .transform(Number),
  ])
);

const teamCoachJoin = `
  FROM project_teams pt
  JOIN user_team_permissions utp
    ON (utp.project = '*' OR utp.project = pt.project)
    AND (utp.team = '*' OR utp.team = pt.name)
  JOIN user_project_permissions upp ON upp.user_id = utp.user_id
    AND (upp.project = '*' OR upp.project = pt.project)
  JOIN users u ON u.id = utp.user_id AND u.role = 'SCC' AND u.active = 1
`;

export function readTeamCoaches(database: DatabaseSync, project: string, team: string) {
  return database
    .prepare(
      `SELECT DISTINCT u.id, u.display_name AS displayName
      ${teamCoachJoin}
      WHERE pt.active = 1 AND pt.project = ? AND pt.name = ?
      ORDER BY u.display_name, u.id`
    )
    .all(project, team) as Array<{ id: number; displayName: string }>;
}

export function readCoachAthleteRelations(database: DatabaseSync, athleteIds?: number[]) {
  if (athleteIds && !athleteIds.length) return [];
  const filter = athleteIds ? `AND a.id IN (${athleteIds.map(() => '?').join(',')})` : '';
  return database
    .prepare(
      `SELECT DISTINCT a.id AS athleteId, u.id, u.display_name AS displayName
      ${teamCoachJoin}
      JOIN athletes a ON a.team_id = pt.id AND a.project = pt.project AND a.active = 1
      WHERE pt.active = 1 ${filter}
      ORDER BY u.display_name, u.id, a.id`
    )
    .all(...(athleteIds || [])) as Array<{ athleteId: number; id: number; displayName: string }>;
}

export function coachAthleteIds(database: DatabaseSync, coachId: number) {
  return (
    database
      .prepare(
        `SELECT DISTINCT a.id
        ${teamCoachJoin}
        JOIN athletes a ON a.team_id = pt.id AND a.project = pt.project AND a.active = 1
        WHERE pt.active = 1 AND u.id = ? ORDER BY a.id`
      )
      .all(coachId) as Array<{ id: number }>
  ).map((athlete) => athlete.id);
}

export function sameCoachIds(left: number[], right: number[]) {
  const ids = new Set(left);
  return ids.size === new Set(right).size && right.every((id) => ids.has(id));
}
