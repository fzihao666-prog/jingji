import ExcelJS from 'exceljs';
import { formatAthleteNumber, parseAthleteNumber } from '../../shared/athlete-number.ts';
import { readFileSync } from 'node:fs';

import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';

vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
import { db } from '../core/db.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
import { BASIC_DOWNLOAD_SHEETS, ATHLETE_PROFILE_HEADERS, ATHLETE_PROFILE_SHEET, BASIC_PROFILE_HEADERS, BASIC_TEST_SHEET, BASIC_SCREENING_SHEET } from './basic-profile-workbook.ts';
import type { DataImportPreview } from './data-import.ts';
import type { ImportStatistics } from '../../shared/import-statistics.js';

let server: Server;
let base: string;
let token: string;
let otherToken: string;
let workbookIndex = 0;

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'synthetic-data-import-http-test-only');
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: false });
  for (const id of [701, 702]) {
    db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, 'test', '虚构教练', 'SCC')").run(id, `import-http-${id}`);
    db.prepare("INSERT INTO user_area_permissions (user_id, area_level, granted_by) VALUES (?, 'national', ?)").run(id, id);
    db.prepare("INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (?, 'ROWING', ?)").run(id, id);
    db.prepare("INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (?, 'ROWING', 'HTTP甲队', ?)").run(id, id);
  }
  for (const team of ['HTTP甲队', 'HTTP乙队'])
    db.prepare("INSERT INTO project_teams (project, name) VALUES ('ROWING', ?)").run(team);
  const teamId = (db.prepare("SELECT id FROM project_teams WHERE name = 'HTTP甲队'").get() as { id: number }).id;
  db.prepare("INSERT INTO athletes (id, name, project, team, team_id) VALUES (701, '虚构队员', 'ROWING', 'HTTP甲队', ?)").run(teamId);
  const { registerDataImportRoutes } = await import('./data-import-routes.ts');
  const { jwtSecret } = await import('../core/auth.ts');
  token = jwt.sign({ id: 701, sessionVersion: 1 }, jwtSecret);
  otherToken = jwt.sign({ id: 702, sessionVersion: 1 }, jwtSecret);
  const app = express();
  app.use(express.json());
  registerDataImportRoutes(app);
  const { registerAthleteRoutes } = await import('../athlete/athlete-routes.ts');
  registerAthleteRoutes(app);
  const { registerAnalysisRoutes } = await import('../analysis/analysis-routes.ts');
  registerAnalysisRoutes(app);
  const { registerStrengthTrainingRoutes } = await import('../strength/strength-training-routes.ts');
  registerStrengthTrainingRoutes(app);
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  vi.unstubAllEnvs();
});

async function request(path: string, method = 'GET', body?: unknown, auth = token) {
  // 既有成功流程显式使用当前修订；过期/缺失修订用例通过raw请求单独验证。
  const match = path.match(/^\/batches\/([^/]+)\/(items|athletes|commit)$/);
  if (match && body && typeof body === 'object' && !(body instanceof FormData) && !('expectedRevision' in body)) {
    const snapshot = db.prepare('SELECT summary_json AS summary FROM data_import_batches WHERE id=?').get(match[1]) as { summary: string } | undefined;
    body = { ...body, expectedRevision: Number(JSON.parse(snapshot?.summary || '{}').revision || 0) };
  }
  const response = await fetch(`${base}/api/data-import${path}`, {
    method, headers: { authorization: `Bearer ${auth}`, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json() as { batch?: DataImportPreview; message?: string; createdRecords?: number; createdAthletes?: number; receipt?: ImportStatistics };
  return { status: response.status, body: payload };
}

it('纠错指标字典只返回授权项目，未登录和越项目请求拒绝', async () => {
  const response = await fetch(`${base}/api/data-import/metrics?project=ROWING`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  const payload = await response.json() as { metrics: Array<{ code: string; label: string; unit: string }> };
  expect(payload.metrics.length).toBeGreaterThan(0);
  expect(payload.metrics.every(metric => typeof metric.code === 'string' && typeof metric.label === 'string' && typeof metric.unit === 'string')).toBe(true);
  expect((await request('/metrics?project=CANOE_SPRINT')).status).toBe(403);
  expect((await request('/metrics?project=not-a-project')).status).toBe(400);
  expect((await fetch(`${base}/api/data-import/metrics?project=ROWING`)).status).toBe(401);
});

it('模板按授权队伍预填，拒绝越权和非法范围，空队伍返回空模板', async () => {
  const addedTeams = ['模板虚构二队', '模板虚构空队'];
  for (const team of addedTeams) {
    db.prepare("INSERT INTO project_teams (project, name) VALUES ('ROWING', ?)").run(team);
    db.prepare("INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (701, 'ROWING', ?, 701)").run(team);
  }
  const teamId = (db.prepare('SELECT id FROM project_teams WHERE name=?').get(addedTeams[0]) as { id: number }).id;
  db.prepare("INSERT INTO athletes (id, name, project, team, team_id) VALUES (799, '模板虚构队员', 'ROWING', ?, ?)").run(addedTeams[0], teamId);
  try {
    for (const kind of ['profile', 'training', 'test']) {
      const response = await fetch(`${base}/api/data-import/template?${new URLSearchParams({ kind, project: 'ROWING', team: addedTeams[0] })}`, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      const buffer = await response.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const content = JSON.stringify(workbook.SheetNames.map(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })));
      expect(content).toContain('模板虚构队员');
      expect(content).not.toContain('"虚构队员"');
      if (kind === 'profile') {
        expect(workbook.SheetNames).toEqual([ATHLETE_PROFILE_SHEET, BASIC_TEST_SHEET, BASIC_SCREENING_SHEET]);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[ATHLETE_PROFILE_SHEET], { header: 1 }) as string[][];
        expect(rows[0]).toEqual([...BASIC_DOWNLOAD_SHEETS[0][1]]);
        const styled = new ExcelJS.Workbook();
        await styled.xlsx.load(buffer);
        expect(styled.getWorksheet(ATHLETE_PROFILE_SHEET)?.getColumn(rows[0].indexOf('出生年月') + 1).numFmt).toBe('@');
        expect(rows[1][0]).toContain('新队员由系统分配编号');
        expect(rows[2][0]).toBe('示例：示例甲');
        expect(rows[3][0]).toBe('模板虚构队员');
        expect(workbook.Sheets[ATHLETE_PROFILE_SHEET].A1.c?.[0].t).toBeTruthy();
        expect(workbook.Sheets[BASIC_SCREENING_SHEET].T4.f).toBeTruthy();
      }
    }
    const empty = await fetch(`${base}/api/data-import/template?${new URLSearchParams({ kind: 'profile', project: 'ROWING', team: addedTeams[1] })}`, { headers: { authorization: `Bearer ${token}` } });
    expect(empty.status).toBe(200);
    const workbook = XLSX.read(await empty.arrayBuffer(), { type: 'array' });
    expect(JSON.stringify(workbook.Sheets)).not.toContain('虚构队员');
    for (const query of ['kind=profile&project=ROWING&team=HTTP乙队', 'kind=profile&project=ROWING&team=不存在的队伍'])
      expect((await request(`/template?${query}`)).status).toBe(403);
    for (const query of ['team=HTTP甲队', 'project=ROWING&team=', 'project=ROWING&team=a&team=b'])
      expect((await request(`/template?${query}`)).status).toBe(400);
  } finally {
    db.prepare('DELETE FROM athletes WHERE id=799').run();
    for (const team of addedTeams) {
      db.prepare('DELETE FROM user_team_permissions WHERE user_id=701 AND team=?').run(team);
      db.prepare('DELETE FROM project_teams WHERE name=?').run(team);
    }
  }
});

it('队伍模板按项目选择，下载仍受登录和项目权限限制', async () => {
  const path = '/api/data-import/template?kind=team&project=';
  expect((await fetch(`${base}${path}ROWING`)).status).toBe(401);
  expect((await request('/template?kind=team&project=CYCLING_ROAD')).status).toBe(403);
  db.prepare("INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (701, 'CYCLING_ROAD', 701)").run();
  db.prepare("INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (701, 'CYCLING_ROAD', '*', 701)").run();
  try {
    for (const [project, sheet] of [['ROWING', '全队训练负荷'], ['CYCLING_ROAD', '队伍训练统计']]) {
      const response = await fetch(`${base}${path}${project}`, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      const book = XLSX.read(await response.arrayBuffer(), { type: 'array' });
      expect(book.SheetNames).toEqual([sheet]);
      expect(JSON.stringify(book.Sheets)).not.toContain('虚构队员');
    }
  } finally {
    db.prepare("DELETE FROM user_team_permissions WHERE user_id=701 AND project='CYCLING_ROAD'").run();
    db.prepare("DELETE FROM user_project_permissions WHERE user_id=701 AND project='CYCLING_ROAD'").run();
  }
});

async function upload(rows: unknown[][], sheet = '身体测量', team?: string) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[++workbookIndex]]), '说明');
  const form = new FormData();
  form.set('project', 'ROWING');
  if (team) form.set('team', team);
  form.set('file', new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })]), '虚构测试.xlsx');
  const response = await request('/analyze', 'POST', form);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.batch).toBeDefined();
  return response.body.batch!;
}

it('收回部分队伍权限后，历史列表只返回仍有权限的批次', async () => {
  const path = '/batches?project=ROWING';
  const headers = ['姓名', '测量日期', '身高cm'];
  const visible = await upload([headers, ['虚构队员', '2026-02-10', 180]], '身体测量', 'HTTP甲队');
  const revoke = () => db.prepare("DELETE FROM user_team_permissions WHERE user_id=701 AND team='HTTP乙队'").run();
  db.prepare("INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (701, 'ROWING', 'HTTP乙队', 701)").run();
  try {
    const hidden = await upload([headers, ['虚构乙队新人', '2026-02-10', 175]], '身体测量', 'HTTP乙队');
    const list = async () => {
      const result = await request(path);
      expect(result.status).toBe(200);
      return (result.body as { batches?: Array<{ id: string }> }).batches?.map(batch => batch.id);
    };
    expect(await list()).toEqual(expect.arrayContaining([visible.id, hidden.id]));
    expect((await request(path, 'GET', undefined, otherToken)).body).toEqual({ batches: [] });
    revoke();
    expect((await request(`/batches/${hidden.id}`)).status).toBe(403);
    const remaining = await list();
    expect(remaining).toContain(visible.id);
    expect(remaining).not.toContain(hidden.id);
  } finally {
    revoke();
  }
});

it('名单使用页面队伍，忽略旧队伍列并阻止关联其他队伍编号', async () => {
  const denied = new FormData();
  denied.set('project', 'ROWING');
  denied.set('team', 'HTTP乙队');
  denied.set('file', new Blob(['test']), '虚构名单.xlsx');
  expect((await request('/analyze', 'POST', denied)).status).toBe(403);
  const grant = db.prepare("INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (701, 'ROWING', 'HTTP乙队', 701)");
  grant.run();
  try {
    const batch = await upload([
      ['系统运动员编号', '姓名', '所属队伍', '性别'],
      ['', '名单虚构新队员', 'HTTP甲队', '女'],
      [701, '虚构队员', 'HTTP乙队', '男'],
    ], '运动员基本资料', 'HTTP乙队');
    expect(batch.athleteCandidates).toHaveLength(2);
    expect(batch.athleteCandidates.find(person => person.name === '名单虚构新队员')).toMatchObject({ team: 'HTTP乙队' });
    const conflict = batch.athleteCandidates.find(person => person.name === '虚构队员')!;
    expect(conflict).toMatchObject({ status: 'pending', confirmed: false, matchedAthleteId: null });
    expect(conflict.messages.join('')).toContain('请人工确认');
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(400);
    expect((await request(`/batches/${batch.id}/athletes`, 'PUT', { corrections: [{ id: conflict.id, excluded: true }] })).status).toBe(200);
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
    expect(db.prepare("SELECT team FROM athletes WHERE name='名单虚构新队员'").get()).toMatchObject({ team: 'HTTP乙队' });
  } finally {
    db.prepare("DELETE FROM user_team_permissions WHERE user_id=701 AND project='ROWING' AND team='HTTP乙队'").run();
  }
});

it('真实HTTP上传、校对、提交与重复提交使用最终值；未登录及跨账号请求被拒绝', async () => {
  const batch = await upload([['姓名', '日期', '体重kg'], ['虚构队员', '2026-10-01', 70]]);
  expect(batch.athleteCandidates.every(person => person.status === 'matched')).toBe(true);
  expect((await request(`/batches/${batch.id}`, 'GET', undefined, 'invalid')).status).toBe(401);
  expect((await request(`/batches/${batch.id}`, 'GET', undefined, otherToken)).status).toBe(404);
  const saved = await request(`/batches/${batch.id}/items`, 'PUT', { corrections: [{ id: batch.items[0].id, payload: { weightKg: 80 } }] });
  expect(saved.status).toBe(200);
  const result = await request(`/batches/${batch.id}/commit`, 'POST', { conflictPolicy: 'update' });
  expect(result.status).toBe(200);
  expect(result.body.createdRecords).toBe(1);
  expect(db.prepare('SELECT weight_kg FROM athlete_body_measurements WHERE athlete_id = 701').get()).toEqual({ weight_kg: 80 });
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).body.createdRecords).toBe(1);
});

it('真实HTTP集中确认3名最小档案，不提前写正式表，提交失败整体回滚', async () => {
  const batch = await upload([['姓名', '所属队伍', '日期', '睡眠小时'], ...['虚构新人甲', '虚构新人乙', '虚构新人丙'].map(name => [name, 'HTTP甲队', '2026-10-02', 8])], '每日恢复');
  const people = await request(`/batches/${batch.id}/athletes`, 'PUT', { corrections: batch.athleteCandidates.map(person => ({ id: person.id, confirmed: true })) });
  expect(people.status).toBe(200);
  expect(db.prepare("SELECT COUNT(*) AS count FROM athletes WHERE name LIKE '虚构新人%'").get()).toEqual({ count: 0 });
  db.exec("CREATE TRIGGER fail_import_http BEFORE INSERT ON daily_wellness BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  try {
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS count FROM athletes WHERE name LIKE '虚构新人%'").get()).toEqual({ count: 0 });
  } finally { db.exec('DROP TRIGGER fail_import_http'); }
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status).toBe(200);
  expect(result.body.createdAthletes).toBe(3);
  expect(result.body.createdRecords).toBe(3);
  expect(db.prepare("SELECT gender, birth_date FROM athletes WHERE name LIKE '虚构新人%'").all()).toEqual(Array.from({ length: 3 }, () => ({ gender: null, birth_date: null })));
  const again = await upload([['姓名', '日期', '睡眠小时'], ['虚构新人甲', '2026-10-06', 7]], '每日恢复');
  expect(again.athleteCandidates[0].status).toBe('matched');
});

it('真实HTTP校对后并发更新拒绝覆盖，权限外队伍拒绝建档', async () => {
  const seed = await upload([['姓名', '日期', '体重kg'], ['虚构队员', '2026-10-05', 80]]);
  expect((await request(`/batches/${seed.id}/commit`, 'POST', {})).status).toBe(200);
  const batch = await upload([['姓名', '日期', '体重kg'], ['虚构队员', '2026-10-05', 90]]);
  db.prepare("UPDATE athlete_body_measurements SET weight_kg = 85 WHERE athlete_id = 701 AND measurement_date = '2026-10-05'").run();
  const conflict = await request(`/batches/${batch.id}/commit`, 'POST', { conflictPolicy: 'update' });
  expect(conflict.status).toBe(400);
  expect(conflict.body.message).toMatch(/变化|修改/);
  expect(db.prepare("SELECT weight_kg FROM athlete_body_measurements WHERE athlete_id = 701 AND measurement_date = '2026-10-05'").get()).toEqual({ weight_kg: 85 });
  const pending = await upload([['姓名', '所属队伍', '日期', '睡眠小时'], ['越权虚构新人', 'HTTP乙队', '2026-10-03', 8]], '每日恢复');
  expect((await request(`/batches/${pending.id}/athletes`, 'PUT', { corrections: [{ id: pending.athleteCandidates[0].id, confirmed: true }] })).status).toBe(400);
  expect((await request(`/batches/${pending.id}/commit`, 'POST', {})).status).toBe(400);
});


it('人员确认后撤回队伍授权，最终HTTP提交拒绝新建及业务写入', async () => {
  const batch = await upload([['姓名', '所属队伍', '日期', '睡眠小时'], ['撤权虚构新人', 'HTTP甲队', '2026-10-09', 8]], '每日恢复');
  expect((await request(`/batches/${batch.id}/athletes`, 'PUT', { corrections: [{ id: batch.athleteCandidates[0].id, confirmed: true }] })).status).toBe(200);
  const previousCount = db.prepare('SELECT COUNT(*) AS count FROM daily_wellness').get();
  db.prepare('DELETE FROM user_team_permissions WHERE user_id = 701').run();
  try {
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS count FROM athletes WHERE name = '撤权虚构新人'").get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM daily_wellness').get()).toEqual(previousCount);
  } finally {
    db.prepare("INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (701, 'ROWING', 'HTTP甲队', 701)").run();
  }
});

it('简化模板HTTP下载预填正确，缺日期自动补齐并可校对', async () => {
  const { templateHeaderKey, IMPORT_TEMPLATE_VERSION } = await import('../../shared/import-template-fields.ts');
  for (const kind of ['training', 'test']) {
    const response = await fetch(`${base}/api/data-import/template?kind=${kind}&project=ROWING&team=${encodeURIComponent('HTTP甲队')}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    expect(workbook.Sheets['填写说明'].B1.v).toBe(IMPORT_TEMPLATE_VERSION);
    if (kind === 'test') {
      const metricRows = XLSX.utils.sheet_to_json(workbook.Sheets['其他测试'], { header: 1 }) as unknown[][];
      const metricHeaders = metricRows[2].map(value => String(value).split('\n')[0]);
      expect(metricHeaders).toContain('测试项目');
      expect(metricHeaders).not.toContain('指标代码');
      expect(metricHeaders).not.toContain('单位');
      const dictionary = XLSX.utils.sheet_to_json(workbook.Sheets['数据字典'], { header: 1 }) as unknown[][];
      expect(dictionary.some(row => row[0] === '纵跳（cm）')).toBe(true);
    }
    if (kind !== 'training') continue;
    const sheet = workbook.Sheets['训练课次'];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    const keys = matrix[2].map(value => templateHeaderKey(String(value)));
    const dataRow = matrix.findIndex((row, index) => index >= 3 && row[keys.indexOf('姓名')] === '虚构队员');
    expect(dataRow).toBeGreaterThanOrEqual(3);
    expect(matrix[dataRow][keys.indexOf('姓名')]).toBe('虚构队员');
    XLSX.utils.sheet_add_aoa(sheet, [[60]], { origin: { r: dataRow, c: keys.indexOf('时长分钟') } });
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('file', new Blob([new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))]), '简化下载往返.xlsx');
    const analyzed = await request('/analyze', 'POST', form);
    expect(analyzed.status).toBe(200);
    const batch = analyzed.body.batch!;
    expect(batch.errorCount).toBe(0);
    expect(batch.items[0].eventDate).toBe(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()));
    const saved = await request(`/batches/${batch.id}/items`, 'PUT', { corrections: [{ id: batch.items[0].id, eventDate: '2026-10-15' }] });
    expect(saved.body.batch!.errorCount).toBe(0);
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
    expect(db.prepare("SELECT duration_min, rpe FROM training_sessions WHERE athlete_id = 701 AND session_date = '2026-10-15'").get()).toEqual({ duration_min: 60, rpe: null });
  }
  expect((await fetch(`${base}/api/data-import/template?kind=training&project=ROWING`)).status).toBe(401);
  expect((await fetch(`${base}/api/data-import/template?kind=training&project=CANOE_SLALOM`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  for (const path of ['/template', '/template?kind=unified', '/template?kind=unified&project=ROWING'])
    expect((await request(path)).status).toBe(400);
});

it('已下载的旧统一单表仍可提交，空行不入库且按姓名关联已有运动员', async () => {
  const unified = XLSX.read(readFileSync('server/data-import/fixtures/legacy-unified-template.xlsx'), { type: 'buffer' });
  const sheet = unified.Sheets['运动员基础体能测试'];
  XLSX.utils.sheet_add_aoa(sheet, [['虚构队员', 'HTTP甲队'], ['另一预填队员', 'HTTP甲队']], { origin: 'A2' });
  const rowsOf = (book: ReturnType<typeof XLSX.read>, sheetName: string) =>
    XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1 }) as unknown[][];
  const matrix = rowsOf(unified, '运动员基础体能测试');
  expect(matrix[0]).toHaveLength(15);
  const dataRow = matrix.findIndex(row => row[0] === '虚构队员');
  expect(dataRow).toBeGreaterThan(0);
  expect(matrix[dataRow].slice(0,2)).toEqual(['虚构队员', 'HTTP甲队']);
  expect(matrix.slice(1).filter(row => row[0]).every(row => row[1] === 'HTTP甲队')).toBe(true);

  // 仅有预填人员信息的整份模板不产生空批次
  const blank = new FormData();
  blank.set('project', 'ROWING');
  blank.set('file', new Blob([new Uint8Array(XLSX.write(unified, { type: 'buffer', bookType: 'xlsx' }))]), '统一预填空白.xlsx');
  const rejected = await request('/analyze', 'POST', blank);
  expect(rejected.status).toBe(400);
  expect(rejected.body.message).toContain('未填写业务数据');

  // 只回填一行业务数据：其余预填行不生成空记录，提交后按姓名关联已有运动员、不重复建档
  XLSX.utils.sheet_add_aoa(unified.Sheets['运动员基础体能测试'], [['2026-10-18',180]], { origin: {r:dataRow,c:2} });
  const form = new FormData();
  form.set('project', 'ROWING');
  form.set('file', new Blob([new Uint8Array(XLSX.write(unified, { type: 'buffer', bookType: 'xlsx' }))]), '统一预填往返.xlsx');
  const analyzed = await request('/analyze', 'POST', form);
  expect(analyzed.status).toBe(200);
  const batch = analyzed.body.batch!;
  expect(batch.items).toHaveLength(1);
  expect(batch.items[0].itemType).toBe('body_measurement');
  expect(batch.items[0].athleteId).toBe(701);
  const athleteCount = (db.prepare('SELECT COUNT(*) AS count FROM athletes').get() as { count: number }).count;
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status).toBe(200);
  expect(result.body.createdAthletes).toBe(0);
  expect(result.body.createdRecords).toBe(1);
  expect((db.prepare('SELECT COUNT(*) AS count FROM athletes').get() as { count: number }).count).toBe(athleteCount);
  expect(db.prepare("SELECT height_cm FROM athlete_body_measurements WHERE athlete_id = 701 AND measurement_date = '2026-10-18'").get()).toEqual({ height_cm: 180 });
});


it.each([undefined, 2])('独立体能预览的组次错误不能通过直接提交token绕过，第二组=%s', async (secondSet) => {
  const { buildStrengthImportWorkbook } = await import('./specialized-template-workbooks.ts');
  const { templateHeaderKey } = await import('../../shared/import-template-fields.ts');
  const workbook = buildStrengthImportWorkbook();
  const sheet = workbook.getWorksheet('训练结果数据')!;
  for (const row of [4, 5]) sheet.getRow(3).eachCell((cell, column) => {
    const values: Record<string, string | number> = { 运动员: '虚构队员', 训练日期: '2026-10-20', 动作: '深蹲', 实际次数: row, 实际重量kg: 60 };
    if (row === 5 && secondSet !== undefined) values['组次'] = secondSet;
    const value = values[templateHeaderKey(String(cell.value))];
    if (value !== undefined) sheet.getCell(row, column).value = value;
  });
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(await workbook.xlsx.writeBuffer())]), '体能组次缺失.xlsx');
  const previewResponse = await fetch(`${base}/api/strength-training/import/preview`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const preview = await previewResponse.json() as { token: string; invalid: number };
  expect(previewResponse.status).toBe(200);
  expect(preview.invalid).toBeGreaterThan(0);
  const response = await fetch(`${base}/api/strength-training/import/commit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ token: preview.token }) });
  expect(response.status).toBe(400);
  expect(db.prepare("SELECT COUNT(*) AS count FROM training_sessions WHERE athlete_id = 701 AND session_date = '2026-10-20'").get()).toEqual({ count: 0 });
});

it('P0 HTTP：修订号必需，过期保存/人员确认/提交返回409且不改数据', async () => {
  const batch = await upload([['姓名', '日期', '睡眠小时'], ['虚构队员', '2026-11-11', 8]], '每日恢复');
  expect(batch.revision).toBe(0);
  const saved = await request(`/batches/${batch.id}/items`, 'PUT', { expectedRevision: batch.revision, corrections: [{ id: batch.items[0].id, payload: { sleepHours: 9 } }] });
  expect(saved.status).toBe(200);
  expect(saved.body.batch!.revision).toBe(1);
  for (const [suffix, method, data] of [
    ['items', 'PUT', { corrections: [{ id: batch.items[0].id, payload: { sleepHours: 10 } }] }],
    ['athletes', 'PUT', { corrections: [] }], ['commit', 'POST', {}],
  ] as const) {
    expect((await request(`/batches/${batch.id}/${suffix}`, method, { ...data, expectedRevision: 0 })).status).toBe(409);
  }
  expect((await request(`/batches/${batch.id}/items`, 'PUT', { expectedRevision: undefined, corrections: [] })).status).toBe(428);
  expect((await request(`/batches/${batch.id}/items`, 'PUT', { expectedRevision: -1, corrections: [] })).status).toBe(400);
  const current = await request(`/batches/${batch.id}`);
  expect(current.body.batch!.items[0].payload.sleepHours).toBe(9);
  expect(current.body.batch!.revision).toBe(1);
  expect(db.prepare("SELECT COUNT(*) AS count FROM daily_wellness WHERE athlete_id=701 AND wellness_date='2026-11-11'").get()).toEqual({ count: 0 });
  expect((await request(`/batches/${batch.id}/commit`, 'POST', { expectedRevision: 1 })).status).toBe(200);
  expect((await request(`/batches/${batch.id}/commit`, 'POST', { expectedRevision: 0 })).status).toBe(200);
});

it('P0 HTTP：队伍授权收紧后旧稿预览、错误下载、保存、提交和重传不泄露队员', async () => {
  const rows = [['姓名', '日期', '睡眠小时'], ['虚构队员', '2026-11-12', 8]];
  const batch = await upload(rows, '每日恢复');
  db.prepare("UPDATE user_team_permissions SET team='HTTP乙队' WHERE user_id=701 AND project='ROWING'").run();
  try {
    for (const [path, method, body] of [
      [`/batches/${batch.id}`, 'GET', undefined],
      [`/batches/${batch.id}/errors`, 'GET', undefined],
      [`/batches/${batch.id}/items`, 'PUT', { corrections: [] }],
      [`/batches/${batch.id}/athletes`, 'PUT', { corrections: [] }],
      [`/batches/${batch.id}/commit`, 'POST', {}],
    ] as const) {
      const result = await request(path, method, body);
      expect(result.status, path).toBe(403);
      expect(JSON.stringify(result.body)).not.toContain('虚构队员');
    }
    expect(db.prepare('SELECT status FROM data_import_batches WHERE id=?').get(batch.id)).toEqual({ status: 'reviewing' });
  } finally {
    db.prepare("UPDATE user_team_permissions SET team='HTTP甲队' WHERE user_id=701 AND project='ROWING'").run();
  }
  expect((await request(`/batches/${batch.id}`)).status).toBe(200);
});

it('P0 HTTP：相同文件不同账号独立，重复上传本人旧稿不串账号', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['姓名', '日期', '睡眠小时'], ['虚构队员', '2026-11-13', 8]]), '每日恢复');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const send = async (auth: string, revision?: number) => {
    const body = new FormData();
    body.set('project', 'ROWING'); body.set('file', new Blob([bytes]), '相同文件.xlsx');
    if (revision !== undefined) { body.set('reparse', '1'); body.set('expectedRevision', String(revision)); }
    return request('/analyze', 'POST', body, auth);
  };
  const first = await send(token), other = await send(otherToken), again = await send(token);
  expect([first.status, other.status, again.status]).toEqual([200, 200, 200]);
  expect(first.body.batch!.id).not.toBe(other.body.batch!.id);
  expect(again.body.batch!.id).toBe(first.body.batch!.id);
  const reparsed = await send(token, first.body.batch!.revision);
  expect(reparsed.status).toBe(200);
  expect(reparsed.body.batch!.id).toBe(first.body.batch!.id);
  expect(reparsed.body.batch!.revision).toBe(1);
  expect((await send(token, 0)).status).toBe(409);
  db.prepare("UPDATE user_team_permissions SET team='HTTP乙队' WHERE user_id=701").run();
  try { expect((await send(token)).status).toBe(403); }
  finally { db.prepare("UPDATE user_team_permissions SET team='HTTP甲队' WHERE user_id=701").run(); }

  expect((await request(`/batches/${first.body.batch!.id}/errors`, 'GET', undefined, otherToken)).status).toBe(404);
});

it('P0 HTTP：事务中的授权变化使正式写入整体回滚', async () => {
  const batch = await upload([['姓名', '日期', '睡眠小时'], ['虚构队员', '2026-11-14', 8]], '每日恢复');
  db.exec("CREATE TRIGGER p0_revoke_in_transaction AFTER INSERT ON daily_wellness WHEN NEW.wellness_date='2026-11-14' BEGIN DELETE FROM user_team_permissions WHERE user_id=701; END");
  try {
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS count FROM daily_wellness WHERE athlete_id=701 AND wellness_date='2026-11-14'").get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT status FROM data_import_batches WHERE id=?').get(batch.id)).toEqual({ status: 'reviewing' });
    expect((await request(`/batches/${batch.id}`)).status).toBe(200);
  } finally { db.exec('DROP TRIGGER p0_revoke_in_transaction'); }
});

it('P0 HTTP：运动员停用后已提交历史批次也不能向普通教练泄露档案', async () => {
  const batch = await upload([['姓名', '日期', '睡眠小时'], ['虚构队员', '2026-11-15', 8]], '每日恢复');
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
  db.prepare('UPDATE athletes SET active=0 WHERE id=701').run();
  try {
    const response = await request(`/batches/${batch.id}`);
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain('虚构队员');
  } finally { db.prepare('UPDATE athletes SET active=1 WHERE id=701').run(); }
});

it('P0 HTTP：旧草稿没有权限快照时，待建档人员也按当前队伍范围保护', async () => {
  const batch = await upload([['姓名', '所属队伍', '日期', '睡眠小时'], ['旧草稿虚构新人', 'HTTP甲队', '2026-11-16', 8]], '每日恢复');
  db.prepare("UPDATE data_import_batches SET summary_json=json_remove(summary_json,'$.accessTeams','$.revision') WHERE id=?").run(batch.id);
  expect((await request(`/batches/${batch.id}`)).body.batch!.revision).toBe(0);
  db.prepare("UPDATE user_team_permissions SET team='HTTP乙队' WHERE user_id=701").run();
  try {
    const result = await request(`/batches/${batch.id}/errors`);
    expect(result.status).toBe(403);
    expect(JSON.stringify(result.body)).not.toContain('旧草稿虚构新人');
  } finally { db.prepare("UPDATE user_team_permissions SET team='HTTP甲队' WHERE user_id=701").run(); }
  expect((await request(`/batches/${batch.id}`)).status).toBe(200);
});

it('P1.5：新增、更新、无变化、排除及未填报口径统一，回执持久化且重试不改变', async () => {
  const initial = await upload([['姓名', '日期', '体重kg'], ['虚构队员', '2050-01-01', 70], ['虚构队员', '2050-01-02', 72]]);
  expect((await request(`/batches/${initial.id}/commit`, 'POST', {})).status).toBe(200);
  const batch = await upload([['姓名', '日期', '体重kg'],
    ['虚构队员', '2050-01-01', 71], ['虚构队员', '2050-01-02', 72],
    ['虚构队员', '2050-01-03', 73], ['虚构队员', '2050-01-04', 74],
    ['虚构队员'], ['虚构队员', '2050-01-05', '错误数值']]);
  expect(batch.summary.unfilledRows).toBe(1);
  expect(batch.counts.newCount).toBe(2);
  const difference = batch.items.find(item => item.eventDate === '2050-01-01')!.conflict!;
  expect(difference.fields.some(field => field.oldValue === '70' && field.newValue === '71')).toBe(true);
  const reportResponse = await fetch(`${base}/api/data-import/batches/${batch.id}/errors`, { headers: { authorization: `Bearer ${token}` } });
  const report = XLSX.read(Buffer.from(await reportResponse.arrayBuffer()));
  const reportRows = XLSX.utils.sheet_to_json(report.Sheets['错误清单'], { header: 1 }) as string[][];
  expect(reportRows[0].slice(-2)).toEqual(['如何修正', '可用操作']);
  expect(reportRows[1][2]).toBe('错误源行');
  const excluded = batch.items.filter(item => item.eventDate === '2050-01-04' || item.itemType === 'invalid_row');
  expect(excluded).toHaveLength(2);
  expect((await request(`/batches/${batch.id}/items`, 'PUT', { corrections: excluded.map(item => ({ id: item.id, resolution: 'skip' })) })).status).toBe(200);
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.receipt).toEqual({ newCount: 1, updateCount: 1, unchangedCount: 1, excludedCount: 2, unfilledRows: 1, errorCount: 0, mergedCount: 0 });
  expect(result.body.message).toContain('无变化1条、排除2条、未填报1行');
  expect((await request(`/batches/${batch.id}`)).body.batch!.summary.receipt).toEqual(result.body.receipt);
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).body.receipt).toEqual(result.body.receipt);
  expect(db.prepare("SELECT weight_kg FROM athlete_body_measurements WHERE athlete_id=701 AND measurement_date='2050-01-01'").get()).toEqual({ weight_kg: 71 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM athlete_body_measurements WHERE athlete_id=701 AND measurement_date='2050-01-04'").get()).toEqual({ count: 0 });
});

const profileSheet = '运动员基础档案';
const profileHeaders = ['运动员编号', '姓名', '运动项目', '所属队伍', '学历', '备注', '身体测量日期', '身高（cm）'];

it('基础档案合并非空资料，新建人员归入所选队伍，身高按实测日期保存', async () => {
  db.prepare("INSERT INTO athlete_profiles (athlete_id, notes) VALUES (701, '原备注') ON CONFLICT(athlete_id) DO UPDATE SET notes = '原备注'").run();
  const batch = await upload([
    profileHeaders,
    ['701', '虚构队员', '赛艇', 'HTTP甲队', '本科', '', '2026-09-18', 179],
    ['701', '虚构队员', '赛艇', 'HTTP甲队'],
    ['', '档案虚构新人'],
  ], profileSheet, 'HTTP甲队');
  expect(batch.items.map(item => item.itemType)).toEqual(['athlete_profile', 'body_measurement', 'athlete_profile']);
  expect(batch.athleteCandidates).toHaveLength(2);
  expect(db.prepare("SELECT id FROM athletes WHERE name='档案虚构新人'").get()).toBeUndefined();
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.createdAthletes).toBe(1);
  expect(db.prepare('SELECT education, notes FROM athlete_profiles WHERE athlete_id=701').get()).toEqual({ education: '本科', notes: '原备注' });
  expect(db.prepare("SELECT height_cm FROM athlete_body_measurements WHERE athlete_id=701 AND measurement_date='2026-09-18'").get()).toEqual({ height_cm: 179 });
  expect(db.prepare("SELECT project, team, team_id FROM athletes WHERE name='档案虚构新人'").get()).toEqual(
    db.prepare('SELECT project, team, team_id FROM athletes WHERE id=701').get(),
  );
});

it('运动员档案识别附件说明与示例并按新列入库', async () => {
  const row = (fields: Record<string, unknown>) => ATHLETE_PROFILE_HEADERS.map(header => fields[header]);
  const infos = [
    row({ 运动员编号: '使用队内固定唯一编号。按文本保存，保留前导零。新增运动员不填写', 姓名: '填写档案中使用的姓名。' }),
    row({ 运动员编号: '示例：ATL00001', 姓名: '示例：示例甲', 录入检查: '示例：留空' }),
    row({ 录入检查: '自动检查结果' }),
  ];
  db.prepare("UPDATE athletes SET birth_date='2000-08-22' WHERE id=701").run();
  try {
    const batch = await upload([[...ATHLETE_PROFILE_HEADERS], ...infos, row({
      运动员编号: 'ATL00701', 姓名: '虚构队员', 录入检查: '自动检查结果', 出生年月: '2000-08',
      运动项目: '赛艇', 代表队伍: '虚构代表队', '小项／场上位置': '单人艇', 技术等级: '一级',
      最好成绩: '7:22.50', 最好成绩对应赛事: '虚构赛事', 成绩日期: '2026-11-10',
      备战赛事: '虚构目标赛事', 当前训练限制: '避免最大强度划行', '身高（cm）': 176,
      '体重（kg）': 68.5, 身体测量日期: '2026-11-12',
    })], ATHLETE_PROFILE_SHEET, 'HTTP甲队');
    expect(batch.items.map(item => item.itemType)).toEqual(['athlete_profile', 'body_measurement']);
    const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(db.prepare('SELECT birth_date, team FROM athletes WHERE id=701').get())
      .toEqual({ birth_date: '2000-08-22', team: 'HTTP甲队' });
    expect(db.prepare('SELECT event_item, representative_unit, best_result, best_result_event, current_event, notes FROM athlete_profiles WHERE athlete_id=701').get())
      .toEqual({ event_item: '单人艇', representative_unit: '虚构代表队', best_result: '7:22.50',
        best_result_event: '虚构赛事', current_event: '虚构目标赛事', notes: '原备注\n出生年月：2000-08\n当前训练限制：避免最大强度划行' });
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    expect(db.prepare('SELECT height_cm, weight_kg FROM athlete_body_measurements WHERE athlete_id=701 AND measurement_date=?').get(today))
      .toEqual({ height_cm: 176, weight_kg: 68.5 });
    const invalid = await upload([[...ATHLETE_PROFILE_HEADERS], row({
      姓名: '虚构队员', 出生年月: '2000-13', '身高（cm）': 176,
    })], ATHLETE_PROFILE_SHEET, 'HTTP甲队');
    expect(invalid.items.flatMap(item => item.messages).join(' ')).toMatch(/E2 出生年月/);
    expect((await request(`/batches/${invalid.id}/commit`, 'POST', {})).status).toBe(400);
  } finally {
    db.prepare("UPDATE athletes SET birth_date='' WHERE id=701").run();
    db.prepare("UPDATE athlete_profiles SET notes='原备注' WHERE athlete_id=701").run();
  }
});

it('基础数据工作簿一次导入档案、测试与FMS，复用同批人员并忽略公式总分', async () => {
  const book = XLSX.utils.book_new();
  for (const [sheet, headers, rows] of [
    [ATHLETE_PROFILE_SHEET, BASIC_DOWNLOAD_SHEETS[0][1], [{ 姓名: '整表虚构新人', 出生年月: '2004-08', 备战赛事: '虚构杯' }]],
    [BASIC_TEST_SHEET, BASIC_DOWNLOAD_SHEETS[1][1], [
      { 姓名: '虚构队员', 测试日期: '2026-10-23', 测试项目: '引体向上', 实测值: 0, '备注／未测原因': '实测为零' },
      { 姓名: '整表虚构新人', 测试日期: '2026-10-23', 测试项目: '引体向上', 实测值: 5 },
      { 姓名: '整表虚构新人', 测试日期: '2026-10-24', 测试项目: '引体向上', '备注／未测原因': '未参加' },
    ]],
    [BASIC_SCREENING_SHEET, BASIC_DOWNLOAD_SHEETS[2][1], [
      { 姓名: '整表虚构新人', 筛查日期: '2026-10-23', 深蹲: 2, '跨栏步 左': 2, '跨栏步 右': 3,
        '直线弓步 左': 2, '直线弓步 右': 2, '肩灵活性 左': 3, '肩灵活性 右': 2, '肩灵活性 左筛查': '有痛',
        '肩灵活性 右筛查': '无痛', '主动直腿抬高 左': 3, '主动直腿抬高 右': 2, 躯干稳定俯卧撑: 2,
        '躯干稳定俯卧撑 筛查': '无痛', '旋转稳定 左': 2, '旋转稳定 右': 2, '旋转稳定 筛查': '无痛', 'FMS 总分': 21 },
    ]],
  ] as Array<[string, readonly string[], Array<Record<string, string | number>>]>) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...headers], ...rows.map(row => headers.map(header => row[header]))]), sheet);
  }
  const form = new FormData();
  form.set('project', 'ROWING');
  form.set('team', 'HTTP甲队');
  form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '虚构基础数据.xlsx');
  const preview = await request('/analyze', 'POST', form);
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  const batch = preview.body.batch!;
  expect(batch.errorCount, JSON.stringify(batch.items.map(item => item.messages))).toBe(0);
  expect(batch.items).toHaveLength(10);
  expect(batch.athleteCandidates).toHaveLength(2);
  expect(batch.items.find(item => item.metricCode === 'fms_shoulder_mobility')).toMatchObject({
    sourceSheet: BASIC_SCREENING_SHEET, valueNum: 0,
    payload: { fmsObservation: { left: 3, right: 2, clearingLeft: '阳性', clearingRight: '阴性' } },
  });
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.createdAthletes).toBe(1);
  const measures = db.prepare(`SELECT m.value_num AS score FROM test_measurements m JOIN test_sessions s ON s.id=m.test_session_id
    JOIN athletes a ON a.id=s.athlete_id WHERE a.name='整表虚构新人' AND s.test_date='2026-10-23' AND s.test_type='FMS测试'`).all();
  expect(measures).toHaveLength(7);
  expect(measures).toContainEqual({ score: 0 });
  expect(measures.reduce((sum, row) => sum + Number((row as { score: number }).score), 0)).toBe(12);
  const fitness = db.prepare(`SELECT a.name, m.value_num AS value FROM test_measurements m JOIN test_sessions s ON s.id=m.test_session_id
    JOIN athletes a ON a.id=s.athlete_id WHERE s.test_date IN ('2026-10-23','2026-10-24') AND m.metric_code='pull_ups_reps'
    AND a.name IN ('虚构队员','整表虚构新人') ORDER BY m.value_num`).all();
  expect(fitness).toEqual([{ name: '虚构队员', value: 0 }, { name: '整表虚构新人', value: 5 }]);
  const exported = await fetch(`${base}/api/data-import/export?format=basic&${new URLSearchParams({ project: 'ROWING', team: 'HTTP甲队' })}`, { headers: { authorization: `Bearer ${token}` } });
  expect(exported.status).toBe(200);
  const exportedBook = XLSX.read(await exported.arrayBuffer(), { type: 'array' });
  expect(exportedBook.SheetNames).toEqual([ATHLETE_PROFILE_SHEET, BASIC_TEST_SHEET, BASIC_SCREENING_SHEET]);
  const exportedTests = XLSX.utils.sheet_to_json<unknown[]>(exportedBook.Sheets[BASIC_TEST_SHEET], { header: 1 });
  expect(exportedTests.find(row => row[0] === '整表虚构新人')).toMatchObject({ 2: '引体向上', 3: 5 });
  const screening = XLSX.utils.sheet_to_json<unknown[]>(exportedBook.Sheets[BASIC_SCREENING_SHEET], { header: 1 });
  expect(screening[2][0]).toBe('示例：示例甲');
  expect(screening.find(row => row[0] === '整表虚构新人')?.[10]).toBe('有痛');
  expect(exportedBook.Sheets[BASIC_TEST_SHEET].A1.c?.[0].t).toBeTruthy();

});

it('基础档案新增字段按正式模板入库并在档案显示，空白保留原值', async () => {
  const headers = [...BASIC_PROFILE_HEADERS];
  const filled = {
    具体小项: '虚构双桨', 代表单位: '虚构代表单位', 输送单位: '虚构输送单位',
    训练年限: '3年6个月', 最好竞技成绩: '6:42.50', 对应赛事: '虚构锦标赛', 成绩日期: '2026-10-18',
  };
  const rowWith = (fields: Record<string, unknown>) => headers.map(header => fields[header] ?? (header === '姓名' ? '虚构队员' : header === '系统运动员编号' ? 'ATL00701' : undefined));
  db.prepare("INSERT INTO athlete_profiles(athlete_id,current_event,start_sport_date) VALUES(701,'虚构备战赛事','2020-01-01') ON CONFLICT(athlete_id) DO UPDATE SET current_event=excluded.current_event,start_sport_date=excluded.start_sport_date").run();
  const submit = async (fields: Record<string, unknown>) => {
    const batch = await upload([headers, rowWith(fields)], profileSheet, 'HTTP甲队');
    return request(`/batches/${batch.id}/commit`, 'POST', {});
  };
  expect((await submit(filled)).status).toBe(200);
  expect((await submit({ 籍贯: '虚构籍贯' })).status).toBe(200);
  const invalid = await upload([headers, rowWith({ 训练年限: '-2', 成绩日期: '2026-02-30' })], profileSheet, 'HTTP甲队');
  expect(invalid.items[0].messages.join('')).toMatch(/训练年限.*成绩日期/s);
  expect((await request(`/batches/${invalid.id}/commit`, 'POST', {})).status).toBe(400);

  const roster = await fetch(`${base}/api/athletes`, { headers: { authorization: `Bearer ${token}` } });
  expect(roster.status).toBe(200);
  const payload = await roster.json() as { athletes: Array<{ id: number }> };
  expect(payload.athletes.find(athlete => athlete.id === 701)).toMatchObject({
    team: 'HTTP甲队', eventItem: '虚构双桨', representativeUnit: '虚构代表单位', originUnit: '虚构输送单位',
    trainingYears: 3.5, startSportDate: '2020-01-01', currentEvent: '虚构备战赛事',
    bestResult: '6:42.50', bestResultEvent: '虚构锦标赛', bestResultDate: '2026-10-18',
  });
  const { readAthleteAdminPayload, upsertAthleteProfile } = await import('../athlete/athlete-module.ts');
  const newFields = new Set(['eventItem', 'representativeUnit', 'trainingYears', 'bestResultEvent', 'bestResultDate']);
  const legacyPayload = Object.fromEntries(Object.entries(payload.athletes.find(athlete => athlete.id === 701)!)
    .filter(([key]) => !newFields.has(key)));
  upsertAthleteProfile(701, readAthleteAdminPayload(legacyPayload));
  expect(db.prepare('SELECT training_years, representative_unit FROM athlete_profiles WHERE athlete_id=701').get())
    .toEqual({ training_years: 3.5, representative_unit: '虚构代表单位' });

  expect((await submit({ 训练年限: 0 })).status).toBe(200);
  expect(db.prepare('SELECT training_years AS years FROM athlete_profiles WHERE athlete_id=701').get()).toEqual({ years: 0 });
  const exported = await fetch(`${base}/api/data-import/export?project=ROWING`, { headers: { authorization: `Bearer ${token}` } });
  expect(exported.status).toBe(200);
  const standardSheet = XLSX.read(await exported.arrayBuffer()).Sheets['运动员基本资料'];
  const standardRows = XLSX.utils.sheet_to_json(standardSheet, { header: 1 }) as unknown[][];
  const source = standardRows.find(row => row[0] === 'ATL00701')!;
  const roundTrip = await upload([standardRows[2], source], '运动员基本资料', 'HTTP甲队');
  expect(roundTrip.items[0]).toMatchObject({ quality: 'valid', payload: {
    eventItem: '虚构双桨', representativeUnit: '虚构代表单位', trainingYears: 0,
    bestResultEvent: '虚构锦标赛', bestResultDate: '2026-10-18',
  } });
});

it('基础档案拒绝项目队伍冲突及没有真实测量日期的身高', async () => {
  const batch = await upload([
    profileHeaders,
    ['701', '虚构队员', '举重', 'HTTP甲队', '错误项目'],
    ['', '档案错误队伍', '赛艇', 'HTTP乙队', '本科'],
    ['701', '虚构队员', '赛艇', 'HTTP甲队', '', '', '', 170],
  ], profileSheet, 'HTTP甲队');
  expect(batch.items.map(item => item.quality)).toEqual(['error', 'error', 'error']);
  expect(batch.items[0].messages.join('')).toContain('运动项目');
  expect(batch.items[1].messages.join('')).toContain('所属队伍');
  expect(batch.items[2].messages.join('')).toContain('身体测量日期');
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(400);
  expect(db.prepare("SELECT id FROM athletes WHERE name='档案错误队伍'").get()).toBeUndefined();
});

it('基础档案兼容无编号旧表，未知编号须先人工确认', async () => {
  const legacy = await upload([profileHeaders, ['', '虚构队员', '', '', '', '旧表档案备注']], profileSheet, 'HTTP甲队');
  expect(legacy.athleteCandidates[0]).toMatchObject({ matchedAthleteId: 701, status: 'matched' });
  expect((await request(`/batches/${legacy.id}/commit`, 'POST', {})).status).toBe(200);

  const batch = await upload([profileHeaders, ['999999', '虚构队员', '', '', '', '编号待核对']], profileSheet, 'HTTP甲队');
  const person = batch.athleteCandidates[0];
  expect(person).toMatchObject({ status: 'pending', matchedAthleteId: null, confirmed: false });
  const path = `/batches/${batch.id}`;
  const report = await fetch(`${base}/api/data-import${path}/errors`, { headers: { authorization: `Bearer ${token}` } });
  expect(report.status).toBe(200);
  const conflicts = XLSX.read(await report.arrayBuffer()).Sheets['运动员编号待确认'];
  expect(JSON.stringify(XLSX.utils.sheet_to_json(conflicts, { header: 1 }))).toContain('999999');
  expect((await request(`${path}/athletes`, 'PUT', { autoMatch: true })).body.batch?.athleteCandidates[0].confirmed).toBe(false);
  expect((await request(`${path}/commit`, 'POST', {})).status).toBe(400);
  expect((await request(`${path}/athletes`, 'PUT', {
    corrections: [{ id: person.id, matchedAthleteId: 701, confirmed: true }],
  })).status).toBe(200);
  expect((await request(`${path}/commit`, 'POST', {})).status).toBe(200);
});

it('举重与赛艇共用档案表头，按所选项目隔离同名队伍，并能回传实际下载的工作簿', async () => {
  db.exec(`
    INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (701, 'WEIGHTLIFTING', 701);
    INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (701, 'WEIGHTLIFTING', 'HTTP甲队', 701);
    INSERT INTO project_teams (project, name) VALUES ('WEIGHTLIFTING', 'HTTP甲队');
    INSERT INTO athletes (name, project, team, team_id)
      SELECT '举重虚构队员', project, name, id FROM project_teams WHERE project='WEIGHTLIFTING' AND name='HTTP甲队';
  `);
  const download = async (project: string, team?: string) => {
    const params = new URLSearchParams({ kind: 'profile', project });
    if (team) params.set('team', team);
    const response = await fetch(`${base}/api/data-import/template?${params}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    return XLSX.read(await response.arrayBuffer(), { type: 'array' });
  };
  const rowing = await download('ROWING', 'HTTP甲队');
  const lifting = await download('WEIGHTLIFTING', 'HTTP甲队');
  const sheet = lifting.Sheets[ATHLETE_PROFILE_SHEET];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
  expect(rows[0]).toEqual((XLSX.utils.sheet_to_json(rowing.Sheets[ATHLETE_PROFILE_SHEET], { header: 1 }) as string[][])[0]);
  expect(rows.slice(3).map(row => row[0]).filter(Boolean)).toEqual(['举重虚构队员']);
  const athlete = db.prepare("SELECT id FROM athletes WHERE name='举重虚构队员' AND project='WEIGHTLIFTING'").get() as { id: number };
  expect(rows[0]).not.toContain('运动员编号');
  const empty = await download('ROWING');
  expect(empty.SheetNames).toEqual([ATHLETE_PROFILE_SHEET, BASIC_TEST_SHEET, BASIC_SCREENING_SHEET]);
  expect(XLSX.utils.sheet_to_json<unknown[]>(empty.Sheets[ATHLETE_PROFILE_SHEET], { header: 1 }).slice(3).some(row => row[0])).toBe(false);

  expect(rows[0]).not.toContain('身体测量日期');
  for (const [header, sample] of [['身高（cm）', 172.5], ['体重（kg）', 68]] as const) {
    XLSX.utils.sheet_add_aoa(sheet, [[sample]], { origin: { r: 3, c: rows[0].indexOf(header) }, cellDates: true });
  }
  const form = new FormData();
  form.set('file', new Blob([XLSX.write(lifting, { type: 'buffer', bookType: 'xlsx' })]), '举重档案.xlsx');
  form.set('project', 'WEIGHTLIFTING');
  expect((await request('/analyze', 'POST', form)).status).toBe(400);
  form.set('team', 'HTTP甲队');
  expect((await request('/analyze', 'POST', form, otherToken)).status).toBe(403);
  const preview = await request('/analyze', 'POST', form);
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  const batch = preview.body.batch!;
  expect(batch.items).toHaveLength(1);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  expect(batch.items[0]).toMatchObject({ athleteId: athlete.id, eventDate: today, quality: 'valid' });
  XLSX.utils.sheet_add_aoa(sheet, [[69]], { origin: { r: 3, c: rows[0].indexOf('体重（kg）') } });
  form.set('file', new Blob([XLSX.write(lifting, { type: 'buffer', bookType: 'xlsx' })]), '举重档案更新.xlsx');
  const later = await request('/analyze', 'POST', form);
  expect(later.status).toBe(200);
  const laterBatch = later.body.batch!;
  // 模拟昨天预览、当天提交，并验证较晚提交的草稿能覆盖先提交的值。
  db.prepare("UPDATE data_import_items SET event_date='2000-01-01' WHERE batch_id=?").run(laterBatch.id);
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
  expect(db.prepare('SELECT height_cm, weight_kg FROM athlete_body_measurements WHERE athlete_id=? AND measurement_date=?')
    .get(athlete.id, today)).toEqual({ height_cm: 172.5, weight_kg: 68 });
  expect((await request(`/batches/${laterBatch.id}/commit`, 'POST', {})).status).toBe(200);
  expect(db.prepare('SELECT measurement_date, height_cm, weight_kg FROM athlete_body_measurements WHERE athlete_id=?').all(athlete.id))
    .toEqual([{ measurement_date: today, height_cm: 172.5, weight_kg: 69 }]);
});

it('测试模板预览列使用授权项目与队伍，交给队伍教练配置', async () => {
  const res = await fetch(`${base}/api/data-import/test-template?project=ROWING&team=HTTP甲队`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ source: 'project', athleteCount: expect.any(Number), canManageProject: false });
  expect((await request('/test-template?project=ROWING&team=HTTP乙队')).status).toBe(403);
});

it('动态模板实际回传按下载时的范围、指标单位和协议入库，不同项目支持不同字段', async () => {
  db.exec(`
    INSERT INTO project_teams (project,name) VALUES ('ROWING','动态模板甲队'),('WEIGHTLIFTING','动态模板甲队'),('ROWING','动态模板乙队');
    INSERT OR IGNORE INTO user_project_permissions (user_id,project,granted_by) VALUES (701,'WEIGHTLIFTING',701);
    INSERT INTO user_team_permissions (user_id,project,team,granted_by)
      SELECT 701,project,name,701 FROM project_teams WHERE name LIKE '动态模板%';
    INSERT INTO athletes(name,project,team,team_id)
      SELECT CASE WHEN project='ROWING' THEN '赛艇测试队员' ELSE '举重测试队员' END,project,name,id
      FROM project_teams WHERE name='动态模板甲队';
  `);
  const team = '动态模板甲队';
  const query = (project: string, name = team) => new URLSearchParams({ project, team: name }).toString();
  const scopePath = (project: string, suffix = '', name = team) => `/test-template${suffix}?${query(project, name)}`;
  const load = async (project: string) => {
    const response = await fetch(`${base}/api/data-import${scopePath(project)}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    return await response.json() as import('../../shared/test-template.ts').TestTemplatePreview;
  };
  const create = async (project: string, metric: import('../../shared/test-template.ts').TestTemplateMetricInput & { previousCode?: string }) => {
    const result = await request(scopePath(project, '/metrics'), 'POST', metric);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return (result.body as unknown as { metric: import('../../shared/test-template.ts').TestTemplateMetric }).metric;
  };
  const download = async (project: string, codes: string[], saveTeam: boolean) => {
    const response = await fetch(`${base}/api/data-import${scopePath(project, '/download')}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ codes, saveTeam }),
    });
    expect(response.status, response.ok ? undefined : await response.clone().text()).toBe(200);
    return XLSX.read(await response.arrayBuffer(), { type: 'array' });
  };
  const write = async (project: string, workbook: XLSX.WorkBook, name = team) => {
    const form = new FormData();
    form.set('file', new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })]), '动态测试模板.xlsx');
    form.set('project', project);
    form.set('team', name);
    return request('/analyze', 'POST', form);
  };
  const rower = 'ROWING';
  const lifter = 'WEIGHTLIFTING';
  const rowingDefault = await load(rower);
  const liftingDefault = await load(lifter);
  expect(rowingDefault.codes).toEqual(['squat_kg', 'erg_2k_sec']);
  expect(liftingDefault.codes).toEqual(['squat_kg', 'vertical_jump_cm']);
  expect(rowingDefault.athleteCount).toBe(1);

  const timed = await create(rower, { label: '2000米专项计时', unit: 's', valueKind: 'time', direction: 'lower_better', protocol: '测试协议A' });
  const snatchInput = { label: '抓举', unit: 'kg', valueKind: 'number', direction: 'higher_better', protocol: '  ' } as const;
  const snatch = await create(lifter, snatchInput);
  expect(snatch.protocol).toBe('');
  expect(await load(rower)).toMatchObject({ codes: rowingDefault.codes, source: 'project' });
  expect((await load(lifter)).catalog.some(metric => metric.code === timed.code)).toBe(false);
  expect((await request(scopePath(rower, '/download'), 'POST', { codes: [snatch.code], saveTeam: true })).status).toBe(400);
  expect((await request(scopePath(rower, '/config'), 'PUT', { action: 'project', codes: [timed.code] })).status).toBe(403);
  expect((await request(scopePath(rower, '/metrics', 'HTTP乙队'), 'POST', snatchInput)).status).toBe(403);

  const rowing = await download(rower, [timed.code, 'squat_kg'], false);
  const lifting = await download(lifter, [snatch.code], true);
  const liftingSecondDate = await download(lifter, [snatch.code], false);
  expect(await load(rower)).toMatchObject({ codes: rowingDefault.codes, source: 'project' });
  expect(await load(lifter)).toMatchObject({ codes: [snatch.code], source: 'team' });
  const sheetName = '运动员测试成绩';
  expect(XLSX.utils.sheet_to_json(rowing.Sheets[sheetName], { header: 1 })).toEqual([
    ['运动员编号', '姓名', '所属队伍', '测试日期', '2000米专项计时（s）', '深蹲（kg）'],
    [expect.any(String), '赛艇测试队员', team],
  ]);
  expect(XLSX.utils.sheet_to_json(lifting.Sheets[sheetName], { header: 1 })).toEqual([
    ['运动员编号', '姓名', '所属队伍', '测试日期', '抓举（kg）'],
    [expect.any(String), '举重测试队员', team],
  ]);

  const rename = await request(scopePath(lifter, `/metrics/${snatch.code}`), 'PUT', { label: '实测抓举' });
  expect(rename.status).toBe(200);
  const revised = await create(lifter, { ...snatchInput, label: '实测抓举', protocol: '测试协议B', previousCode: snatch.code });
  expect(revised).toMatchObject({ unit: 'kg', protocol: '测试协议B', protocolVersion: '2' });
  db.prepare('UPDATE metric_definitions SET active=0 WHERE code=?').run(snatch.code);
  expect((await request(scopePath(lifter, '/config'), 'PUT', { action: 'inherit' })).status).toBe(200);
  expect(await load(lifter)).toMatchObject({ codes: liftingDefault.codes, source: 'project' });

  XLSX.utils.sheet_add_aoa(rowing.Sheets[sheetName], [['2026-11-17', '6:42.5', 0]], { origin: 'D2' });
  XLSX.utils.sheet_add_aoa(lifting.Sheets[sheetName], [['2026-11-17', 85]], { origin: 'D2' });
  expect((await write(rower, lifting)).status).toBe(400);
  expect((await write(rower, rowing, '动态模板乙队')).status).toBe(400);
  for (const [project, book] of [[rower, rowing], [lifter, lifting]] as const) {
    const parsed = await write(project, book);
    expect(parsed.status, JSON.stringify(parsed.body)).toBe(200);
    const batch = parsed.body.batch!;
    expect(batch.errorCount).toBe(0);
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
  }

  XLSX.utils.sheet_add_aoa(lifting.Sheets[sheetName], [[87]], { origin: 'E2' });
  const retry = await write(lifter, lifting);
  expect(retry.status).toBe(200);
  expect((await request(`/batches/${retry.body.batch!.id}/commit`, 'POST', {})).status).toBe(200);
  const revisedWorkbook = await download(lifter, [revised.code], false);
  XLSX.utils.sheet_add_aoa(revisedWorkbook.Sheets[sheetName], [['2026-11-17', 88]], { origin: 'D2' });
  const revisedUpload = await write(lifter, revisedWorkbook);
  expect(revisedUpload.status).toBe(200);
  expect((await request(`/batches/${revisedUpload.body.batch!.id}/commit`, 'POST', {})).status).toBe(200);

  const stored = db.prepare(`SELECT a.project, a.team, t.protocol, t.protocol_version AS version,
    t.test_date AS date, m.metric_code AS code, m.unit, m.value_num AS value
    FROM test_measurements m JOIN test_sessions t ON t.id=m.test_session_id
    JOIN athletes a ON a.id=t.athlete_id WHERE a.team=? ORDER BY a.project,m.value_num`).all(team);
  expect(stored).toEqual([
    { project: rower, team, protocol: '实测1RM', version: '', date: '2026-11-17', code: 'squat_kg', unit: 'kg', value: 0 },
    { project: rower, team, protocol: '测试协议A', version: '1', date: '2026-11-17', code: timed.code, unit: 's', value: 402.5 },
    { project: lifter, team, protocol: '', version: '1', date: '2026-11-17', code: snatch.code, unit: 'kg', value: 87 },
    { project: lifter, team, protocol: '测试协议B', version: '2', date: '2026-11-17', code: revised.code, unit: 'kg', value: 88 },
  ]);

  const [lifterCode] = XLSX.utils.sheet_to_json(lifting.Sheets[sheetName], { header: 1 })[1] as string[];
  const lifterId = parseAthleteNumber(lifterCode);
  const teamId = (db.prepare('SELECT team_id AS id FROM athletes WHERE id=?').get(lifterId) as { id: number }).id;
  const trendQuery = new URLSearchParams({
    project: lifter, teamId: String(teamId), from: '2026-11-17', to: '2026-11-20', metricCode: snatch.code,
  });
  XLSX.utils.sheet_add_aoa(liftingSecondDate.Sheets[sheetName], [['2026-11-19', 0]], { origin: 'D2' });
  const zero = await write(lifter, liftingSecondDate);
  expect(zero.status).toBe(200);
  expect((await request(`/batches/${zero.body.batch!.id}/commit`, 'POST', {})).status).toBe(200);
  const readTrend = (params: URLSearchParams, auth: string) => fetch(
    `${base}/api/athletes/${lifterId}/custom-test-trend?${params}`, { headers: { authorization: `Bearer ${auth}` } },
  );
  const trend = await readTrend(trendQuery, token);
  expect(trend.status).toBe(200);
  expect(await trend.json()).toMatchObject({
    metricCode: snatch.code,
    points: [{ date: '2026-11-17', value: 87 }, { date: '2026-11-19', value: 0 }],
  });
  const missingDate = new URLSearchParams(trendQuery);
  missingDate.set('from', '2026-11-18');
  missingDate.set('to', '2026-11-18');
  const emptyTrend = await readTrend(missingDate, token);
  expect(emptyTrend.status).toBe(200);
  expect(await emptyTrend.json()).toMatchObject({ metricCode: snatch.code, points: [] });
  expect((await readTrend(trendQuery, otherToken)).status).toBe(403);
  const wrongScope = new URLSearchParams(trendQuery);
  wrongScope.set('project', rower);
  expect((await readTrend(wrongScope, token)).status).toBe(403);
  trendQuery.set('metricCode', revised.code);
  const otherVersion = await readTrend(trendQuery, token);
  expect(otherVersion.status).toBe(200);
  expect(await otherVersion.json()).toMatchObject({ points: [{ date: '2026-11-17', value: 88 }] });

  // 合成转队场景：历史测试仍归属下载时的队伍，当前可查看运动员不代表可合并其他队伍成绩。
  const oldTeam = db.prepare("INSERT INTO project_teams(project,name) VALUES ('WEIGHTLIFTING','动态模板历史队伍') RETURNING id").get() as { id: number };
  db.prepare(`UPDATE test_template_downloads SET team_id=? WHERE id=(
    SELECT json_extract(summary_json,'$.testTemplateId') FROM data_import_batches WHERE id=?
  )`).run(oldTeam.id, zero.body.batch!.id);
  trendQuery.set('metricCode', snatch.code);
  const forCurrentTeam = await readTrend(trendQuery, token);
  expect(forCurrentTeam.status).toBe(200);
  expect(await forCurrentTeam.json()).toMatchObject({ points: [{ date: '2026-11-17', value: 87 }] });
  db.prepare(`UPDATE test_template_downloads SET team_id=? WHERE id=(
    SELECT json_extract(summary_json,'$.testTemplateId') FROM data_import_batches WHERE id=?
  )`).run(teamId, zero.body.batch!.id);
  const rosterRow = XLSX.utils.sheet_to_json(lifting.Sheets[sheetName], { header: 1 })[1] as unknown[];
  XLSX.utils.sheet_add_aoa(lifting.Sheets[sheetName], [[...rosterRow.slice(0, 4), 90]], { origin: 'A3' });
  const conflict = await write(lifter, lifting);
  expect(conflict.status).toBe(200);
  expect(conflict.body.batch!.errorCount).toBeGreaterThan(0);
  expect((await request(`/batches/${conflict.body.batch!.id}/commit`, 'POST', {})).status).toBe(400);
  expect(db.prepare("SELECT value_num FROM test_measurements m JOIN test_sessions s ON s.id=m.test_session_id WHERE m.metric_code=? AND s.test_date='2026-11-17'").get(snatch.code)).toEqual({ value_num: 87 });
  const batch = conflict.body.batch!;
  const { importReviewGroups, selectImportReviewRecord } = await import('../../shared/import-conflict-review.ts');
  const groups = importReviewGroups(batch.items);
  const selected = selectImportReviewRecord(groups, 1);
  expect(selected).toHaveLength(1);
  expect((await request(`/batches/${batch.id}/items`, 'PUT', { corrections: selected })).status).toBe(200);
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
  expect(db.prepare("SELECT value_num FROM test_measurements m JOIN test_sessions s ON s.id=m.test_session_id WHERE m.metric_code=? AND s.test_date='2026-11-17'").get(snatch.code)).toEqual({ value_num: 90 });

  XLSX.utils.sheet_add_aoa(rowing.Sheets[sheetName], [['2026-11-18', '6:60', 120]], { origin: 'D2' });
  const recheck = await write(rower, rowing);
  expect(recheck.status).toBe(200);
  const pending = recheck.body.batch!;
  expect(pending.items.find(item => item.metricCode === timed.code)?.messages.join('')).toContain('不是有效的秒数或分:秒');
  expect((await request(`/batches/${pending.id}/commit`, 'POST', {})).status).toBe(400);
  const rowingAthlete = pending.items.find(item => item.athleteId)!.athleteId;
  db.prepare("UPDATE athletes SET team_id=(SELECT id FROM project_teams WHERE project='ROWING' AND name='动态模板乙队') WHERE id=?").run(rowingAthlete);
  expect((await request(`/batches/${pending.id}/commit`, 'POST', {})).status).toBe(403);
  expect(db.prepare("SELECT id FROM test_sessions WHERE athlete_id=? AND test_date='2026-11-18'").get(rowingAthlete)).toBeUndefined();
});

it('获全项目队伍授权的管理员可维护项目默认，已自定义队伍独立保存', async () => {
  db.exec(`
    UPDATE users SET role='TD' WHERE id=702;
    INSERT INTO user_team_permissions (user_id,project,team,granted_by) VALUES (702,'ROWING','*',702);
  `);
  const path = '/test-template';
  const config = `${path}/config?project=ROWING&team=HTTP甲队`;
  const get = async (team: string) => {
    const res = await fetch(`${base}/api/data-import${path}?${new URLSearchParams({ project: 'ROWING', team })}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<import('../../shared/test-template.ts').TestTemplatePreview>;
  };
  try {
    expect(await get('HTTP乙队')).toMatchObject({ source: 'project', canManageProject: true });
    const response = await fetch(`${base}/api/data-import${path}/download?project=ROWING&team=HTTP甲队`, {
      method: 'POST', headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ codes: ['squat_kg'], saveTeam: true }),
    });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    const unitChange = await fetch(`${base}/api/data-management/metrics/squat_kg`, {
      method: 'PUT', headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: '深蹲', unit: 'lb', active: true }),
    });
    expect(unitChange.status).toBe(409);
    expect((await request(config, 'PUT', { action: 'project', codes: ['erg_2k_sec'] }, otherToken)).status).toBe(200);
    expect(await get('HTTP甲队')).toMatchObject({ source: 'team', codes: ['squat_kg'] });
    expect(await get('HTTP乙队')).toMatchObject({ source: 'project', codes: ['erg_2k_sec'] });
    expect((await request(config, 'PUT', { action: 'inherit' }, otherToken)).status).toBe(200);
    expect(await get('HTTP甲队')).toMatchObject({ source: 'project', codes: ['erg_2k_sec'] });
  } finally {
    db.exec("UPDATE users SET role='SCC' WHERE id=702; DELETE FROM user_team_permissions WHERE user_id=702 AND team='*';");
  }
});

it('教练自建测试项目可重复选用，FMS 七项与自定义字段均从宽表写入正式指标', async () => {
  const scope = '?project=ROWING&team=HTTP甲队';
  const path = '/test-template';
  const projectInput = {
    name: '自建力量测试',
    fields: [{ label: '重量', unit: 'kg' }, { label: '组数', unit: '组' }, { label: '次数', unit: '次' }, { label: '用时', unit: '', valueKind: 'time' }],
  };
  const create = await request(`${path}/groups${scope}`, 'POST', projectInput);
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const { group, metrics } = create.body as unknown as {
    group: { name: string; codes: string[] }; metrics: Array<{ code: string; label: string; protocol: string }>;
  };
  expect(group).toEqual({ name: projectInput.name, codes: metrics.map(metric => metric.code) });
  expect(metrics.map(metric => [metric.label, metric.protocol])).toEqual([
    ['自建力量测试重量', ''], ['自建力量测试组数', ''], ['自建力量测试次数', ''], ['自建力量测试用时', ''],
  ]);
  expect((await request(`${path}/groups?project=ROWING&team=HTTP乙队`, 'POST', projectInput)).status).toBe(403);
  expect((await request(`${path}/groups${scope}`, 'POST', projectInput)).status).toBe(400);
  const duplicate = { name: '字段重复', fields: [{ label: '成绩', unit: 'kg' }, { label: '成绩', unit: 'kg' }] };
  expect((await request(`${path}/groups${scope}`, 'POST', duplicate)).status).toBe(400);
  expect(db.prepare("SELECT 1 FROM metric_definitions WHERE label='字段重复成绩'").get()).toBeUndefined();

  db.prepare("INSERT INTO user_team_permissions (user_id,project,team,granted_by) VALUES (702,'ROWING','HTTP乙队',702)").run();
  const preview = await fetch(`${base}/api/data-import${path}?project=ROWING&team=HTTP乙队`, { headers: { authorization: `Bearer ${otherToken}` } });
  expect(preview.status).toBe(200);
  const { groups } = await preview.json() as { groups: typeof group[] };
  expect(groups).toContainEqual(group);
  const fms = groups.find(entry => entry.name === 'FMS')!;
  expect(fms.codes).toHaveLength(7);

  const savedConfig = await request(`${path}/config${scope}`, 'PUT', { action: 'team', codes: [...group.codes, ...fms.codes] });
  expect(savedConfig.status).toBe(200);
  expect(savedConfig.body).toMatchObject({ source: 'team', codes: [...group.codes, ...fms.codes] });
  const response = await fetch(`${base}/api/data-import${path}/download${scope}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  const book = XLSX.read(await response.arrayBuffer(), { type: 'array' });
  const sheet = book.Sheets['运动员测试成绩'];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  expect(matrix[0].slice(4, 8)).toEqual(['自建力量测试重量（kg）', '自建力量测试组数（组）', '自建力量测试次数（次）', '自建力量测试用时（s）']);
  expect(matrix[0].slice(8)).toHaveLength(16);
  const spreadsheetRow = matrix.findIndex(row => row[0] === 'ATL00701') + 1;
  expect(spreadsheetRow).toBeGreaterThan(1);
  const send = async () => {
    const form = new FormData();
    form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '测试项目宽表.xlsx');
    form.set('project', 'ROWING');
    form.set('team', 'HTTP甲队');
    return request('/analyze', 'POST', form);
  };
  XLSX.utils.sheet_add_aoa(sheet, [['2026-11-19', 75, 3, 5, '1:02.5', 4, 3, 2, 2, 3, 3, 3, '阴性', '阳性', 2, 3, 3, '阴性', 1, 2, '阴性']], { origin: `D${spreadsheetRow}` });
  const invalid = await send();
  expect(invalid.status).toBe(200);
  expect(invalid.body.batch?.items.find(item => item.metricCode === 'fms_deep_squat')?.quality).toBe('error');
  expect((await request(`/batches/${invalid.body.batch!.id}/commit`, 'POST', {})).status).toBe(400);
  XLSX.utils.sheet_add_aoa(sheet, [[0]], { origin: `I${spreadsheetRow}` });
  const ready = await send();
  expect(ready.status).toBe(200);
  expect(ready.body.batch?.items).toHaveLength(11);
  expect((await request(`/batches/${ready.body.batch!.id}/commit`, 'POST', {})).status).toBe(200);
  const values = db.prepare(`SELECT m.metric_code AS code, m.value_num AS value, t.test_type AS type, t.protocol
    FROM test_measurements m JOIN test_sessions t ON t.id=m.test_session_id WHERE t.athlete_id=701 AND t.test_date='2026-11-19'`).all();
  expect(values).toHaveLength(11);
  const fmsValues = values.filter(row => row.type === 'FMS测试');
  expect(fmsValues).toHaveLength(7);
  expect(fmsValues.reduce((total, row) => total + Number(row.value), 0)).toBe(10);
  const progress = `/test-template/progress${scope}&from=2026-11-19&to=2026-11-19`;
  const collection = await request(progress);
  expect(collection.status).toBe(200);
  expect(collection.body).toMatchObject({
    athleteCount: expect.any(Number),
    metrics: expect.arrayContaining([expect.objectContaining({ code: 'fms_deep_squat', measured: 1 })]),
  });
  const confirmed = await request(progress, 'PUT', { athleteIds: [701], metricCodes: ['fms_deep_squat'] });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body).toMatchObject({ metrics: expect.arrayContaining([
    expect.objectContaining({ code: 'fms_deep_squat', coverage: { total: 1, completed: 1 }, missing: [] }),
  ]) });
  expect((await request(progress, 'PUT', { athleteIds: [999999], metricCodes: ['fms_deep_squat'] })).status).toBe(400);
  expect((await request(progress.replace('HTTP甲队', '不存在的队伍'))).status).toBe(403);
  expect((await request(progress.replace('2026-11-19', '2026-11-20'))).status).toBe(400);
  expect(values).toEqual(expect.arrayContaining([
    ...group.codes.map((code, index) => ({ code, value: [75, 3, 5, 62.5][index], type: '专项测试', protocol: '' })),
    { code: 'fms_deep_squat', value: 0, type: 'FMS测试', protocol: '功能动作筛查（FMS）' },
    { code: 'fms_hurdle_step', value: 2, type: 'FMS测试', protocol: '功能动作筛查（FMS）' },
    { code: 'fms_shoulder_mobility', value: 0, type: 'FMS测试', protocol: '功能动作筛查（FMS）' },
  ]));
  const raw = db.prepare(`SELECT o.observation_json AS observation FROM fms_import_observations o JOIN test_sessions t ON t.id=o.test_session_id
    WHERE t.athlete_id=701 AND t.test_date='2026-11-19' AND o.metric_code='fms_shoulder_mobility'`).get() as { observation: string };
  expect(JSON.parse(raw.observation)).toEqual({ left: 3, right: 3, clearingLeft: '阴性', clearingRight: '阳性' });
  const trendTeam = db.prepare('SELECT team_id AS id FROM athletes WHERE id=701').get() as { id: number };
  const query = new URLSearchParams({
    project: 'ROWING', teamId: String(trendTeam.id), from: '2026-11-19', to: '2026-11-19', metricCode: group.codes[1],
  });
  const trend = await fetch(`${base}/api/athletes/701/custom-test-trend?${query}`, { headers: { authorization: `Bearer ${token}` } });
  expect(trend.status).toBe(200);
  expect(await trend.json()).toMatchObject({
    metricCode: group.codes[1],
    metrics: expect.arrayContaining(group.codes.map(code => expect.objectContaining({ code }))),
    points: [{ date: '2026-11-19', value: 3 }],
  });
  const removed = await request(`${path}/config${scope}`, 'PUT', { action: 'team', codes: [] });
  expect(removed.status).toBe(200);
  expect((await request(`${path}${scope}`)).body).toMatchObject({ codes: [] });
});

it('训练记录单表在举重和赛艇分别归并整课，保存力量组次和逐段自定义值', async () => {
  const lifting = '单表举重队';
  db.exec(`
    INSERT OR IGNORE INTO user_project_permissions(user_id,project,granted_by) VALUES(701,'WEIGHTLIFTING',701);
    INSERT INTO project_teams(project,name) VALUES('WEIGHTLIFTING','${lifting}');
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES(701,'WEIGHTLIFTING','${lifting}',701);
    INSERT INTO athletes(id,name,project,team,team_id)
      SELECT 1901,'单表举重队员',project,name,id FROM project_teams WHERE name='${lifting}';
  `);
  async function roundTrip(project: string, team: string, athleteId: number, template: object, examples: Record<string, unknown>[], excludeRow?: string, expectedError?: string) {
    const query = new URLSearchParams({ project, team });
    if (!expectedError) {
      const downloadsBefore = db.prepare('SELECT COUNT(*) AS count FROM training_record_downloads').get();
      const saved = await request(`/training-template?${query}`, 'PUT', template);
      if (saved.status === 409) {
        const { name } = template as { name: string };
        expect((await request(`/training-template?${query}`, 'PUT', { ...template, sourceName: name })).status).toBe(200);
      } else {
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        expect(saved.body).toMatchObject({ template });
      }
      expect(db.prepare('SELECT COUNT(*) AS count FROM training_record_downloads').get()).toEqual(downloadsBefore);
    }
    const response = await fetch(`${base}/api/data-import/training-template?${query}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...template, saveTeam: false }),
    });
    expect(response.status).toBe(200);
    const book = XLSX.read(await response.arrayBuffer());
    const sheet = book.Sheets['训练记录'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    const id = formatAthleteNumber(athleteId);
    const athlete = rows.find(row => row[0] === id)!;
    XLSX.utils.sheet_add_aoa(sheet, examples.map(example => rows[0].map((header, index) => example[header] ?? (index < 2 ? athlete[index] : null))), { origin: 'A2' });
    const form = new FormData();
    form.set('project', project);
    form.set('team', team);
    form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '单表训练.xlsx');
    const parsed = await request('/analyze', 'POST', form);
    if (expectedError) {
      expect(parsed.status).toBe(400);
      expect(parsed.body.message).toContain(expectedError);
      return;
    }
    expect(parsed.status, JSON.stringify(parsed.body)).toBe(200);
    if (excludeRow) {
      const target = parsed.body.batch!.items.find(item => item.itemType === 'training_session' && item.sourceAddress === excludeRow);
      expect(target, JSON.stringify(parsed.body.batch!.items.map(item => [item.itemType, item.sourceAddress, item.quality]))).toBeDefined();
      const excluded = await request(`/batches/${parsed.body.batch!.id}/items`, 'PUT', {
        corrections: [{ id: target!.id, resolution: 'skip' }],
      });
      expect(excluded.status, JSON.stringify(excluded.body)).toBe(200);
    }
    const result = await request(`/batches/${parsed.body.batch!.id}/commit`, 'POST', {});
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const history = await request(`/training-template?${query}`);
    expect(history.body).toMatchObject({ templates: expect.arrayContaining([expect.objectContaining(template)]) });
  }
  const when = { 日期: '2026-11-19', 课次: '上午专项课' };
  await roundTrip('WEIGHTLIFTING', lifting, 1901, {
    name: '举重力量', standard: ['训练类型', '时长分钟', 'RPE', '动作', '组序', '实际重量kg', '实际次数'], fields: [],
  }, [
    { ...when, 训练类型: '力量训练', 时长分钟: 60, RPE: 6, 动作: '抓举', 组序: 1, 实际重量kg: 60, 实际次数: 3 },
    { ...when, 动作: '抓举', 组序: 2, 实际重量kg: 65, 实际次数: 3 },
    { ...when, 动作: '抓举', 组序: 3, 实际重量kg: 70, 实际次数: 2 },
  ]);
  const liftingSession = db.prepare("SELECT id,duration_min,srpe FROM training_sessions WHERE athlete_id=1901 AND session_date='2026-11-19'").all();
  expect(liftingSession).toEqual([{ id: expect.any(Number), duration_min: 60, srpe: 360 }]);
  expect(db.prepare('SELECT actual_weight_kg FROM strength_result_sets WHERE training_session_id=? ORDER BY set_index').all(Number(liftingSession[0].id)))
    .toEqual([{ actual_weight_kg: 60 }, { actual_weight_kg: 65 }, { actual_weight_kg: 70 }]);

  const rowingTemplate = {
    name: '赛艇分段', standard: ['时长分钟'], fields: [
      { name: '分段时间', unit: 's', kind: 'time' }, { name: '桨频', unit: '', kind: 'number' },
      { name: '备注', unit: '', kind: 'text' },
    ],
  };
  await roundTrip('ROWING', 'HTTP甲队', 701, rowingTemplate, [230, '3:52', 237, '4:02.5'].map((seconds, index) => ({
    ...when, 时长分钟: index === 0 ? 60 : undefined, 明细序号: index + 1, '分段时间（s）': seconds, 桨频: 24, 备注: '虚构段',
  })));
  for (const invalidTime of ['3:65', -1]) {
    await roundTrip('ROWING', 'HTTP甲队', 701, rowingTemplate, [
      { ...when, 明细序号: 1, '分段时间（s）': invalidTime },
    ], undefined, '须填写非负秒数或分:秒');
  }
  const rows = db.prepare(`SELECT d.detail_order, d.value_num FROM training_record_details d
    JOIN training_sessions s ON s.id=d.session_id WHERE s.athlete_id=701 AND d.field='分段时间' ORDER BY d.detail_order`).all();
  expect(rows).toEqual([230, 232, 237, 242.5].map((value_num, index) => ({ detail_order: index + 1, value_num })));
  const team = db.prepare('SELECT team_id AS id FROM athletes WHERE id=701').get() as { id: number };
  const query = new URLSearchParams({
    project: 'ROWING', teamId: String(team.id), from: '2026-11-19', to: '2026-11-19',
  });
  const headers = { authorization: `Bearer ${token}` };
  const details = await fetch(`${base}/api/athletes/701/custom-training-details?${query}`, { headers });
  expect(details.status).toBe(200);
  expect(await details.json()).toMatchObject({ truncated: false, rows: expect.arrayContaining([
    expect.objectContaining({ detailOrder: 4, field: '分段时间', unit: 's', value: 242.5 }),
    expect.objectContaining({ detailOrder: 4, field: '备注', text: '虚构段' }),
  ]) });
  query.set('project', 'WEIGHTLIFTING');
  const denied = await fetch(`${base}/api/athletes/701/custom-training-details?${query}`, { headers });
  expect(denied.status).toBe(403);
  await roundTrip('ROWING', 'HTTP甲队', 701, rowingTemplate, [
    { ...when, 时长分钟: 60, 明细序号: 5, '分段时间（s）': 246 },
    { ...when, 明细序号: 6, '分段时间（s）': 250 },
  ], 'B3');
  expect(db.prepare("SELECT detail_order FROM training_record_details WHERE field='分段时间' AND detail_order>=5").all())
    .toEqual([{ detail_order: 5 }]);

  const nextTeam = '单表赛艇转入队';
  db.prepare("INSERT INTO project_teams(project,name) VALUES('ROWING',?)").run(nextTeam);
  db.prepare("INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES(701,'ROWING',?,701)").run(nextTeam);
  const nextId = db.prepare("SELECT id FROM project_teams WHERE project='ROWING' AND name=?").get(nextTeam) as { id: number };
  db.prepare('UPDATE athletes SET team=?,team_id=? WHERE id=701').run(nextTeam, nextId.id);
  try {
    await roundTrip('ROWING', nextTeam, 701, rowingTemplate, [
      { ...when, 时长分钟: 75, 明细序号: 1, '分段时间（s）': 260 },
    ]);
    expect(db.prepare(`SELECT scope.team_id, s.duration_min FROM training_sessions s
      JOIN training_record_session_scope scope ON scope.session_id=s.id
      WHERE s.athlete_id=701 AND s.session_date='2026-11-19' AND s.content='上午专项课'
      ORDER BY s.session_order`).all()).toEqual([
      { team_id: team.id, duration_min: 60 }, { team_id: nextId.id, duration_min: 75 },
    ]);
  } finally {
    db.prepare("UPDATE athletes SET team='HTTP甲队',team_id=? WHERE id=701").run(team.id);
  }
  const scope = '?project=ROWING&team=HTTP甲队';
  const before = await request(`/training-template${scope}`);
  expect((await request(`/training-template${scope}`, 'PUT', {
    name: '赛艇技术', standard: [], fields: [{ name: '备注', unit: '', kind: 'text' }],
  })).status).toBe(200);
  const draft = await request(`/training-template${scope}`);
  expect(draft.body).toMatchObject({ names: (before.body as { names?: string[] }).names });
  const columns = ['赛艇技术 · 备注', '赛艇分段 · 分段时间（s）', '时长分钟'];
  const config = { names: ['赛艇分段', '赛艇技术'], columns };
  expect((await request(`/training-template/config${scope}`, 'PUT', { ...config, columns: ['未知列'] })).status).toBe(400);
  expect((await request(`/training-template/config${scope}`, 'PUT', config)).status).toBe(200);
  const permission = db.prepare("INSERT OR IGNORE INTO user_team_permissions(user_id,project,team,granted_by) VALUES(702,'ROWING','HTTP甲队',701)").run();
  try {
    const otherHeaders = { authorization: `Bearer ${otherToken}` };
    const other = await fetch(`${base}/api/data-import/training-template${scope}`, { headers: otherHeaders });
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject(config);
    const download = await fetch(`${base}/api/data-import/training-template/download${scope}`, { headers: otherHeaders });
    expect(download.status).toBe(200);
    const book = XLSX.read(await download.arrayBuffer());
    const sheet = book.Sheets['训练记录'];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    expect(matrix[0]).toEqual(['运动员编号', '姓名', '日期', '课次', ...columns]);
    XLSX.utils.sheet_add_aoa(sheet, [
      ['701', '虚构队员', '2026-11-20', '合并课次', null, '1:02.5', 30],
      ['701', '虚构队员', '2026-11-20', '合并课次', '动作稳定'],
    ], { origin: 'A2' });
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('team', 'HTTP甲队');
    form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '本队训练.xlsx');
    const analyzed = await request('/analyze', 'POST', form);
    expect(analyzed.status).toBe(200);
    const commit = await request(`/batches/${analyzed.body.batch!.id}/commit`, 'POST', {});
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    expect(db.prepare(`SELECT d.template_name, d.field, d.value_num, d.value_text
      FROM training_record_details d JOIN training_sessions s ON s.id=d.session_id
      WHERE s.athlete_id=701 AND s.session_date='2026-11-20' ORDER BY d.template_name`).all()).toEqual([
      { template_name: '赛艇分段', field: '分段时间', value_num: 62.5, value_text: null },
      { template_name: '赛艇技术', field: '备注', value_num: null, value_text: '动作稳定' },
    ]);
    const remainingConfig = { ...config, columns: columns.slice(1) };
    expect((await request(`/training-template/config${scope}`, 'PUT', remainingConfig)).status).toBe(200);
    const updatedDownload = await fetch(`${base}/api/data-import/training-template/download${scope}`, { headers: otherHeaders });
    expect(updatedDownload.status).toBe(200);
    const updatedBook = XLSX.read(await updatedDownload.arrayBuffer());
    const updatedRows = XLSX.utils.sheet_to_json(updatedBook.Sheets['训练记录'], { header: 1 }) as unknown[][];
    expect(updatedRows[0].slice(4)).toEqual(remainingConfig.columns);
  } finally {
    if (permission.changes) db.prepare("DELETE FROM user_team_permissions WHERE user_id=702 AND project='ROWING' AND team='HTTP甲队'").run();
  }
});

it('常用项目支持整课、深蹲三组、赛艇四段和体能成绩回传', async () => {
  const scope = '?project=ROWING&team=HTTP甲队';
  const headers = { authorization: `Bearer ${token}` };
  async function workbook(kind: 'training' | 'test', sheetName: string) {
    const response = await fetch(`${base}/api/data-import/${kind}-template/download${scope}`, { headers });
    expect(response.status).toBe(200);
    const book = XLSX.read(await response.arrayBuffer());
    const sheet = book.Sheets[sheetName];
    const columns = (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][])[0];
    return { book, sheet, columns };
  }
  async function submit(book: XLSX.WorkBook) {
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('team', 'HTTP甲队');
    form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '常用项目.xlsx');
    const parsed = await request('/analyze', 'POST', form);
    expect(parsed.status, JSON.stringify(parsed.body)).toBe(200);
    const committed = await request(`/batches/${parsed.body.batch!.id}/commit`, 'POST', {});
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
  }

  const config = await request(`/training-template${scope}`);
  expect(config.body).toMatchObject({ commonNames: ['整课训练', '力量训练', '间歇与分段训练'] });
  expect((await request(`/training-template/config${scope}`, 'PUT', { names: ['整课训练'] })).status).toBe(200);
  const simple = await workbook('training', '训练记录');
  expect(simple.columns).toEqual(['运动员编号', '姓名', '日期', '课次', '时长分钟', 'RPE', '整课训练 · 备注']);

  expect((await request(`/training-template/config${scope}`, 'PUT', { names: ['整课训练', '力量训练', '间歇与分段训练'] })).status).toBe(200);
  const training = await workbook('training', '训练记录');
  expect(training.columns).toEqual(expect.arrayContaining(['组序', '段序']));
  expect(training.columns).not.toContain('明细序号');
  const identity = { 运动员编号: '', 姓名: '虚构队员', 日期: '2026-11-21' };
  const rows: Record<string, string | number>[] = [
    ...[60, 65, 70].map((weight, index) => ({
      ...identity, 课次: '深蹲训练', ...(index === 0 ? { 时长分钟: 60, RPE: 6 } : {}),
      动作: '深蹲', 组序: index + 1, 实际重量kg: weight, 实际次数: 3,
    })),
    ...[60, 61.5, 62, 63].map((seconds, index) => ({
      ...identity, 课次: '赛艇分段', 段序: index + 1, '间歇与分段训练 · 分段用时（s）': seconds,
    })),
  ];
  XLSX.utils.sheet_add_aoa(training.sheet, rows.map(row => training.columns.map(column => row[column] ?? null)), { origin: 'A2' });
  await submit(training.book);
  expect(db.prepare(`SELECT s.duration_min, s.srpe, COUNT(r.id) AS sets FROM training_sessions s
    JOIN strength_result_sets r ON r.training_session_id=s.id
    WHERE s.athlete_id=701 AND s.session_date='2026-11-21' AND s.content='深蹲训练' GROUP BY s.id`).get())
    .toEqual({ duration_min: 60, srpe: 360, sets: 3 });
  expect(db.prepare(`SELECT d.detail_order,d.value_num FROM training_record_details d
    JOIN training_sessions s ON s.id=d.session_id
    WHERE s.athlete_id=701 AND s.session_date='2026-11-21' AND s.content='赛艇分段' ORDER BY d.detail_order`).all())
    .toEqual([60, 61.5, 62, 63].map((value_num, index) => ({ detail_order: index + 1, value_num })));

  const testConfig = await request(`/test-template${scope}`);
  expect(testConfig.body).toMatchObject({ groups: expect.arrayContaining([
    expect.objectContaining({ name: '实测最大力量（1RM）', common: true, codes: expect.arrayContaining(['squat_kg']) }),
    expect.objectContaining({ name: '跳跃能力', common: true, codes: expect.arrayContaining(['vertical_jump_cm']) }),
  ]) });
  expect((await request(`/test-template/config${scope}`, 'PUT', { action: 'team', codes: ['squat_kg', 'vertical_jump_cm'] })).status).toBe(200);
  const tests = await workbook('test', '运动员测试成绩');
  XLSX.utils.sheet_add_aoa(tests.sheet, [['701', '虚构队员', 'HTTP甲队', '2026-11-21', 95, 41]], { origin: 'A2' });
  await submit(tests.book);
  expect(db.prepare(`SELECT m.metric_code,m.value_num,t.protocol FROM test_measurements m JOIN test_sessions t ON t.id=m.test_session_id
    WHERE t.athlete_id=701 AND t.test_date='2026-11-21' ORDER BY m.metric_code`).all()).toEqual([
    { metric_code: 'squat_kg', value_num: 95, protocol: '实测1RM' },
    { metric_code: 'vertical_jump_cm', value_num: 41, protocol: 'CMJ' },
  ]);
});

it('提交时自动关联预览后出现的同队唯一同名档案', async () => {
  const name = '预览后补建队员';
  const batch = await upload([
    ['姓名', '日期', '时长分钟'], [name, '2026-11-22', 45],
  ], '训练课次', 'HTTP甲队');
  expect(batch.athleteCandidates[0]).toMatchObject({ status: 'pending', matchedAthleteId: null, confirmed: true });

  const athlete = db.prepare(`INSERT INTO athletes (name,project,team,team_id)
    SELECT ?,project,name,id FROM project_teams WHERE project='ROWING' AND name='HTTP甲队'`).run(name);
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({ createdAthletes: 0, linkedAthletes: 1 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM athletes WHERE name=?').get(name)).toEqual({ count: 1 });
  expect(db.prepare("SELECT athlete_id,duration_min FROM training_sessions WHERE session_date='2026-11-22' AND athlete_id=?")
    .get(athlete.lastInsertRowid)).toEqual({ athlete_id: Number(athlete.lastInsertRowid), duration_min: 45 });
});

it('继续校对旧档案草稿时自动关联同队唯一同名者，并能直接提交', async () => {
  const batch = await upload([profileHeaders, ['', '虚构队员', '', '', '', '旧草稿修复']], profileSheet, 'HTTP甲队');
  const person = batch.athleteCandidates[0];
  db.prepare(`UPDATE data_import_athlete_candidates
    SET status='pending', matched_athlete_id=NULL, confirmed=0, messages_json=? WHERE id=?`)
    .run(JSON.stringify(['请选择所属队伍']), person.id);
  db.prepare('UPDATE data_import_items SET athlete_id=NULL WHERE batch_id=?').run(batch.id);
  const path = `/batches/${batch.id}`;
  const refreshed = await request(`${path}/athletes`, 'PUT', { autoMatch: true, expectedRevision: batch.revision });
  expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
  expect(refreshed.body.batch?.athleteCandidates[0]).toMatchObject({ matchedAthleteId: 701, confirmed: true });
  expect(refreshed.body.batch?.items[0]).toMatchObject({ athleteId: 701 });
  const revision = refreshed.body.batch!.revision;
  const unchanged = await request(`${path}/athletes`, 'PUT', { autoMatch: true, expectedRevision: revision });
  expect(unchanged.body.batch?.revision).toBe(revision);
  expect((await request(`${path}/commit`, 'POST', { expectedRevision: revision })).status).toBe(200);
});

it('修正待建档姓名后可直接关联同队已有档案', async () => {
  const batch = await upload([profileHeaders, ['', '原文件笔误', '', '', '', '修正后合并']], profileSheet, 'HTTP甲队');
  const person = batch.athleteCandidates[0];
  const result = await request(`/batches/${batch.id}/athletes`, 'PUT', {
    corrections: [{ id: person.id, name: '虚构队员', confirmed: false }],
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.batch?.athleteCandidates[0]).toMatchObject({ matchedAthleteId: 701, confirmed: true });
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
});

it('停用档案阻止重复建档，授权管理者重新打开草稿后可显式恢复', async () => {
  const name = '停用草稿队员';
  const athlete = db.prepare(`INSERT INTO athletes (name,project,team,team_id,active)
    SELECT ?,project,name,id,0 FROM project_teams WHERE project='ROWING' AND name='HTTP甲队'`).run(name);
  const athleteId = Number(athlete.lastInsertRowid);
  const batch = await upload([['姓名', '日期', '时长分钟'], [name, '2026-11-24', 40]], '训练课次', 'HTTP甲队');
  const path = `/batches/${batch.id}`;
  const rejected = await request(`${path}/commit`, 'POST', {});
  expect(rejected.status).toBe(400);
  expect(rejected.body.message).toContain('联系有权限的人员');
  const coach = await request(`${path}/athletes`, 'PUT', { autoMatch: true });
  expect(coach.body.batch?.athleteCandidates[0].suggested).toEqual([]);

  db.exec("UPDATE users SET role='TD' WHERE id=701");
  try {
    const refreshed = await request(`${path}/athletes`, 'PUT', { autoMatch: true });
    expect(refreshed.status).toBe(200);
    const [person] = refreshed.body.batch!.athleteCandidates;
    expect(person).toMatchObject({ confirmed: false, matchedAthleteId: null, suggested: [{ id: athleteId }] });
    expect(db.prepare('SELECT active FROM athletes WHERE id=?').get(athleteId)).toEqual({ active: 0 });
    const confirmed = await request(`${path}/athletes`, 'PUT', {
      corrections: [{ id: person.id, matchedAthleteId: athleteId, confirmed: true }],
    });
    expect(confirmed.status).toBe(200);
    const committed = await request(`${path}/commit`, 'POST', {});
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body).toMatchObject({ createdAthletes: 0, linkedAthletes: 1 });
    expect(db.prepare('SELECT active FROM athletes WHERE id=?').get(athleteId)).toEqual({ active: 1 });
  } finally {
    db.exec("UPDATE users SET role='SCC' WHERE id=701");
  }
});

it('力量训练组次模板的组次列记录每组次数，并按次数和重量计算训练量', async () => {
  const query = new URLSearchParams({ kind: 'training', project: 'ROWING', team: 'HTTP甲队' });
  const download = await fetch(`${base}/api/data-import/template?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(download.status).toBe(200);
  const book = XLSX.read(await download.arrayBuffer());
  const sheet = book.Sheets['力量训练组次'];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
  const columns = matrix[2].map(header => header.split('\n')[0]);
  expect(columns).toContain('组次（每组实际次数）');
  expect(columns).toContain('组序');
  const rows = [
    { 系统运动员编号: '701', 姓名: '虚构队员', 日期: '2026-11-25', 课次名称: '组次验证', 动作: '深蹲', 组序: 1, '组次（每组实际次数）': 6, 实际重量kg: 60 },
    { 系统运动员编号: '701', 姓名: '虚构队员', 日期: '2026-11-25', 课次名称: '组次验证', 动作: '深蹲', 组序: 2, '组次（每组实际次数）': 4, 实际重量kg: 65 },
  ] as Record<string, string | number>[];
  XLSX.utils.sheet_add_aoa(sheet, rows.map(row => columns.map(column => row[column] ?? null)), { origin: 'A4' });
  const form = new FormData();
  form.set('project', 'ROWING');
  form.set('team', 'HTTP甲队');
  form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '力量组次.xlsx');
  const parsed = await request('/analyze', 'POST', form);
  expect(parsed.status, JSON.stringify(parsed.body)).toBe(200);
  const committed = await request(`/batches/${parsed.body.batch!.id}/commit`, 'POST', {});
  expect(committed.status, JSON.stringify(committed.body)).toBe(200);
  expect(db.prepare(`SELECT r.set_index,r.actual_reps,s.smvl FROM strength_result_sets r
    JOIN training_sessions s ON s.id=r.training_session_id
    WHERE s.athlete_id=701 AND s.project_code='ROWING' AND s.session_date='2026-11-25'
    ORDER BY r.set_index`).all()).toEqual([
    { set_index: 1, actual_reps: 6, smvl: 620 },
    { set_index: 2, actual_reps: 4, smvl: 620 },
  ]);
});

it('标准模板支持补充档案、相同力量组填一行与常用体能宽表', async () => {
  async function download(kind: string) {
    const query = new URLSearchParams({ kind, project: 'ROWING', team: 'HTTP甲队' });
    const response = await fetch(`${base}/api/data-import/template?${query}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    return XLSX.read(await response.arrayBuffer(), { cellStyles: true });
  }
  function fill(book: XLSX.WorkBook, sheetName: string, row: Record<string, string | number>, heading = 3) {
    const sheet = book.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    const headers = rows[heading - 1].map(value => String(value).split('\n')[0]);
    const numberColumn = headers.indexOf('系统运动员编号');
    const athleteRow = numberColumn < 0 ? rows.findIndex(cells => cells[0] === row.姓名) : rows.findIndex(cells => cells[numberColumn] === 'ATL00701');
    XLSX.utils.sheet_add_aoa(sheet, [headers.map(key => key === '系统运动员编号' ? '701' : row[key] ?? null)],
      { origin: `A${athleteRow >= heading ? athleteRow + 1 : heading + 1}` });
  }
  async function preview(book: XLSX.WorkBook) {
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('team', 'HTTP甲队');
    form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '标准模板.xlsx');
    const result = await request('/analyze', 'POST', form);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body.batch!;
  }
  async function submit(book: XLSX.WorkBook) {
    const batch = await preview(book);
    expect(batch.errorCount, JSON.stringify(batch.items.map(item => item.messages))).toBe(0);

    const saved = await request(`/batches/${batch.id}/commit`, 'POST', {});
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  }

  const profile = await download('profile');
  fill(profile, ATHLETE_PROFILE_SHEET, { 运动员编号: 'ATL00701', 姓名: '虚构队员', 技术等级: '二级' }, 1);
  await submit(profile);
  expect(db.prepare('SELECT technical_level,start_sport_date FROM athlete_profiles WHERE athlete_id=701').get())
    .toMatchObject({ technical_level: '二级运动员' });

  const training = await download('training');
  const sheet = training.Sheets['训练课次'];
  const headings = (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][])[2];
  expect(sheet['!cols']?.[headings.findIndex(value => String(value).startsWith('事实项目\n'))]).toMatchObject({ hidden: true, level: 1 });
  const sets = { 姓名: '虚构队员', 日期: '2026-11-26', 动作: '深蹲', 组数: 3, '组次（每组实际次数）': 6, 实际重量kg: 60 };
  fill(training, '力量训练组次', sets);
  await submit(training);
  expect(db.prepare(`SELECT r.set_index,r.actual_reps,s.smvl FROM strength_result_sets r
    JOIN training_sessions s ON s.id=r.training_session_id
    WHERE s.athlete_id=701 AND s.session_date='2026-11-26' ORDER BY r.set_index`).all())
    .toEqual([1, 2, 3].map(set_index => ({ set_index, actual_reps: 6, smvl: 1080 })));
  const invalid = await download('training');
  fill(invalid, '力量训练组次', { ...sets, '组次（每组实际次数）': 6.5 });
  const bad = await preview(invalid);
  expect(bad.items[0].messages.join('')).toContain('实际次数须为非负整数');
  expect((await request(`/batches/${bad.id}/commit`, 'POST', {})).status).toBe(400);

  const tests = await download('test');
  fill(tests, '体能测试', { 姓名: '虚构队员', 测试日期: '2026-11-26', '深蹲1RM（kg）': 95, 'CMJ跳高（cm）': 42 });
  await submit(tests);
  expect(db.prepare(`SELECT m.metric_code,m.value_num,t.protocol FROM test_measurements m JOIN test_sessions t ON t.id=m.test_session_id
    WHERE t.athlete_id=701 AND t.test_date='2026-11-26' ORDER BY m.metric_code`).all()).toEqual([
    { metric_code: 'squat_kg', value_num: 95, protocol: '实测1RM' },
    { metric_code: 'vertical_jump_cm', value_num: 42, protocol: 'CMJ' },
  ]);
});

it('标准 FMS 表先保存单侧原始结果，补录后计算最终分且保留实测零分', async () => {
  const download = async () => {
    const response = await fetch(`${base}/api/data-import/template?kind=test&project=ROWING&team=HTTP甲队`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    return XLSX.read(await response.arrayBuffer());
  };
  async function submit(values: Record<string, unknown>) {
    const book = await download();
    const sheet = book.Sheets['FMS测试'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    const columns = rows[2].map(header => header.split('\n')[0]);
    expect(columns).toContain('肩部灵活性（左侧疼痛排查）');
    expect(columns).toContain('跨栏步（右）');
    const numberColumn = columns.indexOf('系统运动员编号');
    const athleteRow = rows.findIndex(cells => cells[numberColumn] === 'ATL00701');
    expect(athleteRow).toBeGreaterThanOrEqual(3);
    const row: Record<string, unknown> = { 系统运动员编号: '701', 姓名: '虚构队员', 测试日期: '2026-11-28', ...values };
    XLSX.utils.sheet_add_aoa(sheet, [columns.map(column => row[column] ?? null)], { origin: `A${athleteRow + 1}` });
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('team', 'HTTP甲队');
    form.set('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), '左右FMS.xlsx');
    const parsed = await request('/analyze', 'POST', form);
    expect(parsed.status).toBe(200);
    expect(parsed.body.batch?.errorCount, JSON.stringify(parsed.body.batch?.items.map(item => item.messages))).toBe(0);
    const result = await request(`/batches/${parsed.body.batch!.id}/commit`, 'POST', {});
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }
  const final = () => db.prepare(`SELECT m.metric_code,m.value_num FROM test_measurements m JOIN test_sessions s ON s.id=m.test_session_id
    WHERE s.athlete_id=701 AND s.test_date='2026-11-28' ORDER BY m.metric_code`).all();
  await submit({ '跨栏步（左）': 0, 躯干稳定俯卧撑: 3 });
  expect(final()).toEqual([]);
  await submit({ '跨栏步（右）': 2, '躯干稳定俯卧撑（疼痛排查）': '阳性' });
  expect(final()).toEqual([
    { metric_code: 'fms_hurdle_step', value_num: 0 },
    { metric_code: 'fms_trunk_stability_pushup', value_num: 0 },
  ]);
});

it('基础档案旧单列最大力量保留实测日期', async () => {
  const batch = await upload([
    ['姓名', '最大力量'], ['虚构队员', '2026-11-23 深蹲 95kg；2026-11-24 卧推 65.5kg'],
  ], profileSheet, 'HTTP甲队');
  expect(batch.items.filter(item => item.itemType === 'test_measurement')).toHaveLength(2);
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
  expect(db.prepare(`SELECT t.test_date,t.protocol,m.metric_code,m.value_num FROM test_sessions t
    JOIN test_measurements m ON m.test_session_id=t.id WHERE t.athlete_id=701 AND t.protocol='实测1RM'
    AND t.test_date IN ('2026-11-23','2026-11-24') ORDER BY t.test_date`).all()).toEqual([
    { test_date: '2026-11-23', protocol: '实测1RM', metric_code: 'squat_kg', value_num: 95 },
    { test_date: '2026-11-24', protocol: '实测1RM', metric_code: 'bench_press_kg', value_num: 65.5 },
  ]);
  const invalid = await upload([['姓名', '最大力量'], ['虚构队员', '深蹲 95kg']], profileSheet, 'HTTP甲队');
  expect(invalid.items[0].messages.join('')).toContain('实测日期');
  expect((await request(`/batches/${invalid.id}/commit`, 'POST', {})).status).toBe(400);
});

it('基础档案最大力量分列填报，自动按标准测试默认日期入库', async () => {
  const headers = [...BASIC_PROFILE_HEADERS];
  const body = (action: string, weight: number) => headers.map(header => {
    const key = header.split('\n')[0];
    return key === '最大力量项目' ? action : key === '最大力量' ? weight : key === '姓名' ? '虚构队员' : '';
  });
  const batch = await upload([headers, body('高翻', 70), body('卧拉', 61.5)], profileSheet, 'HTTP甲队');
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  expect(batch.items.filter(item => item.itemType === 'test_measurement')).toEqual(expect.arrayContaining([
    expect.objectContaining({ metricCode: 'clean_kg', valueNum: 70, eventDate: date }),
    expect.objectContaining({ metricCode: 'bench_pull_kg', valueNum: 61.5, eventDate: date }),
  ]));
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
  const invalid = await upload([headers, body('', 65)], profileSheet, 'HTTP甲队');
  expect(invalid.items[0].messages.join('')).toContain('请选择最大力量项目');
});

it('姓名模板回传时跳过未修改的在册队员，新姓名按页面所选项目和队伍建档', async () => {
  const batch = await upload([['姓名'], ['虚构队员'], ['仅填姓名虚构新队员']], profileSheet, 'HTTP甲队');
  expect(batch.items.map(item => item.rawAthleteName)).toEqual(['仅填姓名虚构新队员']);
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(db.prepare("SELECT project,team FROM athletes WHERE name='仅填姓名虚构新队员'").get())
    .toEqual({ project: 'ROWING', team: 'HTTP甲队' });
});

it('基础档案日期接受常见分隔符，统一保存为 ISO 日期并拒绝不存在的日期', async () => {
  const headers = ['姓名', '身体测量日期', '身高（cm）', '出生日期', '开始运动日期', '成绩日期'];
  const batch = await upload([headers, ['虚构队员', '2024/2/29', 178, '2009.9.6', '2019年7月13日', '2024．10．2']], profileSheet, 'HTTP甲队');
  expect(batch.errorCount).toBe(0);
  expect(batch.items.find(item => item.itemType === 'body_measurement')?.eventDate).toBe('2024-02-29');
  expect(batch.items.find(item => item.itemType === 'athlete_profile')?.payload).toMatchObject({
    birthDate: '2009-09-06', startSportDate: '2019-07-13', bestResultDate: '2024-10-02',
  });
  expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
  const invalid = await upload([headers, ['虚构队员', '2024.2.30', 178]], profileSheet, 'HTTP甲队');
  expect(invalid.items[0].messages.join('')).toContain('身体测量日期无效');
  expect((await request(`/batches/${invalid.id}/commit`, 'POST', {})).status).toBe(400);
});

it('指标与标准按授权汇总已入库的测试指标，区分单位及协议', async () => {
  const teamId = (db.prepare("SELECT id FROM project_teams WHERE name='HTTP乙队'").get() as { id: number }).id;
  const hiddenAthlete = db.prepare("INSERT INTO athletes(name,project,team,team_id) VALUES('汇总边界样例','ROWING','HTTP乙队',?)").run(teamId);
  const insertSession = db.prepare(`
    INSERT INTO test_sessions(athlete_id,test_date,test_type,project_code,project_status,protocol)
    VALUES(?,?,'汇总测试样例','ROWING','confirmed',?)
  `);
  const insertMetric = db.prepare(`
    INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit,source)
    VALUES(?,'squat_kg',75,?,?)
  `);
  const sessionIds: Array<number | bigint> = [];
  try {
    for (const [athleteId, protocol, unit, source] of [
      [701, '标准一', 'kg', 'file_import'],
      [701, '标准二', 'lb', 'file_import'],
      [701, '手工样例', 'kg', 'manual'],
      [hiddenAthlete.lastInsertRowid, '仅乙队', 'kg', 'file_import'],
    ] as const) {
      const sessionId = insertSession.run(athleteId, `2026-11-0${sessionIds.length + 1}`, protocol).lastInsertRowid;
      sessionIds.push(sessionId);
      insertMetric.run(sessionId, unit, source);
    }
    const response = await fetch(`${base}/api/data-management/imported-tests`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const { items } = await response.json() as { items: Array<{ testType: string }> };
    expect(items.filter((item) => item.testType === '汇总测试样例')).toEqual([
      expect.objectContaining({ metricCode: 'squat_kg', protocol: '标准一', unit: 'kg', measurementCount: 1 }),
      expect.objectContaining({ metricCode: 'squat_kg', protocol: '标准二', unit: 'lb', measurementCount: 1 }),
    ]);
  } finally {
    for (const id of sessionIds) {
      db.prepare('DELETE FROM test_measurements WHERE test_session_id=?').run(id);
      db.prepare('DELETE FROM test_sessions WHERE id=?').run(id);
    }
    db.prepare('DELETE FROM athletes WHERE id=?').run(hiddenAthlete.lastInsertRowid);
  }
});
