import type { DatabaseSync } from 'node:sqlite';

const WAL_RETRY_LIMIT = 40;
const WAL_RETRY_DELAY_MS = 50;

function isDatabaseBusy(error: unknown) {
  return error instanceof Error && /database is (?:locked|busy)/i.test(error.message);
}

/** 配置 SQLite 连接，并在多个首次启动进程间短暂重试 WAL 切换。 */
export function configureDatabaseConnection(db: DatabaseSync) {
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA foreign_keys = ON;');
  const pause = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

  for (let attempt = 0; attempt < WAL_RETRY_LIMIT; attempt += 1) {
    try {
      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      const currentMode = mode.journal_mode.toLowerCase();
      if (currentMode === 'wal' || currentMode === 'memory') break;
      db.exec('PRAGMA journal_mode = WAL;');
      const updatedMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      if (updatedMode.journal_mode.toLowerCase() === 'wal') break;
      if (attempt === WAL_RETRY_LIMIT - 1) {
        throw new Error(`无法将 SQLite 日志模式切换为 WAL，当前模式为 ${updatedMode.journal_mode}`);
      }
    } catch (error) {
      if (!isDatabaseBusy(error) || attempt === WAL_RETRY_LIMIT - 1) throw error;
    }
    Atomics.wait(pause, 0, 0, WAL_RETRY_DELAY_MS);
  }

  db.exec('PRAGMA synchronous = NORMAL;');
}
