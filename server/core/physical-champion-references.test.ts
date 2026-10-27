import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  initializePhysicalChampionReferences,
  savePhysicalReferenceDraft,
  reviewPhysicalReference,
} from './physical-champion-references.js';

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
      count: 2,
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

const actor = {
  id: 1,
  role: 'DMD',
  permissions: {
    projects: ['*'],
    areas: [{ areaLevel: 'national' }],
    teams: [{ project: '*', team: '*' }],
  },
};
const draft = {
  project: 'VOLLEYBALL',
  key: 'jump',
  referenceLabel: '纵跳研究参考',
  value: 50,
  unit: 'cm',
  protocol: 'CMJ双手叉腰',
  direction: 'higher_better',
  sourceType: 'public_reference',
  sourceNature: 'official_research',
  sourceNote: '研究来源材料',
  gender: 'open',
  event: 'open',
  weightClass: 'open',
  ageGroup: 'adult',
  position: 'open',
  referenceLevel: 'open',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  dimensionVersion: 'v1',
  measurementCodes: ['vertical_jump_cm'],
  measurementUnit: 'cm',
  weightRelative: false,
};
function managerSetup() {
  const db = setup();
  initializePhysicalChampionReferences(db);
  db.exec(
    'CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,entity_type TEXT,entity_id INTEGER,detail TEXT)'
  );
  return db;
}
describe('参考版本维护边界', () => {
  it('旧标准和估算默认草稿，六项目约束兼容且来源未伪造审核', () => {
    const db = managerSetup();
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM radar_reference_values WHERE review_status<>'draft'"
        )
        .get()
    ).toEqual({ count: 0 });
    const result = savePhysicalReferenceDraft(db, actor, draft);
    expect(result.id).toBeGreaterThan(0);
    expect(
      db.prepare('SELECT review_status FROM radar_reference_values WHERE id=?').get(result.id)
    ).toEqual({ review_status: 'draft' });
  });
  it('新修订保留原值，过期revision不能修改或审核，旧版本需显式停用', () => {
    const db = managerSetup();
    const first = savePhysicalReferenceDraft(db, actor, draft);
    reviewPhysicalReference(db, actor, first.id, { expectedRevision: 0, status: 'reviewed' });
    expect(() =>
      reviewPhysicalReference(db, actor, first.id, { expectedRevision: 0, status: 'disabled' })
    ).toThrow('更新');
    const next = savePhysicalReferenceDraft(
      db,
      actor,
      { ...draft, value: 60 },
      { id: first.id, expectedRevision: 1 }
    );
    expect(
      db
        .prepare('SELECT value_num,version,review_status FROM radar_reference_values WHERE id=?')
        .get(first.id)
    ).toEqual({ value_num: 50, version: 1, review_status: 'reviewed' });
    expect(() =>
      savePhysicalReferenceDraft(db, actor, draft, { id: first.id, expectedRevision: 1 })
    ).toThrow('更新');
    expect(() =>
      reviewPhysicalReference(db, actor, next.id, { expectedRevision: 0, status: 'reviewed' })
    ).toThrow('重叠');
    reviewPhysicalReference(db, actor, first.id, { expectedRevision: 2, status: 'disabled' });
    expect(() =>
      reviewPhysicalReference(db, actor, next.id, { expectedRevision: 0, status: 'reviewed' })
    ).not.toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('只允许原全国全部项目队伍管理权限，拒绝越权和未知字段且无副作用', () => {
    const db = managerSetup();
    const before = db.prepare('SELECT count(*) AS count FROM radar_reference_values').get();
    for (const partial of [
      { ...actor, role: 'COA' },
      { ...actor, permissions: { ...actor.permissions, projects: ['VOLLEYBALL'] } },
      { ...actor, permissions: { ...actor.permissions, teams: [] } },
    ]) {
      expect(() => savePhysicalReferenceDraft(db, partial, draft)).toThrow('权限');
      expect(() =>
        reviewPhysicalReference(db, partial, 7, { expectedRevision: 0, status: 'reviewed' })
      ).toThrow('权限');
    }
    expect(() =>
      savePhysicalReferenceDraft(db, actor, { ...draft, reviewStatus: 'reviewed' })
    ).toThrow('无效');
    expect(() => savePhysicalReferenceDraft(db, actor, { ...draft, sourceNature: 'team' })).toThrow(
      '无效'
    );
    expect(() =>
      savePhysicalReferenceDraft(db, actor, {
        ...draft,
        sourceNature: 'expert',
        referenceLabel: '专家冠军金牌',
      })
    ).toThrow('无效');
    expect(() =>
      savePhysicalReferenceDraft(db, actor, { ...draft, effectiveTo: '2025-01-01' })
    ).toThrow('无效');
    expect(db.prepare('SELECT count(*) AS count FROM radar_reference_values').get()).toEqual(
      before
    );
  });
  it('不可审核历史缺协议版本，版本失败回滚无修改，审核估算仍标明估算', () => {
    const db = managerSetup();
    expect(() =>
      reviewPhysicalReference(db, actor, 7, { expectedRevision: 0, status: 'reviewed' })
    ).toThrow('补全');
    const estimated = savePhysicalReferenceDraft(db, actor, {
      ...draft,
      sourceType: 'estimated',
      sourceNature: 'estimated',
    });
    reviewPhysicalReference(db, actor, estimated.id, { expectedRevision: 0, status: 'reviewed' });
    expect(
      db
        .prepare(
          'SELECT source_type,source_nature,review_status FROM radar_reference_values WHERE id=?'
        )
        .get(estimated.id)
    ).toEqual({ source_type: 'estimated', source_nature: 'estimated', review_status: 'reviewed' });
  });
});

it('迁移失败完整回滚表、索引、旧值和外键开关，不留下半迁移', () => {
  const db = setup();
  db.exec(
    'PRAGMA foreign_keys=OFF; UPDATE radar_reference_values SET source_id=999 WHERE id=7; PRAGMA foreign_keys=ON'
  );
  const original = db
    .prepare("SELECT sql FROM sqlite_master WHERE name='radar_reference_values'")
    .get();
  expect(() => initializePhysicalChampionReferences(db)).toThrow('外键');
  expect(
    db.prepare("SELECT sql FROM sqlite_master WHERE name='radar_reference_values'").get()
  ).toEqual(original);
  expect(db.prepare('SELECT id,source_id,value_num FROM radar_reference_values').all()).toEqual([
    { id: 7, source_id: 999, value_num: 1.99 },
  ]);
  expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%physical_next'").all()
  ).toEqual([]);
});

it('不同协议版本、条件、侧别可分别配置审核，同条件仍阻止重叠', () => {
  const db = managerSetup();
  const values = [
    { protocolVersion: 'v1', testContext: 'indoor', side: 'left' },
    { protocolVersion: 'v2', testContext: 'indoor', side: 'left' },
    { protocolVersion: 'v1', testContext: 'outdoor', side: 'left' },
    { protocolVersion: 'v1', testContext: 'indoor', side: 'right' },
  ];
  for (const context of values) {
    const result = savePhysicalReferenceDraft(db, actor, { ...draft, ...context });
    expect(() =>
      reviewPhysicalReference(db, actor, result.id, { expectedRevision: 0, status: 'reviewed' })
    ).not.toThrow();
    expect(
      db
        .prepare('SELECT protocol_version,test_context,side FROM radar_reference_values WHERE id=?')
        .get(result.id)
    ).toEqual({
      protocol_version: context.protocolVersion,
      test_context: context.testContext,
      side: context.side,
    });
  }
  const conflict = savePhysicalReferenceDraft(db, actor, { ...draft, ...values[0] });
  expect(() =>
    reviewPhysicalReference(db, actor, conflict.id, { expectedRevision: 0, status: 'reviewed' })
  ).toThrow('重叠');
});

it('新修订保留已配置协议版本、测试条件和侧别，并保全旧版本', () => {
  const db = managerSetup();
  const configured = { ...draft, protocolVersion: 'CMJ-v2', testContext: 'indoor', side: 'right' };
  const first = savePhysicalReferenceDraft(db, actor, configured);
  const next = savePhysicalReferenceDraft(
    db,
    actor,
    { ...configured, value: 60 },
    { id: first.id, expectedRevision: 0 }
  );
  for (const id of [first.id, next.id]) {
    expect(
      db
        .prepare('SELECT protocol_version,test_context,side FROM radar_reference_values WHERE id=?')
        .get(id)
    ).toEqual({ protocol_version: 'CMJ-v2', test_context: 'indoor', side: 'right' });
  }
});
