import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import {
  compactIdentityDatabase,
  createIdentityBackup,
  verifyIdentityDatabase,
} from './identity-removal-backup.js';

const directories: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.forEach((db) => db.close());
  databases.length = 0;
  directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  directories.length = 0;
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'identity-backup-test-'));
  directories.push(directory);
  const database = join(directory, 'source.sqlite');
  const db = new DatabaseSync(database);
  databases.push(db);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE athletes(id INTEGER PRIMARY KEY, identity_number TEXT);'
  );
  db.prepare('INSERT INTO athletes VALUES(?,?)').run(1, '测试占位值');
  return { directory, database, db };
}
describe('身份证清理一致性备份', () => {
  it('备份包含 WAL 已提交数据且目录和文件仅拥有者可访问', () => {
    const { directory, database, db } = setup();
    const backupDirectory = join(directory, 'backups');
    const backup = createIdentityBackup(db, database, backupDirectory);
    const copy = new DatabaseSync(backup, { readOnly: true });
    databases.push(copy);
    expect(copy.prepare('SELECT COUNT(*) AS count FROM athletes').get()?.count).toBe(1);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(statSync(backupDirectory).mode & 0o777).toBe(0o700);
    expect(db.prepare('SELECT COUNT(*) AS count FROM athletes').get()?.count).toBe(1);
  });
  it('重复备份生成不同文件且不覆盖原备份或源数据库', () => {
    const { directory, database, db } = setup();
    const first = createIdentityBackup(db, database, join(directory, 'backups'));
    const original = readFileSync(first);
    const second = createIdentityBackup(db, database, join(directory, 'backups'));
    expect(first).not.toBe(second);
    expect(readFileSync(first)).toEqual(original);
    expect(db.prepare('PRAGMA table_info(athletes)').all()).toHaveLength(2);
  });
  it('备份路径失败时保留原始结构与数据', () => {
    const { directory, database, db } = setup();
    const blocked = join(directory, 'blocked');
    writeFileSync(blocked, '保持原内容');
    expect(() => createIdentityBackup(db, database, blocked)).toThrow('backup-failed');
    expect(readFileSync(blocked, 'utf8')).toBe('保持原内容');
    expect(db.prepare('PRAGMA table_info(athletes)').all()).toHaveLength(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM athletes').get()?.count).toBe(1);
  });
  it('已有外键损坏阻断备份与维护', () => {
    const { directory, database, db } = setup();
    db.exec(
      'PRAGMA foreign_keys=OFF; CREATE TABLE child(parent_id INTEGER REFERENCES athletes(id)); INSERT INTO child VALUES(999);'
    );
    expect(() => verifyIdentityDatabase(db)).toThrow('database-invalid');
    expect(() => createIdentityBackup(db, database, join(directory, 'backups'))).toThrow(
      'database-invalid'
    );
  });
  it('整理清空 WAL 并通过完整性和外键检查', () => {
    const { database, db } = setup();
    compactIdentityDatabase(db);
    expect(statSync(`${database}-wal`).size).toBe(0);
    expect(() => verifyIdentityDatabase(db)).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM athletes').get()?.count).toBe(1);
  });
  it('有读取事务占用 WAL 时整理失败且可在释放后重试', () => {
    const { database, db } = setup();
    const reader = new DatabaseSync(database);
    reader.exec('BEGIN');
    reader.prepare('SELECT * FROM athletes').all();
    db.prepare('INSERT INTO athletes VALUES(?,?)').run(2, '第二条占位值');
    try {
      expect(() => compactIdentityDatabase(db)).toThrow('compaction-failed');
    } finally {
      reader.exec('ROLLBACK');
      reader.close();
    }
    expect(() => compactIdentityDatabase(db)).not.toThrow();
  });
});

describe('独立维护 CLI 参数与失败保护', () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/remove-identity-data.ts', ...args], {
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
  it('不存在的数据库路径不会被创建', () => {
    const directory = mkdtempSync(join(tmpdir(), 'identity-cli-test-'));
    directories.push(directory);
    const absent = join(directory, 'absent.sqlite');
    expect(cli('--database', absent).status).toBe(1);
    expect(() => statSync(absent)).toThrow();
  });
  it('默认检查和缺少停写确认均不改变身份证列', () => {
    const { database, db } = setup();
    expect(cli('--database', database).status).toBe(0);
    expect(cli('--database', database, '--apply').status).toBe(1);
    expect(db.prepare('PRAGMA table_info(athletes)').all()).toHaveLength(2);
  });
  it('备份失败阻止CLI迁移且不泄露底层值', () => {
    const { directory, database, db } = setup();
    const blocked = join(directory, 'blocked');
    writeFileSync(blocked, '保持原内容');
    const result = cli(
      '--database',
      database,
      '--apply',
      '--writers-stopped',
      '--backup-dir',
      blocked
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('测试占位值');
    expect(db.prepare('PRAGMA table_info(athletes)').all()).toHaveLength(2);
  });
  it('显式停写与备份确认后完成迁移并保留可校验备份', () => {
    const { directory, database, db } = setup();
    const result = cli(
      '--database',
      database,
      '--apply',
      '--writers-stopped',
      '--backup-dir',
      join(directory, 'backups')
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('迁移及整理校验完成');
    expect(result.stdout).toContain('原始备份仍含身份证');
    expect(db.prepare('PRAGMA table_info(athletes)').all()).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM athletes').get()?.count).toBe(1);
  });
  it('compact-only只整理而不迁移字段', () => {
    const { database, db } = setup();
    expect(cli('--database', database, '--compact-only', '--writers-stopped').status).toBe(0);
    expect(db.prepare('PRAGMA table_info(athletes)').all()).toHaveLength(2);
  });
});
