import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './shared-server.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('./db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
let db: DatabaseSync;
let permissions: typeof import('./permissions.ts');
beforeAll(async () => {
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, active INTEGER);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, project TEXT, team TEXT, team_id INTEGER, active INTEGER);
    CREATE TABLE athlete_origins (athlete_id INTEGER, province TEXT, city TEXT, county TEXT);
    INSERT INTO users VALUES (1,'SCC',1);
    INSERT INTO user_area_permissions VALUES (1,'province','四川','','');
    INSERT INTO user_project_permissions VALUES (1,'ROWING');
    INSERT INTO user_team_permissions VALUES (1,'ROWING','甲队');
    INSERT INTO project_teams VALUES (1,'ROWING','甲队',1),(2,'ROWING','乙队',1),(3,'CANOE','甲队',1);
    INSERT INTO athletes VALUES (10,'ROWING','甲队',1,1),(11,'ROWING','甲队',1,1),(12,'ROWING','甲队',1,1),
      (13,'ROWING','乙队',2,1),(14,'CANOE','甲队',3,1),(15,'ROWING','甲队',1,0);
    INSERT INTO athlete_origins VALUES (10,'四川','',''),(11,'天津','',''),(13,'四川','',''),(14,'四川','','');
  `);
  permissions = await import('./permissions.ts');
});
afterAll(() => db.close());
function user(role: AuthUser['role']): AuthUser {
  return {
    id: 1,
    role,
    username: 'fixture',
    displayName: '测试账号',
    athleteId: role === 'ATL' ? 11 : null,
    sessionVersion: 0,
  };
}
describe('按角色裁剪运动员访问范围', () => {
  it('SCC 覆盖本队所有在用队员，不受跨省或缺失归属限制', () => {
    expect(permissions.accessibleAthleteIds(user('SCC'))).toEqual([10, 11, 12]);
    expect(permissions.hasAthleteAccess(user('SCC'), 11)).toBe(true);
    expect(permissions.hasAthleteAccess(user('SCC'), 12)).toBe(true);
    expect(permissions.hasAthleteAccess(user('SCC'), 13)).toBe(false);
    expect(permissions.hasAthleteAccess(user('SCC'), 14)).toBe(false);
  });
  it.each(['REG', 'TD', 'DMD'] as const)('%s 保留行政区域、项目和队伍交集', (role) => {
    expect(permissions.accessibleAthleteIds(user(role))).toEqual([10]);
    expect(permissions.hasAthleteAccess(user(role), 11)).toBe(false);
  });
  it('ATL 仅本人', () => {
    expect(permissions.accessibleAthleteIds(user('ATL'))).toEqual([11]);
    expect(permissions.hasAthleteAccess(user('ATL'), 10)).toBe(false);
  });
  it('权限三元组助手保留地区校验', () => {
    expect(
      permissions.permissionsAllowAthlete(permissions.accountPermissions(1), {
        id: 11,
        project: 'ROWING',
        team: '甲队',
        region: '天津',
        city: '',
        county: '',
      })
    ).toBe(false);
  });
});
