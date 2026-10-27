import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateMultiSportFacts } from './multi-sport-migration.ts';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const db = new DatabaseSync(':memory:');
  cleanup.push(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE athletes(id INTEGER PRIMARY KEY, project TEXT); INSERT INTO athletes VALUES(1,'cycling_road');
    CREATE TABLE training_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT, athlete_id INTEGER REFERENCES athletes(id), stroke_rate_spm REAL, average_power_w REAL);
    INSERT INTO training_sessions VALUES(1,1,30,200);
    CREATE TABLE metric_definitions(code TEXT PRIMARY KEY,label TEXT NOT NULL,domain TEXT NOT NULL,unit TEXT NOT NULL,direction TEXT NOT NULL,frequency TEXT NOT NULL,projects_json TEXT NOT NULL DEFAULT '[]',minimum REAL,maximum REAL);
    CREATE TABLE test_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,athlete_id INTEGER REFERENCES athletes(id),test_date TEXT NOT NULL,test_type TEXT NOT NULL,protocol TEXT NOT NULL DEFAULT '', UNIQUE (athlete_id, test_date, test_type));
    INSERT INTO test_sessions VALUES(1,1,'2026-01-01','jump','原始未知协议'),(80,1,'2025-01-01','jump',''); DELETE FROM test_sessions WHERE id=80;
    CREATE TABLE test_measurements(id INTEGER PRIMARY KEY,test_session_id INTEGER REFERENCES test_sessions(id) ON DELETE CASCADE,value_num REAL);
    INSERT INTO test_measurements VALUES(5,1,0);
    CREATE TABLE strength_ai_advice(id INTEGER PRIMARY KEY,test_session_id INTEGER REFERENCES test_sessions(id) ON DELETE CASCADE);
    INSERT INTO strength_ai_advice VALUES(7,1);
    CREATE INDEX idx_test_date ON test_sessions(test_date);
    CREATE TABLE audit(id INTEGER);
    CREATE TRIGGER test_audit AFTER UPDATE ON test_sessions BEGIN INSERT INTO audit VALUES(NEW.id); END;`);
  return db;
}
function children(db: DatabaseSync) {
  return [
    db.prepare('SELECT * FROM test_measurements').all(),
    db.prepare('SELECT * FROM strength_ai_advice').all(),
  ];
}
describe('多项目事实隔离迁移', () => {
  it('只从已入库批次的正式记录引用回填项目证据，不以当前档案猜测', () => {
    const db = fixture();
    db.exec(`CREATE TABLE data_import_batches(id TEXT PRIMARY KEY,status TEXT,project TEXT);
      CREATE TABLE data_import_items(batch_id TEXT,committed_entity_type TEXT,committed_entity_id INTEGER);
      INSERT INTO data_import_batches VALUES('proof','committed','CYCLING_ROAD');
      INSERT INTO data_import_items VALUES('proof','training_session',1);`);
    migrateMultiSportFacts(db);
    expect(db.prepare('SELECT project_code,project_status,project_source FROM training_sessions WHERE id=1').get())
      .toEqual({ project_code: 'CYCLING_ROAD', project_status: 'confirmed', project_source: 'committed_import_batch' });
    expect(db.prepare('SELECT project_code,project_status FROM test_sessions WHERE id=1').get())
      .toEqual({ project_code: null, project_status: 'pending_verification' });
  });
  it('一致性备份可恢复，保留历史及子表、索引、触发器、序号，重复运行无变化', () => {
    const db = fixture();
    const folder = mkdtempSync(join(tmpdir(), 'jingji-multi-sport-'));
    cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
    const backupPath = join(folder, 'before.db');
    const beforeChildren = children(db);
    migrateMultiSportFacts(db, backupPath);
    expect(children(db)).toEqual(beforeChildren);
    expect(
      db
        .prepare(
          'SELECT project_code, project_status, project_source, project_migration_version, activity_code, stroke_rate_spm, average_power_w FROM training_sessions'
        )
        .get()
    ).toEqual({
      project_code: null,
      project_status: 'pending_verification',
      project_source: null,
      project_migration_version: 'multi-sport-v1',
      activity_code: null,
      stroke_rate_spm: 30,
      average_power_w: 200,
    });
    expect(
      db
        .prepare(
          'SELECT protocol,protocol_code,protocol_version,context_key,attempt_order FROM test_sessions'
        )
        .get()
    ).toEqual({
      protocol: '原始未知协议',
      protocol_code: null,
      protocol_version: null,
      context_key: '',
      attempt_order: 1,
    });
    const schema = db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    migrateMultiSportFacts(db, backupPath);
    expect(db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    db.exec('UPDATE test_sessions SET protocol=protocol WHERE id=1');
    expect(db.prepare('SELECT * FROM audit').all()).toEqual([{ id: 1 }]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='idx_test_date'").get()
    ).toBeDefined();
    expect(
      db
        .prepare(
          "INSERT INTO test_sessions(athlete_id,test_date,test_type) VALUES(1,'2026-02-01','jump')"
        )
        .run().lastInsertRowid
    ).toBe(81);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    const recovered = new DatabaseSync(backupPath);
    try {
      expect(children(recovered)).toEqual(beforeChildren);
      expect(
        recovered
          .prepare('PRAGMA table_info(test_sessions)')
          .all()
          .some((c) => c.name === 'project_code')
      ).toBe(false);
    } finally {
      recovered.close();
    }
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
  });
  it('同日项目、协议版本、上下文和试次可区分，NULL项目亦防止重复', () => {
    const db = fixture();
    migrateMultiSportFacts(db);
    const insert = db.prepare(
      `INSERT INTO test_sessions(athlete_id,test_date,test_type,project_code,protocol_code,protocol_version,context_key,attempt_order) VALUES(1,'2026-01-01','jump',?,?,?,?,?)`
    );
    insert.run('volleyball', 'cmj', '1', '', 1);
    insert.run('volleyball', 'sj', '1', '', 1);
    insert.run('volleyball', 'cmj', '2', '', 1);
    insert.run('volleyball', 'cmj', '1', 'arms', 1);
    insert.run('volleyball', 'cmj', '1', '', 2);
    insert.run('cycling_road', 'cmj', '1', '', 1);
    expect(() => insert.run('volleyball', 'cmj', '1', '', 1)).toThrow();
    expect(() => insert.run(null, null, null, '', 1)).toThrow();
    expect(() => insert.run('volleyball', 'cmj', '1', '', 0)).toThrow();
    expect(() => insert.run('volleyball', 'cmj', '1', '', 1.5)).toThrow();
  });
  it('踏频有类型、单位、外键和唯一约束，不重复保存既有功率/桨频事实', () => {
    const db = fixture();
    migrateMultiSportFacts(db);
    const insert = db.prepare(
      'INSERT INTO training_session_metrics(training_session_id,metric_code,value_num,unit) VALUES(?,?,?,?)'
    );
    insert.run(1, 'cadenceRpm', 0, 'rpm');
    expect(() => insert.run(1, 'cadenceRpm', 30, 'rpm')).toThrow();
    expect(() => insert.run(1, 'averagePowerW', 200, 'W')).toThrow();
    expect(() => insert.run(1, 'strokeRateSpm', 30, 'spm')).toThrow();
    expect(() => insert.run(1, 'cadenceRpm', 30, 'spm')).toThrow();
    expect(() => insert.run(999, 'cadenceRpm', 30, 'rpm')).toThrow();
    expect(() => insert.run(1, 'cadenceRpm', 'invalid', 'rpm')).toThrow();
  });
  it('重建失败原子恢复结构和所有关联，并恢复PRAGMA；修复后可重试', () => {
    const db = fixture();
    const before = children(db);
    const schema = db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    const native = db.exec.bind(db);
    const spy = vi.spyOn(db, 'exec').mockImplementation((sql) => {
      if (sql.startsWith('CREATE INDEX idx_test_date')) throw new Error('模拟恢复索引失败');
      native(sql);
    });
    try {
      expect(() => migrateMultiSportFacts(db)).toThrow('模拟恢复索引失败');
    } finally {
      spy.mockRestore();
    }
    expect(children(db)).toEqual(before);
    expect(db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    migrateMultiSportFacts(db);
    expect(children(db)).toEqual(before);
  });
  it('已有外键损坏或外层事务时拒绝迁移，外键关闭状态原样保留', () => {
    const db = fixture();
    db.exec('BEGIN');
    expect(() => migrateMultiSportFacts(db)).toThrow('事务');
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys=OFF');
    migrateMultiSportFacts(db);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 0 });
    const broken = fixture();
    broken.exec(
      'PRAGMA foreign_keys=OFF; INSERT INTO test_measurements VALUES(99,99,0); PRAGMA foreign_keys=ON'
    );
    expect(() => migrateMultiSportFacts(broken)).toThrow('外键');
    expect(
      broken
        .prepare('PRAGMA table_info(test_sessions)')
        .all()
        .some((c) => c.name === 'project_code')
    ).toBe(false);
  });
  it('已确认的历史证据和已有扩展列不被覆盖', () => {
    const db = fixture();
    db.exec(`ALTER TABLE training_sessions ADD COLUMN project_code TEXT;
      ALTER TABLE training_sessions ADD COLUMN project_status TEXT DEFAULT 'pending_verification';
      ALTER TABLE training_sessions ADD COLUMN project_source TEXT;
      UPDATE training_sessions SET project_code='rowing',project_status='confirmed',project_source='import:verified';
      ALTER TABLE test_sessions ADD COLUMN extra_context TEXT;
      UPDATE test_sessions SET extra_context='原始条件';`);
    migrateMultiSportFacts(db);
    expect(
      db.prepare('SELECT project_code,project_status,project_source FROM training_sessions').get()
    ).toEqual({
      project_code: 'rowing',
      project_status: 'confirmed',
      project_source: 'import:verified',
    });
    expect(db.prepare('SELECT extra_context FROM test_sessions').get()).toEqual({
      extra_context: '原始条件',
    });
  });
  it('备份目标已存在时停止且不改动数据库或覆盖已有备份', () => {
    const db = fixture();
    const folder = mkdtempSync(join(tmpdir(), 'jingji-backup-existing-'));
    cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
    const backupPath = join(folder, 'before.db');
    db.prepare('VACUUM INTO ?').run(backupPath);
    expect(() => migrateMultiSportFacts(db, backupPath)).toThrow();
    expect(
      db
        .prepare('PRAGMA table_info(test_sessions)')
        .all()
        .some((c) => c.name === 'project_code')
    ).toBe(false);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    const backup = new DatabaseSync(backupPath);
    try {
      expect(backup.prepare('SELECT COUNT(*) AS count FROM test_sessions').get()).toEqual({
        count: 1,
      });
    } finally {
      backup.close();
    }
  });
  it('已有首次提交记录补充摘要版本1且保留哈希，缺失该列亦可单独重复升级', () => {
    const db = fixture();
    migrateMultiSportFacts(db);
    db.exec(`CREATE TABLE training_submission_keys(id INTEGER PRIMARY KEY,payload_hash TEXT NOT NULL);
      INSERT INTO training_submission_keys VALUES(1,'首次请求hash');`);
    migrateMultiSportFacts(db);
    migrateMultiSportFacts(db);
    expect(db.prepare('SELECT * FROM training_submission_keys').all()).toEqual([
      { id: 1, payload_hash: '首次请求hash', payload_version: 1 },
    ]);
    db.exec(
      "INSERT INTO training_submission_keys(id,payload_hash,payload_version) VALUES(2,'新请求hash',2)"
    );
    migrateMultiSportFacts(db);
    expect(
      db.prepare('SELECT payload_version FROM training_submission_keys WHERE id=2').get()
    ).toEqual({ payload_version: 2 });
  });
});
