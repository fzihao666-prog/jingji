import { db } from '../core/db.ts';
import { metricAppliesToProject, type ImportMetricDefinition } from '../../shared/import-metric-choice.ts';

/** 仅从服务端正式字典读取，工作簿里的数据字典不能决定指标归属。 */
export function readImportMetricDefinitions(project: string): ImportMetricDefinition[] {
  const rows = db.prepare('SELECT code, label, unit, projects_json AS projectsJson FROM metric_definitions WHERE active = 1 ORDER BY code').all() as { code: string; label: string; unit: string; projectsJson: string }[];
  return rows.map(({ projectsJson, ...metric }) => {
    const projects: unknown = JSON.parse(projectsJson || '[]');
    if (!Array.isArray(projects) || !projects.every(value => typeof value === 'string')) throw new Error('测试项目字典的项目范围配置无效');
    return { ...metric, projects };
  }).filter(metric => metricAppliesToProject(metric, project));
}
