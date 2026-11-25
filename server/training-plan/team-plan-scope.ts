import type { DatabaseSync } from 'node:sqlite';
import { accessibleAthleteIds } from '../core/permissions.ts';
import type { AuthUser } from '../core/shared-server.ts';

// 队伍计划访问范围：教练须能访问队内全部运动员；观察员按明确队伍授权只读，包含空队伍。
// 单独成文件：避免 team-plan-service 被 core 模块间接导入时把 permissions 拉进 db 初始化链。
export type TeamPlanScope = {
  athletes: Array<{ id: number; name: string; teamId: number; project: string }>;
  teams: Array<{ id: number; project: string; name: string }>;
};
export function teamPlanScope(db: DatabaseSync, authUser: AuthUser): TeamPlanScope {
  const ids = new Set(accessibleAthleteIds(authUser));
  const athletes = db
    .prepare('SELECT id,name,team_id AS teamId,project FROM athletes WHERE active=1')
    .all() as Array<{ id: number; name: string; teamId: number; project: string }>;
  const observerTeamIds =
    authUser.role === 'OBS'
      ? new Set(
          (
            db
              .prepare(
                `
        SELECT pt.id FROM project_teams pt
        JOIN user_team_permissions ut ON ut.project = pt.project AND ut.team = pt.name
        JOIN user_project_permissions up ON up.user_id = ut.user_id AND up.project = pt.project
        WHERE ut.user_id = ? AND pt.active = 1
      `
              )
              .all(authUser.id) as Array<{ id: number }>
          ).map((team) => team.id)
        )
      : null;
  const teams = (
    db.prepare('SELECT id,project,name FROM project_teams WHERE active=1').all() as Array<{
      id: number;
      project: string;
      name: string;
    }>
  ).filter((team) => {
    if (observerTeamIds) return observerTeamIds.has(team.id);
    const members = athletes.filter((athlete) => athlete.teamId === team.id);
    return members.length > 0 && members.every((athlete) => ids.has(athlete.id));
  });
  return { athletes: athletes.filter((athlete) => ids.has(athlete.id)), teams };
}
