import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';

it('旧五角色数据库升级后允许项目负责人，保留账号与关联且重复启动安全', () => {
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
        role TEXT NOT NULL CHECK(role IN ('ATL', 'SCC', 'REG', 'TD', 'DMD')),
        athlete_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        session_version INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO users VALUES (9001, 'migration_test', 'synthetic_hash', '迁移测试账号', 'REG', NULL, 0, 7);
      CREATE TABLE migration_test_links (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO migration_test_links VALUES (9001);
    `);
    const options = { databasePath: ':memory:', databaseExistedBeforeStartup: true };
    initializeDatabase(db, options);
    expect(() => db.prepare("UPDATE users SET role = 'PRJ' WHERE id = 9001").run()).not.toThrow();
    initializeDatabase(db, options);
    expect(db.prepare('SELECT * FROM users WHERE id = 9001').get()).toEqual({
      id: 9001,
      username: 'migration_test',
      password_hash: 'synthetic_hash',
      display_name: '迁移测试账号',
      role: 'PRJ',
      athlete_id: null,
      active: 0,
      session_version: 7,
    });
    expect(db.prepare('SELECT * FROM migration_test_links').all()).toEqual([{ user_id: 9001 }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(() => db.prepare("UPDATE users SET role = 'INVALID' WHERE id = 9001").run()).toThrow();
  } finally {
    db.close();
  }
});
