import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupDatabase, runBackup } from '../core/backup.ts';

describe('SQLite 在线备份', () => {
  it('默认保留最近 7 天的备份，仅在新备份成功后清理更早的文件', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jingji-backup-retention-'));
    const databasePath = join(directory, 'source.db');
    // 空文件可由 SQLite 初始化，不使用真实数据库。
    writeFileSync(databasePath, '');
    const dayMs = 24 * 60 * 60 * 1000;
    for (const [name, daysAgo] of [
      ['jingji-recent.db', 6],
      ['jingji-expired.db', 8],
      ['manual.db', 8],
    ] as const) {
      const path = join(directory, name);
      writeFileSync(path, 'synthetic backup');
      const timestamp = new Date(Date.now() - daysAgo * dayMs);
      utimesSync(path, timestamp, timestamp);
    }
    try {
      const result = await runBackup({ databasePath, backupDir: directory });
      expect(result.deletedCount).toBe(1);
      expect(readdirSync(directory)).toContain('jingji-recent.db');
      expect(readdirSync(directory)).toContain('manual.db');
      expect(readdirSync(directory)).not.toContain('jingji-expired.db');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('热备份失败时不把主数据库文件复制成看似成功的备份', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jingji-backup-test-'));
    const databasePath = join(directory, 'source.db');
    const backupDirectory = join(directory, 'backups');
    writeFileSync(databasePath, 'not a sqlite database');
    const historyPath = join(directory, 'jingji-history.db');
    writeFileSync(historyPath, 'synthetic historical backup');
    const oldTimestamp = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(historyPath, oldTimestamp, oldTimestamp);

    try {
      await expect(backupDatabase(databasePath, backupDirectory)).rejects.toThrow();
      expect(readdirSync(backupDirectory)).toEqual([]);
      await expect(runBackup({ databasePath, backupDir: directory })).rejects.toThrow();
      expect(readdirSync(directory)).toContain('jingji-history.db');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
