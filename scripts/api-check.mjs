import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const root = process.cwd();
const databasePath = resolve(root, 'data', 'api-check.db');
const port = 8791;
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

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin01', password: 'demo123' })
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`测试服务器未能启动。${serverError ? `\n${serverError}` : ''}`);
}

async function request(path, options = {}, token) {
  const headers = new Headers(options.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForServer();
  const adminLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin01', password: 'demo123' }) });
  const adminToken = adminLogin.payload.token;
  assert(adminLogin.status === 200 && adminToken && adminLogin.payload.user.role === 'DMD', '数据监控总监登录或角色迁移失败');

  const adminAthletesForAnalysis = await request('/api/athletes', {}, adminToken);
  const analysisAthlete = adminAthletesForAnalysis.payload.athletes[0];
  const modelResult = await request(`/api/analysis/model?project=${encodeURIComponent(analysisAthlete.project)}`, {}, adminToken);
  const analysisResult = await request(
    `/api/analysis/summary?from=2026-06-01&to=2026-12-31&athleteId=${analysisAthlete.id}&project=${encodeURIComponent(analysisAthlete.project)}`,
    {},
    adminToken
  );
  assert(
    modelResult.status === 200
      && modelResult.payload.standard.version === 'GJ-ROW-2026.07-R1'
      && analysisResult.status === 200
      && analysisResult.payload.analysis.status.label
      && analysisResult.payload.standard.missingDataRule.includes('未测试'),
    '赛艇分析标准或个人分析接口失败'
  );

  const strengthAthlete = adminAthletesForAnalysis.payload.athletes.find((item) => item.name === '林舟');
  const strengthSeed = await request(`/api/strength-tests?athleteId=${strengthAthlete.id}`, {}, adminToken);
  assert(
    strengthSeed.status === 200
      && strengthSeed.payload.tests.some((test) => test.metrics.benchPullKg === 65),
    '力量测试示例或读取接口失败'
  );
  const demoCoachLogin = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username: 'coach01', password: 'demo123' })
  });
  const demoCoachAthletes = await request('/api/athletes', {}, demoCoachLogin.payload.token);
  const coachAthlete = demoCoachAthletes.payload.athletes[0];
  const saveStrength = await request('/api/strength-tests', {
    method: 'POST',
    body: JSON.stringify({
      athleteId: coachAthlete.id,
      testDate: '2026-07-26',
      metrics: { weightKg: 58.6, benchPullKg: 67, squatKg: 112, leftPlankSec: 160, rightPlankSec: 170 },
      targets: { benchPullKg: 70, squatKg: 115, leftPlankSec: 180, rightPlankSec: 180 },
      notes: '接口测试'
    })
  }, demoCoachLogin.payload.token);
  const updatedStrength = await request(`/api/strength-tests?athleteId=${coachAthlete.id}`, {}, demoCoachLogin.payload.token);
  assert(
    saveStrength.status === 200
      && updatedStrength.payload.tests[0].testDate === '2026-07-26'
      && updatedStrength.payload.tests[0].metrics.squatKg === 112,
    '教练保存力量测试失败'
  );
  const demoAthleteLogin = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username: 'athlete01', password: 'demo123' })
  });
  const ownStrength = await request(`/api/strength-tests?athleteId=${demoAthleteLogin.payload.user.athleteId}`, {}, demoAthleteLogin.payload.token);
  const forbiddenStrengthWrite = await request('/api/strength-tests', {
    method: 'POST',
    body: JSON.stringify({
      athleteId: demoAthleteLogin.payload.user.athleteId,
      testDate: '2026-07-27',
      metrics: { squatKg: 120 },
      targets: { squatKg: 125 },
      notes: ''
    })
  }, demoAthleteLogin.payload.token);
  assert(
    ownStrength.status === 200 && ownStrength.payload.tests.length >= 1 && forbiddenStrengthWrite.status === 403,
    '运动员力量档案只读权限失败'
  );

  const templateResponse = await fetch(`${base}/api/import/template`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const templateBytes = await templateResponse.arrayBuffer();
  assert(
    templateResponse.status === 200,
    `Excel模板下载失败：HTTP ${templateResponse.status} ${new TextDecoder().decode(templateBytes)}`
  );
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(templateBytes);
  const templateHeaders = templateWorkbook.worksheets[0]?.getRow(6).values || [];
  assert(
    templateWorkbook.worksheets.length === 3 && templateHeaders.includes('项目'),
    'Excel模板生成失败'
  );

  const importWorkbook = new ExcelJS.Workbook();
  importWorkbook.addWorksheet('填写说明').addRow(['这张表不是数据表，导入程序应继续查找。']);
  const importSheet = importWorkbook.addWorksheet('训练数据导入');
  importSheet.addRow([
    '日期', '运动员', '水上训练时长(min)', '测功仪训练时长(min)', '力量耐力(min)', '拉伸再生(min)',
    '水上U2(km)', '测功仪U2(km)', 'RPE', '训练状态'
  ]);
  importSheet.addRow(['2026-07-30', '林舟', 90, 30, 45, 20, 12, 6, 6, '正常']);
  const importBytes = await importWorkbook.xlsx.writeBuffer();
  const importForm = new FormData();
  importForm.append('project', '赛艇');
  importForm.append(
    'file',
    new Blob([importBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'regional-check.xlsx'
  );
  const importPreview = await request('/api/import/preview', { method: 'POST', body: importForm }, adminToken);
  const previewRow = importPreview.payload.rows?.[0];
  assert(
    importPreview.status === 200
      && importPreview.payload.valid === 1
      && previewRow.durationMin === 185
      && previewRow.distanceKm === 18
      && previewRow.trainingBreakdown.waterMinutes === 90
      && previewRow.trainingBreakdown.landMinutes.endurance === 45,
    'Excel多工作表查找、分项训练解析或自动汇总失败'
  );
  const importCommit = await request('/api/import/commit', {
    method: 'POST', body: JSON.stringify({ importId: importPreview.payload.importId })
  }, adminToken);
  const importedRecords = await request('/api/records?from=2026-07-30&to=2026-07-30&project=赛艇', {}, adminToken);
  const importedRow = importedRecords.payload.records?.find((item) => item.athleteName === '林舟');
  assert(
    importCommit.status === 200
      && importedRow?.trainingBreakdown.waterDistanceByZone.U2 === 12
      && importedRow?.trainingBreakdown.ergDistanceByZone.U2 === 6,
    'Excel分项数据入库或周期报告数据读取失败'
  );

  const invalidRole = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    username: 'regional_public', password: 'Secure123', displayName: '测试区域', role: 'regional'
  }) });
  assert(invalidRole.status === 400, '公开注册不应允许区域管理人角色');

  const regionalLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({
    username: 'regional01', password: 'demo123'
  }) });
  assert(regionalLogin.status === 200, '区域管理人登录失败');
  const regionalToken = regionalLogin.payload.token;
  const initialRegionalAthletes = await request('/api/athletes', {}, regionalToken);
  const regionalTemplate = await fetch(`${base}/api/import/template`, { headers: { authorization: `Bearer ${regionalToken}` } });
  assert(
    initialRegionalAthletes.status === 200
      && initialRegionalAthletes.payload.athletes.length === 2
      && initialRegionalAthletes.payload.athletes.every((item) => item.region === '四川')
      && regionalTemplate.status === 200,
    '区域负责人的初始地区或数据录入权限错误'
  );

  const executiveLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({
    username: 'executive01', password: 'demo123'
  }) });
  const executiveToken = executiveLogin.payload.token;
  assert(executiveLogin.status === 200 && executiveToken, '高层管理人登录失败');
  const managerResult = await request('/api/access/accounts', {}, executiveToken);
  const demoManager = managerResult.payload.accounts.find((item) => item.username === 'regional01');
  assert(
    managerResult.status === 200
      && managerResult.payload.current.role === 'TD'
      && demoManager?.role === 'REG'
      && demoManager.accountCode.includes('-REG-'),
    '训练总监无法读取区域负责人或账号编码错误'
  );
  const renameManager = await request(`/api/users/${demoManager.id}/name`, {
    method: 'PUT', body: JSON.stringify({ name: '四川区域负责人' })
  }, executiveToken);
  const renamedRegionalProfile = await request('/api/me', {}, regionalToken);
  assert(
    renameManager.status === 200 && renamedRegionalProfile.payload.user.displayName === '四川区域负责人',
    '高层管理人修改区域管理人姓名失败'
  );
  const grantResult = await request(`/api/access/accounts/${demoManager.id}`, {
    method: 'PUT', body: JSON.stringify({
      role: 'REG',
      parentUserId: managerResult.payload.current.id,
      areas: [
        { areaLevel: 'province', province: '四川', city: '', county: '' },
        { areaLevel: 'province', province: '浙江', city: '', county: '' }
      ],
      projects: ['*'],
      teams: [{ project: '*', team: '*' }]
    })
  }, executiveToken);
  assert(grantResult.status === 200, '高层管理人无法追加地区授权');
  const expandedRegionalAthletes = await request('/api/athletes', {}, regionalToken);
  assert(
    expandedRegionalAthletes.payload.athletes.length === 4
      && expandedRegionalAthletes.payload.athletes.every((item) => ['四川', '浙江'].includes(item.region)),
    '区域权限更新后数据范围未同步'
  );

  const adminAccess = await request('/api/access/accounts', {}, adminToken);
  const directorAccount = adminAccess.payload.accounts.find((item) => item.username === 'executive01');
  const createRegional = await request('/api/access/accounts', {
    method: 'POST',
    body: JSON.stringify({
      username: 'regional_test',
      password: 'Secure123',
      displayName: '华南区域负责人',
      role: 'REG',
      parentUserId: directorAccount.id,
      areas: [{ areaLevel: 'province', province: '广东', city: '', county: '' }],
      projects: ['*'],
      teams: [{ project: '*', team: '*' }]
    })
  }, adminToken);
  assert(createRegional.status === 201, '超级管理员创建区域管理人失败');
  const createdRegionalLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({
    username: 'regional_test', password: 'Secure123'
  }) });
  const createdRegionalAthletes = await request('/api/athletes', {}, createdRegionalLogin.payload.token);
  assert(
    createdRegionalLogin.status === 200
      && createdRegionalLogin.payload.user.role === 'REG'
      && createdRegionalAthletes.payload.athletes.length === 2
      && createdRegionalAthletes.payload.athletes.every((item) => item.region === '广东'),
    '新建区域管理人的初始权限错误'
  );
  const forbiddenCrossLevel = await request(`/api/access/accounts/${directorAccount.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      role: 'TD',
      parentUserId: adminAccess.payload.current.id,
      areas: [{ areaLevel: 'national', province: '', city: '', county: '' }],
      projects: ['*'],
      teams: [{ project: '*', team: '*' }]
    })
  }, createdRegionalLogin.payload.token);
  assert(forbiddenCrossLevel.status === 404, '区域负责人不应能管理训练总监');

  const athleteRegister = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    username: 'athlete_test', password: 'Secure123', displayName: '测试运动员', role: 'ATL',
    project: '赛艇', team: '测试组', gender: '女', region: '四川', city: '成都市', county: '武侯区'
  }) });
  assert(athleteRegister.status === 201, '运动员注册申请失败');

  const pendingLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'athlete_test', password: 'Secure123' }) });
  assert(pendingLogin.status === 403, '待审核账户不应登录');

  const pending = await request('/api/admin/registrations?status=pending', {}, adminToken);
  const athleteRequest = pending.payload.requests.find((item) => item.username === 'athlete_test');
  assert(pending.status === 200 && athleteRequest, '管理员未看到注册申请');
  const renameRequest = await request(`/api/admin/registrations/${athleteRequest.id}/name`, {
    method: 'PUT', body: JSON.stringify({ name: '测试运动员修订' })
  }, adminToken);
  assert(renameRequest.status === 200, '管理员修改注册姓名失败');
  const approveAthlete = await request(`/api/admin/registrations/${athleteRequest.id}/approve`, { method: 'POST' }, adminToken);
  assert(approveAthlete.status === 200, '运动员审核失败');

  const athleteLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'athlete_test', password: 'Secure123' }) });
  assert(athleteLogin.status === 200, '获批运动员无法登录');
  const athleteToken = athleteLogin.payload.token;
  const athleteList = await request('/api/athletes', {}, athleteToken);
  const athleteTemplate = await fetch(`${base}/api/import/template`, { headers: { authorization: `Bearer ${athleteToken}` } });
  assert(
    athleteLogin.payload.user.displayName === '测试运动员修订'
      && athleteList.payload.athletes.length === 1
      && athleteList.payload.athletes[0].name === '测试运动员修订'
      && athleteTemplate.status === 403,
    '注册姓名修改或运动员权限范围错误'
  );
  const renameOwnAthlete = await request('/api/profile/name', {
    method: 'PUT', body: JSON.stringify({ name: '测试运动员本人' })
  }, athleteToken);
  const renamedOwnAthleteList = await request('/api/athletes', {}, athleteToken);
  assert(
    renameOwnAthlete.status === 200
      && renameOwnAthlete.payload.user.displayName === '测试运动员本人'
      && renamedOwnAthleteList.payload.athletes[0].name === '测试运动员本人',
    '运动员本人改名未同步档案'
  );

  const coachRegister = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    username: 'coach_test', password: 'Secure123', displayName: '测试教练', role: 'SCC',
    project: '赛艇', team: '测试组', region: '四川', city: '成都市', county: '武侯区'
  }) });
  assert(coachRegister.status === 201, '教练注册申请失败');
  const pendingCoaches = await request('/api/admin/registrations?status=pending', {}, adminToken);
  const coachRequest = pendingCoaches.payload.requests.find((item) => item.username === 'coach_test');
  const approveCoach = await request(`/api/admin/registrations/${coachRequest.id}/approve`, { method: 'POST' }, adminToken);
  assert(approveCoach.status === 200, '教练审核失败');
  const coachLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'coach_test', password: 'Secure123' }) });
  assert(coachLogin.status === 200, '获批教练无法登录');
  const forbiddenRename = await request('/api/admin/athletes/1/name', {
    method: 'PUT', body: JSON.stringify({ name: '无权修改' })
  }, coachLogin.payload.token);
  assert(forbiddenRename.status === 403, '教练不应修改运动员姓名');

  const assignments = await request('/api/admin/assignments', {}, adminToken);
  const demoCoach = assignments.payload.coaches[0];
  const renameCoach = await request(`/api/users/${demoCoach.id}/name`, {
    method: 'PUT', body: JSON.stringify({ name: '刘教练修订' })
  }, adminToken);
  const athletesWithCoachIds = await request('/api/athletes', {}, adminToken);
  assert(
    renameCoach.status === 200
      && athletesWithCoachIds.payload.athletes.some((athlete) => athlete.coachUsers?.some((coach) => coach.id === demoCoach.id && coach.displayName === '刘教练修订')),
    '管理员修改教练姓名或姓名明细返回失败'
  );

  const demoAthlete = athletesWithCoachIds.payload.athletes.find((athlete) => athlete.name === '林舟');
  const renameAthlete = await request(`/api/admin/athletes/${demoAthlete.id}/name`, {
    method: 'PUT', body: JSON.stringify({ name: '林舟修订' })
  }, adminToken);
  const renamedAthleteRecords = await request(`/api/records?from=2026-06-01&to=2026-07-21&athleteId=${demoAthlete.id}&project=${encodeURIComponent(demoAthlete.project)}`, {}, adminToken);
  assert(
    renameAthlete.status === 200
      && renamedAthleteRecords.payload.records.length > 0
      && renamedAthleteRecords.payload.records.every((record) => record.athleteName === '林舟修订'),
    '管理员修改运动员姓名未同步训练记录'
  );

  const changePassword = await request('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword: 'Secure123', newPassword: 'Changed456' })
  }, coachLogin.payload.token);
  const changedLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'coach_test', password: 'Changed456' }) });
  assert(changePassword.status === 200 && changedLogin.status === 200, '修改密码流程失败');

  const disableRegional = await request(`/api/access/accounts/${createRegional.payload.id}/status`, {
    method: 'PUT', body: JSON.stringify({ active: false })
  }, adminToken);
  const disabledSession = await request('/api/me', {}, createdRegionalLogin.payload.token);
  const enableRegional = await request(`/api/access/accounts/${createRegional.payload.id}/status`, {
    method: 'PUT', body: JSON.stringify({ active: true })
  }, adminToken);
  assert(
    disableRegional.status === 200 && disabledSession.status === 401 && enableRegional.status === 200,
    '账号停用没有立即使现有会话失效'
  );

  const auditLogs = await request('/api/access/audit-logs', {}, adminToken);
  assert(
    auditLogs.status === 200
      && auditLogs.payload.logs.some((log) => log.action === 'UPDATE_ACCOUNT_ACCESS')
      && auditLogs.payload.logs.some((log) => log.action === 'DISABLE_ACCOUNT'),
    '数据监控总监未能读取权限审计日志'
  );

  console.log(JSON.stringify({
    rowingAnalysis: 'passed',
    strengthProfile: 'passed',
    registration: 'passed',
    approval: 'passed',
    roleProtection: 'passed',
    sixRoleAccess: 'passed',
    regionalIsolation: 'passed',
    accountLifecycle: 'passed',
    auditLog: 'passed',
    nameEditing: 'passed',
    excelImport: 'passed',
    passwordChange: 'passed'
  }, null, 2));
} finally {
  server.kill();
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  for (const target of cleanupTargets) {
    if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
  }
}
