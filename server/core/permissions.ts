import {
  AREA_LEVELS,
  AREA_LEVEL_META,
  ROLES,
  ROLE_HIERARCHY,
  ROLE_META,
  canManageRole,
  type AreaLevel,
  type Role,
} from '../../shared/access.ts';
import { PROJECTS, type Project } from '../../shared/projects.ts';
import { PROVINCES } from '../../shared/regions.ts';
import { db } from './db.ts';
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

export function areaAllowsAthlete(area: AreaPermission, athlete: ScopeAthlete) {
  if (area.areaLevel === 'national') return true;
  if (area.province !== athlete.region) return false;
  if (area.areaLevel === 'province') return true;
  if (area.city !== athlete.city) return false;
  if (area.areaLevel === 'city') return true;
  return area.county === athlete.county;
}

export function permissionsAllowAthlete(
  permissions: ReturnType<typeof accountPermissions>,
  athlete: ScopeAthlete
) {
  const areaAllowed = permissions.areas.some((area) => areaAllowsAthlete(area, athlete));
  const projectAllowed =
    permissions.projects.includes('*') || permissions.projects.includes(athlete.project);
  const teamAllowed = permissions.teams.some(
    (item) =>
      (item.project === '*' || item.project === athlete.project) &&
      (item.team === '*' || item.team === athlete.team)
  );
  return areaAllowed && projectAllowed && teamAllowed;
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

export function areaContains(manager: AreaPermission, target: AreaPermission) {
  if (manager.areaLevel === 'national') return true;
  if (manager.province !== target.province) return false;
  if (manager.areaLevel === 'province') return true;
  if (manager.city !== target.city) return false;
  if (manager.areaLevel === 'city') return true;
  return target.areaLevel === 'county' && manager.county === target.county;
}

export function canManageAccount(manager: AuthUser, target: AuthUser) {
  if (!canManageRole(manager.role, target.role)) return false;
  const managerPermissions = accountPermissions(manager.id);
  const targetPermissions = accountPermissions(target.id);
  return permissionsContain(managerPermissions, targetPermissions);
}

export function permissionsContain(
  managerPermissions: ReturnType<typeof accountPermissions>,
  targetPermissions: ReturnType<typeof accountPermissions>
) {
  if (
    !targetPermissions.areas.length ||
    !targetPermissions.projects.length ||
    !targetPermissions.teams.length
  )
    return false;
  const areasContained = targetPermissions.areas.every((targetArea) =>
    managerPermissions.areas.some((managerArea) => areaContains(managerArea, targetArea))
  );
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
  return areasContained && projectsContained && teamsContained;
}

export function accountCodeFor(userId: number, role: Role, province: string, project: string) {
  const areaCodes: Record<string, string> = { 四川: '510000', 浙江: '330000', 广东: '440000' };
  const projectCodes: Record<string, string> = { 赛艇: 'ROW', 皮划艇: 'CAN' };
  return `${areaCodes[province] || '000000'}-${projectCodes[project] || 'ALL'}-${role}-${String(userId).padStart(4, '0')}`;
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
    accountCodeFor(input.userId, input.role, input.province, input.project)
  );
  db.prepare(
    `
    INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(input.userId, areaLevel, input.province, input.city, input.county, input.grantedBy);
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
  if (!permissions.areas.length) return '至少绑定一个行政区域。';
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
  db.prepare('DELETE FROM user_area_permissions WHERE user_id = ?').run(input.userId);
  db.prepare('DELETE FROM user_project_permissions WHERE user_id = ?').run(input.userId);
  db.prepare('DELETE FROM user_team_permissions WHERE user_id = ?').run(input.userId);
  const areaInsert = db.prepare(`
    INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const area of input.permissions.areas) {
    areaInsert.run(
      input.userId,
      area.areaLevel,
      area.province,
      area.city,
      area.county,
      input.grantedBy
    );
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
  const firstArea = input.permissions.areas[0];
  const firstProject = input.permissions.projects[0];
  db.prepare(
    `
    UPDATE account_profiles SET parent_user_id = ?, account_code = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `
  ).run(
    input.parentUserId,
    accountCodeFor(input.userId, input.role, firstArea?.province || '', firstProject || '*'),
    input.userId
  );
}

export function standardAccountName(input: {
  displayName: string;
  role: Role;
  areas: AreaPermission[];
  projects: string[];
  teams: Array<{ project: string; team: string }>;
}) {
  const area = input.areas[0];
  const areaLabel =
    area?.areaLevel === 'national'
      ? '全国'
      : [area?.province, area?.city, area?.county].filter(Boolean).join('·') || '未设置区域';
  const projectLabel = input.projects.includes('*') ? '全部项目' : input.projects.join('、');
  const teamLabel = input.teams.some((team) => team.team === '*')
    ? ''
    : `·${input.teams.map((team) => team.team).join('、')}`;
  return `${areaLabel}·${projectLabel}${teamLabel}·${ROLE_META[input.role].label}·${input.displayName}`;
}

export function accessibleAthleteIds(user: AuthUser): number[] {
  if (user.role === 'ATL') return user.athleteId ? [user.athleteId] : [];
  const permissions = accountPermissions(user.id);
  const candidates = db
    .prepare(
      `
      SELECT a.id, COALESCE(ao.province, '') AS region, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county,
        a.project, COALESCE(pt.name, a.team, '') AS team
      FROM athletes a
      LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
      LEFT JOIN project_teams pt ON pt.id = a.team_id
      WHERE a.active = 1
    `
    )
    .all() as ScopeAthlete[];
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
    return athlete && PROJECTS.includes(athlete.project) ? [athlete.project] : [];
  }
  const permissions = accountPermissions(user.id);
  return PROJECTS.filter(
    (project) => permissions.projects.includes('*') || permissions.projects.includes(project)
  );
}
