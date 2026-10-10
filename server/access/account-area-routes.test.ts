import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';

const fixture = vi.hoisted(() => {
  return { db: null as DatabaseSync | null };
});
vi.mock('../core/db.ts', () => ({
  upsertAthleteOrigin: vi.fn(
    (input: { athleteId: number; province: string; city: string; county: string }) => {
      fixture
        .db!.prepare(
          `INSERT INTO athlete_origins (athlete_id,province,city,county) VALUES (?,?,?,?)
      ON CONFLICT(athlete_id) DO UPDATE SET province=excluded.province,city=excluded.city,county=excluded.county`
        )
        .run(input.athleteId, input.province, input.city, input.county);
    }
  ),
  get db() {
    return fixture.db;
  },
}));

let server: Server;
let baseUrl: string;
let db: DatabaseSync;
let secret: string;
const initialPassword = 'OriginalTest123';

function token(id: number, sessionVersion = 0) {
  return jwt.sign({ id, sessionVersion }, secret, { expiresIn: '5m' });
}
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-only-password-reset-secret-not-for-deployment');
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT,
      athlete_id INTEGER, active INTEGER DEFAULT 1, session_version INTEGER DEFAULT 0, password_hash TEXT);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT, granted_by INTEGER);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT, granted_by INTEGER);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT, granted_by INTEGER);
    CREATE TABLE account_profiles (user_id INTEGER PRIMARY KEY, parent_user_id INTEGER, account_code TEXT, updated_at TEXT);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, project TEXT, team TEXT, team_id INTEGER, region TEXT, city TEXT, county TEXT);
    CREATE TABLE athlete_origins (athlete_id INTEGER PRIMARY KEY, province TEXT, city TEXT, county TEXT);
    CREATE TABLE coach_athletes (coach_user_id INTEGER, athlete_id INTEGER);
  `);
  const { registerAccessRoutes } = await import('./access-routes.ts');
  const auth = await import('../core/auth.ts');
  secret = auth.jwtSecret;
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  registerAccessRoutes(app);
  app.get('/session', auth.requireAuth, (_req, res) => res.json({ ok: true }));
  server = await new Promise<Server>((resolve) => {
    const result = app.listen(0, '127.0.0.1', () => resolve(result));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  db.exec(
    'DELETE FROM users; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions; DELETE FROM user_team_permissions; DELETE FROM audit_logs; DELETE FROM athletes; DELETE FROM athlete_origins; DELETE FROM project_teams; DELETE FROM coach_athletes; DELETE FROM account_profiles;'
  );
  for (const [id, role, province, project, team] of [
    [1, 'PRJ', '四川', 'ROWING', 'A队'],
    [2, 'ATL', '四川', 'ROWING', 'A队'],
    [3, 'PRJ', '四川', 'ROWING', 'A队'],
    [4, 'SCC', '四川', 'ROWING', 'A队'],
    [5, 'ATL', '浙江', 'ROWING', 'A队'],
    [6, 'ATL', '四川', 'CANOE_SPRINT', 'A队'],
    [7, 'ATL', '四川', 'ROWING', 'B队'],
    [8, 'DMD', '四川', 'ROWING', 'A队'],
  ] as const) {
    db.prepare(
      'INSERT INTO users (id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(id, `test${id}`, `测试${id}`, role, bcrypt.hashSync(initialPassword, 4));
    db.prepare(
      'INSERT INTO user_area_permissions (user_id,area_level,province,city,county) VALUES (?, ?, ?, ?, ?)'
    ).run(id, 'province', province, '', '');
    db.prepare('INSERT INTO user_project_permissions (user_id,project) VALUES (?, ?)').run(
      id,
      project
    );
    db.prepare('INSERT INTO user_team_permissions (user_id,project,team) VALUES (?, ?, ?)').run(
      id,
      project,
      team
    );
  }
  db.prepare(
    "UPDATE user_area_permissions SET area_level='national', province='',city='',county='' WHERE user_id=8"
  ).run();
  db.exec(`
    INSERT INTO project_teams VALUES (1,'ROWING','A队',1);
    INSERT INTO athletes VALUES (2,'ROWING','A队',1,'四川','成都市','武侯区');
    INSERT INTO athlete_origins VALUES (2,'四川','成都市','武侯区');
    UPDATE users SET athlete_id=2 WHERE id=2;
    INSERT INTO account_profiles VALUES (2,8,'test-account-code',NULL);
  `);
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});

const validArea = { areaLevel: 'county', province: '四川', city: '成都市', county: '武侯区' };
function input(areas: unknown[], role = 'SCC') {
  return {
    role,
    parentUserId: 8,
    areas,
    projects: ['ROWING'],
    teams: [{ project: 'ROWING', team: 'A队' }],
  };
}
async function updateArea(areas: unknown[]) {
  return fetch(`${baseUrl}/api/access/accounts/4`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(8)}` },
    body: JSON.stringify(input(areas)),
  });
}
async function createArea(areas: unknown[]) {
  return fetch(`${baseUrl}/api/access/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(8)}` },
    body: JSON.stringify({
      ...input(areas, 'PRJ'),
      username: 'newtest',
      password: initialPassword,
      displayName: '新建测试',
    }),
  });
}
describe('账号接口行政区域从属校验', () => {
  it.each([
    { ...validArea, city: '杭州市' },
    { ...validArea, county: '西湖区' },
    { ...validArea, province: '重庆', city: '重庆市', county: '渝北区' },
  ])('创建和更新拒绝非法或废止区域 %#', async (area) => {
    expect((await createArea([area])).status).toBe(400);
    expect((await updateArea([area])).status).toBe(400);
    expect(db.prepare('SELECT * FROM audit_logs').all()).toHaveLength(0);
  });
  it('创建和更新接受有效字典选择', async () => {
    expect((await createArea([validArea])).status).toBe(201);
    expect((await updateArea([validArea])).status).toBe(200);
  });
  it('只允许目标数据库中完全一致的历史范围原样保留', async () => {
    const legacy = { ...validArea, province: '重庆', city: '重庆市', county: '渝北区' };
    db.prepare(
      "UPDATE user_area_permissions SET area_level='county',province='重庆',city='重庆市',county='渝北区' WHERE user_id=4"
    ).run();
    expect((await updateArea([legacy])).status).toBe(200);
    expect((await createArea([legacy])).status).toBe(400);
    expect((await updateArea([{ ...legacy, city: '成都市' }])).status).toBe(400);
  });
});

async function updateAthlete(body: unknown, actor = 8, id = '2') {
  return fetch(`${baseUrl}/api/access/accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(actor)}` },
    body: JSON.stringify(body),
  });
}
const nationalArea = { areaLevel: 'national', province: '', city: '', county: '' };
describe('运动员待完善行政归属', () => {
  it('历史全国仅转换展示，不修改数据库，补全后同步档案并记录前后范围', async () => {
    db.exec(
      "UPDATE user_area_permissions SET area_level='national',province='',city='',county='' WHERE user_id=2"
    );
    const response = await fetch(`${baseUrl}/api/access/accounts`, {
      headers: { Authorization: `Bearer ${token(8)}` },
    });
    const payload = (await response.json()) as {
      accounts: Array<{ id: number; areaPending: boolean; standardName: string }>;
    };
    expect(payload.accounts.find((account) => account.id === 2)).toMatchObject({
      areaPending: true,
    });
    expect(payload.accounts.find((account) => account.id === 2)?.standardName).toContain(
      '行政归属待完善'
    );
    expect(
      db.prepare('SELECT area_level FROM user_area_permissions WHERE user_id=2').get()
    ).toEqual({ area_level: 'national' });
    expect((await updateAthlete(input([validArea], 'ATL'))).status).toBe(200);
    expect(
      db
        .prepare(
          'SELECT area_level,province,city,county FROM user_area_permissions WHERE user_id=2'
        )
        .get()
    ).toEqual({ area_level: 'county', province: '四川', city: '成都市', county: '武侯区' });
    expect(db.prepare('SELECT region,city,county,team FROM athletes WHERE id=2').get()).toEqual({
      region: '四川',
      city: '成都市',
      county: '武侯区',
      team: 'A队',
    });
    expect(
      db.prepare('SELECT province,city,county FROM athlete_origins WHERE athlete_id=2').get()
    ).toEqual({ province: '四川', city: '成都市', county: '武侯区' });
    const audit = db.prepare('SELECT action,detail FROM audit_logs').get() as {
      action: string;
      detail: string;
    };
    expect(audit.action).toBe('COMPLETE_ATHLETE_AREA');
    expect(JSON.parse(audit.detail)).toMatchObject({
      previousAreas: [nationalArea],
      permissions: { areas: [validArea] },
    });
  });
  it('未知归属允许全国范围上级补全，不扩大其他管理者的原有权限', async () => {
    db.exec(
      "UPDATE user_area_permissions SET area_level='county',province='',city='',county='' WHERE user_id=2"
    );
    expect((await updateAthlete(input([validArea], 'ATL'), 1)).status).toBe(404);
    expect((await updateAthlete(input([validArea], 'ATL'))).status).toBe(200);
  });
  it('已知省市的待完善账号可由覆盖该范围的上级补全', async () => {
    db.exec(
      "UPDATE user_area_permissions SET area_level='county',city='成都市',county='' WHERE user_id=2"
    );
    expect((await updateAthlete({ ...input([validArea], 'ATL'), parentUserId: 1 }, 1)).status).toBe(
      200
    );
  });
  it('历史全国展示不改变运动员仅访问本人的限制', async () => {
    db.exec(
      "UPDATE user_area_permissions SET area_level='national',province='',city='',county='' WHERE user_id=2"
    );
    const { accessibleAthleteIds } = await import('../core/permissions.ts');
    expect(
      accessibleAthleteIds({
        id: 2,
        username: 'test2',
        displayName: '测试2',
        role: 'ATL',
        athleteId: 2,
        sessionVersion: 0,
      })
    ).toEqual([2]);
  });
  it('拒绝运动员全国、省级、多区域、错误区县和额外字段', async () => {
    expect((await updateAthlete(input([nationalArea], 'ATL'))).status).toBe(400);
    expect(
      (await updateAthlete(input([{ ...validArea, areaLevel: 'province' }], 'ATL'))).status
    ).toBe(400);
    expect((await updateAthlete(input([validArea, validArea], 'ATL'))).status).toBe(400);
    expect((await updateAthlete(input([{ ...validArea, county: '西湖区' }], 'ATL'))).status).toBe(
      400
    );
    expect((await updateAthlete({ ...input([validArea], 'ATL'), areaPending: false })).status).toBe(
      400
    );
    expect((await updateAthlete(input([validArea], 'ATL'), 8, '2.5')).status).toBe(400);
    expect(db.prepare('SELECT * FROM audit_logs').all()).toHaveLength(0);
  });
  it('已有归属不可移到管理者范围之外', async () => {
    db.exec(
      "UPDATE user_area_permissions SET area_level='county',city='成都市',county='武侯区' WHERE user_id=2"
    );
    expect(
      (
        await updateAthlete(
          {
            ...input([{ ...validArea, province: '浙江', city: '杭州市', county: '西湖区' }], 'ATL'),
            parentUserId: 1,
          },
          1
        )
      ).status
    ).toBe(403);
    expect(db.prepare('SELECT * FROM audit_logs').all()).toHaveLength(0);
  });
  it('审计写入失败时账号范围、运动员归属和上级一起回滚', async () => {
    db.exec(
      "UPDATE user_area_permissions SET area_level='national',province='',city='',county='' WHERE user_id=2"
    );
    db.exec(
      "CREATE TEMP TRIGGER reject_area_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'测试审计失败'); END"
    );
    try {
      const next = { ...validArea, county: '青羊区' };
      expect((await updateAthlete(input([next], 'ATL'))).status).toBe(500);
      expect(
        db.prepare('SELECT area_level FROM user_area_permissions WHERE user_id=2').get()
      ).toEqual({ area_level: 'national' });
      expect(db.prepare('SELECT county FROM athlete_origins WHERE athlete_id=2').get()).toEqual({
        county: '武侯区',
      });
      expect(db.prepare('SELECT county FROM athletes WHERE id=2').get()).toEqual({
        county: '武侯区',
      });
      expect(db.prepare('SELECT account_code FROM account_profiles WHERE user_id=2').get()).toEqual(
        { account_code: 'test-account-code' }
      );
      expect(db.prepare('SELECT * FROM audit_logs').all()).toHaveLength(0);
    } finally {
      db.exec('DROP TRIGGER reject_area_audit');
    }
  });
});
