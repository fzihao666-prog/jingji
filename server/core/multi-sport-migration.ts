import { chmodSync, closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeProject } from '../../shared/projects.ts';

const VERSION = 'multi-sport-v1';
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const identityFields = {
  project_code: 'TEXT',
  project_status:
    "TEXT NOT NULL DEFAULT 'pending_verification' CHECK(project_status IN ('pending_verification', 'confirmed'))",
  project_source: 'TEXT',
  project_migration_version: `TEXT NOT NULL DEFAULT '${VERSION}'`,
};
const trainingFields = {
  ...identityFields,
  activity_code: 'TEXT',
  training_category: 'TEXT',
  rules_version: 'TEXT',
  intensity_system: 'TEXT',
  threshold_version: 'TEXT',
};
const testFields = {
  ...identityFields,
  protocol_code: 'TEXT',
  protocol_version: 'TEXT',
  context_key: "TEXT NOT NULL DEFAULT ''",
  attempt_order:
    "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(attempt_order) = 'integer' AND attempt_order >= 1)",
};
function columns(db: DatabaseSync, table: string) {
  return db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>;
}
function addColumns(db: DatabaseSync, table: string, fields: Record<string, string>) {
  const existing = new Set(columns(db, table).map((column) => column.name));
  for (const [name, definition] of Object.entries(fields)) {
    if (!existing.has(name))
      db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(name)} ${definition}`);
  }
}

function backfillCommittedEvidence(db: DatabaseSync) {
  const itemColumns = new Set(columns(db, 'data_import_items').map(column => column.name));
  const batchColumns = new Set(columns(db, 'data_import_batches').map(column => column.name));
  if (!['batch_id', 'committed_entity_type', 'committed_entity_id'].every(name => itemColumns.has(name)) ||
      !['id', 'project', 'status'].every(name => batchColumns.has(name))) return;
  const evidence = db.prepare(`SELECT i.committed_entity_type AS kind,i.committed_entity_id AS id,b.project
    FROM data_import_items i JOIN data_import_batches b ON b.id=i.batch_id
    WHERE b.status='committed' AND i.committed_entity_id IS NOT NULL
      AND i.committed_entity_type IN ('training_session','test_measurement')`).all() as { kind: string; id: number; project: string }[];
  const grouped = new Map<string, { table: 'training_sessions' | 'test_sessions'; id: number; projects: Set<string | null> }>();
  for (const row of evidence) {
    const table = row.kind === 'training_session' ? 'training_sessions' : 'test_sessions';
    const test = row.kind === 'test_measurement' ? db.prepare('SELECT test_session_id AS id FROM test_measurements WHERE id=?').get(row.id) as { id: number } | undefined : undefined;
    const id = row.kind === 'training_session' ? row.id : test?.id;
    if (!id) continue;
    const key = `${table}:${id}`;
    const group = grouped.get(key) || { table, id, projects: new Set<string | null>() };
    group.projects.add(normalizeProject(row.project)); grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    const project = [...group.projects][0];
    if (group.projects.size !== 1 || !project) continue;
    db.prepare(`UPDATE ${group.table} SET project_code=?,project_status='confirmed',project_source='committed_import_batch'
      WHERE id=? AND project_code IS NULL AND project_status='pending_verification'`).run(project,group.id);
  }
}

/** 仅操作调用方传入的库；正式库需停写，并在首次迁移前创建一致性备份。 */
export function migrateMultiSportFacts(db: DatabaseSync, backupPath?: string): void {
  if (db.isTransaction) throw new Error('多项目迁移必须在外层事务之外执行');
  const originalSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='test_sessions'")
    .get() as { sql: string } | undefined;
  if (!originalSchema || !columns(db, 'training_sessions').length)
    throw new Error('缺少训练或测试事实表，无法迁移');
  const legacyUnique = /,\s*UNIQUE\s*\(\s*athlete_id\s*,\s*test_date\s*,\s*test_type\s*\)/i;
  const needsRebuild = legacyUnique.test(originalSchema.sql);
  const trainingColumns = new Set(columns(db, 'training_sessions').map((column) => column.name));
  const testColumns = new Set(columns(db, 'test_sessions').map((column) => column.name));
  const submissionColumns = columns(db, 'training_submission_keys');
  const needsPayloadVersion =
    submissionColumns.length > 0 &&
    !submissionColumns.some((column) => column.name === 'payload_version');
  const complete =
    !needsPayloadVersion &&
    Object.keys(trainingFields).every((name) => trainingColumns.has(name)) &&
    Object.keys(testFields).every((name) => testColumns.has(name)) &&
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_test_sessions_context_identity'"
      )
      .get() &&
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='training_session_metrics'")
      .get();
  if (complete && !needsRebuild) return;
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('多项目迁移前发现外键损坏，已保留原数据');
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
  const foreignKeys = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number })
    .foreign_keys;
  // DROP父表时必须在事务外关闭外键，否则SQLite会级联删除仍需保留的子表记录。
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (needsPayloadVersion) {
        addColumns(db, 'training_submission_keys', {
          payload_version: 'INTEGER NOT NULL DEFAULT 1',
        });
      }
      addColumns(db, 'training_sessions', trainingFields);
      addColumns(db, 'test_sessions', testFields);
      backfillCommittedEvidence(db);
      if (needsRebuild) rebuildTestSessions(db, legacyUnique);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_test_sessions_context_identity ON test_sessions
        (athlete_id, COALESCE(project_code, ''), test_date, test_type,
         COALESCE(protocol_code, ''), COALESCE(protocol_version, ''), context_key, attempt_order);
        CREATE INDEX IF NOT EXISTS idx_training_sessions_project_date ON training_sessions(project_code, athlete_id);
        CREATE INDEX IF NOT EXISTS idx_test_sessions_project_date ON test_sessions(project_code, test_date);`);
      // 首批只开放踏频标量；平均功率和桨频继续使用原列，不能复制到扩展事实。
      db.exec(`INSERT OR IGNORE INTO metric_definitions
        (code,label,domain,unit,direction,frequency,projects_json,minimum)
        VALUES('cadenceRpm','踏频','training','rpm','neutral','session','[]',0);
        CREATE TABLE IF NOT EXISTS training_metric_applicability (
          metric_code TEXT NOT NULL REFERENCES metric_definitions(code),
          activity_code TEXT NOT NULL,
          PRIMARY KEY(metric_code, activity_code)
        );
        INSERT OR IGNORE INTO training_metric_applicability VALUES('cadenceRpm','cycling');
        CREATE TABLE IF NOT EXISTS training_session_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          training_session_id INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
          metric_code TEXT NOT NULL REFERENCES metric_definitions(code) CHECK(metric_code = 'cadenceRpm'),
          value_num REAL NOT NULL CHECK(typeof(value_num) IN ('real','integer') AND value_num >= 0 AND value_num <= 1.7976931348623157e308),
          unit TEXT NOT NULL CHECK(unit = 'rpm'),
          protocol_code TEXT,
          protocol_version TEXT,
          quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid','partial','insufficient','outlier','estimated')),
          source TEXT NOT NULL DEFAULT 'manual',
          source_ref TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(training_session_id, metric_code)
        );`);
      if (db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('多项目迁移后外键校验失败');
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.exec(`PRAGMA foreign_keys=${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
function rebuildTestSessions(db: DatabaseSync, legacyUnique: RegExp) {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='test_sessions'")
    .get() as { sql: string };
  // 只移除已知旧约束，完整复用现有列定义，避免丢失未来扩展列及CHECK约束。
  const relaxed = schema.sql.replace(legacyUnique, '');
  const create = relaxed.replace(
    /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?test_sessions["`\]]?/i,
    'CREATE TABLE test_sessions_multi_sport'
  );
  if (relaxed === schema.sql || create === relaxed)
    throw new Error('测试事实结构与预期不一致，已保留原表');
  const objects = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE tbl_name='test_sessions' AND type IN ('index','trigger') AND sql IS NOT NULL"
    )
    .all() as Array<{ sql: string }>;
  const sequence = db
    .prepare("SELECT seq FROM sqlite_sequence WHERE name='test_sessions'")
    .get() as { seq: number } | undefined;
  const fields = columns(db, 'test_sessions')
    .map((column) => quote(column.name))
    .join(', ');
  const before = db.prepare('SELECT COUNT(*) AS count FROM test_sessions').get() as {
    count: number;
  };
  db.exec(create);
  db.exec(`INSERT INTO test_sessions_multi_sport (${fields}) SELECT ${fields} FROM test_sessions`);
  const copied = db.prepare('SELECT COUNT(*) AS count FROM test_sessions_multi_sport').get() as {
    count: number;
  };
  if (copied.count !== before.count) throw new Error('测试事实迁移行数不一致');
  db.exec(
    'DROP TABLE test_sessions; ALTER TABLE test_sessions_multi_sport RENAME TO test_sessions;'
  );
  for (const object of objects) db.exec(object.sql);
  if (sequence) {
    const updated = db
      .prepare("UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name='test_sessions'")
      .run(sequence.seq);
    if (!updated.changes)
      db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('test_sessions',?)").run(
        sequence.seq
      );
  }
}
