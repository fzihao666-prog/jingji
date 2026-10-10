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
  upsertAthleteOrigin: vi.fn(),
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
    'DELETE FROM users; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions; DELETE FROM user_team_permissions; DELETE FROM audit_logs;'
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
