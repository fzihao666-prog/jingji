import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { databasePath, ensureDatabaseDirectory } from './database-path.ts';
import { configureDatabaseConnection } from './db-connection.ts';
import { initializeDatabase } from './db-initialize.ts';

const databaseExistedBeforeStartup = existsSync(databasePath);
// 迁移可能写入历史数据；旧库首次升级前保留原始文件，便于独立恢复。
if (databaseExistedBeforeStartup && !existsSync(`${databasePath}.before-reconstruction-v1`)) {
  copyFileSync(databasePath, `${databasePath}.before-reconstruction-v1`);
}
ensureDatabaseDirectory(databasePath);

export const db = new DatabaseSync(databasePath);
configureDatabaseConnection(db);

export const { upsertAthleteOrigin } = initializeDatabase(db, {
  databasePath,
  databaseExistedBeforeStartup,
});
