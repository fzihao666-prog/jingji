import { testTemplateHeaders } from '../../shared/test-template.ts';
import {
  combineTrainingProjects, TRAINING_RECORD_OPTIONS, TRAINING_RECORD_SHEET, TRAINING_RECORD_FORMAT, TRAINING_SET_COLUMNS, trainingDetailHeader, trainingRecordHeaders,
  type TrainingRecordTemplate,
} from '../../shared/training-record-template.ts';
import { isValidIsoDate } from '../core/date-utils.ts';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { isProject, projectLabel } from '../../shared/projects.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import { accessibleAthleteIds, accountPermissions } from '../core/permissions.ts';
import { dataImportScope } from './data-import-access.ts';
import { ImportRequestError } from './data-import-revision.ts';
import {
  createTestTemplateGroup, createTestTemplateMetric, testTemplateCatalog, testTemplateCodes, testTemplateGroups, testTemplateTeamId, TestTemplateInputError,
  TEST_TEMPLATE_SHEET, TEST_TEMPLATE_META, TEST_TEMPLATE_FORMAT, TEST_TEMPLATE_IDENTITY_HEADERS,
  type TestTemplateColumn,
} from './test-template-store.ts';

const scopeSchema = z.object({ project: z.string(), team: z.string().trim().min(1).max(120) }).strict();
const codesSchema = z.array(z.string().min(1).max(96)).min(1).max(100);
const metricSchema = z.object({
  label: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(24),
  protocol: z.string().trim().max(160).default(''),
  direction: z.enum(['higher_better', 'lower_better', 'neutral']),
  valueKind: z.enum(['number', 'time']),
  previousCode: z.string().min(1).max(96).optional(),
}).strict().refine(metric => metric.valueKind !== 'time' || metric.unit === 's', '计时指标的标准单位必须为秒（s）。');

const groupSchema = z.object({
  name: z.string().trim().min(1).max(40),
  fields: z.array(z.object({
    label: z.string().trim().min(1).max(40),
    unit: z.string().trim().max(24).default(''),
    valueKind: z.enum(['number', 'time']).optional(),
  }).strict()).min(1).max(100),
  protocol: z.string().trim().max(160).optional(),
}).strict();

function scope(req: Request, selection: unknown = req.query) {
  const input = scopeSchema.safeParse(selection);
  if (!input.success || !isProject(input.data.project))
    throw new ImportRequestError('请选择有效的项目和队伍。', 400);
  const user = req.authUser!;
  const { project, team } = input.data;
  const teamId = testTemplateTeamId(db, project, team);
  const access = dataImportScope(user, project);
  if (!teamId || !access.allowed || !access.allowedTeams.has(team))
    throw new ImportRequestError('当前账号无权配置或下载所选队伍的测试模板。', 403);
  const canManageProject = user.role !== 'SCC' && accountPermissions(user.id).teams.some(
    grant => grant.team === '*' && (grant.project === '*' || grant.project === project),
  );
  return { project, team, teamId, canManageProject, user };
}

function roster(s: ReturnType<typeof scope>) {
  const allowed = new Set(accessibleAthleteIds(s.user));
  return (db.prepare('SELECT id,name FROM athletes WHERE project=? AND team_id=? AND active=1 ORDER BY name,id')
    .all(s.project, s.teamId) as Array<{ id: number; name: string }>).filter(athlete => allowed.has(athlete.id));
}

const trainingTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  standard: z.array(z.enum(TRAINING_RECORD_OPTIONS)).max(TRAINING_RECORD_OPTIONS.length),
  fields: z.array(z.object({
    name: z.string().trim().min(1).max(80), unit: z.string().trim().max(24), kind: z.enum(['number', 'text', 'time']),
  }).strict()).max(60),
}).strict();

function validateTrainingTemplate(template: TrainingRecordTemplate) {
  if (!template.standard.length && !template.fields.length)
    throw new ImportRequestError('请至少添加一个训练字段。', 400);
  for (const field of template.fields) if (field.kind === 'time') field.unit = 's';
  if (template.standard.some(field => TRAINING_SET_COLUMNS.some(key => key === field)))
    template.standard = [...new Set([...template.standard, ...TRAINING_SET_COLUMNS])];
  const headers = trainingRecordHeaders({ ...template, columnOrder: undefined });
  if (new Set(headers.map(label => label.normalize('NFKC').replace(/\s+/g, '').toLowerCase())).size !== headers.length)
    throw new ImportRequestError('字段名称与已有列重复，请修改名称。', 400);
  const requested = template.columnOrder;
  if (requested && (!requested.length || new Set(requested).size !== requested.length ||
    requested.some(header => !template.standard.includes(header) && !template.fields.some(field => trainingDetailHeader(field) === header))))
    throw new ImportRequestError('Excel 列配置已变化，请重新选择字段。', 400);
  return trainingRecordHeaders(template);
}

function saveTrainingTemplate(teamId: number, template: TrainingRecordTemplate) {
  db.prepare(`INSERT INTO training_record_templates(team_id,name,config_json) VALUES (?,?,?)
    ON CONFLICT(team_id,name) DO UPDATE SET config_json=excluded.config_json`).run(teamId, template.name, JSON.stringify(template));
}

function trainingTeamConfig(teamId: number) {
  const templates = db.prepare('SELECT config_json AS config FROM training_record_templates WHERE team_id=? ORDER BY name')
    .all(teamId).map(row => JSON.parse(String(row.config)) as TrainingRecordTemplate);
  const saved = db.prepare('SELECT names_json AS names FROM training_record_team_columns WHERE team_id=?').get(teamId);
  const config = saved ? JSON.parse(String(saved.names)) : templates.map(template => template.name);
  const names: string[] = Array.isArray(config) ? config : config.names;
  return { templates, names: names.filter(name => templates.some(template => template.name === name)),
    columns: Array.isArray(config) ? undefined : config.columns as string[] | undefined };
}

function selectedTrainingProjects(teamId: number, names?: string[]) {
  const config = trainingTeamConfig(teamId);
  const selected = names ?? config.names;
  const catalog = new Map(config.templates.map(template => [template.name, template]));
  if (new Set(selected).size !== selected.length || selected.some(name => !catalog.has(name)))
    throw new ImportRequestError('训练项目已变化，请重新打开模板配置。', 400);
  return selected.map(name => catalog.get(name)!);
}

function throwOnInvalidCodes(project: string, codes: string[]) {
  const catalog = new Map(testTemplateCatalog(db, project).map(metric => [metric.code, metric]));
  if (codes.length !== new Set(codes).size || codes.some(code => !catalog.has(code)))
    throw new ImportRequestError('模板包含重复、停用或不适用于当前项目的指标。', 400);
  return codes.map(code => catalog.get(code)!);
}

function saveTeamCodes(teamId: number, codes: string[]) {
  db.prepare(`INSERT INTO test_template_teams (team_id,codes_json) VALUES (?,?)
    ON CONFLICT(team_id) DO UPDATE SET codes_json=excluded.codes_json`).run(teamId, JSON.stringify(codes));
}

function errorResponse(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message.startsWith('计时') ? error.issues[0].message : '模板或指标字段格式不正确，请核对后重试。' });
  if (error instanceof ImportRequestError) return res.status(error.status).json({ message: error.message });
  if (error instanceof TestTemplateInputError) return res.status(400).json({ message: error.message });
  return res.status(500).json({ message: '测试模板操作失败，请稍后重试。' });
}

export function registerTestTemplateRoutes(app: Express) {
  const access = [requireAuth, requireRole('SCC', 'REG', 'TD', 'DMD')];
  const path = '/api/data-import/test-template';

  const trainingPath = '/api/data-import/training-template';
  app.get(trainingPath, ...access, (req, res) => {
    try {
      const s = scope(req);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...trainingTeamConfig(s.teamId), athleteCount: roster(s).length });
    } catch (error) { errorResponse(res, error); }
  });
  app.put(trainingPath, ...access, (req, res) => {
    try {
      const s = scope(req);
      const { sourceName, ...template } = trainingTemplateSchema.extend({
        sourceName: z.string().trim().max(80).optional(),
      }).parse(req.body);
      validateTrainingTemplate(template);
      if (sourceName !== template.name && db.prepare('SELECT 1 FROM training_record_templates WHERE team_id=? AND name=?').get(s.teamId, template.name))
        throw new ImportRequestError('本队已有同名训练项目，请换个名称或选择已有项目编辑。', 409);
      const previouslyPublished = trainingTeamConfig(s.teamId).names;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT OR IGNORE INTO training_record_team_columns (team_id,names_json) VALUES (?,?)')
          .run(s.teamId, JSON.stringify(previouslyPublished));
        saveTrainingTemplate(s.teamId, template);
        if (sourceName && sourceName !== template.name)
          db.prepare('DELETE FROM training_record_templates WHERE team_id=? AND name=?').run(s.teamId, sourceName);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      res.json({ template });
    } catch (error) { errorResponse(res, error); }
  });
  app.put(`${trainingPath}/config`, ...access, (req, res) => {
    try {
      const s = scope(req);
      const { names, columns } = z.object({
        names: z.array(z.string().min(1).max(80)).max(100),
        columns: z.array(z.string().min(1).max(210)).max(1000).optional(),
      }).strict().parse(req.body);
      const projects = selectedTrainingProjects(s.teamId, names);
      if (projects.length && columns?.length !== 0) validateTrainingTemplate(combineTrainingProjects(projects, columns));
      db.prepare(`INSERT INTO training_record_team_columns(team_id,names_json) VALUES (?,?)
        ON CONFLICT(team_id) DO UPDATE SET names_json=excluded.names_json`).run(s.teamId, JSON.stringify({ names, columns }));
      res.json({ names, columns });
    } catch (error) { errorResponse(res, error); }
  });
  app.get(`${trainingPath}/download`, ...access, trainingDownload);
  app.post(trainingPath, ...access, trainingDownload);

  async function trainingDownload(req: Request, res: Response) {
    try {
      const s = scope(req);
      const { saveTeam, ...template } = req.method === 'GET'
        ? { ...combineTrainingProjects(selectedTrainingProjects(s.teamId), trainingTeamConfig(s.teamId).columns), saveTeam: false }
        : trainingTemplateSchema.extend({ saveTeam: z.boolean() }).parse(req.body);
      const headers = validateTrainingTemplate(template);
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet(TRAINING_RECORD_SHEET, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
      sheet.columns = headers.map(header => ({ header, width: 22, style: { numFmt: '@' } }));
      sheet.getRow(1).font = { bold: true };
      sheet.getCell('D1').note = '同一运动员同日同课次填同一个名称。整课时长和 RPE 填一次即可。';
      sheet.getCell('E1').note = '逐段或逐组记录时，为同一课次各明细填写不同的正整数序号。';
      template.fields.forEach(field => {
        if (field.kind === 'time' && headers.includes(trainingDetailHeader(field)))
          sheet.getRow(1).getCell(headers.indexOf(trainingDetailHeader(field)) + 1).note =
            '填写秒数或分:秒（例如 6:42.5），系统按秒保存。';
      });
      const athletes = roster(s);
      for (const athlete of athletes) sheet.addRow([String(athlete.id), athlete.name]);
      const id = randomUUID();
      const meta = book.addWorksheet(TEST_TEMPLATE_META, { state: 'veryHidden' });
      meta.getCell('A1').value = TRAINING_RECORD_FORMAT;
      meta.getCell('A2').value = id;
      const buffer = await book.xlsx.writeBuffer();
      const current = scope(req);
      if (current.teamId !== s.teamId || JSON.stringify(roster(current)) !== JSON.stringify(athletes))
        throw new ImportRequestError('队伍名单已变化，请重新下载。', 409);
      db.exec('BEGIN IMMEDIATE');
      try {
        const config = JSON.stringify(template);
        if (saveTeam) saveTrainingTemplate(s.teamId, template);
        db.prepare('INSERT INTO training_record_downloads(id,project,team_id,config_json) VALUES (?,?,?,?)').run(id, s.project, s.teamId, config);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
    } catch (error) { errorResponse(res, error); }
  }

  app.get(path, ...access, (req, res) => {
    try {
      const s = scope(req);
      const catalog = testTemplateCatalog(db, s.project);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ catalog, groups: testTemplateGroups(db, s.project, catalog), ...testTemplateCodes(db, s.project, s.teamId, catalog), athleteCount: roster(s).length, canManageProject: s.canManageProject });
    } catch (error) { errorResponse(res, error); }
  });

  app.route(`${path}/progress`).all(...access).get(progress).put(progress);
  function progress(req: Request, res: Response) {
    try {
      const { from, to, ...selection } = z.object({
        project: z.string(), team: z.string(),
        from: z.string().refine(isValidIsoDate), to: z.string().refine(isValidIsoDate),
      }).strict().refine(input => input.from <= input.to).parse(req.query);
      const s = scope(req, selection);
      const athletes = roster(s);
      const catalog = testTemplateCatalog(db, s.project);
      const { codes } = testTemplateCodes(db, s.project, s.teamId, catalog);
      const ids = new Set(athletes.map(athlete => athlete.id));
      if (req.method === 'PUT') {
        const expected = z.object({
          athleteIds: z.array(z.number().int().positive()).min(1),
          metricCodes: codesSchema,
        }).strict().parse(req.body);
        if (expected.athleteIds.some(id => !ids.has(id)) || expected.metricCodes.some(code => !codes.includes(code)) ||
            new Set(expected.athleteIds).size !== expected.athleteIds.length || new Set(expected.metricCodes).size !== expected.metricCodes.length)
          throw new ImportRequestError('应测人员和指标须来自当前授权名单和队伍模板，且不能重复。', 400);
        const saved = db.prepare('SELECT athlete_ids_json AS ids FROM test_collection_expectations WHERE team_id=? AND from_date=? AND to_date=?').get(s.teamId, from, to);
        const activeMembers = new Set(db.prepare('SELECT id FROM athletes WHERE team_id=? AND project=? AND active=1')
          .all(s.teamId, s.project).map(row => Number(row.id)));
        if (saved && (JSON.parse(String(saved.ids)) as number[]).some(id => activeMembers.has(id) && !ids.has(id)))
          throw new ImportRequestError('本期名单包含当前无法管理的人员，请由有完整权限的人员更新。', 403);
        db.prepare(`INSERT INTO test_collection_expectations(team_id,from_date,to_date,athlete_ids_json,metric_codes_json,confirmed_by)
          VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,from_date,to_date) DO UPDATE SET
          athlete_ids_json=excluded.athlete_ids_json, metric_codes_json=excluded.metric_codes_json, confirmed_by=excluded.confirmed_by`)
          .run(s.teamId, from, to, JSON.stringify(expected.athleteIds), JSON.stringify(expected.metricCodes), s.user.id);
      }
      const expectation = db.prepare(`SELECT athlete_ids_json AS ids,metric_codes_json AS codes FROM test_collection_expectations
        WHERE team_id=? AND from_date=? AND to_date=?`).get(s.teamId, from, to);
      const expectedIds: number[] = expectation ? JSON.parse(String(expectation.ids)) : [];
      const expectedCodes: string[] = expectation ? JSON.parse(String(expectation.codes)) : [];
      const coverageAvailable = expectedIds.length > 0 && expectedIds.every(id => ids.has(id)) &&
        expectedCodes.every(code => catalog.some(metric => metric.code === code));

      const profiles = db.prepare(`
        SELECT a.id, a.gender, a.birth_date AS birthDate, p.event_item AS eventItem,
          p.training_years AS years, p.start_sport_date AS startSportDate
        FROM athletes a LEFT JOIN athlete_profiles p ON p.athlete_id=a.id
        WHERE a.project=? AND a.team_id=? AND a.active=1
      `).all(s.project, s.teamId);
      const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
      const missingProfiles = athletes.flatMap(athlete => {
        const profile = profilesById.get(athlete.id);
        if (!profile) return [];
        const missing = [
          ...(!profile.gender ? ['性别'] : []),
          ...(!(typeof profile.birthDate === 'string' && isValidIsoDate(profile.birthDate)) ? ['出生日期'] : []),
          ...(!profile.eventItem ? ['具体小项'] : []),
          ...(profile.years == null && !(typeof profile.startSportDate === 'string' && isValidIsoDate(profile.startSportDate)) ? ['训练年限'] : []),
        ];
        return missing.length ? [{ ...athlete, missing }] : [];
      });
      const results = db.prepare(`
        SELECT DISTINCT t.athlete_id AS athleteId, m.metric_code AS code, m.unit, t.protocol,
          COALESCE(t.protocol_version, '') AS version
        FROM test_sessions t JOIN test_measurements m ON m.test_session_id=t.id
        JOIN athletes a ON a.id=t.athlete_id
        JOIN data_import_batches b ON b.id=m.data_import_batch_id AND b.status='committed' AND b.project=t.project_code
        JOIN test_template_downloads d ON d.id=json_extract(
          CASE WHEN json_valid(b.summary_json) THEN b.summary_json ELSE '{}' END, '$.testTemplateId'
        )
        WHERE a.team_id=? AND a.active=1 AND t.project_code=? AND t.project_status='confirmed'
          AND d.team_id=a.team_id AND d.project=t.project_code AND t.test_date BETWEEN ? AND ?
          AND t.is_demo=0 AND m.is_demo=0 AND t.quality IN ('valid','partial') AND m.quality IN ('valid','partial')
      `).all(s.teamId, s.project, from, to).filter(row => ids.has(Number(row.athleteId)));
      const metrics = [...new Set([...codes, ...expectedCodes])].flatMap(code => {
        const metric = catalog.find(entry => entry.code === code);
        if (!metric) return [];
        const measured = new Set(results.filter(row => row.code === code && row.unit === metric.unit &&
          row.protocol === metric.protocol && row.version === metric.protocolVersion).map(row => row.athleteId));
        const expected = coverageAvailable && expectedCodes.includes(code) ? expectedIds : [];
        return [{ code, label: metric.label, inTemplate: codes.includes(code), measured: measured.size,
          missing: athletes.filter(athlete => !measured.has(athlete.id) && (!expected.length || expected.includes(athlete.id))),
          coverage: expected.length ? { total: expected.length, completed: expected.filter(id => measured.has(id)).length } : null }];
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ athleteCount: athletes.length, profileCompleteCount: athletes.length - missingProfiles.length, athletes, missingProfiles, metrics,
        expectation: coverageAvailable ? { athleteIds: expectedIds, metricCodes: expectedCodes } : null });
    } catch (error) { errorResponse(res, error); }
  }

  app.post(`${path}/groups`, ...access, (req, res) => {
    try {
      const { project } = scope(req);
      res.status(201).json(createTestTemplateGroup(db, project, groupSchema.parse(req.body)));
    } catch (error) { errorResponse(res, error); }
  });

  app.post(`${path}/metrics`, ...access, (req, res) => {
    try {
      const { project } = scope(req);
      const { previousCode, ...metric } = metricSchema.parse(req.body);
      res.status(201).json({ metric: createTestTemplateMetric(db, project, metric, previousCode) });
    } catch (error) { errorResponse(res, error); }
  });

  app.put(`${path}/metrics/:code`, ...access, (req, res) => {
    try {
      const { project } = scope(req);
      const { label } = z.object({ label: z.string().trim().min(1).max(80) }).strict().parse(req.body);
      const catalog = testTemplateCatalog(db, project);
      const metric = catalog.find(metric => metric.code === req.params.code && metric.editable);
      if (!metric) throw new ImportRequestError('只能修改当前项目专用指标的名称。', 403);
      if (catalog.some(other => other.code !== metric.code && other.label === label && other.unit === metric.unit && other.protocol === metric.protocol))
        throw new ImportRequestError('已有同名、同单位、同协议的指标。', 400);
      db.prepare('UPDATE metric_definitions SET label=?,updated_at=CURRENT_TIMESTAMP WHERE code=?').run(label, metric.code);
      res.json({ metric: { ...metric, label } });
    } catch (error) { errorResponse(res, error); }
  });

  app.put(`${path}/config`, ...access, (req, res) => {
    try {
      const s = scope(req);
      const input = z.discriminatedUnion('action', [
        z.object({ action: z.literal('project'), codes: codesSchema }).strict(),
        z.object({ action: z.literal('inherit') }).strict(),
        z.object({ action: z.literal('team'), codes: z.array(z.string().min(1).max(96)).max(100) }).strict(),
      ]).parse(req.body);
      if (input.action === 'project') {
        if (!s.canManageProject) throw new ImportRequestError('当前账号没有维护项目默认组合的权限。', 403);
        throwOnInvalidCodes(s.project, input.codes);
        db.prepare(`INSERT INTO test_template_projects (project,codes_json) VALUES (?,?)
          ON CONFLICT(project) DO UPDATE SET codes_json=excluded.codes_json`).run(s.project, JSON.stringify(input.codes));
      } else if (input.action === 'team') {
        throwOnInvalidCodes(s.project, input.codes);
        saveTeamCodes(s.teamId, input.codes);
      } else {
        db.prepare('DELETE FROM test_template_teams WHERE team_id=?').run(s.teamId);
      }
      res.json(testTemplateCodes(db, s.project, s.teamId, testTemplateCatalog(db, s.project)));
    } catch (error) { errorResponse(res, error); }
  });

  app.get(`${path}/download`, ...access, testDownload);
  app.post(`${path}/download`, ...access, testDownload);
  async function testDownload(req: Request, res: Response) {
    try {
      const s = scope(req);
      const { codes, saveTeam } = req.method === 'GET'
        ? { codes: testTemplateCodes(db, s.project, s.teamId, testTemplateCatalog(db, s.project)).codes, saveTeam: false }
        : z.object({ codes: codesSchema, saveTeam: z.boolean() }).strict().parse(req.body);
      if (!codes.length) throw new ImportRequestError('请先保存本队 Excel 列。', 400);
      const metrics = throwOnInvalidCodes(s.project, codes);
      const headers = testTemplateHeaders(metrics).slice(TEST_TEMPLATE_IDENTITY_HEADERS.length);
      const columns: TestTemplateColumn[] = metrics.map(({ code, label, unit, protocol, protocolVersion, valueKind, testType }, index) => ({
        code, label, unit, protocol, protocolVersion, valueKind, testType, header: headers[index],
      }));
      const id = randomUUID();
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet(TEST_TEMPLATE_SHEET, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
      sheet.columns = [
        ...TEST_TEMPLATE_IDENTITY_HEADERS.map((header, index) => ({ header, width: 20, style: { numFmt: index === 3 ? 'yyyy-mm-dd' : '@' } })),
        ...columns.map(column => ({ header: column.header, width: 24, style: { numFmt: column.valueKind === 'time' ? '@' : '0.###' } })),
      ];
      const heading = sheet.getRow(1);
      heading.height = 34;
      heading.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183655' } };
      heading.alignment = { vertical: 'middle', wrapText: true };
      columns.forEach((column, index) => {
        const instructions = column.testType === 'FMS测试' ? '评分填 0、1、2 或 3，未测留空。'
          : column.valueKind === 'time' ? '填写秒数或分:秒（例如 6:42.5）。' : '填写实际成绩，未测留空。';
        const notes = [column.protocol, instructions];
        heading.getCell(TEST_TEMPLATE_IDENTITY_HEADERS.length + index + 1).note = notes.filter(Boolean).join('\n');
      });
      const athletes = roster(s);
      for (const athlete of athletes) sheet.addRow([String(athlete.id), athlete.name, s.team]);
      const meta = book.addWorksheet(TEST_TEMPLATE_META, { state: 'veryHidden' });
      meta.getCell('A1').value = TEST_TEMPLATE_FORMAT;
      meta.getCell('A2').value = id;
      const buffer = await book.xlsx.writeBuffer();
      const current = scope(req);
      if (current.teamId !== s.teamId || JSON.stringify(roster(current)) !== JSON.stringify(athletes))
        throw new ImportRequestError('队伍名单已变化，请重新下载。', 409);
      throwOnInvalidCodes(s.project, codes);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (saveTeam) saveTeamCodes(s.teamId, codes);
        db.prepare('INSERT INTO test_template_downloads (id,project,team_id,team_name,columns_json) VALUES (?,?,?,?,?)')
          .run(id, s.project, s.teamId, s.team, JSON.stringify(columns));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      const filename = encodeURIComponent(`竞迹${projectLabel(s.project)}${s.team}测试成绩模板.xlsx`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
    } catch (error) { errorResponse(res, error); }
  }
}
