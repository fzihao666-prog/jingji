import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { AuthUser } from '../core/shared-server.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
let db: DatabaseSync;
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
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, display_name TEXT, role TEXT, athlete_id INTEGER);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, name TEXT, project TEXT, team TEXT, team_id INTEGER, gender TEXT, birth_date TEXT);
    CREATE TABLE athlete_origins (athlete_id INTEGER PRIMARY KEY, province TEXT, city TEXT, county TEXT, source TEXT, quality TEXT);
    CREATE TABLE athlete_profiles (athlete_id INTEGER PRIMARY KEY, identity_number TEXT, native_place TEXT, phone TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT, granted_by INTEGER);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT, granted_by INTEGER);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT, granted_by INTEGER);
    CREATE TABLE account_profiles (user_id INTEGER PRIMARY KEY, parent_user_id INTEGER, account_code TEXT);
    CREATE TABLE coach_profiles (user_id INTEGER, category TEXT);
    CREATE TABLE coach_athletes (coach_user_id INTEGER, athlete_id INTEGER, UNIQUE(coach_user_id,athlete_id));
    CREATE TABLE registration_requests (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, display_name TEXT, requested_role TEXT, project TEXT, team TEXT, gender TEXT, status TEXT, identity_number TEXT, native_place TEXT, phone TEXT, reviewed_by INTEGER, reviewed_at TEXT);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT);
  `);
  activate = (await import('./registration-service.ts')).activateRegistrationRequest;
});
beforeEach(() => {
  db.exec(`DELETE FROM users; DELETE FROM athletes; DELETE FROM athlete_origins; DELETE FROM athlete_profiles; DELETE FROM account_profiles; DELETE FROM user_area_permissions; DELETE FROM user_project_permissions; DELETE FROM user_team_permissions; DELETE FROM registration_requests; DELETE FROM project_teams; DELETE FROM audit_logs; DELETE FROM coach_profiles; DELETE FROM coach_athletes;
    INSERT INTO users (id,username,display_name,role) VALUES (1,'reviewer','测试审核人','DMD');
    INSERT INTO project_teams VALUES (1,'ROWING','测试队',1);
    INSERT INTO user_area_permissions VALUES (1,'national','','','',1);
    INSERT INTO user_project_permissions VALUES (1,'ROWING',1);
    INSERT INTO user_team_permissions VALUES (1,'ROWING','测试队',1);
    INSERT INTO registration_requests (id,username,password_hash,display_name,requested_role,project,team,gender,status,native_place) VALUES (1,'newathlete','test-only-hash','测试运动员','ATL','ROWING','测试队','男','pending','浙江/杭州市');
  `);
});
afterAll(() => db.close());
function area(userId: number) {
  return db
    .prepare('SELECT area_level,province,city,county FROM user_area_permissions WHERE user_id=?')
    .get(userId);
}
function existingOrigin(county = '武侯区') {
  db.exec("INSERT INTO athletes VALUES (10,'测试运动员','ROWING','测试队',1,'男',NULL)");
  db.prepare("INSERT INTO athlete_origins VALUES (10,'四川','成都市',?,'manual','valid')").run(
    county
  );
}
describe('运动员注册行政归属', () => {
  it.each([reviewer, null])('无已确认归属时使用待完善区县，不继承审核范围或籍贯 %#', (actor) => {
    const result = activate(1, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(area(result.userId)).toEqual({
      area_level: 'county',
      province: '',
      city: '',
      county: '',
    });
    expect(db.prepare('SELECT * FROM athlete_origins').all()).toHaveLength(0);
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
