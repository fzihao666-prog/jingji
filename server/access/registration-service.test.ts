import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import type { AuthUser } from '../core/shared-server.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  upsertAthleteOrigin: vi.fn(),
  get db() {
    return fixture.db;
  },
}));
let db: DatabaseSync;
let server: Server;
let baseUrl: string;
let secret: string;
let verifyTeam: typeof import('./registration-service.ts').verifyRegistrationTeam;
let activate: typeof import('./registration-service.ts').activateRegistrationRequest;
const reviewer: AuthUser = {
  id: 1,
  username: 'reviewer',
  displayName: '测试审核人',
  role: 'DMD',
  athleteId: null,
  sessionVersion: 0,
};
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-only-registration-p1-secret');
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, display_name TEXT, role TEXT, athlete_id INTEGER,active INTEGER DEFAULT 1,session_version INTEGER DEFAULT 0);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, name TEXT, project TEXT, team TEXT, team_id INTEGER, gender TEXT, birth_date TEXT,source TEXT DEFAULT 'manual',profile_status TEXT DEFAULT 'complete',region TEXT,city TEXT,county TEXT,active INTEGER DEFAULT 1);
    CREATE UNIQUE INDEX idx_athletes_identity ON athletes (name, project, team);
    CREATE TABLE athlete_origins (athlete_id INTEGER PRIMARY KEY, province TEXT, city TEXT, county TEXT, source TEXT, quality TEXT);
    CREATE TABLE athlete_profiles (athlete_id INTEGER PRIMARY KEY, native_place TEXT, phone TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT, granted_by INTEGER);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT, granted_by INTEGER);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT, granted_by INTEGER);
    CREATE TABLE account_profiles (user_id INTEGER PRIMARY KEY, parent_user_id INTEGER, account_code TEXT,updated_at TEXT);
    CREATE TABLE coach_profiles (user_id INTEGER, category TEXT);
    CREATE TABLE coach_athletes (coach_user_id INTEGER, athlete_id INTEGER, UNIQUE(coach_user_id,athlete_id));
    CREATE TABLE registration_requests (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, display_name TEXT, requested_role TEXT, project TEXT, team TEXT, gender TEXT, birth_date TEXT, status TEXT, native_place TEXT, phone TEXT, reviewed_by INTEGER, reviewed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT);
  `);
  const service = await import('./registration-service.ts');
  activate = service.activateRegistrationRequest;
  verifyTeam = service.verifyRegistrationTeam;
  secret = (await import('../core/auth.ts')).jwtSecret;
  const app = express();
  app.use(express.json());
  (await import('./access-routes.ts')).registerAccessRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  db.exec(`DELETE FROM users; DELETE FROM athletes; DELETE FROM athlete_origins; DELETE FROM athlete_profiles; DELETE FROM account_profiles; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions; DELETE FROM user_team_permissions; DELETE FROM registration_requests; DELETE FROM project_teams; DELETE FROM audit_logs; DELETE FROM coach_profiles; DELETE FROM coach_athletes;
    INSERT INTO users (id,username,display_name,role) VALUES (1,'reviewer','测试审核人','DMD');
    INSERT INTO project_teams VALUES (1,'ROWING','测试队',1);
    INSERT INTO user_area_permissions VALUES (1,'national','','','',1);
    INSERT INTO user_project_permissions VALUES (1,'ROWING',1);
    INSERT INTO user_team_permissions VALUES (1,'ROWING','测试队',1);
    INSERT INTO registration_requests (id,username,password_hash,display_name,requested_role,project,team,gender,birth_date,status,native_place) VALUES (1,'newathlete','test-only-hash','测试运动员','ATL','ROWING','测试队','男','2000-02-29','pending','浙江/杭州市');
  `);
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});
function area(userId: number) {
  return db
    .prepare('SELECT area_level,province,city,county FROM user_area_permissions WHERE user_id=?')
    .get(userId);
}
function existingOrigin(county = '武侯区') {
  db.exec(
    "INSERT INTO athletes (id,name,project,team,team_id,gender,birth_date) VALUES (10,'测试运动员','ROWING','测试队',1,'男',NULL)"
  );
  db.prepare("INSERT INTO athlete_origins VALUES (10,'四川','成都市',?,'manual','valid')").run(
    county
  );
}
describe('运动员注册行政归属', () => {
  it.each([reviewer, null])('新档案使用籍贯推测省市，缺失区县仍待完善 %#', (actor) => {
    const result = activate(1, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(area(result.userId)).toEqual({
      area_level: 'county',
      province: '浙江',
      city: '杭州市',
      county: '',
    });
    expect(db.prepare('SELECT source,quality FROM athlete_origins').get()).toEqual({
      source: 'registration',
      quality: 'estimated',
    });
    expect(db.prepare('SELECT native_place FROM athlete_profiles').get()).toEqual({
      native_place: '浙江/杭州市',
    });
  });
  it('已有运动员使用确认的档案归属，籍贯不覆盖它', () => {
    existingOrigin();
    const result = activate(1, reviewer);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(area(result.userId)).toEqual({
      area_level: 'county',
      province: '四川',
      city: '成都市',
      county: '武侯区',
    });
    expect(
      db
        .prepare('SELECT province,city,county,source FROM athlete_origins WHERE athlete_id=10')
        .get()
    ).toEqual({ province: '四川', city: '成都市', county: '武侯区', source: 'manual' });
  });
  it('缺区县时保留确认的省市，等待上级补全', () => {
    existingOrigin('');
    const result = activate(1, reviewer);
    if (!result.ok) throw new Error(result.message);
    expect(area(result.userId)).toEqual({
      area_level: 'county',
      province: '四川',
      city: '成都市',
      county: '',
    });
  });
  it('无效区县不写入账号权限，也不改写原始档案', () => {
    existingOrigin('西湖区');
    const result = activate(1, reviewer);
    if (!result.ok) throw new Error(result.message);
    expect(area(result.userId)).toEqual({
      area_level: 'county',
      province: '四川',
      city: '成都市',
      county: '',
    });
    expect(db.prepare('SELECT county FROM athlete_origins WHERE athlete_id=10').get()).toEqual({
      county: '西湖区',
    });
  });
  it('教练注册保留既有审核范围继承规则', () => {
    db.exec("UPDATE registration_requests SET requested_role='SCC'");
    const result = activate(1, reviewer);
    if (!result.ok) throw new Error(result.message);
    expect(area(result.userId)).toEqual({
      area_level: 'national',
      province: '',
      city: '',
      county: '',
    });
  });
  it('审核人超出项目队伍范围时拒绝开通', () => {
    db.exec("UPDATE user_team_permissions SET team='其他队'");
    expect(activate(1, reviewer)).toMatchObject({ ok: false, status: 403 });
    expect(db.prepare('SELECT * FROM account_profiles').all()).toHaveLength(0);
  });
});

it.each([reviewer, null])('开通保存申请生日性别 %#', (actor) => {
  expect(activate(1, actor).ok).toBe(true);
  expect(db.prepare('SELECT gender,birth_date FROM athletes').get()).toEqual({
    gender: '男',
    birth_date: '2000-02-29',
  });
});
it('已有运动员生日或性别不一致时拒绝关联', () => {
  existingOrigin();
  db.exec("UPDATE athletes SET birth_date='1999-01-01',gender='女'");
  expect(activate(1, reviewer).ok).toBe(false);
  expect(db.prepare('SELECT gender,birth_date FROM athletes').get()).toEqual({
    gender: '女',
    birth_date: '1999-01-01',
  });
});

describe('注册身份绑定加固', () => {
  it('人工审核精确匹配身份后关联，不新建且保留已有字段', () => {
    existingOrigin();
    db.exec("UPDATE athletes SET birth_date='2000-02-29'");
    const result = activate(1, reviewer);
    expect(result.ok).toBe(true);
    expect(db.prepare("SELECT athlete_id FROM users WHERE username='newathlete'").get()).toEqual({
      athlete_id: 10,
    });
    expect(db.prepare('SELECT id FROM athletes').all()).toEqual([{ id: 10 }]);
  });
  it.each([
    { gender: '女', birth: '2000-02-29' },
    { gender: '男', birth: '1999-01-01' },
  ])('身份字段冲突时人工和自动开通均不绑定 %#', ({ gender, birth }) => {
    existingOrigin();
    db.prepare('UPDATE athletes SET gender=?,birth_date=?').run(gender, birth);
    expect(activate(1, reviewer)).toMatchObject({
      ok: false,
      message: expect.stringContaining('身份信息不一致'),
    });
    expect(activate(1, null)).toMatchObject({
      ok: false,
      message: expect.stringContaining('联系管理员'),
    });
    expect(db.prepare("SELECT id FROM users WHERE username='newathlete'").get()).toBeUndefined();
    expect(db.prepare('SELECT id FROM athletes').all()).toEqual([{ id: 10 }]);
    expect(db.prepare('SELECT status FROM registration_requests WHERE id=1').get()).toEqual({
      status: 'pending',
    });
    expect(db.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM athlete_profiles').all()).toEqual([]);
  });
  it('自动开通即使身份一致也不得认领已有档案', () => {
    existingOrigin();
    db.exec("UPDATE athletes SET birth_date='2000-02-29'");
    expect(activate(1, null)).toMatchObject({
      ok: false,
      message: expect.stringContaining('暂停开通'),
    });
    expect(db.prepare("SELECT id FROM users WHERE username='newathlete'").get()).toBeUndefined();
  });
  it('已有登录账号时拒绝人工绑定', () => {
    existingOrigin();
    db.exec("INSERT INTO users (id,username,role,athlete_id) VALUES (2,'linked','ATL',10)");
    expect(activate(1, reviewer)).toMatchObject({ ok: false, message: '该运动员已有登录账户。' });
  });
  it.each([
    ['ROWING', '其他队'],
    ['CANOE', '测试队'],
  ])('同名仅存在于其他项目队伍时拒绝人工关联 %s %s', (project, team) => {
    db.prepare('INSERT INTO project_teams VALUES (2,?,?,1)').run(project, team);
    db.prepare(
      'INSERT INTO athletes (id,name,project,team,team_id,gender,birth_date) VALUES (9,?,?,?,?,?,?)'
    ).run('测试运动员', project, team, 2, '男', '2000-02-29');
    expect(activate(1, reviewer)).toMatchObject({
      ok: false,
      message: expect.stringContaining(`${project} / ${team}`),
    });
  });
  it('跨队同名优先精确匹配申请队伍，不受先插入的其他队影响', () => {
    db.exec(
      "INSERT INTO project_teams VALUES (2,'ROWING','其他队',1); INSERT INTO athletes (id,name,project,team,team_id,gender,birth_date) VALUES (9,'测试运动员','ROWING','其他队',2,'女','1999-01-01');"
    );
    existingOrigin();
    expect(activate(1, reviewer).ok).toBe(true);
    expect(db.prepare("SELECT athlete_id FROM users WHERE username='newathlete'").get()).toEqual({
      athlete_id: 10,
    });
  });
  it('人工审核补齐空生日性别', () => {
    existingOrigin();
    db.exec("UPDATE athletes SET gender=''");
    expect(activate(1, reviewer).ok).toBe(true);
    expect(db.prepare('SELECT gender,birth_date FROM athletes').get()).toEqual({
      gender: '男',
      birth_date: '2000-02-29',
    });
  });
});

describe('P1 入队核实与审核范围', () => {
  it('自动开通待核实，人工确认更新来源、父级及审计', () => {
    const result = activate(1, null);
    if (!result.ok) throw new Error(result.message);
    expect(db.prepare('SELECT source FROM athletes').get()).toEqual({ source: 'self_registered' });
    expect(verifyTeam(1, reviewer, true)).toEqual({ ok: true, userId: result.userId });
    expect(db.prepare('SELECT source FROM athletes').get()).toEqual({
      source: 'registration_verified',
    });
    expect(
      db.prepare('SELECT parent_user_id FROM account_profiles WHERE user_id=?').get(result.userId)
    ).toEqual({ parent_user_id: 1 });
    expect(
      db.prepare("SELECT action FROM audit_logs WHERE action='VERIFY_REGISTRATION_TEAM'").all()
    ).toHaveLength(1);
    expect(verifyTeam(1, reviewer, true)).toMatchObject({ ok: false, status: 409 });
  });
  it('拒绝自动入队停用账号、撤销会话并保留档案和归属', () => {
    const result = activate(1, null);
    if (!result.ok) throw new Error(result.message);
    expect(verifyTeam(1, reviewer, false).ok).toBe(true);
    expect(
      db.prepare('SELECT active,session_version FROM users WHERE id=?').get(result.userId)
    ).toEqual({ active: 0, session_version: 1 });
    expect(db.prepare('SELECT active,source FROM athletes').get()).toEqual({
      active: 0,
      source: 'self_registration_rejected',
    });
    expect(db.prepare('SELECT status FROM registration_requests').get()).toEqual({
      status: 'rejected',
    });
    expect(db.prepare('SELECT * FROM athlete_origins').all()).toHaveLength(1);
  });
  it.each(['REG', 'SCC'] as const)('%s 审核人区域不含推测归属时拒绝并回滚全部开通写入', (role) => {
    db.exec("UPDATE user_area_permissions SET area_level='province',province='四川'");
    expect(activate(1, { ...reviewer, role })).toMatchObject({ ok: false, status: 403 });
    expect(db.prepare('SELECT * FROM athletes').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM athlete_origins').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM account_profiles').all()).toEqual([]);
    expect(db.prepare('SELECT status FROM registration_requests').get()).toEqual({
      status: 'pending',
    });
  });
  it('区域审核以已确认档案归属为准，籍贯不能绕过审核范围', () => {
    existingOrigin();
    db.exec("UPDATE user_area_permissions SET area_level='province',province='浙江'");
    expect(activate(1, reviewer)).toMatchObject({ ok: false, status: 403 });
    expect(db.prepare('SELECT province,source,quality FROM athlete_origins').get()).toEqual({
      province: '四川',
      source: 'manual',
      quality: 'valid',
    });
  });
  it('区域覆盖推测省市时允许审核，区县仍明确待完善', () => {
    db.exec("UPDATE user_area_permissions SET area_level='province',province='浙江'");
    expect(activate(1, reviewer).ok).toBe(true);
    expect(db.prepare('SELECT source,region,city,county FROM athletes').get()).toEqual({
      source: 'registration_verified',
      region: '浙江',
      city: '杭州市',
      county: '',
    });
  });
  it('无效历史籍贯保留明确待完善，不伪造行政归属', () => {
    db.exec("UPDATE registration_requests SET native_place='错误/城市'");
    expect(activate(1, null).ok).toBe(true);
    expect(db.prepare('SELECT province,city,county,quality FROM athlete_origins').get()).toEqual({
      province: '',
      city: '',
      county: '',
      quality: 'estimated',
    });
  });
  it('入队核实拒绝外队操作者及区域不覆盖的审核人', () => {
    expect(activate(1, null).ok).toBe(true);
    db.exec("UPDATE user_team_permissions SET team='其他队'");
    expect(verifyTeam(1, reviewer, true)).toMatchObject({ ok: false, status: 403 });
    db.exec(
      "UPDATE user_team_permissions SET team='测试队'; UPDATE user_area_permissions SET area_level='province',province='四川'"
    );
    expect(verifyTeam(1, reviewer, false)).toMatchObject({ ok: false, status: 403 });
    expect(db.prepare('SELECT source,active FROM athletes').get()).toEqual({
      source: 'self_registered',
      active: 1,
    });
  });
  it('审核或核实的审计失败时事务整体回滚', () => {
    expect(activate(1, null).ok).toBe(true);
    db.exec(
      "CREATE TRIGGER fail_verification BEFORE INSERT ON audit_logs WHEN NEW.action='VERIFY_REGISTRATION_TEAM' BEGIN SELECT RAISE(ABORT,'fixture'); END"
    );
    expect(verifyTeam(1, reviewer, true)).toMatchObject({ ok: false, status: 500 });
    expect(db.prepare('SELECT source FROM athletes').get()).toEqual({ source: 'self_registered' });
    expect(db.prepare('SELECT parent_user_id FROM account_profiles WHERE user_id=2').get()).toEqual(
      { parent_user_id: null }
    );
    db.exec('DROP TRIGGER fail_verification');
  });
});

function callRegistration(path: string, method = 'GET', body?: unknown, actor = 1) {
  return fetch(`${baseUrl}/api/admin/registrations${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${jwt.sign({ id: actor, sessionVersion: 0 }, secret, { expiresIn: '5m' })}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
describe('注册入队审核路由', () => {
  it('待审核队伍更正后按新队开通，核实来源及账号范围一致', async () => {
    db.exec(
      "INSERT INTO project_teams VALUES (2,'ROWING','新队',1);INSERT INTO user_team_permissions VALUES (1,'ROWING','新队',1)"
    );
    const updated = await callRegistration('/1/team', 'PUT', { project: 'ROWING', team: '新队' });
    expect(updated.status).toBe(200);
    const approved = await callRegistration('/1/approve', 'POST');
    expect(approved.status).toBe(200);
    expect(db.prepare('SELECT team,team_id,source FROM athletes').get()).toEqual({
      team: '新队',
      team_id: 2,
      source: 'registration_verified',
    });
    expect(db.prepare('SELECT team FROM user_team_permissions WHERE user_id=2').get()).toEqual({
      team: '新队',
    });
  });
  it('禁止将申请移到操作者权限以外的队伍', async () => {
    db.exec("INSERT INTO project_teams VALUES (2,'ROWING','外队',1)");
    const response = await callRegistration('/1/team', 'PUT', { project: 'ROWING', team: '外队' });
    expect(response.status).toBe(403);
    expect(db.prepare('SELECT team FROM registration_requests').get()).toEqual({ team: '测试队' });
  });
  it('自动开通在已通过列表返回待核实标记，可确认并更新列表', async () => {
    expect(activate(1, null).ok).toBe(true);
    const list = await callRegistration('?status=approved');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ requests: [{ teamVerification: 'pending' }] });
    expect((await callRegistration('/1/verify-team', 'POST', { approved: true })).status).toBe(200);
    const verified = await callRegistration('?status=approved');
    expect(await verified.json()).toMatchObject({ requests: [{ teamVerification: 'verified' }] });
    expect(
      (await callRegistration('/1/team', 'PUT', { project: 'ROWING', team: '测试队' })).status
    ).toBe(409);
  });
  it('拒绝入队返回明确停用提示；非法请求不改变状态', async () => {
    expect(activate(1, null).ok).toBe(true);
    expect((await callRegistration('/1/verify-team', 'POST', { approved: 'false' })).status).toBe(
      400
    );
    const response = await callRegistration('/1/verify-team', 'POST', { approved: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('停用') });
  });
  it('未登录不能更正或核实，ATL 不能审核入队', async () => {
    const response = await fetch(`${baseUrl}/api/admin/registrations/1/team`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'ROWING', team: '测试队' }),
    });
    expect(response.status).toBe(401);
    expect(activate(1, null).ok).toBe(true);
    expect((await callRegistration('/1/verify-team', 'POST', { approved: true }, 2)).status).toBe(
      403
    );
  });
});

it('待核实运动员转队后列表、改名和核实均按当前队伍授权', async () => {
  expect(activate(1, null).ok).toBe(true);
  db.exec(`INSERT INTO project_teams VALUES (2,'ROWING','新队',1);
    INSERT INTO users (id,username,role,display_name) VALUES (3,'oldcoach','SCC','旧队教练'),(4,'newcoach','SCC','新队教练');
    INSERT INTO user_area_permissions VALUES (3,'national','','','',1),(4,'national','','','',1);
    INSERT INTO user_project_permissions VALUES (3,'ROWING',1),(4,'ROWING',1);
    INSERT INTO user_team_permissions VALUES (3,'ROWING','测试队',1),(4,'ROWING','新队',1);
    UPDATE athletes SET team_id=2,team='新队'; UPDATE user_team_permissions SET team='新队' WHERE user_id=2;`);
  const oldList = await callRegistration('?status=approved', 'GET', undefined, 3);
  expect(await oldList.json()).toMatchObject({ requests: [] });
  const newList = await callRegistration('?status=approved', 'GET', undefined, 4);
  expect(await newList.json()).toMatchObject({
    requests: [{ team: '新队', teamVerification: 'pending' }],
  });
  expect((await callRegistration('/1/name', 'PUT', { name: '越权改名' }, 3)).status).toBe(403);
  expect((await callRegistration('/1/verify-team', 'POST', { approved: true }, 4)).status).toBe(
    200
  );
});


it('转队后拒绝入队的历史记录仍只向当前队伍审核人展示', async () => {
  expect(activate(1,null).ok).toBe(true);
  db.exec(`INSERT INTO project_teams VALUES (2,'ROWING','新队',1);
    INSERT INTO users (id,username,role,display_name) VALUES (3,'oldcoach','SCC','旧队教练'),(4,'newcoach','SCC','新队教练');
    INSERT INTO user_area_permissions VALUES (3,'national','','','',1),(4,'national','','','',1);
    INSERT INTO user_project_permissions VALUES (3,'ROWING',1),(4,'ROWING',1);
    INSERT INTO user_team_permissions VALUES (3,'ROWING','测试队',1),(4,'ROWING','新队',1);
    UPDATE athletes SET team_id=2,team='新队'; UPDATE user_team_permissions SET team='新队' WHERE user_id=2;`);
  expect((await callRegistration('/1/verify-team','POST',{approved:false},4)).status).toBe(200);
  const oldList=await callRegistration('?status=rejected','GET',undefined,3);
  expect(await oldList.json()).toMatchObject({requests:[]});
  const newList=await callRegistration('?status=rejected','GET',undefined,4);
  expect(await newList.json()).toMatchObject({requests:[{team:'新队',status:'rejected'}]});
});

it('更正队伍或拒绝申请的审计失败时状态回滚', async () => {
  db.exec(`INSERT INTO project_teams VALUES (2,'ROWING','新队',1);
    INSERT INTO user_team_permissions VALUES (1,'ROWING','新队',1);
    CREATE TRIGGER fail_registration_audit BEFORE INSERT ON audit_logs
      BEGIN SELECT RAISE(ABORT,'fixture'); END;`);
  expect((await callRegistration('/1/team','PUT',{project:'ROWING',team:'新队'})).status).toBe(500);
  expect(db.prepare('SELECT team,status FROM registration_requests').get()).toEqual({team:'测试队',status:'pending'});
  expect((await callRegistration('/1/reject','POST')).status).toBe(500);
  expect(db.prepare('SELECT team,status FROM registration_requests').get()).toEqual({team:'测试队',status:'pending'});
  db.exec('DROP TRIGGER fail_registration_audit');
});
