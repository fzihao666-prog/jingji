import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { databasePath, ensureDatabaseDirectory } from './database-path.ts';
import { initializeStartupDatabase } from './db-startup.ts';

const databaseExistedBeforeStartup = existsSync(databasePath);
ensureDatabaseDirectory(databasePath);

export const db = new DatabaseSync(databasePath);
export const { upsertAthleteOrigin } = initializeStartupDatabase(db, {
  databasePath,
  databaseExistedBeforeStartup,
});
