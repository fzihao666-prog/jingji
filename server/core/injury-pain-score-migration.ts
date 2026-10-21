import { chmodSync, closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** 空白疼痛评分需保存 NULL。事务内只放宽非空约束，保留历史值、索引、触发器和自增序号。 */
export function migrateNullableInjuryPainScore(db: DatabaseSync, backupPath?: string) {
  const columns = db.prepare('PRAGMA table_info(injury_records)').all() as Array<{ name: string; notnull: number }>;
  if (!columns.find(column => column.name === 'pain_score')?.notnull) return;
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'injury_records'").get() as { sql: string };
  const relaxed = schema.sql.replace(/pain_score\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i, 'pain_score INTEGER DEFAULT NULL');
  if (relaxed === schema.sql) throw new Error('伤病疼痛评分结构与预期不一致，已保留原表，请检查迁移');
  // 当前正式结构没有引用伤病记录的子表；发现额外引用时拒绝重建，避免级联影响未知数据。
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const references = db.prepare(`PRAGMA foreign_key_list("${name.replaceAll('"', '""')}")`).all() as Array<{ table: string }>;
    if (references.some(reference => reference.table === 'injury_records')) throw new Error('伤病表存在额外外键引用，已保留原表，请先检查迁移依赖');
  }
  const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'injury_records' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
  const fields = columns.map(column => `"${column.name.replaceAll('"', '""')}"`).join(', ');
  const create = relaxed.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?injury_records["`\]]?/i, 'CREATE TABLE injury_records_nullable');
  if (create === relaxed) throw new Error('伤病表名称与预期不一致，已保留原表');
  if (backupPath) {
    mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
    closeSync(openSync(backupPath, 'wx', 0o600));
    try { db.prepare('VACUUM INTO ?').run(backupPath); chmodSync(backupPath, 0o600); }
    catch (error) { rmSync(backupPath); throw error; }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('PRAGMA table_info(injury_records)').all() as Array<{ name: string; notnull: number }>;
    if (!current.find(column => column.name === 'pain_score')?.notnull) { db.exec('COMMIT'); return; }
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'injury_records'").get() as { seq: number } | undefined;
    db.exec(create);
    db.exec(`INSERT INTO injury_records_nullable (${fields}) SELECT ${fields} FROM injury_records`);
    db.exec('DROP TABLE injury_records; ALTER TABLE injury_records_nullable RENAME TO injury_records;');
    for (const object of objects) db.exec(object.sql);
    if (sequence) {
      const updated = db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'injury_records'").run(sequence.seq);
      if (!updated.changes) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('injury_records', ?)").run(sequence.seq);
    }
    if (db.prepare('PRAGMA foreign_key_check(injury_records)').all().length) throw new Error('伤病表迁移外键校验失败');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
