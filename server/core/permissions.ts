import {
  AREA_LEVELS,
  ROLE_META,
  canManageRole,
  type AreaLevel,
  type Role,
} from '../../shared/access.ts';
import { isProject, PROJECT_META, PROJECTS, type Project } from '../../shared/projects.ts';
import { PROVINCES } from '../../shared/regions.ts';
import { db } from './db.ts';
import { coachAthleteIds } from './coach-team-responsibility.ts';
import type { AreaPermission, AuthUser, ScopeAthlete } from './shared-server.ts';
import { cleanString } from './utils.ts';

const provinceSet = new Set<string>(PROVINCES);
const projectSet = new Set<string>(PROJECTS);

export function accountPermissions(userId: number) {
  const areas = db
    .prepare(
      `
    SELECT area_level AS areaLevel, province, city, county
    FROM user_area_permissions WHERE user_id = ?
  `
    )
    .all(userId) as AreaPermission[];
  const projects = (
    db.prepare('SELECT project FROM user_project_permissions WHERE user_id = ?').all(userId) as {
      project: string;
    }[]
  ).map((item) => item.project);
  const teams = db
    .prepare(
      `
    SELECT project, team FROM user_team_permissions WHERE user_id = ?
  `
    )
    .all(userId) as Array<{ project: string; team: string }>;
  return { areas, projects, teams };
}

export function permissionsAllowAthlete(
  permissions: ReturnType<typeof accountPermissions>,
  athlete: Pick<ScopeAthlete, 'project' | 'team'> & Partial<ScopeAthlete>
) {
  return permissionsAllowProjectTeam(permissions, athlete.project, athlete.team);
}

export function permissionsAllowProjectTeam(
  permissions: ReturnType<typeof accountPermissions>,
  project: string,
  team: string
) {
  return (
    (permissions.projects.includes('*') || permissions.projects.includes(project)) &&
    permissions.teams.some(
      (item) =>
        (item.project === '*' || item.project === project) &&
        (item.team === '*' || item.team === team)
    )
  );
}

export function canManageAccount(manager: AuthUser, target: AuthUser) {
  if (!canManageRole(manager.role, target.role)) return false;
  const managerPermissions = accountPermissions(manager.id);
  const targetPermissions = accountPermissions(target.id);
  if (target.role === 'SCC' && !targetPermissions.teams.length) {
    // 无归属历史账号仅允许全部项目和队伍授权的上级修复，不能猜测其组织范围。
    const globalManager = managerPermissions.projects.includes('*') &&
      managerPermissions.teams.some((team) => team.project === '*' && team.team === '*');
    if (globalManager) return true;
    // 已有项目但尚未绑队的教练，须由覆盖其项目全部队伍的上级管理。
    return permissionsContain(managerPermissions, {
      ...targetPermissions,
      teams: targetPermissions.projects.map((project) => ({ project, team: '*' })),
    });
  }
  return permissionsContain(managerPermissions, targetPermissions);
}

export function permissionsContain(
  managerPermissions: ReturnType<typeof accountPermissions>,
  targetPermissions: ReturnType<typeof accountPermissions>
) {
  if (!targetPermissions.projects.length || !targetPermissions.teams.length) return false;
  const projectsContained =
    managerPermissions.projects.includes('*') ||
    targetPermissions.projects.every((project) => managerPermissions.projects.includes(project));
  const teamsContained =
    managerPermissions.teams.some((team) => team.project === '*' && team.team === '*') ||
    targetPermissions.teams.every((targetTeam) =>
      managerPermissions.teams.some(
        (managerTeam) =>
          (managerTeam.project === '*' || managerTeam.project === targetTeam.project) &&
          (managerTeam.team === '*' || managerTeam.team === targetTeam.team)
      )
    );
  return projectsContained && teamsContained;
}

export function accountCodeFor(userId: number, role: Role, project: string) {
  const projectCode = isProject(project) ? PROJECT_META[project].code : 'ALL';
  return `${projectCode}-${role}-${String(userId).padStart(4, '0')}`;
}

export function initializeAccountScope(input: {
  userId: number;
  role: Role;
  parentUserId: number | null;
  province: string;
  city: string;
  county: string;
  project: string;
  team: string;
  grantedBy: number;
  areaLevel?: AreaLevel;
}) {
  const areaLevel =
    input.areaLevel ||
    (input.province ? (input.county ? 'county' : input.city ? 'city' : 'province') : 'national');
  db.prepare(
    `
    INSERT INTO account_profiles (user_id, parent_user_id, account_code)
    VALUES (?, ?, ?)
  `
  ).run(
    input.userId,
    input.parentUserId,
    accountCodeFor(input.userId, input.role, input.project)
  );
  if (input.role === 'ATL') {
    db.prepare(
      `
      INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(input.userId, areaLevel, input.province, input.city, input.county, input.grantedBy);
  }
  db.prepare(
    `
    INSERT INTO user_project_permissions (user_id, project, granted_by)
    VALUES (?, ?, ?)
  `
  ).run(input.userId, input.project || '*', input.grantedBy);
  db.prepare(
    `
    INSERT INTO user_team_permissions (user_id, project, team, granted_by)
    VALUES (?, ?, ?, ?)
  `
  ).run(input.userId, input.project || '*', input.team || '*', input.grantedBy);
}

export function parseScopePayload(body: any) {
  const areas: AreaPermission[] = Array.isArray(body?.areas)
    ? body.areas.map((area: any) => ({
        areaLevel: cleanString(area?.areaLevel) as AreaLevel,
        province: cleanString(area?.province),
        city: cleanString(area?.city),
        county: cleanString(area?.county),
      }))
    : [];
  const projects = Array.isArray(body?.projects)
    ? [
        ...new Set<string>(
          body.projects.map((project: unknown) => cleanString(project)).filter(Boolean)
        ),
      ]
    : [];
  const teams = Array.isArray(body?.teams)
    ? body.teams
        .map((team: any) => ({
          project: cleanString(team?.project),
          team: cleanString(team?.team),
        }))
        .filter((team: { project: string; team: string }) => team.project && team.team)
    : [];
  return { areas, projects, teams };
}

export function validateScopePayload(permissions: ReturnType<typeof parseScopePayload>) {
  if (!permissions.projects.length) return '至少绑定一个运动项目。';
  if (!permissions.teams.length) return '至少绑定一个队伍范围。';
  for (const area of permissions.areas) {
    if (!AREA_LEVELS.includes(area.areaLevel)) return '行政区域级别无效。';
    if (area.areaLevel === 'national') continue;
    if (!provinceSet.has(area.province)) return '省份信息无效。';
    if ((area.areaLevel === 'city' || area.areaLevel === 'county') && area.city.length < 2)
      return '请填写所属城市。';
    if (area.areaLevel === 'county' && area.county.length < 2) return '请填写所属区县。';
  }
  if (permissions.projects.some((project) => project !== '*' && !projectSet.has(project))) {
    return '运动项目信息无效。';
  }
  return '';
}

export function replaceAccountScope(input: {
  userId: number;
  role: Role;
  parentUserId: number | null;
  permissions: ReturnType<typeof parseScopePayload>;
  grantedBy: number;
}) {
  db.prepare('DELETE FROM user_project_permissions WHERE user_id = ?').run(input.userId);
  db.prepare('DELETE FROM user_team_permissions WHERE user_id = ?').run(input.userId);
  if (input.role === 'ATL' && input.permissions.areas.length) {
    db.prepare('DELETE FROM user_area_permissions WHERE user_id = ?').run(input.userId);
    const area = input.permissions.areas[0];
    db.prepare(`
      INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.userId, area.areaLevel, area.province, area.city, area.county, input.grantedBy);
  }
  const projectInsert = db.prepare(`
    INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (?, ?, ?)
  `);
  for (const project of input.permissions.projects)
    projectInsert.run(input.userId, project, input.grantedBy);
  const teamInsert = db.prepare(`
    INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (?, ?, ?, ?)
  `);
  for (const team of input.permissions.teams)
    teamInsert.run(input.userId, team.project, team.team, input.grantedBy);
  db.prepare(`
    UPDATE account_profiles SET parent_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(input.parentUserId, input.userId);
}

export function standardAccountName(input: {
  displayName: string;
  role: Role;
  projects: string[];
  teams: Array<{ project: string; team: string }>;
}) {
  const projectLabel = input.projects.includes('*') ? '全部项目' : input.projects.join('、');
  const teamLabel = input.teams.some((team) => team.team === '*')
    ? ''
    : `·${input.teams.map((team) => team.team).join('、')}`;
  return `${projectLabel}${teamLabel}·${ROLE_META[input.role].label}·${input.displayName}`;
}

export function accessibleAthleteIds(user: AuthUser): number[] {
  if (user.role === 'ATL') return user.athleteId ? [user.athleteId] : [];
  if (user.role === 'SCC') return coachAthleteIds(db, user.id);
  const permissions = accountPermissions(user.id);
  const candidates = db
    .prepare(
      `
      SELECT a.id, a.project, COALESCE(pt.name, a.team, '') AS team
      FROM athletes a
      LEFT JOIN project_teams pt ON pt.id = a.team_id
      WHERE a.active = 1
    `
    )
    .all() as Array<Pick<ScopeAthlete, 'id' | 'project' | 'team'>>;
  return candidates
    .filter((athlete) => permissionsAllowAthlete(permissions, athlete))
    .map((athlete) => athlete.id);
}

export function hasAthleteAccess(user: AuthUser, athleteId: number) {
  return accessibleAthleteIds(user).includes(athleteId);
}

export function selectableProjects(user: AuthUser): Project[] {
  if (user.role === 'ATL') {
    const athlete = user.athleteId
      ? (db
          .prepare('SELECT project FROM athletes WHERE id = ? AND active = 1')
          .get(user.athleteId) as { project: string } | undefined)
      : undefined;
    return athlete && isProject(athlete.project) ? [athlete.project] : [];
  }
  const permissions = accountPermissions(user.id);
  return PROJECTS.filter(
    (project) => permissions.projects.includes('*') || permissions.projects.includes(project)
  );
}
