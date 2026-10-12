import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './shared-server.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('./db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
let database: DatabaseSync;
let resolveParent: typeof import('./athlete-parent.ts').resolveAthleteParent;
const currentUser: AuthUser = {
  id: 1,
  username: 'manager',
  displayName: '测试管理',
  role: 'REG',
  athleteId: null,
  sessionVersion: 0,
};
const permissions = {
  areas: [{ areaLevel: 'county' as const, province: '四川', city: '成都', county: '青羊' }],
  projects: ['ROWING'],
  teams: [{ project: 'ROWING', team: '乙队' }],
};
beforeAll(async () => {
  database = new DatabaseSync(':memory:');
  fixture.db = database;
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, active INTEGER);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT);
  `);
  resolveParent = (await import('./athlete-parent.ts')).resolveAthleteParent;
});
afterAll(() => database.close());
beforeEach(() =>
  database.exec(`
  DELETE FROM users; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions;
  DELETE FROM user_team_permissions; DELETE FROM audit_logs;
  INSERT INTO users VALUES (1,'REG',1),(2,'SCC',1),(3,'REG',1),(4,'ATL',1);
  INSERT INTO user_area_permissions VALUES (1,'national','','',''),(2,'province','天津','',''),(3,'province','天津','','');
  INSERT INTO user_project_permissions VALUES (1,'ROWING'),(2,'ROWING'),(3,'ROWING'),(4,'ROWING');
  INSERT INTO user_team_permissions VALUES (1,'ROWING','*'),(2,'ROWING','乙队'),(3,'ROWING','乙队'),(4,'ROWING','乙队');
`)
);
const resolve = (parentUserId: number | null) =>
  resolveParent({ athleteId: 10, parentUserId, currentUser, permissions });
describe('运动员转队同步上级', () => {
  it('旧教练仍覆盖新队伍时保留，不以籍贯区域限制教练', () => {
    expect(resolve(2)).toBe(2);
    expect(database.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
  });
  it('旧教练不覆盖新队伍时绑定当前合法管理者并审计', () => {
    database.prepare('UPDATE user_team_permissions SET team = ? WHERE user_id = 2').run('甲队');
    expect(resolve(2)).toBe(1);
    expect(database.prepare('SELECT action, detail FROM audit_logs').get()).toEqual({
      action: 'UPDATE_ATHLETE_PARENT',
      detail: '{"from":2,"to":1}',
    });
  });
  it('管理岗父级不覆盖新行政归属时重新绑定', () => expect(resolve(3)).toBe(1));
  it('管理岗覆盖新行政归属时保留', () => {
    database.prepare("UPDATE user_area_permissions SET province = '四川' WHERE user_id = 3").run();
    expect(resolve(3)).toBe(3);
  });
  it('停用父级、低层级父级和缺失父级均不保留', () => {
    database.prepare('UPDATE users SET active = 0 WHERE id = 2').run();
    expect(resolve(2)).toBe(1);
    expect(resolve(4)).toBe(1);
    expect(resolve(null)).toBe(1);
  });
  it('旧教练缺少目标项目权限时重新绑定', () => {
    database.prepare('DELETE FROM user_project_permissions WHERE user_id = 2').run();
    expect(resolve(2)).toBe(1);
  });
  it('当前操作者也不覆盖新范围时失败且事务回滚', () => {
    database.prepare("UPDATE user_team_permissions SET team = '甲队'").run();
    database.exec('BEGIN');
    database.prepare('UPDATE users SET active = 0 WHERE id = 4').run();
    expect(() => resolve(2)).toThrow('运动员新范围超出可绑定上级范围');
    database.exec('ROLLBACK');
    expect(database.prepare('SELECT active FROM users WHERE id = 4').get()).toEqual({ active: 1 });
    expect(database.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
  });
  it('事务回滚不会留下上级同步审计', () => {
    database.exec('BEGIN');
    expect(resolve(null)).toBe(1);
    database.exec('ROLLBACK');
    expect(database.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
  });
});
