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
