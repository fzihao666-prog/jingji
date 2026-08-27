import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const databasePath = resolve(root, 'data', 'special-training-check.db');
const port = 8794;
const base = `http://127.0.0.1:${port}`;
const cleanupTargets = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
for (const target of cleanupTargets) {
  if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
}

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverError = '';
server.stderr.on('data', (chunk) => { serverError += chunk.toString(); });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function request(path, options = {}, token) {
  const headers = new Headers(options.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin01', password: 'demo123' }) });
      if (result.status === 200) return result.payload.token;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`测试服务器未能启动。${serverError}`);
}

try {
  const token = await waitForServer();
  const athletesResult = await request('/api/athletes', {}, token);
  const athlete = athletesResult.payload.athletes.find((item) => item.project === '赛艇');
  assert(athlete, '未找到赛艇运动员');

  const initial = await request('/api/records?from=2020-01-01&to=2100-12-31&project=%E8%B5%9B%E8%89%87', {}, token);
  assert(initial.status === 200 && initial.payload.records.length > 0, '专项训练基础记录为空');
  assert(initial.payload.records.some((item) => item.averageHeartRate && item.averagePowerW && item.strokeRateSpm), '数据库专项指标不完整');

  const baseRow = {
    athleteId: athlete.id, project: athlete.project, date: '2026-08-27', type: '技术训练', content: '专项训练接口回归记录',
    duration: 88, distance: 17.4, rpe: 6, strokeRate: 31, heartRate: 147, maxHeartRate: 182, power: 366, source: 'manual'
  };
  const invalidDate = await request('/api/special-training/sessions', { method: 'POST', body: JSON.stringify({ sessions: [{ ...baseRow, date: '2026-99-99' }] }) }, token);
  assert(invalidDate.status === 400, '无效自然日期未被拒绝');
  const invalidHeartRate = await request('/api/special-training/sessions', { method: 'POST', body: JSON.stringify({ sessions: [{ ...baseRow, maxHeartRate: 120 }] }) }, token);
  assert(invalidHeartRate.status === 400, '最大心率低于平均心率时未被拒绝');

  const rollbackContent = '专项训练事务回滚记录';
  const rollback = await request('/api/special-training/sessions', { method: 'POST', body: JSON.stringify({ sessions: [{ ...baseRow, content: rollbackContent }, { ...baseRow, rpe: 12 }] }) }, token);
  assert(rollback.status === 400, '批量录入中的异常记录未使请求失败');
  const afterRollback = await request(`/api/records?from=2026-08-27&to=2026-08-27&athleteId=${athlete.id}&project=%E8%B5%9B%E8%89%87`, {}, token);
  assert(!afterRollback.payload.records.some((item) => item.content === rollbackContent), '批量录入失败后没有完整回滚');

  const saved = await request('/api/special-training/sessions', { method: 'POST', body: JSON.stringify({ sessions: [baseRow] }) }, token);
  assert(saved.status === 201 && saved.payload.imported === 1, '有效专项训练记录保存失败');
  const persisted = await request(`/api/records?from=2026-08-27&to=2026-08-27&athleteId=${athlete.id}&project=%E8%B5%9B%E8%89%87`, {}, token);
  const record = persisted.payload.records.find((item) => item.content === baseRow.content);
  assert(record?.averageHeartRate === 147 && record?.maxHeartRate === 182 && record?.averagePowerW === 366 && record?.strokeRateSpm === 31, '专项指标没有按原值持久化');

  console.log(JSON.stringify({ seededRecords: initial.payload.records.length, persistedSessionId: record.id, validation: 'ok', transactionRollback: 'ok' }, null, 2));
} finally {
  server.kill();
  await new Promise((resolveExit) => server.once('exit', resolveExit));
  for (const target of cleanupTargets) {
    if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
  }
}
