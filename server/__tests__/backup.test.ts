import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupDatabase } from '../core/backup.ts';

describe('SQLite 在线备份', () => {
  it('热备份失败时不把主数据库文件复制成看似成功的备份', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jingji-backup-test-'));
    const databasePath = join(directory, 'source.db');
    const backupDirectory = join(directory, 'backups');
    writeFileSync(databasePath, 'not a sqlite database');

    try {
      await expect(backupDatabase(databasePath, backupDirectory)).rejects.toThrow();
      expect(readdirSync(backupDirectory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
