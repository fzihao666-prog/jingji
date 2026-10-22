import { ImportRequestError } from './data-import-revision.ts';
import { db } from '../core/db.ts';
import { accountPermissions, permissionsAllowProjectTeam, permissionsAllowAthlete } from '../core/permissions.ts';
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

/** 所有草稿读取和写入共用：所有者身份不替代当前业务授权。 */
export function assertDataImportBatchAccess(user: AuthUser, batchId: string, candidates: Array<{ id: number }>) {
  const batch = db.prepare('SELECT project,summary_json AS summary FROM data_import_batches WHERE id=? AND created_by=?').get(batchId, user.id) as { project: string; summary: string } | undefined;
  if (!batch) throw new ImportRequestError('未找到该导入批次，或当前账号无权访问。', 404);
  const scope = dataImportScope(user, batch.project);
  const deny = () => { throw new ImportRequestError('当前授权已变化，无法访问该批次，请核对项目、队伍及人员权限。', 403); };
  if (!scope.allowed) deny();
  const allowed = new Set(candidates.map(candidate => candidate.id));
  const ids = db.prepare('SELECT DISTINCT athlete_id AS id FROM data_import_items WHERE batch_id=? AND athlete_id IS NOT NULL').all(batchId) as { id: number }[];
  if (ids.some(row => !allowed.has(row.id))) deny();
  const persons = db.prepare(`SELECT project,team,region,city,county,matched_athlete_id AS matchedId,
    created_athlete_id AS createdId,suggested_json AS suggested FROM data_import_athlete_candidates WHERE batch_id=?`).all(batchId) as Array<{
      project: string; team: string; region: string; city: string; county: string; matchedId: number | null; createdId: number | null; suggested: string;
    }>;
  const permissions = accountPermissions(user.id);
  const originalTeams: unknown = (JSON.parse(batch.summary || '{}') as Record<string, unknown>).accessTeams;
  for (const person of persons) {
    const linked = person.createdId || person.matchedId;
    if (linked && !allowed.has(linked)) deny();
    const suggestions = JSON.parse(person.suggested || '[]') as { id: number }[];
    if (suggestions.some(suggestion => !allowed.has(suggestion.id))) deny();
    if (!linked && (Array.isArray(originalTeams) ? originalTeams.includes(person.team) : Boolean(person.team)) && !permissionsAllowAthlete(permissions, { ...person, id: 0 })) deny();
  }
  return scope;
}
