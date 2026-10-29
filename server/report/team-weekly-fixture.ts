import { createReportFixture } from './report-fixture.ts';

export function createTeamWeeklyFixture() {
  const db = createReportFixture();
  db.exec(`ALTER TABLE daily_wellness ADD COLUMN fatigue_index REAL;
    CREATE TABLE strength_result_sets(training_session_id INTEGER,exercise_name TEXT,actual_reps REAL,actual_weight_kg REAL,completed INTEGER DEFAULT 1,source TEXT DEFAULT 'manual');
    ALTER TABLE athletes ADD COLUMN name TEXT DEFAULT '示例队员';
    ALTER TABLE athletes ADD COLUMN team_id INTEGER DEFAULT 1;
    CREATE TABLE project_teams(id INTEGER PRIMARY KEY, project TEXT, name TEXT, active INTEGER);
    INSERT INTO project_teams VALUES(1,'ROWING','合成测试队',1),(2,'CANOE_SPRINT','其他项目队',1);
    UPDATE athletes SET team_id=2 WHERE id=2;
    CREATE TABLE injury_records(athlete_id INTEGER,onset_date TEXT,injury_name TEXT,status TEXT,pain_score REAL);
    CREATE TABLE training_plans(id INTEGER,root_id INTEGER,version INTEGER,revision INTEGER,status TEXT,team_id INTEGER,model TEXT,title TEXT,start_date TEXT,end_date TEXT,plan_data TEXT,published_at TEXT,archived_at TEXT);
    CREATE TABLE team_plan_item_checks(plan_id INTEGER,session_id TEXT,item_id TEXT,status TEXT);
    CREATE TABLE training_plan_execution_links(training_session_id INTEGER PRIMARY KEY,plan_id INTEGER,session_id TEXT,target_json TEXT);
    INSERT INTO athletes(id,project,active,name,team_id) VALUES(3,'ROWING',1,'队员乙',1);
    INSERT INTO training_sessions(id,athlete_id,session_date,session_order,training_type,structure_type,content,duration_min,distance_km,duration_reported,distance_reported,rpe,srpe,project_code,project_status)
    VALUES(20,3,'2026-10-05',1,'专项训练','','水上',60,10,1,1,5,300,'ROWING','confirmed');`);
  return db;
}
