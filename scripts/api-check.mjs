import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

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
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_PATH: databasePath
  },
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
  const analysisAthlete = adminAthletesForAnalysis.payload.athletes.find((item) => item.project === '赛艇');
  const forbiddenAdminIndividualOverview = await request(
    `/api/overview?from=2020-01-01&to=2100-12-31&athleteId=${analysisAthlete.id}&project=${encodeURIComponent(analysisAthlete.project)}`,
    {},
    adminToken
  );
  assert(forbiddenAdminIndividualOverview.status === 400, '训练总监类账号不应在训练总览读取单人数据');
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

  const overviewRequiredMetrics = {
    赛艇: ['seven_stroke_power_w', 'erg_2k_sec', 'movement_squat_score'],
    皮划艇: ['sprint_200_sec', 'left_paddle_power_w', 'movement_shoulder_score'],
    激流: ['gate_technique_score', 'movement_trunk_score']
  };
  for (const [overviewProject, requiredCodes] of Object.entries(overviewRequiredMetrics)) {
    const result = await request(
      `/api/overview?from=2020-01-01&to=2100-12-31&project=${encodeURIComponent(overviewProject)}`,
      {},
      adminToken
    );
    const codes = new Set(result.payload.overview?.measurements?.map((item) => item.code));
    const profiles = result.payload.overview?.profiles || [];
    assert(
      result.status === 200
        && result.payload.overview.records.length > 0
        && result.payload.overview.strengthTests.length >= 2
        && profiles.length > 0
        && profiles.every((profile) => profile.province && profile.province !== '未设置' && profile.city && profile.originSource)
        && profiles.every((profile) => profile.birthDate && profile.age > 0 && profile.heightCm > 0 && profile.weightKg > 0)
        && profiles.every((profile) => profile.competitiveScore > 0 && profile.competitiveLevel && profile.competitiveDimensions.competition > 0)
        && result.payload.overview.meta.containsDemoData
        && requiredCodes.every((code) => codes.has(code)),
      `${overviewProject}统一训练总览数据或演示指标不完整`
    );
  }

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
  const coachOverview = await request(
    `/api/overview?from=2020-01-01&to=2100-12-31&project=${encodeURIComponent(coachAthlete.project)}`,
    {},
    demoCoachLogin.payload.token
  );
  const forbiddenCoachIndividualOverview = await request(
    `/api/overview?from=2020-01-01&to=2100-12-31&athleteId=${coachAthlete.id}&project=${encodeURIComponent(coachAthlete.project)}`,
    {},
    demoCoachLogin.payload.token
  );
  assert(
    coachOverview.status === 200
      && coachOverview.payload.overview.meta.scope === 'team'
      && coachOverview.payload.overview.meta.athleteCount === demoCoachAthletes.payload.athletes.filter((item) => item.project === coachAthlete.project).length
      && forbiddenCoachIndividualOverview.status === 400,
    '教练训练总览未按负责队员进行团队聚合'
  );
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
  const ownAthlete = adminAthletesForAnalysis.payload.athletes.find((item) => item.id === demoAthleteLogin.payload.user.athleteId);
  const athleteOverview = await request(
    `/api/overview?from=2020-01-01&to=2100-12-31&project=${encodeURIComponent(ownAthlete.project)}`,
    {},
    demoAthleteLogin.payload.token
  );
  assert(
    athleteOverview.status === 200
      && athleteOverview.payload.overview.meta.scope === 'individual'
      && athleteOverview.payload.overview.meta.athleteCount === 1
      && athleteOverview.payload.overview.records.every((record) => record.athleteId === demoAthleteLogin.payload.user.athleteId),
    '运动员训练总览未限制为本人数据'
  );
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

  const removedImportRoutes = await Promise.all([
    request('/api/import/preview', { method: 'POST' }, adminToken),
    request('/api/import/ai/inspect', { method: 'POST' }, adminToken),
    request('/api/training-plans/ai/import/preview', { method: 'POST' }, adminToken)
  ]);
  assert(
    removedImportRoutes.every((result) => result.status === 404),
    '已移除的数据识别接口仍可访问'
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
  assert(
    initialRegionalAthletes.status === 200
      && initialRegionalAthletes.payload.athletes.length === 2
      && initialRegionalAthletes.payload.athletes.every((item) => item.region === '四川'),
    '区域负责人的初始地区权限错误'
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

  const createRegistrationTeam = await request('/api/admin/teams', {
    method: 'POST', body: JSON.stringify({ project: '赛艇', name: '测试组' })
  }, adminToken);
  assert(createRegistrationTeam.status === 201, '队伍管理接口无法创建注册测试队伍');

  const invalidIdentityRegister = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    username: 'invalid_id_test', password: 'Secure123', displayName: '证件测试', role: 'ATL',
    project: '赛艇', team: '测试组', identityNumber: '51010720000101123', nativePlace: '四川/成都市'
  }) });
  assert(invalidIdentityRegister.status === 400, '不足18位的身份证号不应通过注册校验');

  const invalidNativePlaceRegister = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    username: 'invalid_native_test', password: 'Secure123', displayName: '籍贯测试', role: 'ATL',
    project: '赛艇', team: '测试组', identityNumber: '510107200001011234', nativePlace: '四川/武汉市'
  }) });
  assert(invalidNativePlaceRegister.status === 400, '缺少县/市的籍贯不应通过注册校验');

  const athleteRegister = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    username: 'athlete_test', password: 'Secure123', displayName: '测试运动员', role: 'ATL',
    project: '赛艇', team: '测试组', identityNumber: '510107200001011234', nativePlace: '四川/成都市'
  }) });
  assert(athleteRegister.status === 201, '运动员注册申请失败');

  const pendingLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'athlete_test', password: 'Secure123' }) });
  assert(pendingLogin.status === 403, '待审核账户不应登录');

  const pending = await request('/api/admin/registrations?status=pending', {}, adminToken);
  const athleteRequest = pending.payload.requests.find((item) => item.username === 'athlete_test');
  assert(
    pending.status === 200
      && athleteRequest?.identityNumber === '510107200001011234'
      && athleteRequest?.nativePlace === '四川/成都市'
      && athleteRequest?.gender === '男',
    '管理员未看到完整的注册申请资料'
  );
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
  assert(
    athleteLogin.payload.user.displayName === '测试运动员修订'
      && athleteList.payload.athletes.length === 1
      && athleteList.payload.athletes[0].name === '测试运动员修订',
    '注册姓名修改或运动员数据范围错误'
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
    project: '赛艇', team: '测试组', identityNumber: '51010719900101123X', nativePlace: '四川/成都市'
  }) });
  assert(coachRegister.status === 400, '公开注册接口不应允许教练注册');
  const createCoachInternally = await request('/api/access/accounts', {
    method: 'POST', body: JSON.stringify({
      username: 'coach_internal', password: 'Secure123', displayName: '内部创建教练', role: 'SCC',
      parentUserId: adminAccess.payload.current.id, areas: adminAccess.payload.current.areas,
      projects: ['赛艇'], teams: [{ project: '赛艇', team: '测试组' }], coachCategory: '体能教练'
    })
  }, adminToken);
  assert(createCoachInternally.status === 201, '管理员内部创建教练失败');
  const coachLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'coach_internal', password: 'Secure123' }) });
  assert(coachLogin.status === 200, '内部创建的教练账号无法登录');
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

  const athleteAdminPayload = {
    name: '接口测试运动员', username: 'athlete_crud_test', password: 'Secure123',
    project: analysisAthlete.project, team: analysisAthlete.team, gender: '女',
    region: analysisAthlete.region, city: analysisAthlete.city, county: analysisAthlete.county,
    birthDate: '2004-06-18', ethnicity: '汉族', phone: '13800138000',
    emergencyContact: '测试联系人', emergencyPhone: '13900139000',
    education: '本科', technicalLevel: '国家一级', healthStatus: '健康',
    bestResult: '测试成绩', athleteStatus: '在训', trainingVenue: '水上训练基地',
    currentEvent: '双人艇', trainingPhase: '专项准备期', specialties: '耐力'
  };
  const createManagedAthlete = await request('/api/admin/athletes', {
    method: 'POST', body: JSON.stringify(athleteAdminPayload)
  }, adminToken);
  assert(createManagedAthlete.status === 201 && createManagedAthlete.payload.id, '运动员管理新增接口失败');
  const managedAthleteId = createManagedAthlete.payload.id;
  const updateManagedAthlete = await request(`/api/admin/athletes/${managedAthleteId}`, {
    method: 'PUT', body: JSON.stringify({ ...athleteAdminPayload, name: '接口测试运动员修订', healthStatus: '观察' })
  }, adminToken);
  const bulkManagedAthlete = await request('/api/admin/athletes/bulk/profile', {
    method: 'PUT', body: JSON.stringify({ ids: [managedAthleteId], athleteStatus: '集训', currentEvent: '四人艇' })
  }, adminToken);
  const managedAthleteList = await request('/api/athletes', {}, adminToken);
  const managedAthlete = managedAthleteList.payload.athletes.find((item) => item.id === managedAthleteId);
  assert(
    updateManagedAthlete.status === 200
      && bulkManagedAthlete.status === 200
      && managedAthlete?.name === '接口测试运动员修订'
      && managedAthlete?.healthStatus === '观察'
      && managedAthlete?.athleteStatus === '集训'
      && managedAthlete?.currentEvent === '四人艇',
    '运动员管理编辑、批量更新或档案读取失败'
  );
  const deleteManagedAthlete = await request(`/api/admin/athletes/${managedAthleteId}`, { method: 'DELETE' }, adminToken);
  const deletedManagedAthleteList = await request('/api/athletes', {}, adminToken);
  assert(
    deleteManagedAthlete.status === 200
      && !deletedManagedAthleteList.payload.athletes.some((item) => item.id === managedAthleteId),
    `运动员管理删除或账号停用失败：${deleteManagedAthlete.status} ${JSON.stringify(deleteManagedAthlete.payload)}`
  );

  const changePassword = await request('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword: 'Secure123', newPassword: 'Changed456' })
  }, coachLogin.payload.token);
  const changedLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'coach_internal', password: 'Changed456' }) });
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
    overviewPipeline: 'passed',
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
    athleteManagementCrud: 'passed',
    removedAIImportRoutes: 'passed',
    passwordChange: 'passed'
  }, null, 2));
} finally {
  server.kill();
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  for (const target of cleanupTargets) {
    if (target.startsWith(resolve(root, 'data')) && existsSync(target)) rmSync(target);
  }
}
