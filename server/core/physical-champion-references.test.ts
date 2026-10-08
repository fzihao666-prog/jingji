import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { initializePhysicalChampionReferences } from './physical-champion-references.js';

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});
function setup() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE radar_reference_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL CHECK(project='ROWING'), name TEXT NOT NULL,
      url TEXT NOT NULL, source_year INTEGER NOT NULL, protocol TEXT NOT NULL, verified_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project,name,url,source_year,protocol)
    );
    CREATE TABLE radar_reference_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, project TEXT NOT NULL CHECK(project='ROWING'),
      radar_kind TEXT NOT NULL, metric_key TEXT NOT NULL, gender TEXT NOT NULL, boat_class TEXT NOT NULL DEFAULT '',
      applicability TEXT NOT NULL, value_num REAL NOT NULL, unit TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id,radar_kind,metric_key,gender,boat_class,applicability),
      FOREIGN KEY(source_id) REFERENCES radar_reference_sources(id) ON DELETE RESTRICT
    );
    CREATE INDEX idx_reference_project ON radar_reference_values(project);
    CREATE TABLE reference_changes (value_id INTEGER);
    CREATE TRIGGER reference_audit AFTER UPDATE ON radar_reference_values BEGIN INSERT INTO reference_changes VALUES (NEW.id); END;
    INSERT INTO radar_reference_sources (id,project,name,url,source_year,protocol,verified_at) VALUES (1,'ROWING','历史资料','https://example.com',2020,'历史协议','2020-01-01');
    INSERT INTO radar_reference_values (id,source_id,project,radar_kind,metric_key,gender,applicability,value_num,unit) VALUES (7,1,'ROWING','physical','relative_squat','男','历史标准',1.99,'倍体重');
    INSERT INTO radar_reference_values (id,source_id,project,radar_kind,metric_key,gender,applicability,value_num,unit) VALUES (999,1,'ROWING','special','old','男','已删除标准',1,'s');
    DELETE FROM radar_reference_values WHERE id=999;
  `);
  return db;
}

describe('冠军参考值兼容迁移', () => {
  it('人工修改测试协议后重跑不新增该维度的重复基线', () => {
    const db = setup();
    initializePhysicalChampionReferences(db);
    db.exec(
      "UPDATE radar_reference_values SET protocol='教练校准深蹲协议',revision=1 WHERE project='ROWING' AND gender='男' AND metric_key='relative_squat' AND protocol<>''"
    );
    initializePhysicalChampionReferences(db);
    expect(
      db
        .prepare(
          "SELECT protocol,revision FROM radar_reference_values WHERE project='ROWING' AND gender='男' AND metric_key='relative_squat' AND protocol<>''"
        )
        .all()
    ).toEqual([{ protocol: '教练校准深蹲协议', revision: 1 }]);
    expect(db.prepare('SELECT count(*) AS count FROM radar_reference_values').get()).toEqual({
      count: 49,
    });
  });

  it('保留历史数据并补全三项目男女八维估算标准，重复初始化幂等', () => {
    const db = setup();
    initializePhysicalChampionReferences(db);
    initializePhysicalChampionReferences(db);
    expect(
      db.prepare('SELECT id,value_num,protocol FROM radar_reference_values WHERE id=7').get()
    ).toEqual({ id: 7, value_num: 1.99, protocol: '' });
    expect(
      db
        .prepare(
          "SELECT project,gender,count(*) AS count FROM radar_reference_values WHERE source_type='estimated' GROUP BY project,gender ORDER BY project,gender"
        )
        .all()
    ).toEqual([
      { project: 'CANOE_SLALOM', gender: '女', count: 8 },
      { project: 'CANOE_SLALOM', gender: '男', count: 8 },
      { project: 'CANOE_SPRINT', gender: '女', count: 8 },
      { project: 'CANOE_SPRINT', gender: '男', count: 8 },
      { project: 'ROWING', gender: '女', count: 8 },
      { project: 'ROWING', gender: '男', count: 8 },
    ]);
    expect(db.prepare('SELECT count(*) AS count FROM radar_reference_values').get()).toEqual({
      count: 49,
    });
    expect(
      db.prepare('SELECT min(id) AS id FROM radar_reference_values WHERE id<>7').get()
    ).toEqual({ id: 1000 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_reference_project'"
        )
        .get()
    ).toEqual({ name: 'idx_reference_project' });
  });
  it('人工修改与停用状态保留，触发器在重建后仍执行', () => {
    const db = setup();
    initializePhysicalChampionReferences(db);
    db.exec(
      "UPDATE radar_reference_values SET value_num=2.3,source_type='measured',active=0 WHERE project='ROWING' AND gender='男' AND metric_key='relative_squat' AND protocol<>''"
    );
    initializePhysicalChampionReferences(db);
    expect(
      db
        .prepare(
          "SELECT value_num,source_type,active FROM radar_reference_values WHERE project='ROWING' AND gender='男' AND metric_key='relative_squat' AND protocol<>''"
        )
        .all()
    ).toEqual([{ value_num: 2.3, source_type: 'measured', active: 0 }]);
    expect(db.prepare('SELECT count(*) AS count FROM reference_changes').get()).toEqual({
      count: 1,
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

describe('无来源外键的历史冠军参考表', () => {
  it('兼容旧项目枚举和已部分升级的列，保留历史值并幂等补齐来源', () => {
    const db = new DatabaseSync(':memory:');
    databases.push(db);
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE radar_reference_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL CHECK(project IN ('ROWING', 'CANOE', 'SLALOM')),
        name TEXT NOT NULL, url TEXT NOT NULL, source_year INTEGER NOT NULL,
        protocol TEXT NOT NULL, verified_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project,name,url,source_year,protocol)
      );
      CREATE TABLE radar_reference_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL CHECK(project IN ('ROWING', 'CANOE', 'SLALOM')),
        radar_kind TEXT NOT NULL, metric_key TEXT NOT NULL, gender TEXT NOT NULL,
        boat_class TEXT NOT NULL DEFAULT '', applicability TEXT NOT NULL DEFAULT '',
        value_num REAL NOT NULL, unit TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        source_type TEXT NOT NULL DEFAULT 'public_reference', protocol TEXT NOT NULL DEFAULT '',
        event_group TEXT NOT NULL DEFAULT 'open', weight_class TEXT NOT NULL DEFAULT 'open',
        age_group TEXT NOT NULL DEFAULT 'adult', direction TEXT NOT NULL DEFAULT 'higher_better', revision INTEGER NOT NULL DEFAULT 0,
        UNIQUE(project,radar_kind,metric_key,gender,boat_class,applicability)
      );
      CREATE INDEX idx_legacy_reference ON radar_reference_values(project);
      INSERT INTO radar_reference_values(id,project,radar_kind,metric_key,gender,value_num,unit,active,revision)
        VALUES (7,'ROWING','physical','relative_squat','男',2.13,'倍体重',0,3),
               (8,'CANOE','special','legacy_metric','女',100,'s',1,2);
      INSERT INTO radar_reference_values(id,project,radar_kind,metric_key,gender,value_num,unit,protocol,source_type,revision)
        VALUES (9,'SLALOM','physical','relative_bench_pull','女',1.27,'倍体重','卧拉1RM','measured',4);
    `);
    expect(() => initializePhysicalChampionReferences(db)).not.toThrow();
    initializePhysicalChampionReferences(db);
    expect(db.prepare('SELECT count(*) AS count FROM radar_reference_values').get()).toEqual({
      count: 50,
    });
    expect(
      db
        .prepare('SELECT project,value_num,active,revision FROM radar_reference_values WHERE id=7')
        .get()
    ).toEqual({ project: 'ROWING', value_num: 2.13, active: 0, revision: 3 });
    expect(
      db.prepare('SELECT project,value_num,revision FROM radar_reference_values WHERE id=8').get()
    ).toEqual({ project: 'CANOE', value_num: 100, revision: 2 });
    expect(
      db
        .prepare('SELECT count(*) AS count FROM radar_reference_values WHERE source_id IS NULL')
        .get()
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM radar_reference_values WHERE project='CANOE_SLALOM' AND metric_key='relative_bench_pull' AND gender='女'"
        )
        .get()
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare('SELECT value_num,source_type,revision FROM radar_reference_values WHERE id=9')
        .get()
    ).toEqual({ value_num: 1.27, source_type: 'measured', revision: 4 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_legacy_reference'"
        )
        .get()
    ).toEqual({ name: 'idx_legacy_reference' });
  });
});
