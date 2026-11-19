import type { TrainingRecordTemplate } from '../../shared/training-record-template.ts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TestTemplateGroup, TestTemplateGroupInput, TestTemplateMetric, TestTemplateMetricInput } from '../../shared/test-template.ts';
import { FMS_TEST_PROTOCOL, FMS_TEMPLATE_METRICS } from '../../shared/data-import-template.ts';
import { COMPACT_ATHLETE_COLUMNS } from '../../shared/compact-athlete-template.ts';
import { normalizeProject } from '../../shared/projects.ts';
import { metricAppliesToProject } from '../../shared/import-metric-choice.ts';

export class TestTemplateInputError extends Error {}

export const TEST_TEMPLATE_SHEET = '运动员测试成绩';
export const TEST_TEMPLATE_META = '模板识别';
export const TEST_TEMPLATE_FORMAT = 'jingji:test-template:v1';
export { TEST_TEMPLATE_IDENTITY_HEADERS } from '../../shared/test-template.ts';

export function initializeTestTemplates(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_template_metric_details (
        metric_code TEXT PRIMARY KEY REFERENCES metric_definitions(code),
        value_kind TEXT NOT NULL CHECK(value_kind IN ('number','time')),
        protocol TEXT NOT NULL,
        version INTEGER NOT NULL,
        previous_code TEXT REFERENCES metric_definitions(code)
      );
      CREATE TABLE IF NOT EXISTS test_template_projects (
        project TEXT PRIMARY KEY,
        codes_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS test_template_teams (
        team_id INTEGER PRIMARY KEY REFERENCES project_teams(id) ON DELETE CASCADE,
        codes_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS test_template_groups (
        project TEXT NOT NULL,
        name_key TEXT NOT NULL,
        name TEXT NOT NULL,
        codes_json TEXT NOT NULL,
        PRIMARY KEY (project, name_key)
      );
      CREATE TABLE IF NOT EXISTS test_collection_expectations (
        team_id INTEGER NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
        from_date TEXT NOT NULL,
        to_date TEXT NOT NULL,
        athlete_ids_json TEXT NOT NULL,
        metric_codes_json TEXT NOT NULL,
        confirmed_by INTEGER NOT NULL,
        PRIMARY KEY (team_id,from_date,to_date)
      );
      CREATE TABLE IF NOT EXISTS training_record_templates (
        team_id INTEGER NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        PRIMARY KEY(team_id,name)
      );
      CREATE TABLE IF NOT EXISTS training_record_downloads (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, team_id INTEGER NOT NULL, config_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS training_record_session_scope (
        session_id INTEGER PRIMARY KEY REFERENCES training_sessions(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS training_record_details (
        session_id INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL,
        template_name TEXT NOT NULL,
        detail_order INTEGER NOT NULL,
        field TEXT NOT NULL,
        unit TEXT NOT NULL,
        value_num REAL,
        value_text TEXT,
        PRIMARY KEY(session_id,team_id,template_name,detail_order,field,unit)
      );
      CREATE TABLE IF NOT EXISTS test_template_downloads (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        team_id INTEGER NOT NULL,
        team_name TEXT NOT NULL,
        columns_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const columns = db.prepare('PRAGMA table_info(test_template_downloads)').all();
    // 开发早期的快照已存在时，补列并保留原记录；旧快照的下载时队名没有历史依据。
    if (!columns.some(column => column.name === 'team_name'))
      db.exec("ALTER TABLE test_template_downloads ADD COLUMN team_name TEXT NOT NULL DEFAULT ''");
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const compactProtocols = new Map<string, string>(COMPACT_ATHLETE_COLUMNS.flatMap(field =>
  field.kind === 'test' ? [[field.code, field.protocol] as const] : []
));

const fmsGroup: TestTemplateGroup = { name: 'FMS', codes: FMS_TEMPLATE_METRICS.map(([, code]) => code) };
const fmsCodes = new Set(fmsGroup.codes);

const projectDefaults: Record<string, string[]> = {
  ROWING: ['squat_kg', 'erg_2k_sec'],
  WEIGHTLIFTING: ['squat_kg', 'vertical_jump_cm'],
};

export function testTemplateCatalog(db: DatabaseSync, project: string): TestTemplateMetric[] {
  const rows = db.prepare(`
    SELECT m.code, m.label, m.unit, m.direction, m.projects_json AS projectsJson,
      d.value_kind AS valueKind, d.protocol, d.version
    FROM metric_definitions m LEFT JOIN test_template_metric_details d ON d.metric_code=m.code
    WHERE m.active=1 ORDER BY m.label, m.code
  `).all() as Array<Pick<TestTemplateMetric, 'code' | 'label' | 'unit' | 'direction'> & {
    projectsJson: string; valueKind: TestTemplateMetric['valueKind'] | null; protocol: string | null; version: number | null;
  }>;
  return rows.flatMap(({ code, label, unit, direction, projectsJson, valueKind, protocol, version }) => {
    const projects = JSON.parse(projectsJson) as string[];
    if (!metricAppliesToProject({ projects }, project)) return [];
    const isFms = fmsCodes.has(code);
    const resolvedProtocol = isFms ? FMS_TEST_PROTOCOL : protocol ?? compactProtocols.get(code) ?? '';
    return [{
      code, label, unit, direction, protocol: resolvedProtocol,
      valueKind: valueKind ?? (unit === 's' ? 'time' : 'number'),
      protocolVersion: version?.toString() ?? '',
      testType: isFms ? 'FMS测试' : resolvedProtocol === '实测1RM' ? '力量素质测试' : compactProtocols.has(code) ? '体能测试' : '专项测试',
      editable: projects.length === 1 && normalizeProject(projects[0]) === project,
    }];
  });
}

export function testTemplateCodes(db: DatabaseSync, project: string, teamId: number, catalog: TestTemplateMetric[]) {
  const projectConfig = db.prepare('SELECT codes_json AS codes FROM test_template_projects WHERE project=?')
    .get(project) as { codes: string } | undefined;
  const teamConfig = db.prepare('SELECT codes_json AS codes FROM test_template_teams WHERE team_id=?')
    .get(teamId) as { codes: string } | undefined;
  const active = new Set(catalog.map(metric => metric.code));
  const available = (codes: string[]) => codes.filter(code => active.has(code));
  const projectCodes = available(projectConfig ? JSON.parse(projectConfig.codes) : (projectDefaults[project] ?? []));
  return { projectCodes, codes: teamConfig ? available(JSON.parse(teamConfig.codes)) : projectCodes, source: teamConfig ? 'team' as const : 'project' as const };
}

export function testTemplateGroups(db: DatabaseSync, project: string, catalog: TestTemplateMetric[]) {
  const available = new Set(catalog.map(metric => metric.code));
  const stored = db.prepare('SELECT name,codes_json AS codes FROM test_template_groups WHERE project=? ORDER BY name')
    .all(project) as Array<{ name: string; codes: string }>;
  return [fmsGroup, ...stored.map((row): TestTemplateGroup => ({ name: row.name, codes: JSON.parse(row.codes) }))]
    .filter(group => group.codes.every(code => available.has(code)));
}

function groupNameKey(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function insertTestTemplateMetric(db: DatabaseSync, project: string, input: TestTemplateMetricInput, previous?: TestTemplateMetric) {
  const code = `custom_${randomUUID().replaceAll('-', '')}`;
  db.prepare(`INSERT INTO metric_definitions (code,label,domain,unit,direction,frequency,projects_json)
    VALUES (?,?,'fitness',?,?,'phase',?)`).run(code, input.label, input.unit, input.direction, JSON.stringify([project]));
  db.prepare(`INSERT INTO test_template_metric_details (metric_code,value_kind,protocol,version,previous_code)
    VALUES (?,?,?,?,?)`).run(code, input.valueKind, input.protocol, previous ? Number(previous.protocolVersion || 1) + 1 : 1, previous?.code ?? null);
  return code;
}

export function createTestTemplateGroup(db: DatabaseSync, project: string, input: TestTemplateGroupInput) {
  const nameKey = groupNameKey(input.name);
  const fieldKeys = input.fields.map(field => groupNameKey(field.label));
  if (new Set(fieldKeys).size !== fieldKeys.length) throw new TestTemplateInputError('同一个测试项目的字段名称不能重复。');
  if (nameKey === groupNameKey(fmsGroup.name)) throw new TestTemplateInputError('FMS 已内置，请直接选用。');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM test_template_groups WHERE project=? AND name_key=?').get(project, nameKey))
      throw new TestTemplateInputError('该测试项目已存在，请直接选用。');
    const catalog = testTemplateCatalog(db, project);
    const codes = input.fields.map(field => {
      const metric: TestTemplateMetricInput = {
        label: `${input.name}${field.label}`,
        unit: field.unit,
        protocol: input.protocol ?? '',
        valueKind: 'number',
        direction: 'neutral',
      };
      const matches = catalog.filter(item => item.label === metric.label && item.unit === metric.unit && item.protocol === metric.protocol);
      if (matches.length > 1 || (matches[0] && matches[0].valueKind !== metric.valueKind))
        throw new TestTemplateInputError(`「${metric.label}」已有同名指标，请修改字段名称后再保存。`);
      return matches[0]?.code ?? insertTestTemplateMetric(db, project, metric);
    });
    db.prepare('INSERT INTO test_template_groups (project,name_key,name,codes_json) VALUES (?,?,?,?)')
      .run(project, nameKey, input.name, JSON.stringify(codes));
    const updated = new Map(testTemplateCatalog(db, project).map(metric => [metric.code, metric]));
    const metrics = codes.map(code => updated.get(code)!);
    db.exec('COMMIT');
    return { group: { name: input.name, codes }, metrics };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createTestTemplateMetric(db: DatabaseSync, project: string, input: TestTemplateMetricInput, previousCode?: string) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const catalog = testTemplateCatalog(db, project);
    const previous = previousCode ? catalog.find(metric => metric.code === previousCode) : undefined;
    if (previousCode && !previous)
      throw new TestTemplateInputError('原指标已停用或不适用于当前项目。');
    if (previous && previous.protocol === input.protocol && previous.unit === input.unit && previous.valueKind === input.valueKind)
      throw new TestTemplateInputError('单位、协议和成绩格式均未变更。');
    if (catalog.some(metric => metric.label === input.label && metric.unit === input.unit && metric.protocol === input.protocol))
      throw new TestTemplateInputError('已有同名、同单位、同协议的指标，请从候选列表选用。');
    const code = insertTestTemplateMetric(db, project, input, previous);
    const metric = testTemplateCatalog(db, project).find(entry => entry.code === code)!;
    db.exec('COMMIT');
    return metric;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export type TestTemplateColumn = Pick<TestTemplateMetric, 'code' | 'label' | 'unit' | 'protocol' | 'protocolVersion' | 'valueKind' | 'testType'> & { header: string };
export type TestTemplateDownload = { id: string; project: string; teamId: number; teamName: string; columns: TestTemplateColumn[] };

export function readTestTemplateDownload(db: DatabaseSync, id: string): TestTemplateDownload | undefined {
  const row = db.prepare('SELECT id,project,team_id AS teamId,team_name AS teamName,columns_json AS columns FROM test_template_downloads WHERE id=?')
    .get(id) as { id: string; project: string; teamId: number; teamName: string; columns: string } | undefined;
  return row && { ...row, columns: JSON.parse(row.columns) };
}

export function testTemplateTeamId(db: DatabaseSync, project: string, team: string) {
  return (db.prepare('SELECT id FROM project_teams WHERE project=? AND name=? AND active=1')
    .get(project, team) as { id: number } | undefined)?.id;
}

export type TrainingRecordDownload = TrainingRecordTemplate & { project: string; teamId: number };
export function readTrainingRecordDownload(db: DatabaseSync, id: string): TrainingRecordDownload | undefined {
  const row = db.prepare('SELECT project,team_id AS teamId,config_json AS config FROM training_record_downloads WHERE id=?')
    .get(id) as { project: string; teamId: number; config: string } | undefined;
  if (row) return { ...JSON.parse(row.config), project: row.project, teamId: row.teamId };
}
