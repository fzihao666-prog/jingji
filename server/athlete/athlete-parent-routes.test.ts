import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../core/shared-server.ts';

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
      ON CONFLICT(athlete_id) DO UPDATE SET province=excluded.province, city=excluded.city, county=excluded.county`
      )
      .run(input.athleteId, input.province, input.city, input.county);
  },
}));
let database: DatabaseSync;
let server: Server;
let baseUrl: string;
let secret: string;
let accessibleAthleteIds: typeof import('../core/permissions.ts').accessibleAthleteIds;

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-athlete-parent-not-for-deployment');
  database = new DatabaseSync(':memory:');
  fixture.db = database;
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT,
      athlete_id INTEGER, active INTEGER DEFAULT 1, session_version INTEGER DEFAULT 0);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT, granted_by INTEGER);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT, granted_by INTEGER);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT, granted_by INTEGER);
    CREATE TABLE account_profiles (user_id INTEGER PRIMARY KEY, parent_user_id INTEGER, account_code TEXT, updated_at TEXT);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, name TEXT, project TEXT, team TEXT, team_id INTEGER,
      active INTEGER, gender TEXT, birth_date TEXT, region TEXT, city TEXT, county TEXT, profile_status TEXT);
    CREATE TABLE athlete_origins (athlete_id INTEGER PRIMARY KEY, province TEXT, city TEXT, county TEXT);
    CREATE TABLE athlete_profiles (athlete_id INTEGER PRIMARY KEY, ethnicity TEXT, phone TEXT,
      blood_type TEXT, emergency_contact TEXT, emergency_phone TEXT, education TEXT, technical_level TEXT,
      position TEXT, health_status TEXT, best_result TEXT, native_place TEXT, home_address TEXT,
      athlete_status TEXT, start_sport_date TEXT, training_venue TEXT, current_event TEXT, training_phase TEXT,
      camp_period TEXT, origin_place TEXT, origin_unit TEXT, origin_coach TEXT, specialties TEXT, notes TEXT,
      updated_at TEXT);
  `);
  const { registerAthleteRoutes } = await import('./athlete-routes.ts');
  secret = (await import('../core/auth.ts')).jwtSecret;
  accessibleAthleteIds = (await import('../core/permissions.ts')).accessibleAthleteIds;
  const app = express();
  app.use(express.json());
  registerAthleteRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() =>
  database.exec(`
  DELETE FROM users; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions;
  DELETE FROM user_team_permissions; DELETE FROM account_profiles; DELETE FROM audit_logs;
  DELETE FROM project_teams; DELETE FROM athletes; DELETE FROM athlete_origins; DELETE FROM athlete_profiles;
  INSERT INTO users (id, username, display_name, role, athlete_id) VALUES
    (1,'manager','管理者','DMD',NULL),(2,'old','原队教练','SCC',NULL),
    (3,'new','新队教练','SCC',NULL),(4,'athlete','测试队员','ATL',101),(5,'regional','区域管理','REG',NULL);
  INSERT INTO user_area_permissions VALUES (1,'national','','','',1), (2,'province','浙江','','',1),
    (3,'province','浙江','','',1),(4,'county','四川','成都市','武侯区',1),(5,'province','四川','','',1);
  INSERT INTO user_project_permissions VALUES (1,'*',1),(2,'ROWING',1),(3,'ROWING',1),(4,'ROWING',1),(5,'ROWING',1);
  INSERT INTO user_team_permissions VALUES (1,'*','*',1),(2,'ROWING','A队',1),(3,'ROWING','B队',1),
    (4,'ROWING','A队',1),(5,'ROWING','*',1);
  INSERT INTO account_profiles VALUES (4,2,'test',NULL);
  INSERT INTO project_teams VALUES (10,'ROWING','A队',1),(11,'ROWING','B队',1);
  INSERT INTO athletes VALUES (101,'测试队员','ROWING','A队',10,1,'男','2000-01-01','四川','成都市','武侯区','complete');
  INSERT INTO athlete_origins VALUES (101,'四川','成都市','武侯区');
`)
);
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
  vi.unstubAllEnvs();
});
const payload = {
  name: '测试队员',
  project: 'ROWING',
  team: 'B队',
  gender: '男',
  birthDate: '2000-01-01',
  region: '四川',
  city: '成都市',
  county: '武侯区',
};
function update(body: Record<string, unknown> = payload, actor = 1) {
  return fetch(`${baseUrl}/api/admin/athletes/101`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${jwt.sign({ id: actor, sessionVersion: 0 }, secret, { expiresIn: '5m' })}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
function coach(id: number): AuthUser {
  return {
    id,
    username: 'coach',
    displayName: '测试教练',
    role: 'SCC',
    athleteId: null,
    sessionVersion: 0,
  };
}
describe('运动员转队真实 PUT 路由', () => {
  it('转队原子重算父级与账号范围，新旧队教练可见性立即变化', async () => {
    expect(accessibleAthleteIds(coach(2))).toEqual([101]);
    expect(accessibleAthleteIds(coach(3))).toEqual([]);
    expect((await update()).status).toBe(200);
    expect(
      database.prepare('SELECT parent_user_id FROM account_profiles WHERE user_id=4').get()
    ).toEqual({ parent_user_id: 1 });
    expect(
      database.prepare('SELECT team FROM user_team_permissions WHERE user_id=4').get()
    ).toEqual({ team: 'B队' });
    expect(accessibleAthleteIds(coach(2))).toEqual([]);
    expect(accessibleAthleteIds(coach(3))).toEqual([101]);
    expect(
      database.prepare("SELECT action FROM audit_logs WHERE action='UPDATE_ATHLETE_PARENT'").all()
    ).toEqual([{ action: 'UPDATE_ATHLETE_PARENT' }]);
  });
  it('旧父级覆盖新队伍时保留，即使教练区域与队员不同', async () => {
    database.prepare("INSERT INTO user_team_permissions VALUES (2,'ROWING','B队',1)").run();
    expect((await update()).status).toBe(200);
    expect(
      database.prepare('SELECT parent_user_id FROM account_profiles WHERE user_id=4').get()
    ).toEqual({ parent_user_id: 2 });
    expect(
      database.prepare("SELECT action FROM audit_logs WHERE action='UPDATE_ATHLETE_PARENT'").all()
    ).toEqual([]);
  });
  it('旧父级失效且当前操作者不覆盖待完善区域时，整次回滚', async () => {
    // 现有地区待完善检查允许进入事务，父级委派仍须严格覆盖新区域。
    expect(
      (
        await update(
          { ...payload, name: '修改队员', region: '未设置', city: '未设置', county: '未设置' },
          5
        )
      ).status
    ).toBe(409);
    expect(
      database.prepare('SELECT name, team, team_id, region FROM athletes WHERE id=101').get()
    ).toEqual({ name: '测试队员', team: 'A队', team_id: 10, region: '四川' });
    expect(
      database
        .prepare('SELECT province, city, county FROM athlete_origins WHERE athlete_id=101')
        .get()
    ).toEqual({ province: '四川', city: '成都市', county: '武侯区' });
    expect(database.prepare('SELECT display_name FROM users WHERE id=4').get()).toEqual({
      display_name: '测试队员',
    });
    expect(
      database.prepare('SELECT parent_user_id FROM account_profiles WHERE user_id=4').get()
    ).toEqual({ parent_user_id: 2 });
    expect(
      database.prepare('SELECT team FROM user_team_permissions WHERE user_id=4').get()
    ).toEqual({ team: 'A队' });
    expect(database.prepare('SELECT * FROM athlete_profiles').all()).toEqual([]);
    expect(database.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
  });
});
