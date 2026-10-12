import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  coachAthleteIds,
  readCoachAthleteRelations,
  readTeamCoaches,
} from './coach-team-responsibility.ts';

const databases: DatabaseSync[] = [];

function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, active INTEGER, display_name TEXT);
    CREATE TABLE user_project_permissions (user_id INTEGER, project TEXT);
    CREATE TABLE user_team_permissions (user_id INTEGER, project TEXT, team TEXT);
    CREATE TABLE project_teams (id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    CREATE TABLE athletes (
      id INTEGER PRIMARY KEY, project TEXT, team_id INTEGER, active INTEGER,
      province TEXT, city TEXT, county TEXT
    );
    CREATE TABLE coach_athletes (coach_user_id INTEGER, athlete_id INTEGER);
    INSERT INTO users VALUES
      (9, 'SCC', 1, '教练九'), (2, 'SCC', 1, '教练二'),
      (3, 'SCC', 1, '无项目授权'), (4, 'TD', 1, '上级管理者'),
      (5, 'SCC', 0, '停用教练'), (6, 'SCC', 1, '无队伍授权');
    INSERT INTO user_project_permissions VALUES
      (9, '赛艇'), (2, '赛艇'), (4, '赛艇'), (5, '赛艇'), (6, '赛艇');
    INSERT INTO user_team_permissions VALUES
      (9, '赛艇', '甲队'), (9, '赛艇', '乙队'), (2, '赛艇', '甲队'),
      (3, '赛艇', '甲队'), (4, '赛艇', '甲队'), (5, '赛艇', '甲队');
    INSERT INTO project_teams VALUES
      (10, '赛艇', '甲队', 1), (11, '赛艇', '乙队', 1),
      (20, '皮划艇', '甲队', 1), (30, '赛艇', '停用队', 0),
      (40, '赛艇', '空队', 1);
    INSERT INTO athletes VALUES
      (102, '赛艇', 10, 1, '乙省', '乙市', '乙县'),
      (101, '赛艇', 10, 1, '甲省', '甲市', '甲县'),
      (103, '赛艇', 10, 1, NULL, NULL, NULL),
      (104, '赛艇', 11, 1, NULL, NULL, NULL),
      (201, '皮划艇', 20, 1, NULL, NULL, NULL),
      (301, '赛艇', 30, 1, NULL, NULL, NULL),
      (401, '赛艇', NULL, 1, NULL, NULL, NULL),
      (402, '赛艇', 999, 1, NULL, NULL, NULL),
      (403, '赛艇', 10, 0, NULL, NULL, NULL),
      (404, '皮划艇', 10, 1, NULL, NULL, NULL);
  `);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('队伍派生教练责任关系', () => {
  it('覆盖全队跨生源和未填行政归属队员，跨队汇总按运动员 ID 稳定排序', () => {
    const database = setup();
    expect(coachAthleteIds(database, 9)).toEqual([101, 102, 103, 104]);
    expect(coachAthleteIds(database, 2)).toEqual([101, 102, 103]);
  });

  it('同队多教练按姓名和 ID 稳定排序，重复和重叠授权不重复关系', () => {
    const database = setup();
    database.exec(`
      INSERT INTO user_team_permissions VALUES (9, '赛艇', '甲队'), (9, '赛艇', '*');
      INSERT INTO user_project_permissions VALUES (9, '赛艇');
    `);
    expect(readCoachAthleteRelations(database, [102, 101, 101])).toEqual([
      { athleteId: 101, id: 9, displayName: '教练九' },
      { athleteId: 102, id: 9, displayName: '教练九' },
      { athleteId: 101, id: 2, displayName: '教练二' },
      { athleteId: 102, id: 2, displayName: '教练二' },
    ]);
    expect(readTeamCoaches(database, '赛艇', '甲队')).toEqual([
      { id: 9, displayName: '教练九' },
      { id: 2, displayName: '教练二' },
    ]);
    expect(coachAthleteIds(database, 9)).toEqual([101, 102, 103, 104]);
  });

  it('同名跨项目队伍隔离，项目不匹配及无效队伍不产生关系', () => {
    const database = setup();
    expect(readCoachAthleteRelations(database, [201, 301, 401, 402, 403, 404])).toEqual([]);
    expect(readTeamCoaches(database, '皮划艇', '甲队')).toEqual([]);
    expect(readTeamCoaches(database, '赛艇', '停用队')).toEqual([]);
    expect(readTeamCoaches(database, '赛艇', '不存在的队伍')).toEqual([]);
  });

  it('只允许有效 SCC 且同时具备项目与队伍权限的账号', () => {
    const database = setup();
    expect(coachAthleteIds(database, 3)).toEqual([]);
    expect(coachAthleteIds(database, 4)).toEqual([]);
    expect(coachAthleteIds(database, 5)).toEqual([]);
    expect(coachAthleteIds(database, 6)).toEqual([]);
    expect(coachAthleteIds(database, 999)).toEqual([]);
  });

  it('项目与队伍通配授权展开到有效队伍，仍要求项目授权匹配', () => {
    const database = setup();
    database.exec(`
      INSERT INTO user_team_permissions VALUES (6, '*', '*');
      INSERT INTO user_project_permissions VALUES (2, '*');
      INSERT INTO user_team_permissions VALUES (2, '*', '甲队');
    `);
    expect(coachAthleteIds(database, 6)).toEqual([101, 102, 103, 104]);
    expect(coachAthleteIds(database, 2)).toEqual([101, 102, 103, 201]);
  });

  it('入队、转队和离队在下一次查询立即生效', () => {
    const database = setup();
    database.exec('UPDATE athletes SET team_id = 10 WHERE id = 401');
    expect(coachAthleteIds(database, 2)).toEqual([101, 102, 103, 401]);
    database.exec('UPDATE athletes SET team_id = 11 WHERE id = 101');
    expect(coachAthleteIds(database, 2)).toEqual([102, 103, 401]);
    database.exec('UPDATE athletes SET team_id = NULL WHERE id = 102');
    expect(coachAthleteIds(database, 2)).toEqual([103, 401]);
  });

  it('撤销队伍或项目授权后下一次查询立即失去责任关系', () => {
    const database = setup();
    database.exec("DELETE FROM user_team_permissions WHERE user_id = 9 AND team = '甲队'");
    expect(coachAthleteIds(database, 9)).toEqual([104]);
    database.exec('DELETE FROM user_project_permissions WHERE user_id = 9');
    expect(coachAthleteIds(database, 9)).toEqual([]);
  });

  it('运动员、队伍和教练停用后下一次查询立即排除', () => {
    const database = setup();
    database.exec('UPDATE athletes SET active = 0 WHERE id = 101');
    expect(coachAthleteIds(database, 2)).toEqual([102, 103]);
    database.exec('UPDATE project_teams SET active = 0 WHERE id = 10');
    expect(coachAthleteIds(database, 9)).toEqual([104]);
    expect(readTeamCoaches(database, '赛艇', '甲队')).toEqual([]);
    database.exec('UPDATE users SET active = 0 WHERE id = 9');
    expect(coachAthleteIds(database, 9)).toEqual([]);
    expect(readCoachAthleteRelations(database)).toEqual([]);
  });

  it('旧逐人表中的错误关联不改变责任关系，删除旧表后仍可查询', () => {
    const database = setup();
    database.exec('INSERT INTO coach_athletes VALUES (2, 104), (2, 201), (6, 101)');
    expect(coachAthleteIds(database, 2)).toEqual([101, 102, 103]);
    expect(coachAthleteIds(database, 6)).toEqual([]);
    database.exec('DROP TABLE coach_athletes');
    expect(readTeamCoaches(database, '赛艇', '乙队')).toEqual([{ id: 9, displayName: '教练九' }]);
    expect(readCoachAthleteRelations(database, [104])).toEqual([
      { athleteId: 104, id: 9, displayName: '教练九' },
    ]);
  });

  it('空队伍仍可用于新增运动员的教练校验，空 ID 过滤不泄露其他关系', () => {
    const database = setup();
    database.exec("INSERT INTO user_team_permissions VALUES (2, '赛艇', '空队')");
    expect(readTeamCoaches(database, '赛艇', '空队')).toEqual([{ id: 2, displayName: '教练二' }]);
    expect(readCoachAthleteRelations(database, [])).toEqual([]);
    expect(readCoachAthleteRelations(database, [999])).toEqual([]);
  });
});
