import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateNullableInjuryPainScore } from './injury-pain-score-migration.ts';

const resources: Array<() => void> = [];
afterEach(() => { for (const cleanup of resources.splice(0).reverse()) cleanup(); });
function legacyDatabase() {
  const db = new DatabaseSync(':memory:');
  resources.push(() => db.close());
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE athletes(id INTEGER PRIMARY KEY); INSERT INTO athletes VALUES(1);
    CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(7);
    CREATE TABLE injury_records (id INTEGER PRIMARY KEY AUTOINCREMENT, athlete_id INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL DEFAULT 7, pain_score INTEGER NOT NULL DEFAULT 0 CHECK(pain_score BETWEEN 0 AND 10), note TEXT NOT NULL DEFAULT '', FOREIGN KEY(athlete_id) REFERENCES athletes(id), FOREIGN KEY(created_by) REFERENCES users(id));
    CREATE INDEX idx_injury_pain ON injury_records(pain_score);
    CREATE TABLE updates (id INTEGER);
    CREATE TRIGGER track_injury_update AFTER UPDATE ON injury_records BEGIN INSERT INTO updates VALUES(NEW.id); END;
    INSERT INTO injury_records(id,pain_score,note) VALUES (1,0,'真实0'),(2,5,'原记录'),(50,1,'已删除');
    DELETE FROM injury_records WHERE id = 50;`);
  return db;
}
const snapshot = (db: DatabaseSync) => JSON.stringify(db.prepare('SELECT * FROM injury_records ORDER BY id').all());
describe('伤病疼痛评分可空兼容迁移', () => {
  it('备份、记录、索引、触发器和自增序号均保留，重复执行无变化', () => {
    const folder = mkdtempSync(join(tmpdir(), 'jingji-enum-migration-'));
    resources.push(() => rmSync(folder, { recursive: true, force: true }));
    const db = legacyDatabase();
    const before = snapshot(db);
    const backupPath = join(folder, 'before.db');
    migrateNullableInjuryPainScore(db, backupPath);
    const backup = new DatabaseSync(backupPath);
    try { expect(snapshot(backup)).toBe(before); } finally { backup.close(); }
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    expect(snapshot(db)).toBe(before);
    migrateNullableInjuryPainScore(db, backupPath);
    expect(snapshot(db)).toBe(before);
    db.prepare("INSERT INTO injury_records(note) VALUES ('未提供')").run();
    expect(db.prepare('SELECT id, pain_score AS pain FROM injury_records WHERE id = 51').get()).toEqual({ id: 51, pain: null });
    db.exec("UPDATE injury_records SET note = '保留触发器' WHERE id = 1");
    expect(db.prepare('SELECT id FROM updates').all()).toEqual([{ id: 1 }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_injury_pain'").get()).toBeDefined();
    expect(() => db.exec('INSERT INTO injury_records(pain_score) VALUES (11)')).toThrow();
    expect(() => db.exec('INSERT INTO injury_records(athlete_id) VALUES (99)')).toThrow();
    expect(db.prepare('PRAGMA foreign_key_list(injury_records)').all()).toHaveLength(2);
  });
  it('重建中途失败时整笔回滚，原表和记录完整保留', () => {
    const db = legacyDatabase();
    const before = snapshot(db);
    const nativeExec = db.exec.bind(db);
    const exec = vi.spyOn(db, 'exec').mockImplementation(sql => {
      if (sql.startsWith('CREATE INDEX idx_injury_pain')) throw new Error('模拟索引恢复失败');
      nativeExec(sql);
    });
    try { expect(() => migrateNullableInjuryPainScore(db)).toThrow('模拟索引恢复失败'); }
    finally { exec.mockRestore(); }
    expect(snapshot(db)).toBe(before);
    expect(() => db.exec('INSERT INTO injury_records(pain_score) VALUES (NULL)')).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'injury_records_nullable'").get()).toBeUndefined();
  });
  it('存在未知子表依赖时拒绝重建，不触发级联删除', () => {
    const db = legacyDatabase();
    db.exec('CREATE TABLE injury_children (id INTEGER REFERENCES injury_records(id) ON DELETE CASCADE); INSERT INTO injury_children VALUES (1);');
    const before = snapshot(db);
    expect(() => migrateNullableInjuryPainScore(db)).toThrow('额外外键引用');
    expect(snapshot(db)).toBe(before);
    expect(db.prepare('SELECT id FROM injury_children').all()).toEqual([{ id: 1 }]);
  });
});
