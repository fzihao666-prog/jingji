import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../core/shared-server.ts';

vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
import { db } from '../core/db.ts';
import { dataImportScope } from './data-import-access.ts';
const database = db as DatabaseSync;
database.exec(`
  CREATE TABLE user_area_permissions (user_id INTEGER, area_level TEXT, province TEXT, city TEXT, county TEXT);
  CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT);
  CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT);
  CREATE TABLE project_teams (project TEXT, name TEXT, active INTEGER);
`);
const manager: AuthUser = { id: 1, role: 'DMD', username: 'fixture', displayName: '测试总监', athleteId: null, sessionVersion: 0 };
beforeEach(() => database.exec(`
  DELETE FROM user_area_permissions; DELETE FROM user_project_permissions;
  DELETE FROM user_team_permissions; DELETE FROM project_teams;
  INSERT INTO user_area_permissions VALUES (1,'national','','','');
  INSERT INTO user_project_permissions VALUES (1,'*');
  INSERT INTO user_team_permissions VALUES (1,'*','*');
`));
afterAll(() => database.close());

describe('模板访问权限独立于是否已有队伍', () => {
  it('全国全部范围总监可下载尚未建队项目的空模板', () => {
    const scope = dataImportScope(manager, 'SWIMMING');
    expect(scope.allowed).toBe(true);
    expect(scope.allowedTeams.size).toBe(0);
  });
  it('明确授权具体队伍时仍仅返回该队伍', () => {
    database.exec("DELETE FROM user_team_permissions; INSERT INTO user_team_permissions VALUES (1,'ROWING','A队'); INSERT INTO project_teams VALUES ('ROWING','A队',1),('ROWING','B队',1)");
    expect([...dataImportScope(manager, 'ROWING').allowedTeams]).toEqual(['A队']);
  });
  it('总监角色不能越过项目授权', () => {
    database.exec("DELETE FROM user_project_permissions; INSERT INTO user_project_permissions VALUES (1,'ROWING')");
    expect(dataImportScope(manager, 'SWIMMING').allowed).toBe(false);
  });
  it('缺少队伍授权时仍拒绝，不能按角色自动扩权', () => {
    database.exec('DELETE FROM user_team_permissions');
    expect(dataImportScope(manager, 'ROWING').allowed).toBe(false);
  });
  it('缺少行政授权时仍拒绝', () => {
    database.exec("DELETE FROM user_area_permissions; INSERT INTO project_teams VALUES ('ROWING','A队',1)");
    expect(dataImportScope(manager, 'ROWING').allowed).toBe(false);
  });
});
