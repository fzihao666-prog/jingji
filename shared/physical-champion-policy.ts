/** 全局参考影响所有组织，必须同时拥有全国、全部项目和全部队伍权限。 */
export function canManageGlobalPhysicalReferences(
  role: string,
  permissions: {
    projects: string[];
    areas: Array<{ areaLevel: string }>;
    teams: Array<{ project: string; team: string }>;
  }
) {
  return (
    role === 'DMD' &&
    permissions.projects.includes('*') &&
    permissions.areas.some((area) => area.areaLevel === 'national') &&
    permissions.teams.some((team) => team.project === '*' && team.team === '*')
  );
}

/** 项目冠军值允许教练及以上维护，项目授权不能跨项目扩展。 */
export function canEditPhysicalChampionValues(
  role: string,
  permissions: { projects: string[] },
  project: string
) {
  return (
    ['SCC', 'REG', 'TD', 'DMD'].includes(role) &&
    (permissions.projects.includes('*') || permissions.projects.includes(project))
  );
}
