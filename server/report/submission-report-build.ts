import type { DatabaseSync } from 'node:sqlite';
import { allowsTeam } from '../core/permission-scope.ts';
import { HEAD_COACH_CATEGORY } from '../../shared/coach-categories.ts';
import type { Project } from '../../shared/projects.ts';
import type { SubmissionReport } from '../../shared/submission-report.ts';
import { collectSubmissionFacts } from './submission-report.ts';

type Scope = { projects: string[]; teams: Array<{ project: string; team: string }> };
export type SubmissionReportInput = { projects: Project[]; permissions: Scope };

export function buildSubmissionReport(
  db: DatabaseSync,
  { projects, permissions }: SubmissionReportInput
): SubmissionReport {
  const report: SubmissionReport = {
    teams: [],
    coaches: [],
    records: [],
    types: ['训练课次', '力量训练组次', '体能测试', 'FMS测试', '日常监测', '康复伤病'],
  };
  const categories = db.prepare(
    'SELECT category FROM coach_profiles WHERE user_id=? ORDER BY category'
  );
  const projectsFor = db.prepare('SELECT project FROM user_project_permissions WHERE user_id=?');
  const teamsFor = db.prepare('SELECT project,team FROM user_team_permissions WHERE user_id=?');
  const coaches = (
    db.prepare("SELECT id,display_name AS name FROM users WHERE role='SCC' AND active=1").all() as {
      id: number;
      name: string;
    }[]
  ).map((coach) => ({
    ...coach,
    roles: (categories.all(coach.id) as { category: string }[]).map(({ category }) => category),
    scope: {
      projects: (projectsFor.all(coach.id) as { project: string }[]).map(({ project }) => project),
      teams: teamsFor.all(coach.id) as Scope['teams'],
    },
  }));
  const included = new Set<number>();
  const types = new Map(report.types.map((type, index) => [type, index]));
  for (const project of projects) {
    const visible = (team: string) => allowsTeam(permissions, project, team);
    const athletes = (
      db
        .prepare(
          `
      SELECT a.id, a.name, COALESCE(t.name,NULLIF(a.team,''),last.name,'') AS team
      FROM athletes a LEFT JOIN project_teams t ON t.id=a.team_id AND t.project=a.project
      LEFT JOIN athlete_last_team h ON h.athlete_id=a.id AND h.project=a.project
      LEFT JOIN project_teams last ON last.id=h.team_id AND last.project=a.project
      WHERE a.project=?
    `
        )
        .all(project) as { id: number; name: string; team: string }[]
    ).filter(({ team }) => visible(team));
    const athleteTeams = new Map(athletes.map(({ id, team }) => [id, team]));
    const registered = db
      .prepare('SELECT name,active FROM project_teams WHERE project=?')
      .all(project) as { name: string; active: number }[];
    const active = new Set(registered.filter((team) => team.active).map(({ name }) => name));
    const teamIds = new Map<string, number>();
    const addTeam = (name: string) => {
      const known = teamIds.get(name);
      if (known !== undefined) return known;
      const index = report.teams.length;
      const responsible =
        name && active.has(name)
          ? coaches
              .filter(
                ({ roles, scope }) =>
                  allowsTeam(scope, project, name) &&
                  (roles.some((role) => role !== HEAD_COACH_CATEGORY) ||
                    scope.teams.some((grant) => grant.project === project && grant.team === name))
              )
              .map(({ id }) => id)
          : [];
      responsible.forEach((id) => included.add(id));
      report.teams.push({
        name,
        project,
        coaches: responsible,
        athletes: athletes.filter((athlete) => athlete.team === name).length,
      });
      teamIds.set(name, index);
      return index;
    };
    const teamNames = registered.map(({ name }) => name).filter(visible);
    for (const name of new Set([...teamNames, ...athleteTeams.values()])) addTeam(name);
    if (!athletes.length && !teamNames.length && !visible('')) continue;
    for (const fact of collectSubmissionFacts(db, project, athletes, teamNames, visible(''))) {
      const team = athleteTeams.get(fact.athleteId) ?? fact.team ?? '';
      if (!visible(team)) continue;
      let type = types.get(fact.type);
      if (type === undefined) {
        type = report.types.length;
        report.types.push(fact.type);
        types.set(fact.type, type);
      }
      report.records.push([
        addTeam(team),
        type,
        fact.businessDate ?? '',
        `${fact.entity}:${fact.id}`,
        fact.athleteId || undefined,
      ]);
    }
  }
  report.coaches = coaches
    .filter(({ id }) => included.has(id))
    .map(({ id, name, roles }) => ({ id, name, roles }));
  return report;
}
