import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const root = process.cwd();
const databasePath = resolve(root, 'data', 'project-isolation-check.db');
const port = 8796;
const base = `http://127.0.0.1:${port}`;
const cleanup = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
for (const path of cleanup) if (existsSync(path)) rmSync(path);

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverError = '';
server.stderr.on('data', (chunk) => { serverError += chunk.toString(); });
const assert = (value, message) => { if (!value) throw new Error(message); };

async function request(path, options = {}, token) {
  const headers = new Headers(options.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...options, headers });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin01', password: 'demo123' })
      });
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 120));
  }
  throw new Error(`server failed: ${serverError}`);
}

async function specialWorkbook(project, athleteName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('专项训练成绩');
  sheet.addRow(['训练日期', '项目', '训练距离(m)', '艇型', '性别组别', '运动员/组合', '运动员姓名', '上午/下午', '第1轮', '第2轮']);
  sheet.addRow(['2026-07-28', project, 250, '单人艇', '公开组', athleteName, athleteName, '下午', '0:58.20', '0:57.80']);
  return workbook.xlsx.writeBuffer();
}

async function previewSpecial(project, athleteName, token) {
  const bytes = await specialWorkbook(project, athleteName);
  const body = new FormData();
  body.append('project', project);
  body.append('file', new Blob([bytes]), `${project}-专项训练.xlsx`);
  return request('/api/special-tests/import/preview', { method: 'POST', body }, token);
}

try {
  await waitForServer();
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin01', password: 'demo123' }) });
  const token = login.payload.token;
  const athletes = (await request('/api/athletes', {}, token)).payload.athletes;
  const rowingAthlete = athletes.find((athlete) => athlete.project === '赛艇');
  const canoeAthlete = athletes.find((athlete) => athlete.project === '皮划艇');
  assert(rowingAthlete && canoeAthlete, 'seed data must include both projects');

  const missingProject = await request('/api/records?from=2026-07-01&to=2026-07-31', {}, token);
  const rowingRecords = await request('/api/records?from=2026-07-01&to=2026-07-31&project=赛艇', {}, token);
  const canoeRecords = await request('/api/records?from=2026-07-01&to=2026-07-31&project=皮划艇', {}, token);
  assert(missingProject.status === 400, 'records endpoint accepted a request without project');
  assert(rowingRecords.payload.records.every((row) => row.project === '赛艇'), 'rowing records leaked canoe data');
  assert(canoeRecords.payload.records.every((row) => row.project === '皮划艇'), 'canoe records leaked rowing data');

  const rowingModel = await request('/api/analysis/model?project=赛艇', {}, token);
  const canoeModel = await request('/api/analysis/model?project=皮划艇', {}, token);
  assert(rowingModel.payload.standard.version.includes('ROW'), 'rowing model is not independent');
  assert(canoeModel.payload.standard.version.includes('CAN'), 'canoe model is not independent');

  const wrongLane = new FormData();
  wrongLane.append('project', '皮划艇');
  wrongLane.append('file', new Blob([await specialWorkbook('赛艇', rowingAthlete.name)]), 'wrong-lane.xlsx');
  const wrongPreview = await request('/api/special-tests/import/preview', { method: 'POST', body: wrongLane }, token);
  assert(wrongPreview.status === 200 && wrongPreview.payload.invalid === 1, 'cross-project special test import was not rejected');

  for (const [project, athlete] of [['赛艇', rowingAthlete], ['皮划艇', canoeAthlete]]) {
    const preview = await previewSpecial(project, athlete.name, token);
    assert(preview.status === 200 && preview.payload.valid === 1, `${project} special preview failed`);
    const commit = await request('/api/special-tests/import/commit', { method: 'POST', body: JSON.stringify({ importId: preview.payload.importId }) }, token);
    assert(commit.status === 200 && commit.payload.events === 1, `${project} special commit failed`);
  }
  const rowingEvents = await request('/api/special-tests?from=2026-07-01&to=2026-07-31&project=赛艇', {}, token);
  const canoeEvents = await request('/api/special-tests?from=2026-07-01&to=2026-07-31&project=皮划艇', {}, token);
  assert(rowingEvents.payload.events.length === 1 && rowingEvents.payload.events[0].project === '赛艇', 'rowing special events leaked');
  assert(canoeEvents.payload.events.length === 1 && canoeEvents.payload.events[0].project === '皮划艇', 'canoe special events leaked');

  console.log(JSON.stringify({
    records: { rowing: rowingRecords.payload.records.length, canoe: canoeRecords.payload.records.length },
    models: [rowingModel.payload.standard.version, canoeModel.payload.standard.version],
    specialEvents: { rowing: rowingEvents.payload.events.length, canoe: canoeEvents.payload.events.length },
    crossProjectImport: 'rejected',
    status: 'passed'
  }, null, 2));
} finally {
  server.kill();
  await new Promise((done) => setTimeout(done, 250));
  for (const path of cleanup) if (existsSync(path)) rmSync(path);
}
