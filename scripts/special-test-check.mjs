import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const root = process.cwd();
const databasePath = resolve(root, 'data', 'special-test-check.db');
const port = 8793;
const base = `http://127.0.0.1:${port}`;
for (const target of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) if (existsSync(target)) rmSync(target);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = '';
server.stderr.on('data', (chunk) => { serverError += chunk.toString(); });
const assert = (value, message) => { if (!value) throw new Error(message); };

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin01', password: 'demo123' }) })).ok) return; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
  throw new Error(`server failed: ${serverError}`);
}

async function json(path, options = {}, token) {
  const headers = new Headers(options.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function filledTemplate(athletes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(root, 'public', 'templates', '竞迹训练数据导入模板.xlsx'));
  const fill = (sheetName, valuesByHeader, rowNumber) => {
    const sheet = workbook.getWorksheet(sheetName);
    const headers = new Map();
    sheet.getRow(6).eachCell((cell, columnNumber) => headers.set(cell.text.trim(), columnNumber));
    for (const [header, value] of Object.entries(valuesByHeader)) sheet.getCell(rowNumber, headers.get(header)).value = value;
  };
  fill('专项测试成绩', { '测试日期': '2026-07-28', '测试距离(m)': 250, '艇型': '单人艇', '性别组别': '男子组', '运动员/组合': athletes[0].name, '运动员姓名': athletes[0].name, '上午/下午': '下午', '风向风速': '顶风1级', '测试地点': '训练基地', '历史最好': '0:58.00', '第1轮': '0:57.15', '第2轮': '0:56.68' }, 7);
  fill('专项测试成绩', { '测试日期': '2026-07-28', '测试距离(m)': 250, '艇型': '单人艇', '性别组别': '男子组', '运动员/组合': athletes[1].name, '运动员姓名': athletes[1].name, '上午/下午': '下午', '风向风速': '顶风1级', '测试地点': '训练基地', '历史最好': '1:02.00', '第1轮': '0:59.79', '第2轮': '0:59.03' }, 8);
  fill('每日训练数据', { '日期': '2026-07-29', '运动员': athletes[0].name, '水上U3(km)': 6, '水上U3时间(min)': 30, 'RPE': 5 }, 7);
  return workbook.xlsx.writeBuffer();
}

try {
  await waitForServer();
  const login = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin01', password: 'demo123' }) });
  assert(login.status === 200, 'admin login failed');
  const token = login.payload.token;
  const athletes = (await json('/api/athletes', {}, token)).payload.athletes;
  assert(athletes.length >= 2, 'seed athletes missing');
  const [first, second] = athletes;

  const templateBuffer = await filledTemplate([first, second]);
  const specialFile = new File([templateBuffer], '竞迹训练数据导入模板.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const specialForm = new FormData(); specialForm.append('file', specialFile);
  const preview = await json('/api/special-tests/import/preview', { method: 'POST', body: specialForm }, token);
  assert(preview.status === 200 && preview.payload.valid === 2 && preview.payload.invalid === 0, `special preview failed: ${JSON.stringify(preview.payload)}`);
  const commit = await json('/api/special-tests/import/commit', { method: 'POST', body: JSON.stringify({ importId: preview.payload.importId }) }, token);
  assert(commit.status === 200 && commit.payload.imported === 2, `special commit failed: ${JSON.stringify(commit.payload)}`);
  const events = await json('/api/special-tests?from=2026-07-01&to=2026-07-31', {}, token);
  assert(events.status === 200 && events.payload.events.length === 1, 'special query failed');
  assert(events.payload.events[0].results[0].rank === 1 && events.payload.events[0].results[0].bestMs === 56680, 'ranking or time conversion failed');

  const dailyFile = new File([templateBuffer], '竞迹训练数据导入模板.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const dailyForm = new FormData(); dailyForm.append('file', dailyFile);
  const dailyPreview = await json('/api/import/preview', { method: 'POST', body: dailyForm }, token);
  assert(dailyPreview.status === 200 && dailyPreview.payload.valid === 1, `daily preview failed: ${JSON.stringify(dailyPreview.payload)}`);
  assert(dailyPreview.payload.rows[0].trainingBreakdown.waterTimeByZone.U3 === 30 && dailyPreview.payload.rows[0].durationMin === 30, 'water zone time aggregation failed');
  console.log(JSON.stringify({ specialEvents: events.payload.events.length, rankedResults: events.payload.events[0].results.length, waterU3Minutes: 30, status: 'ok' }, null, 2));
} finally {
  server.kill();
  await new Promise((resolveExit) => server.once('exit', resolveExit));
  for (const target of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) if (existsSync(target)) rmSync(target);
}
