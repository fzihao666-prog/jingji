import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const root = process.cwd();
const databasePath = resolve(root, 'data', 'strength-training-check.db');
const cleanupTargets = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
const port = 8792;
const base = `http://127.0.0.1:${port}`;
for (const target of cleanupTargets) if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverError = '';
server.stderr.on('data', (chunk) => { serverError += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin01', password: 'demo123' }) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`测试服务器未启动：${serverError}`);
}

async function jsonRequest(path, options = {}, token = '') {
  const headers = new Headers(options.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status}: ${payload.message || JSON.stringify(payload)}`);
  return payload;
}

async function previewWorkbook(token, athlete) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('体能训练结果');
  sheet.addRow(['训练日期', '运动员', '队伍', '训练场次', '训练类型', '身体位置', '训练环境', '动作', '组次', '计划次数', '实际次数', '计划重量kg', '实际重量kg', '强度%', '强度区间', '训练时间min', '训练距离km', 'RPE', '是否完成', '备注']);
  sheet.addRow(['2026-08-24', athlete.name, athlete.team, '自动化验证场次', '基础力量', '上肢', '场馆', '卧推', 1, 8, 8, 57.5, 60, 82, 'AN', 12, 0, 7.5, '是', '验证导入']);
  sheet.addRow(['2026-08-24', athlete.name, athlete.team, '自动化验证场次', '基础力量', '上肢', '场馆', '卧推', 2, 8, 7, 57.5, 60, 82, 'AN', 0, 0, 8, '是', '验证导入']);
  const buffer = await workbook.xlsx.writeBuffer();
  const body = new FormData();
  body.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '体能训练结果验证.xlsx');
  return jsonRequest('/api/strength-training/import/preview', { method: 'POST', body }, token);
}

try {
  await waitForServer();
  const login = await jsonRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin01', password: 'demo123' }) });
  const token = login.token;
  const athleteResponse = await jsonRequest('/api/athletes', {}, token);
  const athlete = athleteResponse.athletes[0];
  if (!athlete) throw new Error('测试库没有运动员。');

  const firstPreview = await previewWorkbook(token, athlete);
  if (firstPreview.total !== 2 || firstPreview.valid !== 2 || firstPreview.invalid !== 0) throw new Error(`首次预览错误：${JSON.stringify(firstPreview)}`);
  const firstCommit = await jsonRequest('/api/strength-training/import/commit', { method: 'POST', body: JSON.stringify({ token: firstPreview.token, rows: firstPreview.rows, conflictPolicy: 'skip' }) }, token);
  if (firstCommit.imported !== 2 || firstCommit.sessions !== 1) throw new Error(`首次提交错误：${JSON.stringify(firstCommit)}`);

  const secondPreview = await previewWorkbook(token, athlete);
  if (secondPreview.duplicate !== 2) throw new Error(`重复检测错误：${JSON.stringify(secondPreview)}`);
  const secondCommit = await jsonRequest('/api/strength-training/import/commit', { method: 'POST', body: JSON.stringify({ token: secondPreview.token, rows: secondPreview.rows, conflictPolicy: 'new' }) }, token);
  if (secondCommit.imported !== 2 || secondCommit.sessions !== 1) throw new Error(`另存场次错误：${JSON.stringify(secondCommit)}`);

  const results = await jsonRequest(`/api/strength-training/results?athleteId=${athlete.id}`, {}, token);
  const importedSessions = results.sessions.filter((session) => session.trainingDate === '2026-08-24' && session.sessionLabel === '自动化验证场次');
  if (importedSessions.length !== 2 || importedSessions.some((session) => session.sets.length !== 2)) throw new Error(`结果持久化错误：${JSON.stringify(importedSessions)}`);
  if (new Set(importedSessions.map((session) => session.sessionOrder)).size !== 2) throw new Error('同日多场训练的场次序号发生覆盖。');
  if (importedSessions.some((session) => session.durationMin !== 12 || session.srpe <= 0 || session.sets.some((set) => set.trainingCategory !== '基础力量' || set.bodyPosition !== '上肢' || set.trainingEnvironment !== '场馆' || set.plannedWeightKg !== 57.5 || set.intensityPercent !== 82 || set.intensityZone !== 'AN'))) {
    throw new Error(`扩展体能字段持久化错误：${JSON.stringify(importedSessions)}`);
  }

  console.log(JSON.stringify({ preview: 'passed', persistence: 'passed', duplicateDetection: 'passed', sameDayMultipleSessions: 'passed', sessions: importedSessions.length, rows: importedSessions.reduce((sum, session) => sum + session.sets.length, 0) }, null, 2));
} finally {
  server.kill('SIGTERM');
  await new Promise((resolveWait) => server.once('exit', resolveWait));
  for (const target of cleanupTargets) if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
}
