import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
  upsertAthleteOrigin(input: {
    athleteId: number;
    province: string;
    city: string;
    county: string;
  }) {
    fixture
      .db!.prepare(
        `INSERT INTO athlete_origins VALUES (?, ?, ?, ?)
      ON CONFLICT(athlete_id) DO UPDATE SET province=excluded.province,
      city=excluded.city, county=excluded.county`
      )
      .run(input.athleteId, input.province, input.city, input.county);
  },
}));

let database: DatabaseSync;
let server: Server;
let baseUrl: string;
let secret: string;
type AssignmentPayload = {
  athletes: Array<{
    id: number;
    name: string;
    coachIds: string;
    coachUsers: Array<{ id: number; displayName: string }>;
  }>;
  coaches: Array<{ id: number; displayName: string }>;
};

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-only-coach-responsibility-secret-not-for-deployment');
  database = new DatabaseSync(':memory:');
  fixture.db = database;
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT,
      athlete_id INTEGER, active INTEGER DEFAULT 1, session_version INTEGER DEFAULT 0);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT, granted_by INTEGER);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT, granted_by INTEGER);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT, granted_by INTEGER);
    ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
    CREATE TABLE user_dashboard_preferences (user_id INTEGER);
    CREATE TABLE registration_requests (username TEXT);
    CREATE TABLE account_profiles (user_id INTEGER PRIMARY KEY, parent_user_id INTEGER, account_code TEXT, updated_at TEXT);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE coach_work_status (user_id INTEGER PRIMARY KEY, status TEXT, team_id INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE team_work_status (team_id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, name TEXT, project TEXT, team TEXT, team_id INTEGER,
      active INTEGER, gender TEXT);
    CREATE TABLE athlete_origins (athlete_id INTEGER PRIMARY KEY, province TEXT, city TEXT, county TEXT);
    CREATE TABLE coach_profiles (user_id INTEGER, category TEXT, updated_at TEXT, PRIMARY KEY (user_id, category));
    CREATE TABLE coach_athletes (coach_user_id INTEGER, athlete_id INTEGER);
    CREATE TABLE training_plans (id INTEGER, athlete_id INTEGER, title TEXT, start_date TEXT, end_date TEXT, created_by INTEGER, plan_data TEXT, model TEXT DEFAULT 'legacy');
    CREATE TABLE special_training_plans (id INTEGER, project TEXT, week_start TEXT, title TEXT, status TEXT, created_by INTEGER);
    CREATE TABLE special_training_plan_sessions (id INTEGER, plan_id INTEGER, session_date TEXT, session_order INTEGER, content TEXT, target_json TEXT);
  `);
  const { registerAccessRoutes } = await import('./access-routes.ts');
  secret = (await import('../core/auth.ts')).jwtSecret;
  const app = express();
  app.use(express.json());
  registerAccessRoutes(app);
  const { registerAuthRoutes } = await import('./auth-routes.ts');
  registerAuthRoutes(app);
  const { registerTrainingPlanCatalogRoutes } =
    await import('../training-plan/training-plan-catalog-routes.ts');
  registerTrainingPlanCatalogRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  database.exec(`
    DELETE FROM users; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions;
    DELETE FROM user_team_permissions; DELETE FROM account_profiles; DELETE FROM audit_logs;
    DELETE FROM project_teams; DELETE FROM athletes; DELETE FROM athlete_origins;
    DELETE FROM coach_profiles; DELETE FROM coach_athletes; DELETE FROM coach_work_status; DELETE FROM team_work_status; DELETE FROM user_dashboard_preferences; DELETE FROM registration_requests;
    DELETE FROM training_plans; DELETE FROM special_training_plans; DELETE FROM special_training_plan_sessions;
    INSERT INTO users (id,username,display_name,role,athlete_id) VALUES
      (1,'manager','全国管理者','DMD',NULL), (2,'coach2','教练甲','SCC',NULL),
      (3,'coach3','教练乙','SCC',NULL), (4,'empty','空队教练','SCC',NULL),
      (5,'regional','四川管理者','REG',NULL), (6,'athlete','运动员本人','ATL',101);
    INSERT INTO user_area_permissions (user_id,area_level,province,city,county) VALUES
      (1,'national','','',''), (2,'province','四川','',''), (3,'province','四川','',''),
      (4,'province','四川','',''), (5,'province','四川','',''), (6,'province','四川','','');
    INSERT INTO user_project_permissions (user_id,project) VALUES
      (1,'*'), (2,'ROWING'), (3,'ROWING'), (4,'ROWING'), (5,'ROWING'), (6,'ROWING');
    INSERT INTO user_team_permissions (user_id,project,team) VALUES
      (1,'*','*'), (2,'ROWING','A队'), (3,'ROWING','A队'), (4,'ROWING','空队'),
      (5,'ROWING','A队'), (6,'ROWING','A队');
    INSERT INTO project_teams VALUES (10,'ROWING','A队',1), (11,'ROWING','B队',1),
      (12,'ROWING','空队',1), (20,'CANOE_SPRINT','A队',1);
    INSERT INTO athletes VALUES
      (101,'四川队员','ROWING','A队',10,1,'男'),
      (102,'浙江队员','ROWING','A队',10,1,'女'),
      (103,'未填归属队员','ROWING','A队',10,1,'男'),
      (104,'其他队队员','ROWING','B队',11,1,'男'),
      (201,'其他项目队员','CANOE_SPRINT','A队',20,1,'女');
    INSERT INTO athlete_origins VALUES (101,'四川','成都市','武侯区'),
      (102,'浙江','杭州市','西湖区'), (104,'四川','成都市','武侯区'),
      (201,'四川','成都市','武侯区');
    INSERT INTO coach_athletes VALUES (2,104), (4,101);
  `);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
  vi.unstubAllEnvs();
});

function headers(actor: number) {
  return {
    Authorization: `Bearer ${jwt.sign({ id: actor, sessionVersion: 0 }, secret, { expiresIn: '5m' })}`,
    'Content-Type': 'application/json',
  };
}
async function assignments(actor: number) {
  const response = await fetch(`${baseUrl}/api/admin/assignments`, { headers: headers(actor) });
  expect(response.status).toBe(200);
  return (await response.json()) as AssignmentPayload;
}
const newOrigin = { region: '四川', city: '成都市', county: '锦江区' };
function update(body: unknown, actor = 1, athleteId = '101') {
  return fetch(`${baseUrl}/api/admin/assignments/${athleteId}`, {
    method: 'PUT',
    headers: headers(actor),
    body: JSON.stringify(body),
  });
}

describe('队伍责任范围 HTTP 集成', () => {
  it('仅范围内上级可分配多个教练类别，非法类别不会覆盖原分配', async () => {
    const save = (actor: number, coach: number, categories: string[]) =>
      fetch(`${baseUrl}/api/admin/coaches/${coach}/category`, {
        method: 'PUT', headers: headers(actor), body: JSON.stringify({ categories }),
      });
    const categories = ['主管教练', '专项教练', '体能教练', '康复治疗师'];
    expect((await save(2, 2, categories)).status).toBe(403);
    expect((await save(5, 4, categories)).status).toBe(404);
    expect((await save(1, 2, categories)).status).toBe(200);
    expect((await save(1, 2, ['DMD'])).status).toBe(400);
    const payload = await assignments(2);
    expect(payload.coaches[0]).toMatchObject({ id: 2, categories: expect.arrayContaining(categories) });
    expect((await save(1, 2, [])).status).toBe(200);
    expect((await assignments(2)).coaches[0]).toMatchObject({ categories: [] });
  });

  it('SCC 可见跨生源与缺失归属的全队，关系来自队伍且不受错误旧关联影响', async () => {
    const payload = await assignments(2);
    expect(payload.athletes.map((athlete) => athlete.id).sort()).toEqual([101, 102, 103]);
    expect(payload.athletes).toHaveLength(3);
    expect(payload.athletes.find((athlete) => athlete.id === 101)).toMatchObject({
      coachIds: '3,2',
      coachUsers: [
        { id: 3, displayName: '教练乙' },
        { id: 2, displayName: '教练甲' },
      ],
    });
    expect(payload.coaches.map((coach) => coach.id)).toEqual([2]);
  });

  it('统一计划接口覆盖无账号队员，并隔离跨队、跨项目及项目级计划', async () => {
    database.exec(`INSERT INTO training_plans(id,athlete_id,title,start_date,end_date,created_by,plan_data) VALUES
      (1,101,'甲计划','2026-10-01','2026-10-31',2,'{}'),
      (2,102,'乙计划','2026-10-01','2026-10-31',2,'{}'),
      (3,103,'无账号计划','2026-10-01','2026-10-31',2,'{}'),
      (4,104,'其他队计划','2026-10-01','2026-10-31',2,'{}'),
      (5,201,'其他项目计划','2026-10-01','2026-10-31',2,'{}');
      INSERT INTO special_training_plans VALUES
      (1,'ROWING','2026-10-12','本人项目计划','active',2),
      (2,'ROWING','2026-10-12','他人项目计划','active',3),
      (3,'CANOE_SPRINT','2026-10-12','其他项目','active',2);`);
    const read = async (actor: number) => {
      const response = await fetch(`${baseUrl}/api/training-plans/catalog`, {
        headers: headers(actor),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as { plans: Array<{ key: string }> };
    };
    expect((await read(2)).plans.map((plan) => plan.key)).toEqual([
      'training_plans:1',
      'training_plans:2',
      'training_plans:3',
      'special_training_plans:1',
    ]);
    expect((await read(6)).plans.map((plan) => plan.key)).toEqual(['training_plans:1']);
    expect((await read(5)).plans.map((plan) => plan.key)).toEqual(['training_plans:1', 'training_plans:2', 'training_plans:3']);
    expect((await read(1)).plans).toHaveLength(8);
    expect((await fetch(`${baseUrl}/api/training-plans/catalog`)).status).toBe(401);
  });

  it('队伍人数和教练名单包含无登录账号队员，账号停用或删除不改变档案责任范围', async () => {
    const expectFullTeam = async () => {
      for (const path of ['/api/teams', '/api/admin/teams']) {
        const response = await fetch(`${baseUrl}${path}`, { headers: headers(2) });
        expect(response.status, await response.clone().text()).toBe(200);
        const payload = (await response.json()) as {
          teams: Array<{ id: number; athleteCount: number }>;
        };
        expect(payload.teams.find((team) => team.id === 10)?.athleteCount).toBe(3);
        expect(payload.teams.some((team) => team.id === 11 || team.id === 20)).toBe(false);
      }
      const payload = await assignments(2);
      expect(payload.athletes.map((athlete) => athlete.id).sort()).toEqual([101, 102, 103]);
      for (const athlete of payload.athletes) {
        expect(athlete.coachUsers.map((coach) => coach.id)).toContain(2);
      }
    };
    // 101 有登录账号，102、103 只有档案；三人应同属教练管理范围。
    await expectFullTeam();
    database.exec('UPDATE users SET active = 0 WHERE athlete_id = 101');
    await expectFullTeam();
    database.exec('DELETE FROM users WHERE athlete_id = 101');
    await expectFullTeam();
  });

  it('管理者返回授权队伍的跨省和缺失生源地成员', async () => {
    const payload = await assignments(5);
    expect(payload.athletes.map((athlete) => athlete.id).sort()).toEqual([101, 102, 103]);
    expect(payload.athletes[0].coachUsers).toHaveLength(2);
  });

  it('全国管理者可管理绑定空队的教练，空队 SCC 仍返回自身且无成员', async () => {
    const payload = await assignments(1);
    expect(payload.athletes).toHaveLength(5);
    expect(payload.coaches.map((coach) => coach.id)).toEqual([2, 3, 4]);
    const empty = await assignments(4);
    expect(empty.athletes).toEqual([]);
    expect(empty.coaches.map((coach) => coach.id)).toEqual([4]);
  });

  it('省略 coachIds 可独立保存行政归属，并保持历史个人关系', async () => {
    expect((await update(newOrigin)).status).toBe(200);
    expect(database.prepare('SELECT * FROM athlete_origins WHERE athlete_id=101').get()).toEqual({
      athlete_id: 101,
      province: '四川',
      city: '成都市',
      county: '锦江区',
    });
    expect(database.prepare('SELECT * FROM coach_athletes ORDER BY coach_user_id').all()).toEqual([
      { coach_user_id: 2, athlete_id: 104 },
      { coach_user_id: 4, athlete_id: 101 },
    ]);
    expect(
      database.prepare('SELECT province,county FROM user_area_permissions WHERE user_id=6').get()
    ).toEqual({ province: '四川', county: '锦江区' });
  });

  it('兼容与当前派生集合相同的重复及乱序 coachIds', async () => {
    expect((await update({ ...newOrigin, coachIds: [2, 3, 2] })).status).toBe(200);
    expect(
      database.prepare('SELECT county FROM athlete_origins WHERE athlete_id=101').get()
    ).toEqual({ county: '锦江区' });
  });

  it('不同 coachIds 返回稳定 409，行政归属、账号范围、历史表和审计均不部分修改', async () => {
    const beforeOrigin = database.prepare('SELECT * FROM athlete_origins').all();
    const beforeAreas = database.prepare('SELECT * FROM user_area_permissions').all();
    const beforeLegacy = database.prepare('SELECT * FROM coach_athletes').all();
    const response = await update({ ...newOrigin, coachIds: [4] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'COACH_SCOPE_DERIVED_FROM_TEAM' });
    expect(database.prepare('SELECT * FROM athlete_origins').all()).toEqual(beforeOrigin);
    expect(database.prepare('SELECT * FROM user_area_permissions').all()).toEqual(beforeAreas);
    expect(database.prepare('SELECT * FROM coach_athletes').all()).toEqual(beforeLegacy);
    expect(database.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
  });

  it('补齐队伍所属项目后仍拒绝超出授权人范围的保存', async () => {
    database.exec("UPDATE user_project_permissions SET project='ROWING' WHERE user_id=1");
    const before = database.prepare('SELECT * FROM user_team_permissions WHERE user_id=2').all();
    const response = await fetch(`${baseUrl}/api/access/accounts/2`, {
      method: 'PUT', headers: headers(1),
      body: JSON.stringify({
        role: 'SCC', parentUserId: 1, areas: [], projects: ['ROWING'],
        teams: [{ project: 'CANOE_SPRINT', team: 'A队' }],
      }),
    });
    expect(response.status).toBe(403);
    expect(database.prepare('SELECT * FROM user_team_permissions WHERE user_id=2').all()).toEqual(before);
  });

  it('工作状态独立于账号启用状态和队伍权限，并拒绝越权修改', async () => {
    const put = (path: string, actor: number, body: object) => fetch(`${baseUrl}${path}`, {
      method: 'PUT', headers: headers(actor), body: JSON.stringify(body),
    });
    const coachPath = '/api/admin/coaches/2/work-status';
    const teamPath = '/api/admin/teams/10/work-status';
    expect((await put(coachPath, 2, { status: 'resting', teamId: null })).status).toBe(403);
    expect((await put(coachPath, 1, { status: 'inactive', teamId: null })).status).toBe(400);
    expect((await put(teamPath, 2, { status: 'on_leave' })).status).toBe(403);
    expect((await put('/api/admin/teams/11/work-status', 5, { status: 'on_leave' })).status).toBe(403);
    const teamResponse = await put(teamPath, 1, { status: 'on_leave' });
    expect(teamResponse.status).toBe(200);
    const coachResponse = await put(coachPath, 1, { status: 'substituting' });
    expect(coachResponse.status).toBe(200);
    expect(await coachResponse.json()).toMatchObject({
      workStatus: { status: 'substituting', updatedAt: expect.any(String) },
    });
    const response = await fetch(`${baseUrl}/api/admin/assignments`, { headers: headers(1) });
    expect(await response.json()).toMatchObject({ coaches: expect.arrayContaining([
      expect.objectContaining({ id: 2, workStatus: expect.objectContaining({ status: 'substituting' }) }),
    ]) });
    const coachView = await fetch(`${baseUrl}/api/admin/assignments`, { headers: headers(2) });
    expect(await coachView.json()).toMatchObject({ coaches: expect.arrayContaining([
      expect.objectContaining({ id: 2, workStatus: expect.objectContaining({ status: 'substituting' }) }),
    ]) });
    const teamsResponse = await fetch(`${baseUrl}/api/admin/teams`, { headers: headers(1) });
    expect(await teamsResponse.json()).toMatchObject({ teams: expect.arrayContaining([
      expect.objectContaining({ id: 10, workStatus: 'on_leave' }),
    ]) });
    expect((await assignments(2)).athletes.map(({ id }) => id).sort()).toEqual([101, 102, 103]);
    expect(database.prepare('SELECT active FROM users WHERE id=2').get()).toMatchObject({ active: 1 });
    const ended = await put(coachPath, 1, { status: 'at_center', teamId: null });
    expect(await ended.json()).toMatchObject({ workStatus: { status: 'at_center' } });
  });

  it('从管理名册删除离职教练和运动员，撤销账号访问并保留训练记录', async () => {
    database.exec(`
      INSERT INTO coach_work_status(user_id,status) VALUES (2,'training');
      INSERT INTO registration_requests(username) VALUES ('coach2');
      INSERT INTO training_plans(id,athlete_id,created_by) VALUES (42,101,2);
    `);
    const remove = (id: number, actor: number) => fetch(`${baseUrl}/api/access/accounts/${id}`, {
      method: 'DELETE', headers: headers(actor),
    });
    expect((await remove(2, 2)).status).toBe(403);
    expect((await remove(2, 1)).status).toBe(200);
    expect((await remove(2, 1)).status).toBe(404);
    const enable = await fetch(`${baseUrl}/api/access/accounts/2/status`, {
      method: 'PUT', headers: headers(1), body: JSON.stringify({ active: true }),
    });
    expect(enable.status).toBe(404);
    expect((await fetch(`${baseUrl}/api/admin/assignments`, { headers: headers(2) })).status).toBe(401);
    expect((await assignments(1)).coaches.map(({ id }) => id)).not.toContain(2);
    expect(database.prepare('SELECT 1 FROM coach_work_status WHERE user_id=2').get()).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM registration_requests WHERE username='coach2'").get()).toBeUndefined();
    expect((await remove(6, 1)).status).toBe(200);
    expect((await assignments(1)).athletes.map(({ id }) => id)).not.toContain(101);
    const list = await fetch(`${baseUrl}/api/access/accounts`, { headers: headers(1) });
    const payload = (await list.json()) as { accounts: Array<{ id: number }> };
    expect(payload.accounts.some(({ id }) => id === 2 || id === 6)).toBe(false);
    expect(database.prepare('SELECT created_by FROM training_plans WHERE id=42').get()).toMatchObject({ created_by: 2 });
  });

  it('下级账号未移交时拒绝删除上级', async () => {
    database.exec("INSERT INTO account_profiles(user_id,parent_user_id,account_code) VALUES(2,5,'child-account')");
    const result = await fetch(`${baseUrl}/api/access/accounts/5`, { method: 'DELETE', headers: headers(1) });
    expect(result.status).toBe(409);
    expect(database.prepare('SELECT active FROM users WHERE id=5').get()).toMatchObject({ active: 1 });
  });

  it('保存教练队伍授权时补齐所属项目，其他页面即时查询到负责教练', async () => {
    database.exec(`
      INSERT INTO account_profiles (user_id,parent_user_id,account_code) VALUES (2,1,'scope-sync');
    `);
    const response = await fetch(`${baseUrl}/api/access/accounts/2`, {
      method: 'PUT',
      headers: headers(1),
      body: JSON.stringify({
        role: 'SCC', parentUserId: 1, areas: [], projects: ['ROWING', 'CANOE_SLALOM'],
        teams: [
          { project: 'ROWING', team: 'A队' },
          { project: 'CANOE_SPRINT', team: 'A队' },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect(database.prepare('SELECT project FROM user_project_permissions WHERE user_id=2 ORDER BY project').all())
      .toEqual([{ project: 'CANOE_SPRINT' }, { project: 'ROWING' }]);
    const { readTeamCoaches } = await import('../core/coach-team-responsibility.ts');
    expect(readTeamCoaches(database, 'CANOE_SPRINT', 'A队').map(coach => coach.id)).toContain(2);
    expect((await assignments(2)).athletes.map(athlete => athlete.id)).toContain(201);
    const narrowed = await fetch(`${baseUrl}/api/access/accounts/2`, {
      method: 'PUT', headers: headers(1),
      body: JSON.stringify({
        role: 'SCC', parentUserId: 1, areas: [],
        projects: ['ROWING', 'CANOE_SPRINT'],
        teams: [{ project: 'ROWING', team: 'A队' }],
      }),
    });
    expect(narrowed.status).toBe(200);
    expect(database.prepare('SELECT project FROM user_project_permissions WHERE user_id=2').all())
      .toEqual([{ project: 'ROWING' }]);
    expect(readTeamCoaches(database, 'CANOE_SPRINT', 'A队').map(coach => coach.id)).not.toContain(2);

  });

  it.each([
    { coachIds: ['2'] },
    { coachIds: [-1] },
    { coachIds: null },
    { extra: true },
    { city: '' },
  ])('非法格式返回 400 且不写入 %#', async (invalid) => {
    expect((await update({ ...newOrigin, ...invalid })).status).toBe(400);
    expect(
      database.prepare('SELECT county FROM athlete_origins WHERE athlete_id=101').get()
    ).toEqual({ county: '武侯区' });
    expect(database.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
  });

  it('拒绝角色越权、不可见运动员及无效路径 ID', async () => {
    expect((await update(newOrigin, 2)).status).toBe(403);
    expect((await update(newOrigin, 6)).status).toBe(403);
    expect((await update(newOrigin, 5, '104')).status).toBe(400);
    expect((await update(newOrigin, 1, '101x')).status).toBe(400);
    expect(database.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
  });

  it('撤销队伍授权后下次 HTTP 查询立即失去全队可见性及派生关系', async () => {
    expect((await assignments(2)).athletes).toHaveLength(3);
    database.exec('DELETE FROM user_team_permissions WHERE user_id=2');
    expect((await assignments(2)).athletes).toEqual([]);
    const payload = await assignments(1);
    expect(payload.athletes.find((athlete) => athlete.id === 101)?.coachUsers).toEqual([
      { id: 3, displayName: '教练乙' },
    ]);
  });

  it('ATL 本人访问及上级管理者按项目队伍过滤', async () => {
    const { accessibleAthleteIds } = await import('../core/permissions.ts');
    const { userById } = await import('../core/utils.ts');
    expect(accessibleAthleteIds(userById(6)!)).toEqual([101]);
    expect(accessibleAthleteIds(userById(5)!)).toEqual([101, 102, 103]);
    const response = await fetch(`${baseUrl}/api/admin/assignments`, { headers: headers(6) });
    expect(response.status).toBe(403);
  });

  it('全国上级看到未绑定队伍 SCC，并可通过既有账号授权入口补齐负责队伍', async () => {
    database.exec(`
      DELETE FROM user_team_permissions WHERE user_id=2;
      INSERT INTO account_profiles (user_id,parent_user_id,account_code) VALUES (2,1,'test-coach');
    `);
    expect((await assignments(2)).athletes).toEqual([]);
    expect((await assignments(1)).coaches.map((coach) => coach.id)).toContain(2);
    expect((await assignments(5)).coaches.map((coach) => coach.id)).not.toContain(2);
    const list = await fetch(`${baseUrl}/api/access/accounts`, { headers: headers(1) });
    expect(list.status).toBe(200);
    const payload = (await list.json()) as { accounts: Array<{ id: number; teams: unknown[] }> };
    expect(payload.accounts.find((account) => account.id === 2)).toMatchObject({ teams: [] });

    const response = await fetch(`${baseUrl}/api/access/accounts/2`, {
      method: 'PUT',
      headers: headers(1),
      body: JSON.stringify({
        role: 'SCC',
        parentUserId: 1,
        areas: [{ areaLevel: 'province', province: '四川', city: '', county: '' }],
        projects: ['ROWING'],
        teams: [{ project: 'ROWING', team: 'A队' }],
      }),
    });
    expect(response.status).toBe(200);
    expect((await assignments(2)).athletes.map((athlete) => athlete.id).sort()).toEqual([
      101, 102, 103,
    ]);
    expect(database.prepare('SELECT * FROM coach_athletes WHERE coach_user_id=2').all()).toEqual([
      { coach_user_id: 2, athlete_id: 104 },
    ]);
  });

  it('未绑队 SCC 只允许覆盖其项目全部队伍的上级管理', async () => {
    database.exec('DELETE FROM user_team_permissions WHERE user_id=2');
    const { canManageAccount } = await import('../core/permissions.ts');
    const { userById } = await import('../core/utils.ts');
    expect(canManageAccount(userById(5)!, userById(2)!)).toBe(false);
    database.exec("UPDATE user_team_permissions SET team='*' WHERE user_id=5");
    expect(canManageAccount(userById(5)!, userById(2)!)).toBe(true);
    expect((await assignments(5)).coaches.map((coach) => coach.id)).toContain(2);
    database.exec("UPDATE user_project_permissions SET project='CANOE_SPRINT' WHERE user_id=5");
    expect(canManageAccount(userById(5)!, userById(2)!)).toBe(false);
    expect((await assignments(5)).coaches.map((coach) => coach.id)).not.toContain(2);
  });

  it('完全无范围的历史 SCC 仅全国全项目全队伍上级可见并能补齐授权', async () => {
    database.exec(`
      DELETE FROM user_area_permissions WHERE user_id=2;
      DELETE FROM user_project_permissions WHERE user_id=2;
      DELETE FROM user_team_permissions WHERE user_id=2;
    `);
    const { canManageAccount } = await import('../core/permissions.ts');
    const { userById } = await import('../core/utils.ts');
    expect(canManageAccount(userById(1)!, userById(2)!)).toBe(true);
    expect(canManageAccount(userById(5)!, userById(2)!)).toBe(false);
    expect(canManageAccount(userById(3)!, userById(2)!)).toBe(false);
    expect((await assignments(2)).athletes).toEqual([]);
    expect((await assignments(1)).coaches.map((coach) => coach.id)).toContain(2);
    const response = await fetch(`${baseUrl}/api/access/accounts/2`, {
      method: 'PUT',
      headers: headers(1),
      body: JSON.stringify({
        role: 'SCC',
        parentUserId: 1,
        areas: [{ areaLevel: 'province', province: '四川', city: '', county: '' }],
        projects: ['ROWING'],
        teams: [{ project: 'ROWING', team: 'A队' }],
      }),
    });
    expect(response.status).toBe(200);
    expect((await assignments(2)).athletes).toHaveLength(3);
  });

  it.each([
    "UPDATE user_project_permissions SET project='ROWING' WHERE user_id=1",
    "UPDATE user_team_permissions SET project='ROWING' WHERE user_id=1",
  ])('历史无范围 SCC 不向缺少任一全国完整授权的上级开放 %#', async (restriction) => {
    database.exec(`
      DELETE FROM user_area_permissions WHERE user_id=2;
      DELETE FROM user_project_permissions WHERE user_id=2;
      DELETE FROM user_team_permissions WHERE user_id=2;
    `);
    database.exec(restriction);
    const { canManageAccount } = await import('../core/permissions.ts');
    const { userById } = await import('../core/utils.ts');
    expect(canManageAccount(userById(1)!, userById(2)!)).toBe(false);
    expect((await assignments(1)).coaches.map((coach) => coach.id)).not.toContain(2);
  });
});
