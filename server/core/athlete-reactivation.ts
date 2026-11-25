import { db } from './db.ts';
import { removedAccountUsernamePattern } from './removed-account.ts';

export class AthleteReactivationError extends Error {}

export function reactivateAthlete(athleteId: number, teamId: number | null) {
  if (db.prepare("SELECT 1 FROM athletes WHERE id = ? AND source = 'self_registration_rejected'").get(athleteId)) {
    throw new AthleteReactivationError('该档案的入队核实已被拒绝。');
  }
  if (db.prepare(
    "SELECT 1 FROM users WHERE athlete_id = ? AND role = 'ATL' AND username LIKE ?"
  ).get(athleteId, removedAccountUsernamePattern)) {
    throw new AthleteReactivationError('该运动员账号已删除，无法恢复原档案。');
  }
  const team = db.prepare(`
    SELECT t.id, t.name FROM project_teams t
    JOIN athletes a ON a.project = t.project
    WHERE a.id = ? AND t.id = COALESCE(?, a.team_id) AND t.active = 1
  `).get(athleteId, teamId) as { id: number; name: string } | undefined;
  if (!team) throw new AthleteReactivationError('请选择同项目的启用队伍后再恢复运动员。');
  db.prepare('UPDATE athletes SET active = 1, team = ?, team_id = ? WHERE id = ? AND active = 0')
    .run(team.name, team.id, athleteId);
}
