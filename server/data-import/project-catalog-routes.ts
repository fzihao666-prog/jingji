import type { Express } from 'express';
import { z } from 'zod';
import type { ProjectNameCatalog, ProjectNameKind } from '../../shared/project-name-catalog.ts';
import { ACTIVITY_LABELS, activityMetricFields, projectRules } from '../../shared/sport-rules.ts';
import { WEEKLY_FOCUS_EXERCISES } from '../../shared/team-weekly-report.ts';
import {
  commonTrainingProjects,
  type TrainingRecordTemplate,
} from '../../shared/training-record-template.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import {
  accessibleAthleteIds,
  accountPermissions,
  permissionsAllowProjectTeam,
  selectableProjects,
} from '../core/permissions.ts';
import {
  ProjectNameMappingError,
  projectNameResolver,
  readProjectNameMappings,
  saveProjectNameMapping,
} from '../core/project-name-mappings.ts';
import type { AuthUser } from '../core/shared-server.ts';
import { testTemplateCatalog, testTemplateGroups } from './test-template-store.ts';
import { originalTestProjectSql, readTestProjectFields } from './test-project-names.ts';
import {
  projectCatalogSettingsLookup,
  readProjectCatalogSettings,
  saveProjectCatalogSettings,
} from '../core/project-catalog-settings.ts';
import { DAILY_TRAINING_SHEET } from '../../shared/daily-training.ts';

const name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) =>
    [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
  );
const mappingBody = z
  .object({
    kind: z.enum(['training', 'test']),
    source: name,
    target: name,
    previousSource: name.optional(),
  })
  .strict();
const path = '/api/data-management/project-catalog';
const projectBody = z
  .object({
    kind: z.enum(['training', 'test']),
    source: name,
    name,
    fields: z
      .array(
        z
          .object({
            source: name,
            name,
            unit: z.string().trim().max(24),
            protocol: z.string().trim().max(160),
            version: z
              .string()
              .trim()
              .regex(/^(?:[1-9]\d{0,8})?$/),
          })
          .strict()
      )
      .max(60)
      .refine((fields) => new Set(fields.map((field) => field.source)).size === fields.length)
      .optional(),
  })
  .strict();

function projectCatalog(user: AuthUser): ProjectNameCatalog {
  const mappings = readProjectNameMappings(db);
  const resolve = projectNameResolver(mappings);
  const projects = new Map<string, ProjectNameCatalog['projects'][number]>();
  const metrics = new Map<string, ProjectNameCatalog['metrics'][number]>();
  const addProject = (kind: ProjectNameKind, rawName: string, source: string, recordCount = 0) => {
    const name = resolve(kind, rawName);
    if (!name) return;
    const key = JSON.stringify([kind, name]);
    const current = projects.get(key) ?? { kind, name, recordCount: 0, sources: [] };
    current.recordCount += recordCount;
    if (!current.sources.includes(source)) current.sources.push(source);
    projects.set(key, current);
  };
  const addMetric = (
    kind: ProjectNameKind,
    name: string,
    unit: string,
    rawProject = '',
    protocol = '',
    version = '',
    source = '系统内置',
    count = 0
  ) => {
    const identity = {
      kind,
      name,
      unit,
      projectName: resolve(kind, rawProject),
      protocol,
      version,
    };
    const key = JSON.stringify(identity);
    const metric = metrics.get(key) ?? { ...identity, recordCount: 0, sources: [] };
    metric.recordCount += count;
    if (!metric.sources.includes(source)) metric.sources.push(source);
    metrics.set(key, metric);
  };
  const addTemplate = (template: TrainingRecordTemplate, source: string) => {
    addProject('training', template.name, source);
    for (const field of template.fields)
      addMetric('training', field.name, field.unit, template.name, '', '', source);
  };
  const sports = selectableProjects(user);
  const fields = readTestProjectFields(db, sports);
  for (const sport of sports) {
    const rules = projectRules(sport);
    for (const activity of rules?.activities ?? []) {
      if (activity === 'unknown') continue;
      addProject('training', ACTIVITY_LABELS[activity], '系统内置');
      for (const field of activityMetricFields(sport, activity))
        addMetric('training', field.label, field.unit, ACTIVITY_LABELS[activity]);
    }
    const catalog = testTemplateCatalog(db, sport);
    for (const group of testTemplateGroups(db, sport, catalog))
      addProject('test', group.name, group.common ? '系统内置' : '模板配置');
    for (const metric of catalog) {
      for (const field of fields(sport, metric.code, metric.label)) {
        const source = metric.code.startsWith('custom_import_')
          ? '教练导入'
          : metric.code.startsWith('custom_')
            ? '模板配置'
            : '系统内置';
        addProject('test', field.projectName, source);
        addMetric(
          'test',
          field.field === '成绩' && field.projectName === metric.label
            ? resolve('test', field.projectName)
            : field.field,
          metric.unit,
          field.projectName,
          metric.protocol,
          metric.protocolVersion,
          source
        );
      }
    }
  }
  for (const template of commonTrainingProjects) addTemplate(template, '系统内置');
  for (const exercise of WEEKLY_FOCUS_EXERCISES) addProject('training', exercise, '系统内置');
  for (const [label, unit] of [
    ['强度', ''],
    ['每组次数', '次'],
    ['组数', '组'],
    ['时长', '分钟'],
    ['距离', 'km'],
    ['RPE', ''],
    ['PRE', ''],
    ['平均心率', '次/分'],
    ['最大心率', '次/分'],
    ['SRPE', ''],
    ['力量训练总容量', 'kg'],
  ])
    addMetric('training', label, unit);

  const permissions = accountPermissions(user.id);
  const templates = db
    .prepare(
      `SELECT t.project, t.name AS team, c.config_json AS config
    FROM training_record_templates c JOIN project_teams t ON t.id=c.team_id WHERE t.active=1`
    )
    .all() as Array<{ project: string; team: string; config: string }>;
  for (const template of templates) {
    if (permissionsAllowProjectTeam(permissions, template.project, template.team))
      addTemplate(JSON.parse(template.config) as TrainingRecordTemplate, '模板配置');
  }
  const allowed = JSON.stringify(accessibleAthleteIds(user));
  const training = `
    FROM training_sessions s JOIN athletes a ON a.id=s.athlete_id AND a.project=s.project_code
    WHERE s.athlete_id IN (SELECT value FROM json_each(?)) AND s.is_demo=0 AND s.project_status='confirmed'
      AND s.quality IN ('valid','partial')`;
  const sessions = db
    .prepare(
      `
    SELECT COALESCE(NULLIF(s.content,''),NULLIF(s.training_type,''),'训练课次') AS projectName,
      s.source, COUNT(*) AS count, COUNT(CASE WHEN s.duration_reported=1 THEN 1 END) AS duration,
      COUNT(CASE WHEN s.distance_reported=1 THEN 1 END) AS distance, COUNT(s.rpe) AS rpe,
      COUNT(s.srpe) AS srpe, COUNT(s.average_heart_rate) AS averageHeartRate, COUNT(s.max_heart_rate) AS maxHeartRate
    ${training} GROUP BY projectName,s.source
  `
    )
    .all(allowed) as Array<{
    projectName: string;
    source: string;
    count: number;
    duration: number;
    distance: number;
    rpe: number;
    srpe: number;
    averageHeartRate: number;
    maxHeartRate: number;
  }>;
  const sourceLabel = (source: string) => (/import/.test(source) ? '教练导入' : '系统记录');
  for (const row of sessions) {
    const source = sourceLabel(row.source);
    addProject('training', row.projectName, source, row.count);
    for (const [label, unit, count] of [
      ['时长', '分钟', row.duration],
      ['距离', 'km', row.distance],
      ['RPE', '', row.rpe],
      ['SRPE', '', row.srpe],
      ['平均心率', '次/分', row.averageHeartRate],
      ['最大心率', '次/分', row.maxHeartRate],
    ] as const) {
      if (count) addMetric('training', label, unit, row.projectName, '', '', source, count);
    }
  }
  const exercises = db
    .prepare(
      `
    SELECT r.exercise_name AS name, r.source, COUNT(DISTINCT s.id) AS count,
      COUNT(CASE WHEN r.completed=1 THEN 1 END) AS completedSets
    FROM strength_result_sets r JOIN training_sessions s ON s.id=r.training_session_id
    JOIN athletes a ON a.id=s.athlete_id AND a.project=s.project_code
    WHERE s.athlete_id IN (SELECT value FROM json_each(?)) AND s.is_demo=0 AND s.project_status='confirmed'
      AND s.quality IN ('valid','partial') GROUP BY r.exercise_name,r.source
  `
    )
    .all(allowed) as Array<{ name: string; source: string; count: number; completedSets: number }>;
  for (const row of exercises) {
    const source = sourceLabel(row.source);
    addProject('training', row.name, source, row.count);
    if (row.completedSets) {
      addMetric('training', '强度', 'kg', row.name, '', '', source, row.completedSets);
      addMetric('training', '次数', '次', row.name, '', '', source, row.completedSets);
    }
  }
  const details = db
    .prepare(
      `
    SELECT CASE WHEN d.template_name=? THEN COALESCE(NULLIF(s.content,''),d.template_name)
      ELSE d.template_name END AS projectName,d.field AS name,d.unit,COUNT(*) AS count
    FROM training_record_details d JOIN training_record_session_scope scope ON scope.session_id=d.session_id AND scope.team_id=d.team_id
    JOIN training_sessions s ON s.id=d.session_id JOIN athletes a ON a.id=s.athlete_id AND a.project=s.project_code
    WHERE s.athlete_id IN (SELECT value FROM json_each(?)) AND s.is_demo=0 AND s.project_status='confirmed'
      AND s.quality IN ('valid','partial') AND a.team_id=d.team_id
    GROUP BY projectName,d.field,d.unit
  `
    )
    .all(DAILY_TRAINING_SHEET, allowed) as Array<{
    projectName: string;
    name: string;
    unit: string;
    count: number;
  }>;
  for (const row of details) {
    addProject('training', row.projectName, '教练导入');
    addMetric('training', row.name, row.unit, row.projectName, '', '', '教练导入', row.count);
  }
  const tests = db
    .prepare(
      `
    SELECT s.project_code AS project, m.metric_code AS code, COALESCE(d.label,m.metric_code) AS label,
      m.source,m.unit,s.protocol,COALESCE(s.protocol_version,'') AS version,
      ${originalTestProjectSql} AS original,COUNT(*) AS count
    FROM test_measurements m JOIN test_sessions s ON s.id=m.test_session_id
    JOIN athletes a ON a.id=s.athlete_id AND a.project=s.project_code
    LEFT JOIN metric_definitions d ON d.code=m.metric_code
    WHERE s.athlete_id IN (SELECT value FROM json_each(?)) AND s.project_status='confirmed'
      AND s.is_demo=0 AND m.is_demo=0 AND s.quality IN ('valid','partial') AND m.quality IN ('valid','partial')
    GROUP BY s.project_code,m.metric_code,m.source,m.unit,s.protocol,s.protocol_version,original
  `
    )
    .all(allowed) as Array<{
    project: string;
    code: string;
    label: string;
    source: string;
    unit: string;
    protocol: string;
    version: string;
    original: string;
    count: number;
  }>;
  for (const row of tests) {
    const seen = new Set<string>();
    for (const field of fields(row.project, row.code, row.label, row.original)) {
      const canonical = resolve('test', field.projectName);
      if (!seen.has(canonical)) addProject('test', canonical, sourceLabel(row.source), row.count);
      const name =
        field.field === '成绩' && field.projectName === row.label ? canonical : field.field;
      const key = JSON.stringify([canonical, name]);
      if (!seen.has(key))
        addMetric(
          'test',
          name,
          row.unit,
          canonical,
          row.protocol,
          row.version,
          sourceLabel(row.source),
          row.count
        );
      seen.add(canonical);
      seen.add(key);
    }
  }
  for (const rule of mappings) addProject(rule.kind, rule.target, '名称映射');
  for (const setting of readProjectCatalogSettings(db))
    addProject(setting.kind, setting.name, '项目配置');
  const settingsFor = projectCatalogSettingsLookup(db);
  return {
    projects: [...projects.values()].sort(
      (a, b) => b.recordCount - a.recordCount || a.name.localeCompare(b.name, 'zh-CN')
    ),
    metrics: [...metrics.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    mappings,
    settings: [...projects.values()].flatMap((project) => {
      const setting = settingsFor(project.kind, project.name);
      return setting ? [{ ...setting, name: project.name }] : [];
    }),
  };
}

export function registerProjectCatalogRoutes(app: Express) {
  app.get(path, requireAuth, requireRole('SCC', 'REG', 'TD', 'DMD'), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(projectCatalog(req.authUser!));
  });
  app.put(`${path}/projects`, requireAuth, requireRole('TD', 'DMD'), (req, res) => {
    const input = projectBody.safeParse(req.body);
    if (!input.success)
      return res
        .status(400)
        .json({ message: '请检查项目名称、字段、单位、协议与版本。版本填写正整数或留空。' });
    const { source, ...settings } = input.data;
    if (
      !projectCatalog(req.authUser!).projects.some(
        (project) => project.kind === settings.kind && project.name === source
      )
    )
      return res.status(404).json({ message: '未找到可编辑的项目，请刷新目录。' });
    try {
      saveProjectCatalogSettings(db, req.authUser!.id, source, settings);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ message: '项目已保存。' });
    } catch (error) {
      if (error instanceof ProjectNameMappingError)
        return res.status(409).json({ message: error.message });
      throw error;
    }
  });
  app.put(`${path}/mappings`, requireAuth, requireRole('TD', 'DMD'), (req, res) => {
    const input = mappingBody.safeParse(req.body);
    if (!input.success)
      return res.status(400).json({ message: '请选择项目类型并填写原始名称与标准名称。' });
    const { previousSource, ...rule } = input.data;
    try {
      saveProjectNameMapping(db, req.authUser!.id, rule, previousSource);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ message: '项目名称映射已保存。' });
    } catch (error) {
      if (error instanceof ProjectNameMappingError)
        return res.status(409).json({ message: error.message });
      throw error;
    }
  });
}
