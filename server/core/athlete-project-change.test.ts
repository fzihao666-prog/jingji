import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { assertAthleteProjectChangeAllowed } from './athlete-project-change.ts';
it('历史事实阻止直接改项目，同项目别名及无事实修改允许', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE athletes(id INTEGER,project TEXT); INSERT INTO athletes VALUES(1,'ROWING'),(2,'ROWING'); CREATE TABLE training_sessions(athlete_id INTEGER); INSERT INTO training_sessions VALUES(1)");
    expect(() => assertAthleteProjectChangeAllowed(db, 1, 'VOLLEYBALL')).toThrow('历史');
    expect(() => assertAthleteProjectChangeAllowed(db, 1, '赛艇')).not.toThrow();
    expect(() => assertAthleteProjectChangeAllowed(db, 2, 'VOLLEYBALL')).not.toThrow();
    db.exec("CREATE TABLE special_test_results(member_athlete_ids TEXT); INSERT INTO special_test_results VALUES('[2]')");
    expect(() => assertAthleteProjectChangeAllowed(db, 2, 'VOLLEYBALL')).toThrow('历史');
  } finally { db.close(); }
});
