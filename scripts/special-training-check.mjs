import { DatabaseSync } from 'node:sqlite';
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
  const athlete = athletesResult.payload.athletes.find((item) => item.project === 'ROWING');
  assert(athlete, '未找到赛艇运动员');

  const initial = await request('/api/records?from=2020-01-01&to=2100-12-31&project=ROWING', {}, token);
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
  const afterRollback = await request(`/api/records?from=2026-08-27&to=2026-08-27&athleteId=${athlete.id}&project=ROWING`, {}, token);
  assert(!afterRollback.payload.records.some((item) => item.content === rollbackContent), '批量录入失败后没有完整回滚');

  const saved = await request('/api/special-training/sessions', { method: 'POST', body: JSON.stringify({ sessions: [baseRow] }) }, token);
  assert(saved.status === 201 && saved.payload.imported === 1, '有效专项训练记录保存失败');
  const persisted = await request(`/api/records?from=2026-08-27&to=2026-08-27&athleteId=${athlete.id}&project=ROWING`, {}, token);
  const record = persisted.payload.records.find((item) => item.content === baseRow.content);
  assert(record?.averageHeartRate === 147 && record?.maxHeartRate === 182 && record?.averagePowerW === 366 && record?.strokeRateSpm === 31, '专项指标没有按原值持久化');

  const dashboardUrl = `/api/special-training/overview?from=2026-08-27&to=2026-08-27&project=${encodeURIComponent(athlete.project)}`;
  const dashboard = await request(`${dashboardUrl}&athleteId=${athlete.id}`, {}, token);
  assert(dashboard.status === 200 && dashboard.payload.training.summary.sessionCount === 1, `专项首页未排除演示课次或未正确下钻个人：${dashboard.status} ${JSON.stringify(dashboard.payload.training?.summary || dashboard.payload.message)}`);
  assert(dashboard.payload.training.summary.durationMin === 88 && dashboard.payload.training.summary.distanceKm === 17.4, '专项首页训练时长/距离与真实记录不一致');
  assert(dashboard.payload.training.summary.load === 528, '专项首页没有沿用已有SRPE');
  assert(dashboard.payload.training.content.reduce((sum, row) => sum + row.count, 0) === 1, '专项内容课次统计错误');
  const teammate = athletesResult.payload.athletes.find((item) => item.id !== athlete.id && item.project === athlete.project && item.team === athlete.team);
  assert(teammate, '缺少同队课次去重回归人员');
  // 独立测试库显式建立同队关系，避免依赖旧初始化数据的项目名称映射。
  const fixtureDb = new DatabaseSync(databasePath);
  const createdTeam = fixtureDb.prepare('INSERT INTO project_teams (project, name) VALUES (?, ?)').run(athlete.project, '专项回归队伍');
  const team = { id: Number(createdTeam.lastInsertRowid) };
  fixtureDb.prepare('UPDATE athletes SET team_id = ? WHERE id IN (?, ?)').run(team.id, athlete.id, teammate.id);
  fixtureDb.close();
  const teammateSaved = await request('/api/special-training/sessions', { method: 'POST', body: JSON.stringify({ sessions: [{ ...baseRow, athleteId: teammate.id }] }) }, token);
  assert(teammateSaved.status === 201, '同队课次回归记录写入失败');
  const teamDashboard = await request(`${dashboardUrl}&teamId=${team.id}`, {}, token);
  assert(teamDashboard.status === 200 && teamDashboard.payload.training.summary.sessionCount === 1, '团队共同课次被重复统计');
  assert(teamDashboard.payload.training.summary.durationMin === 88 && teamDashboard.payload.training.summary.load === 528, '团队时长或既有负荷去重错误');
  const missing = await request(`/api/special-training/overview?from=2099-01-01&to=2099-01-02&project=${encodeURIComponent(athlete.project)}`, {}, token);
  assert(missing.payload.training.summary.durationMin === null && missing.payload.training.days.length === 0, '空周期生成了模拟数据');
  const wrongProject = await request(`/api/special-training/overview?from=2026-08-27&to=2026-08-27&project=${encodeURIComponent('CANOE_SLALOM')}&athleteId=${athlete.id}`, {}, token);
  assert(wrongProject.status === 403, '专项首页未隔离不同项目运动员');
  const unknownTeam = await request(`${dashboardUrl}&teamId=99999999`, {}, token);
  assert(unknownTeam.status === 403, '专项首页未拒绝无权队伍');
  const anonymous = await request(dashboardUrl);
  assert(anonymous.status === 401, '专项首页允许匿名读取');
  const badRange = await request(`/api/special-training/overview?from=2026-09-01&to=2026-08-01&project=${encodeURIComponent(athlete.project)}`, {}, token);
  assert(badRange.status === 400, '专项首页未校验日期范围');

  console.log(JSON.stringify({ seededRecords: initial.payload.records.length, persistedSessionId: record.id, validation: 'ok', transactionRollback: 'ok' }, null, 2));
} finally {
  server.kill();
  await new Promise((resolveExit) => server.once('exit', resolveExit));
  for (const target of cleanupTargets) {
    if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
  }
}
