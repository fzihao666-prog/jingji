import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import type { AuthUser } from '../core/shared-server.ts';

vi.mock('../core/permissions.ts', () => ({ accessibleAthleteIds: () => [1] }));
import { teamPlanScope } from './team-plan-scope.ts';

it('观察员可读取授权空队伍的计划，撤销后立即失去范围且同名队伍不混用', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE athletes(id INTEGER,name TEXT,team_id INTEGER,project TEXT,active INTEGER);
      CREATE TABLE project_teams(id INTEGER,project TEXT,name TEXT,active INTEGER);
      CREATE TABLE user_team_permissions(user_id INTEGER,project TEXT,team TEXT);
      CREATE TABLE user_project_permissions(user_id INTEGER,project TEXT);
      INSERT INTO project_teams VALUES(1,'ROWING','一队',1),(2,'ROWING','空队',1),(3,'CANOE_SPRINT','空队',1);
      INSERT INTO athletes VALUES(1,'甲',1,'ROWING',1),(2,'乙',3,'CANOE_SPRINT',1);
      INSERT INTO user_project_permissions VALUES(9,'ROWING');
      INSERT INTO user_team_permissions VALUES(9,'ROWING','一队'),(9,'ROWING','空队');
    `);
    const observer: AuthUser = {
      id: 9,
      username: 'observer',
      displayName: '观察员',
      role: 'OBS',
      athleteId: null,
      sessionVersion: 1,
    };
    const scope = teamPlanScope(db, observer);
    expect(scope.teams.map((team) => team.id)).toEqual([1, 2]);
    expect(scope.athletes.map((athlete) => athlete.id)).toEqual([1]);
    db.prepare('DELETE FROM user_team_permissions WHERE user_id = ? AND team = ?').run(9, '空队');
    expect(teamPlanScope(db, observer).teams.map((team) => team.id)).toEqual([1]);
  } finally {
    db.close();
  }
});
