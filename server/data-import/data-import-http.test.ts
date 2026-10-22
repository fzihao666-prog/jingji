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
  const response = await fetch(`${base}/api/data-import${path}`, {
    method, headers: { authorization: `Bearer ${auth}`, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json() as { batch?: DataImportPreview; message?: string; createdRecords?: number; createdAthletes?: number };
  return { status: response.status, body: payload };
}

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
