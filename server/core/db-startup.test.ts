import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeStartupDatabase } from './db-startup.ts';

describe('启动前身份证保护与重建备份', () => {
  it('旧身份证库在备份和初始化之前阻断', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jingji-startup-'));
    const databasePath = join(directory, 'fixture.sqlite');
    const db = new DatabaseSync(databasePath);
    try {
      db.exec('CREATE TABLE athlete_profiles(athlete_id INTEGER PRIMARY KEY,identity_number TEXT)');
      expect(() =>
        initializeStartupDatabase(db, { databasePath, databaseExistedBeforeStartup: true })
      ).toThrow('身份证');
      expect(existsSync(`${databasePath}.before-reconstruction-v1`)).toBe(false);
      expect(
        db.prepare("SELECT name FROM sqlite_schema WHERE name='athletes'").get()
      ).toBeUndefined();
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('无身份证旧库保留一致性重建备份并限制权限', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jingji-startup-'));
    const databasePath = join(directory, 'fixture.sqlite');
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE retained(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO retained VALUES(1,'业务数据');"
      );
      initializeStartupDatabase(db, { databasePath, databaseExistedBeforeStartup: true });
      const path = `${databasePath}.before-reconstruction-v1`;
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const backup = new DatabaseSync(path, { readOnly: true });
      try {
        expect(backup.prepare('SELECT * FROM retained').get()).toEqual({
          id: 1,
          value: '业务数据',
        });
      } finally {
        backup.close();
      }
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
