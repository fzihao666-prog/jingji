import type { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** 保留事实与所有关联，只把缺少时长/RPE的旧占位零改为空值。 */
export function migrateNullableSrpe(db: DatabaseSync, backupPath?: string) {
  const columns = db.prepare('PRAGMA table_info(training_sessions)').all() as {
    name: string;
    notnull: number;
  }[];
  const column = columns.find((row) => row.name === 'srpe');
  if (!column) return;
  if (db.isTransaction) throw new Error('SRPE迁移必须在独立事务执行');
  const hasMarkers = columns.some((row) => row.name === 'duration_reported');
  const missing = hasMarkers ? '(duration_reported=0 OR rpe IS NULL)' : 'rpe IS NULL';
  const dirty = db
    .prepare(`SELECT 1 FROM training_sessions WHERE srpe=0 AND ${missing} LIMIT 1`)
    .get();
  if (!column.notnull && !dirty) return;
  if (backupPath) {
    mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
    closeSync(openSync(backupPath, 'wx', 0o600));
    try {
      db.prepare('VACUUM INTO ?').run(backupPath);
      chmodSync(backupPath, 0o600);
    } catch (error) {
      rmSync(backupPath);
      throw error;
    }
  }
  const fk = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    if (column.notnull) {
      const schema = (
        db.prepare("SELECT sql FROM sqlite_master WHERE name='training_sessions'").get() as {
          sql: string;
        }
      ).sql;
      const relaxed = schema.replace(/\bsrpe\s+REAL\s+NOT\s+NULL(?:\s+DEFAULT\s+0)?/i, 'srpe REAL');
      if (schema === relaxed) throw new Error('SRPE结构不符合预期，保留原表');
      const objects = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE tbl_name='training_sessions' AND type IN ('index','trigger') AND sql IS NOT NULL"
        )
        .all() as { sql: string }[];
      const sequence = db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name='training_sessions'")
        .get() as { seq: number } | undefined;
      const fields = columns.map((row) => `"${row.name.replaceAll('"', '""')}"`).join(',');
      db.exec(
        relaxed.replace(
          /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?training_sessions["`\]]?/i,
          'CREATE TABLE training_sessions_srpe'
        )
      );
      db.exec(
        `INSERT INTO training_sessions_srpe(${fields}) SELECT ${fields} FROM training_sessions`
      );
      db.exec(
        'DROP TABLE training_sessions; ALTER TABLE training_sessions_srpe RENAME TO training_sessions'
      );
      for (const object of objects) db.exec(object.sql);
      if (sequence)
        db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='training_sessions'").run(
          sequence.seq
        );
    }
    db.exec(`UPDATE training_sessions SET srpe=NULL WHERE srpe=0 AND ${missing}`);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('SRPE迁移外键校验失败');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec(`PRAGMA foreign_keys=${fk ? 'ON' : 'OFF'}`);
  }
}
