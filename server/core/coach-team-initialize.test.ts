import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { initializeDatabase } from './db-initialize.ts';
import { coachAthleteIds, readCoachAthleteRelations } from './coach-team-responsibility.ts';

const options = { databasePath: ':memory:', databaseExistedBeforeStartup: false };

function userId(db: DatabaseSync, username: string): number {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!row || typeof row.id !== 'number') throw new Error('隔离测试账号不存在');
  return row.id;
}

function businessCounts(db: DatabaseSync) {
  return db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM athletes) AS athletes,
      (SELECT COUNT(*) FROM training_sessions) AS trainingSessions,
      (SELECT COUNT(*) FROM daily_wellness) AS wellness,
      (SELECT COUNT(*) FROM test_sessions) AS testSessions
  `
    )
    .get();
}

describe('队伍责任关系初始化兼容', () => {
  it('全新演示库直接建立项目和队伍授权，不生成逐人关系', () => {
    const db = new DatabaseSync(':memory:');
    try {
      initializeDatabase(db, options);
      const coachId = userId(db, 'coach01');
      const secondCoachId = userId(db, 'coach02');
      expect(
        db
          .prepare(
            `
          SELECT COUNT(*) AS activeAthletes, COUNT(team_id) AS athletesWithTeam
          FROM athletes WHERE active = 1
        `
          )
          .get()
      ).toEqual({ activeAthletes: 8, athletesWithTeam: 8 });
      expect(coachAthleteIds(db, coachId)).toEqual([1, 2, 3, 4]);
      expect(coachAthleteIds(db, secondCoachId)).toEqual([1, 2, 5, 6, 7, 8]);
      const relations = readCoachAthleteRelations(db);
      expect(
        relations
          .filter((relation) => relation.id === coachId)
          .map((relation) => relation.athleteId)
      ).toEqual([1, 2, 3, 4]);
      expect(
        relations
          .filter((relation) => relation.id === secondCoachId)
          .map((relation) => relation.athleteId)
      ).toEqual([1, 2, 5, 6, 7, 8]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM coach_athletes').get()).toEqual({
        count: 0,
      });
      expect(
        db
          .prepare(
            'SELECT project FROM user_project_permissions WHERE user_id = ? ORDER BY project'
          )
          .all(coachId)
      ).toEqual([{ project: 'ROWING' }]);
      expect(
        db
          .prepare(
            'SELECT project, team FROM user_team_permissions WHERE user_id = ? ORDER BY project, team'
          )
          .all(coachId)
      ).toEqual([
        { project: 'ROWING', team: '女子双桨组' },
        { project: 'ROWING', team: '男子单桨组' },
      ]);
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM user_area_permissions WHERE user_id = ?')
          .get(coachId)
      ).toEqual({ count: 2 });
      expect(
        db
          .prepare(
            `
        SELECT COUNT(*) AS count FROM user_team_permissions permission
        JOIN users account ON account.id = permission.user_id
        JOIN project_teams team ON team.project = permission.project AND team.name = permission.team
        WHERE account.role = 'SCC' AND team.active = 1
      `
          )
          .get()
      ).toEqual({ count: 7 });
    } finally {
      db.close();
    }
  }, 30_000);

  it('重复初始化不恢复已撤销队伍授权，也不删除运动员和训练事实', () => {
    const db = new DatabaseSync(':memory:');
    try {
      initializeDatabase(db, options);
      const coachId = userId(db, 'coach01');
      db.prepare('DELETE FROM user_team_permissions WHERE user_id = ?').run(coachId);
      const counts = businessCounts(db);

      initializeDatabase(db, { ...options, databaseExistedBeforeStartup: true });
      initializeDatabase(db, { ...options, databaseExistedBeforeStartup: true });

      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM user_team_permissions WHERE user_id = ?')
          .get(coachId)
      ).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM coach_athletes').get()).toEqual({
        count: 0,
      });
      expect(businessCounts(db)).toEqual(counts);
    } finally {
      db.close();
    }
  }, 30_000);

  it('旧授权初始化标记缺失时保留历史关联，不从旧关系补授权或推导运动员上级', () => {
    const db = new DatabaseSync(':memory:');
    try {
      initializeDatabase(db, options);
      const coachId = userId(db, 'coach01');
      const adminId = userId(db, 'admin01');
      const directorId = userId(db, 'executive01');
      const athlete = db
        .prepare("SELECT id FROM athletes WHERE project = 'CANOE_SPRINT' ORDER BY id LIMIT 1")
        .get();
      if (!athlete || typeof athlete.id !== 'number') throw new Error('隔离测试运动员不存在');
      const legacyCoachId = Number(
        db
          .prepare(
            `
        INSERT INTO users (username, password_hash, display_name, role)
        VALUES ('fixture_legacy_coach', 'fixture-only-hash', '历史教练测试账号', 'SCC')
      `
          )
          .run().lastInsertRowid
      );
      const legacyAthleteUserId = Number(
        db
          .prepare(
            `
        INSERT INTO users (username, password_hash, display_name, role, athlete_id)
        VALUES ('fixture_legacy_athlete', 'fixture-only-hash', '历史运动员测试账号', 'ATL', ?)
      `
          )
          .run(athlete.id).lastInsertRowid
      );
      db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(
        coachId,
        athlete.id
      );
      db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(
        legacyCoachId,
        athlete.id
      );
      db.prepare('DELETE FROM user_team_permissions WHERE user_id = ?').run(coachId);
      db.prepare("DELETE FROM app_metadata WHERE key = 'access_model_seed_v1'").run();
      const historicalRelationships = db
        .prepare('SELECT * FROM coach_athletes ORDER BY coach_user_id, athlete_id')
        .all();
      const counts = businessCounts(db);
      const existingParent = db
        .prepare('SELECT parent_user_id FROM account_profiles WHERE user_id = ?')
        .get(coachId);

      initializeDatabase(db, { ...options, databaseExistedBeforeStartup: true });
      initializeDatabase(db, { ...options, databaseExistedBeforeStartup: true });

      expect(
        db.prepare('SELECT * FROM coach_athletes ORDER BY coach_user_id, athlete_id').all()
      ).toEqual(historicalRelationships);
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM user_team_permissions WHERE user_id = ?')
          .get(coachId)
      ).toEqual({ count: 0 });
      expect(
        db
          .prepare(
            `
        SELECT
          (SELECT COUNT(*) FROM user_area_permissions WHERE user_id = ?) AS areas,
          (SELECT COUNT(*) FROM user_project_permissions WHERE user_id = ?) AS projects,
          (SELECT COUNT(*) FROM user_team_permissions WHERE user_id = ?) AS teams
      `
          )
          .get(legacyCoachId, legacyCoachId, legacyCoachId)
      ).toEqual({ areas: 0, projects: 0, teams: 0 });
      expect(
        db.prepare('SELECT parent_user_id FROM account_profiles WHERE user_id = ?').get(coachId)
      ).toEqual(existingParent);
      expect(
        db
          .prepare('SELECT parent_user_id FROM account_profiles WHERE user_id = ?')
          .get(legacyCoachId)
      ).toEqual({ parent_user_id: directorId });
      expect(
        db
          .prepare('SELECT parent_user_id FROM account_profiles WHERE user_id = ?')
          .get(legacyAthleteUserId)
      ).toEqual({ parent_user_id: adminId });
      expect(businessCounts(db)).toEqual(counts);
    } finally {
      db.close();
    }
  }, 30_000);
});
