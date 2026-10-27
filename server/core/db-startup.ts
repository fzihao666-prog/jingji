import type { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, existsSync, openSync, rmSync } from 'node:fs';
import { configureDatabaseConnection } from './db-connection.ts';
import { inspectIdentityRemoval } from './identity-removal.ts';
import { initializeDatabase } from './db-initialize.ts';

/** 先阻断敏感旧结构，再为既有重建流程生成一致性快照。 */
export function initializeStartupDatabase(
  db: DatabaseSync,
  options: { databasePath: string; databaseExistedBeforeStartup: boolean }
) {
  // 结构检查也可能遇到并发初始化的写锁；在任何读取之前启用等待，不改变旧库内容。
  db.exec('PRAGMA busy_timeout = 15000;');
  if (inspectIdentityRemoval(db).pending) {
    throw new Error(
      '数据库包含历史身份证字段。请先停止服务，运行身份证清理工具并确认迁移后再启动。'
    );
  }
  const backupPath = `${options.databasePath}.before-reconstruction-v1`;
  if (options.databaseExistedBeforeStartup && !existsSync(backupPath)) {
    const descriptor = openSync(backupPath, 'wx', 0o600);
    closeSync(descriptor);
    try {
      db.prepare('VACUUM INTO ?').run(backupPath);
      chmodSync(backupPath, 0o600);
    } catch (error) {
      rmSync(backupPath);
      throw error;
    }
  }
  configureDatabaseConnection(db);
  return initializeDatabase(db, options);
}
