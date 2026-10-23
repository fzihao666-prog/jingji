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
    for (const kind of ['profile', 'training', 'test', 'unified']) {
      const response = await fetch(`${base}/api/data-import/template?${new URLSearchParams({ kind, project: 'ROWING', team: addedTeams[0] })}`, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
      const content = JSON.stringify(workbook.SheetNames.map(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })));
      expect(content).toContain('模板虚构队员');
      expect(content).not.toContain('"虚构队员"');
    }
    const empty = await fetch(`${base}/api/data-import/template?${new URLSearchParams({ kind: 'unified', project: 'ROWING', team: addedTeams[1] })}`, { headers: { authorization: `Bearer ${token}` } });
    expect(empty.status).toBe(200);
    const workbook = XLSX.read(await empty.arrayBuffer(), { type: 'array' });
    expect(JSON.stringify(workbook.Sheets)).not.toContain('虚构队员');
    for (const query of ['project=ROWING&team=HTTP乙队', 'project=ROWING&team=不存在的队伍'])
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

async function upload(rows: unknown[][], sheet = '身体测量') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[++workbookIndex]]), '说明');
  const form = new FormData();
  form.set('project', 'ROWING');
  form.set('file', new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })]), '虚构测试.xlsx');
  const response = await request('/analyze', 'POST', form);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.batch).toBeDefined();
  return response.body.batch!;
}

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


it('人员确认后撤回行政授权，最终HTTP提交拒绝新建及业务写入', async () => {
  const batch = await upload([['姓名', '所属队伍', '日期', '睡眠小时'], ['撤权虚构新人', 'HTTP甲队', '2026-10-09', 8]], '每日恢复');
  expect((await request(`/batches/${batch.id}/athletes`, 'PUT', { corrections: [{ id: batch.athleteCandidates[0].id, confirmed: true }] })).status).toBe(200);
  const previousCount = db.prepare('SELECT COUNT(*) AS count FROM daily_wellness').get();
  db.prepare('DELETE FROM user_area_permissions WHERE user_id = 701').run();
  try {
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS count FROM athletes WHERE name = '撤权虚构新人'").get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM daily_wellness').get()).toEqual(previousCount);
  } finally {
    db.prepare("INSERT INTO user_area_permissions (user_id, area_level, granted_by) VALUES (701, 'national', 701)").run();
  }
});

it('简化模板HTTP下载预填正确，缺日期不可提交，校对后成功写入', async () => {
  const { templateHeaderKey, IMPORT_TEMPLATE_VERSION } = await import('../../shared/import-template-fields.ts');
  for (const kind of ['profile', 'training', 'test', 'unified']) {
    const response = await fetch(`${base}/api/data-import/template?kind=${kind}&project=ROWING`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    expect(workbook.Sheets['填写说明'].B1.v).toBe(IMPORT_TEMPLATE_VERSION);
    if (kind === 'test' || kind === 'unified') {
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
    const dataRow = matrix.findIndex((row, index) => index >= 3 && row[keys.indexOf('系统运动员编号')] === 701);
    expect(dataRow).toBeGreaterThanOrEqual(3);
    expect(matrix[dataRow][keys.indexOf('姓名')]).toBe('虚构队员');
    XLSX.utils.sheet_add_aoa(sheet, [[60]], { origin: { r: dataRow, c: keys.indexOf('时长分钟') } });
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('file', new Blob([new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))]), '简化下载往返.xlsx');
    const analyzed = await request('/analyze', 'POST', form);
    expect(analyzed.status).toBe(200);
    const batch = analyzed.body.batch!;
    expect(batch.errorCount).toBeGreaterThan(0);
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(400);
    const saved = await request(`/batches/${batch.id}/items`, 'PUT', { corrections: [{ id: batch.items[0].id, eventDate: '2026-10-15' }] });
    expect(saved.body.batch!.errorCount).toBe(0);
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(200);
    expect(db.prepare("SELECT duration_min, rpe FROM training_sessions WHERE athlete_id = 701 AND session_date = '2026-10-15'").get()).toEqual({ duration_min: 60, rpe: null });
  }
  expect((await fetch(`${base}/api/data-import/template?kind=training&project=ROWING`)).status).toBe(401);
  expect((await fetch(`${base}/api/data-import/template?kind=training&project=CANOE_SLALOM`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  expect((await fetch(`${base}/api/data-import/template?kind=unified&project=CANOE_SLALOM`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
});

it('统一数据模板预填与分用途模板一致，预填空行不入库且按编号关联已有运动员', async () => {
  const { templateHeaderKey } = await import('../../shared/import-template-fields.ts');
  const download = async (kind: string) => {
    const response = await fetch(`${base}/api/data-import/template?kind=${kind}&project=ROWING`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    return XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
  };
  const rowsOf = (book: ReturnType<typeof XLSX.read>, sheetName: string) =>
    XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1 }) as unknown[][];
  const athleteIdentity = (matrix: unknown[][]) => {
    const keys = matrix[2].map(value => templateHeaderKey(String(value)));
    const index = matrix.findIndex((row, number) => number >= 3 && row[keys.indexOf('系统运动员编号')] === 701);
    expect(index).toBeGreaterThanOrEqual(3);
    const pick = (label: string) => (keys.includes(label) ? matrix[index][keys.indexOf(label)] ?? null : null);
    return { code: pick('系统运动员编号'), name: pick('姓名'), team: pick('所属队伍'), project: pick('运动项目') };
  };
  const unified = await download('unified');
  for (const sheetName of ['运动员基本资料', '身体测量', '体能测试', 'FMS测试', '训练课次', '力量训练组次', '每日恢复', '伤病记录', '竞技评估', '其他测试'])
    expect(athleteIdentity(rowsOf(unified, sheetName)).name, sheetName).toBe('虚构队员');
  expect(athleteIdentity(rowsOf(unified, '运动员基本资料'))).toEqual({ code: 701, name: '虚构队员', team: 'HTTP甲队', project: 'ROWING' });
  expect(athleteIdentity(rowsOf(unified, '运动员基本资料'))).toEqual(athleteIdentity(rowsOf(await download('profile'), '运动员基本资料')));
  expect(athleteIdentity(rowsOf(unified, '训练课次'))).toEqual(athleteIdentity(rowsOf(await download('training'), '训练课次')));

  // 仅有预填人员信息的整份模板不产生空批次
  const blank = new FormData();
  blank.set('project', 'ROWING');
  blank.set('file', new Blob([new Uint8Array(XLSX.write(unified, { type: 'buffer', bookType: 'xlsx' }))]), '统一预填空白.xlsx');
  const rejected = await request('/analyze', 'POST', blank);
  expect(rejected.status).toBe(400);
  expect(rejected.body.message).toContain('未填写业务数据');

  // 只回填一行业务数据：其余预填行不生成空记录，提交后按编号关联已有运动员、不重复建档
  const matrix = rowsOf(unified, '每日恢复');
  const keys = matrix[2].map(value => templateHeaderKey(String(value)));
  const dataRow = matrix.findIndex((row, number) => number >= 3 && row[keys.indexOf('系统运动员编号')] === 701);
  XLSX.utils.sheet_add_aoa(unified.Sheets['每日恢复'], [['2026-10-18']], { origin: { r: dataRow, c: keys.indexOf('日期') } });
  XLSX.utils.sheet_add_aoa(unified.Sheets['每日恢复'], [[7.5]], { origin: { r: dataRow, c: keys.indexOf('睡眠小时') } });
  const form = new FormData();
  form.set('project', 'ROWING');
  form.set('file', new Blob([new Uint8Array(XLSX.write(unified, { type: 'buffer', bookType: 'xlsx' }))]), '统一预填往返.xlsx');
  const analyzed = await request('/analyze', 'POST', form);
  expect(analyzed.status).toBe(200);
  const batch = analyzed.body.batch!;
  expect(batch.items).toHaveLength(1);
  expect(batch.items[0].itemType).toBe('wellness');
  expect(batch.items[0].athleteId).toBe(701);
  const athleteCount = (db.prepare('SELECT COUNT(*) AS count FROM athletes').get() as { count: number }).count;
  const result = await request(`/batches/${batch.id}/commit`, 'POST', {});
  expect(result.status).toBe(200);
  expect(result.body.createdAthletes).toBe(0);
  expect(result.body.createdRecords).toBe(1);
  expect((db.prepare('SELECT COUNT(*) AS count FROM athletes').get() as { count: number }).count).toBe(athleteCount);
  expect(db.prepare("SELECT sleep_hours FROM daily_wellness WHERE athlete_id = 701 AND wellness_date = '2026-10-18'").get()).toEqual({ sleep_hours: 7.5 });
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
  expect(db.prepare("SELECT COUNT(*) AS count FROM daily_wellness WHERE wellness_date='2026-11-11'").get()).toEqual({ count: 0 });
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
  db.exec("CREATE TRIGGER p0_revoke_in_transaction AFTER INSERT ON daily_wellness WHEN NEW.wellness_date='2026-11-14' BEGIN DELETE FROM user_area_permissions WHERE user_id=701; END");
  try {
    expect((await request(`/batches/${batch.id}/commit`, 'POST', {})).status).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS count FROM daily_wellness WHERE wellness_date='2026-11-14'").get()).toEqual({ count: 0 });
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

it('P0 HTTP：旧草稿没有权限快照时，待建档人员也按当前地域范围保护', async () => {
  const batch = await upload([['姓名', '所属队伍', '日期', '睡眠小时'], ['旧草稿虚构新人', 'HTTP甲队', '2026-11-16', 8]], '每日恢复');
  db.prepare("UPDATE data_import_batches SET summary_json=json_remove(summary_json,'$.accessTeams','$.revision') WHERE id=?").run(batch.id);
  expect((await request(`/batches/${batch.id}`)).body.batch!.revision).toBe(0);
  db.prepare("UPDATE user_area_permissions SET area_level='province',province='广东' WHERE user_id=701").run();
  try {
    const result = await request(`/batches/${batch.id}/errors`);
    expect(result.status).toBe(403);
    expect(JSON.stringify(result.body)).not.toContain('旧草稿虚构新人');
  } finally { db.prepare("UPDATE user_area_permissions SET area_level='national',province='' WHERE user_id=701").run(); }
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
