import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { configureDatabaseConnection } from '../core/db-connection.ts';

describe('SQLite 连接配置', () => {
  it('幂等启用 WAL、外键和写入同步设置', () => {
    const db = new DatabaseSync(':memory:');
    try {
      configureDatabaseConnection(db);
      configureDatabaseConnection(db);

      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'memory' });
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 });
    } finally {
      db.close();
    }
  });
});
