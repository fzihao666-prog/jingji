import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';

it.each([
  [false, true, false],
  [true, true, false],
  [true, false, false],
  [true, false, true],
])(
  '合并旧角色，保留账号与关联且重复启动安全：六角色库=%s，已有授权=%s，中断恢复=%s',
  (hasProjectRole, hasExistingScope, interruptStartup) => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO app_metadata (key, value) VALUES ('core_seed_v1', 'complete');
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('ATL', 'SCC', ${hasProjectRole ? "'PRJ'," : ''} 'REG', 'TD', 'DMD')),
        athlete_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        session_version INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO users VALUES (9001, 'migration_test', 'synthetic_hash', '迁移测试账号', '${hasProjectRole ? 'PRJ' : 'REG'}', NULL, 0, 7);
      INSERT INTO users VALUES (1, 'admin01', 'synthetic_hash', '测试总监', 'DMD', NULL, 1, 1);
      INSERT INTO users VALUES (2, 'executive01', 'synthetic_hash', '测试训练总监', 'TD', NULL, 1, 1);
      CREATE TABLE migration_test_links (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO migration_test_links VALUES (9001);
      CREATE TABLE user_project_permissions (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        project TEXT NOT NULL, granted_by INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, project)
      );
      INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (9001, 'ROWING', 9001);
      CREATE TABLE user_team_permissions (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        project TEXT NOT NULL, team TEXT NOT NULL, granted_by INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, project, team)
      );
      INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (9001, 'ROWING', '测试队', 9001);
      CREATE TABLE user_area_permissions (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        area_level TEXT NOT NULL, province TEXT NOT NULL, city TEXT NOT NULL, county TEXT NOT NULL,
        granted_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, area_level, province, city, county)
      );
      INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
        VALUES (9001, 'province', '四川', '', '', 9001);
      CREATE TABLE account_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        parent_user_id INTEGER REFERENCES users(id), account_code TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO account_profiles (user_id, parent_user_id, account_code) VALUES (9001, NULL, 'historical-account-code');
    `);
      if (!hasExistingScope) {
        db.exec(
          'DELETE FROM user_area_permissions; DELETE FROM user_project_permissions; DELETE FROM user_team_permissions;'
        );
      }
      const scopeTables = [
        'user_area_permissions',
        'user_project_permissions',
        'user_team_permissions',
        'account_profiles',
      ];
      const beforeScopes = scopeTables.map((table) =>
        db.prepare(`SELECT * FROM ${table} WHERE user_id = 9001`).all()
      );
      const beforeSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get();
      const options = { databasePath: ':memory:', databaseExistedBeforeStartup: true };
      if (interruptStartup) {
        db.exec(`CREATE TRIGGER interrupt_access_seed BEFORE INSERT ON account_profiles
          WHEN NEW.user_id = 1 BEGIN SELECT RAISE(ABORT, '模拟授权初始化中断'); END;`);
        expect(() => initializeDatabase(db, options)).toThrow('模拟授权初始化中断');
        expect(db.prepare('SELECT role FROM users WHERE id = 9001').get()).toEqual({ role: 'REG' });
        db.exec('DROP TRIGGER interrupt_access_seed');
      }
      initializeDatabase(db, options);
      expect(() => db.prepare("UPDATE users SET role = 'PRJ' WHERE id = 9001").run()).toThrow();
      initializeDatabase(db, options);
      expect(db.prepare('SELECT * FROM users WHERE id = 9001').get()).toEqual({
        id: 9001,
        username: 'migration_test',
        password_hash: 'synthetic_hash',
        display_name: '迁移测试账号',
        role: 'REG',
        athlete_id: null,
        active: 0,
        session_version: 7,
      });
      expect(db.prepare('SELECT * FROM migration_test_links').all()).toEqual([{ user_id: 9001 }]);
      expect(
        scopeTables.map((table) => db.prepare(`SELECT * FROM ${table} WHERE user_id = 9001`).all())
      ).toEqual(beforeScopes);
      if (!hasProjectRole)
        expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get()).toEqual(
          beforeSchema
        );
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(() => db.prepare("UPDATE users SET role = 'INVALID' WHERE id = 9001").run()).toThrow();
    } finally {
      db.close();
    }
  }
);
