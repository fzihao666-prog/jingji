import { db } from '../core/db.ts';
import { accountPermissions, permissionsAllowProjectTeam } from '../core/permissions.ts';
import type { AuthUser } from '../core/shared-server.ts';

export function dataImportScope(user: AuthUser, project: string) {
  const permissions = accountPermissions(user.id);
  const projectAllowed =
    permissions.projects.includes('*') || permissions.projects.includes(project);
  const allTeams = (
    db
      .prepare('SELECT name FROM project_teams WHERE project = ? AND active = 1 ORDER BY name')
      .all(project) as Array<{ name: string }>
  ).map((row) => row.name);
  const teamScopeGranted = permissions.teams.some(
    item => (item.project === '*' || item.project === project) && Boolean(item.team)
  );
  const allowedTeams = new Set(allTeams.filter(team => permissionsAllowProjectTeam(permissions, project, team)));
  const area = permissions.areas[0];
  return {
    // 授权来自账号范围；项目尚未建队不代表无权下载模板或查看空结果。
    allowed: permissions.areas.length > 0 && projectAllowed && teamScopeGranted,
    allowedTeams,
    defaultArea: {
      region: area?.areaLevel === 'national' ? '未设置' : area?.province || '未设置',
      city: area && ['city', 'county'].includes(area.areaLevel) ? area.city || '未设置' : '未设置',
      county: area?.areaLevel === 'county' ? area.county || '未设置' : '未设置',
    },
  };
}
