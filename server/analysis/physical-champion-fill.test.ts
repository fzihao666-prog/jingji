import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { PHYSICAL_CHAMPION_DIMENSIONS } from '../../shared/physical-champion.js';
import { buildPhysicalChampion } from './physical-champion-service.js';
import { fillPhysicalChampionSimulation } from './physical-champion-fill.js';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,active INTEGER); INSERT INTO users VALUES(1,'DMD',1);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,entity_type TEXT,detail TEXT);
    CREATE TABLE athletes(id INTEGER PRIMARY KEY,name TEXT,project TEXT,gender TEXT,birth_date TEXT,active INTEGER);
    INSERT INTO athletes VALUES(1,'测试甲','ROWING','男','2000-01-01',1),(2,'测试乙','ROWING','男',NULL,1),(3,'测试丙','ROWING','男','2015-01-01',1);
    CREATE TABLE athlete_profiles(athlete_id INTEGER,current_event TEXT);
    CREATE TABLE radar_reference_sources(id INTEGER PRIMARY KEY,name TEXT,active INTEGER); INSERT INTO radar_reference_sources VALUES(1,'参考',1);
    CREATE TABLE radar_reference_values(id INTEGER PRIMARY KEY,source_id INTEGER,project TEXT,radar_kind TEXT,metric_key TEXT,gender TEXT,unit TEXT,value_num REAL,protocol TEXT,direction TEXT,source_type TEXT,event_group TEXT,weight_class TEXT,age_group TEXT,active INTEGER,updated_at TEXT,revision INTEGER);
    CREATE TABLE metric_definitions(code TEXT PRIMARY KEY,label TEXT,domain TEXT,unit TEXT,direction TEXT,frequency TEXT,minimum REAL,maximum REAL);
    CREATE TABLE test_sessions(id INTEGER PRIMARY KEY,athlete_id INTEGER,test_date TEXT,test_type TEXT,protocol TEXT,source TEXT,quality TEXT,is_demo INTEGER,created_by INTEGER,UNIQUE(athlete_id,test_date,test_type));
    CREATE TABLE test_measurements(id INTEGER PRIMARY KEY,test_session_id INTEGER,metric_code TEXT,value_num REAL,unit TEXT,side TEXT,quality TEXT,source TEXT,is_demo INTEGER,source_ref TEXT);
    INSERT INTO test_sessions VALUES(1,1,'2026-10-01','力量素质测试','CMJ双手叉腰','manual','valid',0,1);
    INSERT INTO test_measurements VALUES(1,1,'vertical_jump_cm',0,'cm','center','valid','manual',0,'');
  `);
  const values = [2, 1.4, 1.2, 55, 65, 240, 13, 72];
  const insert = db.prepare(
    `INSERT INTO radar_reference_values VALUES(?,1,'ROWING','physical',?,'男',?,?,?,?,'estimated','open','open','adult',1,'2026-10-08',0)`
  );
  PHYSICAL_CHAMPION_DIMENSIONS.forEach((dimension, i) =>
    insert.run(
      i + 1,
      dimension.key,
      dimension.unit,
      values[i],
      dimension.protocol,
      dimension.direction
    )
  );
  return db;
}
describe('用户授权体能补充', () => {
  it('只补缺测，真实零成绩和个人档案保持原样，重复执行不增加记录', () => {
    const db = setup();
    const options = { from: '2026-09-09', to: '2026-10-08', actorId: 1, batchId: 'unit-check' };
    const before = db.prepare('SELECT * FROM test_measurements WHERE id=1').get();
    const result = fillPhysicalChampionSimulation(db, options);
    expect(result.athletesFilled).toBe(2);
    expect(result.sessionsInserted).toBe(8);
    expect(db.prepare('SELECT * FROM test_measurements WHERE id=1').get()).toEqual(before);
    expect(db.prepare('SELECT birth_date FROM athletes WHERE id=2').get()).toEqual({
      birth_date: null,
    });
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM test_measurements WHERE metric_code='vertical_jump_cm' AND test_session_id IN (SELECT id FROM test_sessions WHERE athlete_id=1)"
        )
        .get()
    ).toEqual({ count: 1 });
    const model = buildPhysicalChampion(db, {
      project: 'ROWING',
      from: options.from,
      to: options.to,
      athleteIds: [1, 2, 3],
      canEdit: false,
    });
    expect(model.groups[0].athletes.map((athlete) => athlete.coverage)).toEqual([8, 8]);
    expect(fillPhysicalChampionSimulation(db, options).sessionsInserted).toBe(0);
    expect(
      db.prepare('SELECT count(*) AS count FROM test_sessions WHERE athlete_id=3').get()
    ).toEqual({ count: 0 });
  });
  it('日期或执行账号无效时拒绝写入', () => {
    const db = setup();
    expect(() =>
      fillPhysicalChampionSimulation(db, {
        from: '2026-10-08',
        to: '2026-09-09',
        actorId: 1,
        batchId: 'x',
      })
    ).toThrow();
    expect(() =>
      fillPhysicalChampionSimulation(db, {
        from: '2026-09-09',
        to: '2026-10-08',
        actorId: 999,
        batchId: 'x',
      })
    ).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM test_sessions').get()).toEqual({ count: 1 });
  });
});
