import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// 在静态导入图初始化 db.ts 前加载本地配置。
const environmentPath = resolve(process.cwd(), '.env');
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

export function getDatabasePath(root = process.cwd(), configuredPath = process.env.DATABASE_PATH) {
  return resolve(root, configuredPath || resolve(root, 'data', 'training-monitor.db'));
}

export function getDatabaseBackupDirectory(databaseFilePath: string) {
  return resolve(dirname(databaseFilePath), 'backups');
}

export const databasePath = getDatabasePath();
export const databaseBackupDirectory = getDatabaseBackupDirectory(databasePath);

export function ensureDatabaseDirectory(databaseFilePath = databasePath) {
  mkdirSync(dirname(databaseFilePath), { recursive: true });
}
