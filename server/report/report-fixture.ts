import { DatabaseSync } from 'node:sqlite';
import { initializeTrainingReports } from './report-service.ts';

/** 仅测试使用的内存库与合成记录，不读取或写入任何正式资料。 */
export function createReportFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE athletes(id INTEGER PRIMARY KEY, project TEXT, active INTEGER);
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO athletes VALUES(1, 'ROWING', 1), (2, 'CANOE_SPRINT', 1);
    INSERT INTO users VALUES(1);
    CREATE TABLE training_sessions(id INTEGER PRIMARY KEY, athlete_id INTEGER, session_date TEXT, session_order INTEGER,
      training_type TEXT, structure_type TEXT, content TEXT, duration_min REAL, distance_km REAL,
      duration_reported INTEGER, distance_reported INTEGER, rpe REAL, srpe REAL,
      is_demo INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', quality TEXT DEFAULT 'valid');
    CREATE TABLE daily_wellness(athlete_id INTEGER, wellness_date TEXT, sleep_hours REAL, morning_pulse REAL, weight_kg REAL,
      is_demo INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', quality TEXT DEFAULT 'valid');
    CREATE TABLE metric_definitions(code TEXT, label TEXT);
    CREATE TABLE test_sessions(id INTEGER PRIMARY KEY, athlete_id INTEGER, test_date TEXT, protocol TEXT,
      is_demo INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', quality TEXT DEFAULT 'valid');
    CREATE TABLE test_measurements(id INTEGER PRIMARY KEY, test_session_id INTEGER, metric_code TEXT, unit TEXT, side TEXT, value_num REAL,
      is_demo INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', quality TEXT DEFAULT 'valid');
    INSERT INTO training_sessions VALUES
      (1,1,'2026-10-05',1,'专项训练','','水上',60,10,1,1,5,300,0,'manual','valid'),
      (2,1,'2026-10-06',1,'体能训练','','力量',0,0,0,0,NULL,0,0,'manual','partial'),
      (3,1,'2026-10-07',1,'恢复','','拉伸',0,0,1,1,0,0,0,'manual','valid'),
      (4,2,'2026-10-05',1,'专项训练','','水上',900,100,1,1,5,4500,0,'manual','valid'),
      (5,1,'2026-10-05',2,'专项训练','','水上',900,100,1,1,5,4500,1,'manual','valid'),
      (6,1,'2026-10-05',3,'专项训练','','水上',900,100,1,1,5,4500,0,'demo_seed','valid'),
      (7,1,'2026-10-05',4,'专项训练','','水上',900,100,1,1,5,4500,0,'manual','estimated'),
      (8,1,'2026-09-28',1,'专项训练','','水上',30,5,1,1,4,120,0,'manual','valid');
    INSERT INTO daily_wellness VALUES(1,'2026-10-05',8,50,NULL,0,'manual','valid'),(1,'2026-10-06',NULL,NULL,NULL,0,'manual','partial');
    INSERT INTO metric_definitions VALUES('power', '测试功率');
    INSERT INTO test_sessions VALUES(1,1,'2026-10-05','标准协议',0,'manual','valid'),(2,1,'2026-10-08','标准协议',0,'manual','valid'),(3,1,'2026-10-09','另一协议',0,'manual','valid');
    INSERT INTO test_measurements VALUES(1,1,'power','W','center',200,0,'manual','valid'),(2,2,'power','W','center',220,0,'manual','valid'),(3,3,'power','W','center',600,0,'manual','valid');`);
  // 新事实必须有明确的项目归属；旧报告兼容通过快照测试单独验证。
  db.exec(`ALTER TABLE training_sessions ADD COLUMN project_code TEXT;
    ALTER TABLE training_sessions ADD COLUMN project_status TEXT DEFAULT 'confirmed';
    ALTER TABLE training_sessions ADD COLUMN activity_code TEXT;
    ALTER TABLE training_sessions ADD COLUMN training_category TEXT;
    ALTER TABLE test_sessions ADD COLUMN project_code TEXT;
    ALTER TABLE test_sessions ADD COLUMN project_status TEXT DEFAULT 'confirmed';
    ALTER TABLE test_sessions ADD COLUMN protocol_code TEXT;
    ALTER TABLE test_sessions ADD COLUMN protocol_version TEXT;
    ALTER TABLE test_sessions ADD COLUMN context_key TEXT DEFAULT '';
    UPDATE training_sessions SET project_code = (SELECT project FROM athletes WHERE id=athlete_id);
    UPDATE test_sessions SET project_code = (SELECT project FROM athletes WHERE id=athlete_id);`);
  initializeTrainingReports(db);
  return db;
}
