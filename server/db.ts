import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { PROVINCES } from '../shared/regions.ts';
import { PROJECT_META, normalizeProject } from '../shared/projects.ts';
import { OVERVIEW_METRICS } from '../shared/overview-metrics.ts';

const databasePath = resolve(process.env.DATABASE_PATH || resolve(process.cwd(), 'data', 'training-monitor.db'));
const databaseExistedBeforeStartup = existsSync(databasePath);
// 收敛迁移可能会写入大量历史数据；第一次启动时必须保留可独立恢复的原始副本。
// 备份发生在打开 SQLite 连接之前，避免把已迁移的数据误当作原始数据。
if (databaseExistedBeforeStartup && !existsSync(`${databasePath}.before-reconstruction-v1`)) {
  copyFileSync(databasePath, `${databasePath}.before-reconstruction-v1`);
}
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
// 开发热重载可能短暂保留上一进程的连接。先设置等待时间，避免迁移或初始化数据
// 在几毫秒的写锁竞争中直接以 SQLITE_BUSY 退出。
db.exec('PRAGMA busy_timeout = 15000; PRAGMA foreign_keys = ON;');
const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
if (journalMode.journal_mode.toLowerCase() !== 'wal') db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');


db.exec(`
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS athletes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    project TEXT NOT NULL,
    team_id INTEGER,
    gender TEXT,
    birth_date TEXT,
    photo_url TEXT NOT NULL DEFAULT '',
    profile_status TEXT NOT NULL DEFAULT 'complete' CHECK(profile_status IN ('incomplete', 'complete')),
    source TEXT NOT NULL DEFAULT 'manual',
    data_import_batch_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (team_id) REFERENCES project_teams(id)
  );

  CREATE TABLE IF NOT EXISTS athlete_origins (
    athlete_id INTEGER PRIMARY KEY,
    province TEXT NOT NULL,
    city TEXT NOT NULL,
    county TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid', 'estimated')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ATL', 'SCC', 'PRJ', 'REG', 'TD', 'DMD')),
    athlete_id INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (athlete_id) REFERENCES athletes(id)
  );

  CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
    user_id INTEGER NOT NULL,
    dashboard TEXT NOT NULL,
    project TEXT NOT NULL,
    scope TEXT NOT NULL,
    layout_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, dashboard, project, scope),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS registration_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    requested_role TEXT NOT NULL CHECK(requested_role IN ('ATL', 'SCC')),
    project TEXT,
    team TEXT,
    gender TEXT,
    identity_number TEXT,
    native_place TEXT,
    region TEXT,
    city TEXT,
    county TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS project_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project, name)
  );

  CREATE TABLE IF NOT EXISTS coach_athletes (
    coach_user_id INTEGER NOT NULL,
    athlete_id INTEGER NOT NULL,
    PRIMARY KEY (coach_user_id, athlete_id),
    FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS strength_ai_advice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_session_id INTEGER,
    version INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('ai', 'rules')),
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved')),
    generated_by INTEGER NOT NULL,
    reviewed_by INTEGER,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (test_session_id, version),
    FOREIGN KEY (test_session_id) REFERENCES test_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (generated_by) REFERENCES users(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS training_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    plan_date TEXT NOT NULL,
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    schedule_label TEXT NOT NULL DEFAULT '',
    plan_data TEXT NOT NULL DEFAULT '{}',
    ai_metadata TEXT,  -- AI生成信息：输入类型、模型、分析摘要等
    created_by INTEGER NOT NULL,
    updated_by INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, plan_date),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS injury_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    record_type TEXT NOT NULL CHECK (record_type IN ('formal', 'feedback')),
    injury_name TEXT NOT NULL,
    body_part TEXT NOT NULL,
    side TEXT NOT NULL DEFAULT 'unspecified' CHECK (side IN ('left', 'right', 'bilateral', 'center', 'unspecified')),
    status TEXT NOT NULL CHECK (status IN ('healthy', 'observation', 'restricted', 'rehab', 'suspended')),
    pain_score INTEGER NOT NULL DEFAULT 0 CHECK (pain_score BETWEEN 0 AND 10),
    onset_date TEXT NOT NULL,
    restrictions TEXT NOT NULL DEFAULT '',
    rehab_plan TEXT NOT NULL DEFAULT '',
    review_date TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_injury_records_athlete_created
    ON injury_records (athlete_id, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS special_test_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_date TEXT NOT NULL,
    project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
    distance_m INTEGER NOT NULL,
    boat_class TEXT NOT NULL,
    gender_group TEXT NOT NULL,
    session TEXT NOT NULL DEFAULT '',
    wind_conditions TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project, test_date, distance_m, boat_class, gender_group, session),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS special_test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    crew_name TEXT NOT NULL,
    member_athlete_ids TEXT NOT NULL DEFAULT '[]',
    member_names TEXT NOT NULL DEFAULT '[]',
    previous_best_ms INTEGER,
    attempts_ms TEXT NOT NULL DEFAULT '[]',
    average_ms INTEGER NOT NULL,
    best_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES special_test_events(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_special_test_events_date
    ON special_test_events (project, test_date DESC, distance_m, boat_class);
  CREATE INDEX IF NOT EXISTS idx_special_test_results_event
    ON special_test_results (event_id, best_ms);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

function hasColumn(table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((item) => item.name === column);
}

function tableExists(table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

if (!hasColumn('data_import_batches', 'storage_path')) {
  db.exec('ALTER TABLE data_import_batches ADD COLUMN storage_path TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS intensity_zone_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_system TEXT NOT NULL,
    zone_code TEXT NOT NULL,
    zone_name TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(zone_system, zone_code)
  );
  CREATE TABLE IF NOT EXISTS exercise_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_code TEXT NOT NULL UNIQUE,
    exercise_name TEXT NOT NULL,
    category TEXT,
    default_unit TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const insertIntensityZone = db.prepare(`
  INSERT OR IGNORE INTO intensity_zone_definitions (zone_system, zone_code, zone_name, description, sort_order)
  VALUES (?, ?, ?, ?, ?)
`);
for (const [system, zones] of Object.entries({
  ROWING_U: ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'],
  ROWING_UT: ['UT2', 'UT1', 'TR', 'AT', 'AN', 'REC']
})) {
  zones.forEach((code, index) => insertIntensityZone.run(system, code, code, `${system} 强度分区`, index + 1));
}
const insertExercise = db.prepare(`
  INSERT OR IGNORE INTO exercise_definitions (exercise_code, exercise_name, category, default_unit)
  VALUES (?, ?, ?, 'kg')
`);
for (const [code, name] of [
  ['SQUAT', '深蹲'], ['BENCH_PULL', '卧拉'], ['BENCH_PRESS', '卧推'], ['DEADLIFT', '硬拉'], ['LEG_PRESS', '腿举'], ['PULL_UP', '引体向上'],
  ['ROWING_ERG_FUNCTION', '划船测功仪功能'], ['CIRCUIT_STRENGTH_ENDURANCE', '循环力量耐力'], ['RECOVERY_MOBILITY', '拉伸再生组合'],
  ['WATER_SPECIAL_ROWING', '水上专项划行'], ['COORDINATION_TRAINING', '综合协调训练'], ['RUN_INTERVAL', '跑步间歇'], ['HIGH_PULL_SPEED', '高拉速度力量']
]) {
  insertExercise.run(code, name, '力量训练');
}
db.exec(`
  UPDATE strength_result_sets
  SET exercise_code = CASE exercise_name
    WHEN '深蹲' THEN 'SQUAT'
    WHEN '卧拉' THEN 'BENCH_PULL'
    WHEN '划船测功仪功能' THEN 'ROWING_ERG_FUNCTION'
    WHEN '循环力量耐力' THEN 'CIRCUIT_STRENGTH_ENDURANCE'
    WHEN '拉伸再生组合' THEN 'RECOVERY_MOBILITY'
    WHEN '水上专项划行' THEN 'WATER_SPECIAL_ROWING'
    WHEN '综合协调训练' THEN 'COORDINATION_TRAINING'
    WHEN '跑步间歇' THEN 'RUN_INTERVAL'
    WHEN '高拉速度力量' THEN 'HIGH_PULL_SPEED'
    ELSE exercise_code
  END
  WHERE NULLIF(trim(exercise_code), '') IS NULL;
`);

if (!hasColumn('special_test_events', 'project')) {
  const legacyEvents = db.prepare(`
    SELECT id, test_date AS testDate, distance_m AS distanceM, boat_class AS boatClass,
      gender_group AS genderGroup, session, wind_conditions AS windConditions,
      location, note, created_by AS createdBy, created_at AS createdAt
    FROM special_test_events
  `).all() as Array<{ id: number; testDate: string; distanceM: number; boatClass: string; genderGroup: string; session: string; windConditions: string; location: string; note: string; createdBy: number; createdAt: string }>;
  const legacyResults = db.prepare(`
    SELECT id, event_id AS eventId, crew_name AS crewName, member_athlete_ids AS memberAthleteIds,
      member_names AS memberNames, previous_best_ms AS previousBestMs, attempts_ms AS attemptsMs,
      average_ms AS averageMs, best_ms AS bestMs, created_at AS createdAt
    FROM special_test_results
  `).all() as Array<{ id: number; eventId: number; crewName: string; memberAthleteIds: string; memberNames: string; previousBestMs: number | null; attemptsMs: string; averageMs: number; bestMs: number; createdAt: string }>;
  const athleteProject = db.prepare('SELECT project FROM athletes WHERE id = ?');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN;
      DROP TABLE special_test_results;
      DROP TABLE special_test_events;
      CREATE TABLE special_test_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_date TEXT NOT NULL,
        project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
        distance_m INTEGER NOT NULL,
        boat_class TEXT NOT NULL,
        gender_group TEXT NOT NULL,
        session TEXT NOT NULL DEFAULT '',
        wind_conditions TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (project, test_date, distance_m, boat_class, gender_group, session),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      CREATE TABLE special_test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        crew_name TEXT NOT NULL,
        member_athlete_ids TEXT NOT NULL DEFAULT '[]',
        member_names TEXT NOT NULL DEFAULT '[]',
        previous_best_ms INTEGER,
        attempts_ms TEXT NOT NULL DEFAULT '[]',
        average_ms INTEGER NOT NULL,
        best_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES special_test_events(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_special_test_events_date ON special_test_events (project, test_date DESC, distance_m, boat_class);
      CREATE INDEX idx_special_test_results_event ON special_test_results (event_id, best_ms);
      COMMIT;
    `);
    const insertEvent = db.prepare(`
      INSERT INTO special_test_events
        (test_date, project, distance_m, boat_class, gender_group, session, wind_conditions, location, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `);
    const insertResult = db.prepare(`
      INSERT INTO special_test_results
        (event_id, crew_name, member_athlete_ids, member_names, previous_best_ms, attempts_ms, average_ms, best_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of legacyEvents) {
      const results = legacyResults.filter((row) => row.eventId === event.id);
      const byProject = new Map<string, typeof results>();
      for (const result of results) {
        const athleteId = (JSON.parse(result.memberAthleteIds || '[]') as number[])[0];
        const project = (athleteProject.get(athleteId) as { project: string } | undefined)?.project === '皮划艇' ? '皮划艇' : '赛艇';
        byProject.set(project, [...(byProject.get(project) || []), result]);
      }
      if (!byProject.size) byProject.set('赛艇', []);
      for (const [project, projectResults] of byProject) {
        const saved = insertEvent.get(event.testDate, project, event.distanceM, event.boatClass, event.genderGroup, event.session, event.windConditions, event.location, event.note, event.createdBy, event.createdAt) as { id: number };
        for (const result of projectResults) insertResult.run(saved.id, result.crewName, result.memberAthleteIds, result.memberNames, result.previousBestMs, result.attemptsMs, result.averageMs, result.bestMs, result.createdAt);
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const specialTestSchema = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'special_test_events'").get() as { sql: string } | undefined)?.sql || '';
if (hasColumn('special_test_events', 'project') && !specialTestSchema.includes("'激流'")) {
  const events = db.prepare(`
    SELECT id, test_date AS testDate, project, distance_m AS distanceM, boat_class AS boatClass,
      gender_group AS genderGroup, session, wind_conditions AS windConditions,
      location, note, created_by AS createdBy, created_at AS createdAt
    FROM special_test_events
  `).all() as Array<{ id: number; testDate: string; project: string; distanceM: number; boatClass: string; genderGroup: string; session: string; windConditions: string; location: string; note: string; createdBy: number; createdAt: string }>;
  const results = db.prepare(`
    SELECT id, event_id AS eventId, crew_name AS crewName, member_athlete_ids AS memberAthleteIds,
      member_names AS memberNames, previous_best_ms AS previousBestMs, attempts_ms AS attemptsMs,
      average_ms AS averageMs, best_ms AS bestMs, created_at AS createdAt
    FROM special_test_results
  `).all() as Array<{ id: number; eventId: number; crewName: string; memberAthleteIds: string; memberNames: string; previousBestMs: number | null; attemptsMs: string; averageMs: number; bestMs: number; createdAt: string }>;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN;
      DROP TABLE special_test_results;
      DROP TABLE special_test_events;
      CREATE TABLE special_test_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_date TEXT NOT NULL,
        project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
        distance_m INTEGER NOT NULL,
        boat_class TEXT NOT NULL,
        gender_group TEXT NOT NULL,
        session TEXT NOT NULL DEFAULT '',
        wind_conditions TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (project, test_date, distance_m, boat_class, gender_group, session),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      CREATE TABLE special_test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        crew_name TEXT NOT NULL,
        member_athlete_ids TEXT NOT NULL DEFAULT '[]',
        member_names TEXT NOT NULL DEFAULT '[]',
        previous_best_ms INTEGER,
        attempts_ms TEXT NOT NULL DEFAULT '[]',
        average_ms INTEGER NOT NULL,
        best_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES special_test_events(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_special_test_events_date ON special_test_events (project, test_date DESC, distance_m, boat_class);
      CREATE INDEX idx_special_test_results_event ON special_test_results (event_id, best_ms);
      COMMIT;
    `);
    const insertEvent = db.prepare(`
      INSERT INTO special_test_events
        (id, test_date, project, distance_m, boat_class, gender_group, session, wind_conditions, location, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of events) insertEvent.run(event.id, event.testDate, event.project, event.distanceM, event.boatClass, event.genderGroup, event.session, event.windConditions, event.location, event.note, event.createdBy, event.createdAt);
    const insertResult = db.prepare(`
      INSERT INTO special_test_results
        (id, event_id, crew_name, member_athlete_ids, member_names, previous_best_ms, attempts_ms, average_ms, best_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const result of results) insertResult.run(result.id, result.eventId, result.crewName, result.memberAthleteIds, result.memberNames, result.previousBestMs, result.attemptsMs, result.averageMs, result.bestMs, result.createdAt);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

if (!hasColumn('athletes', 'photo_url')) {
  db.exec("ALTER TABLE athletes ADD COLUMN photo_url TEXT NOT NULL DEFAULT ''");
}
if (!hasColumn('athletes', 'birth_date')) {
  db.exec('ALTER TABLE athletes ADD COLUMN birth_date TEXT');
}
if (!hasColumn('registration_requests', 'region')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN region TEXT');
}
if (!hasColumn('registration_requests', 'city')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN city TEXT');
}
if (!hasColumn('registration_requests', 'county')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN county TEXT');
}
if (!hasColumn('registration_requests', 'identity_number')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN identity_number TEXT');
}
if (!hasColumn('registration_requests', 'native_place')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN native_place TEXT');
}
if (!hasColumn('training_plans', 'start_date')) {
  db.exec("ALTER TABLE training_plans ADD COLUMN start_date TEXT NOT NULL DEFAULT ''");
}
if (!hasColumn('training_plans', 'end_date')) {
  db.exec("ALTER TABLE training_plans ADD COLUMN end_date TEXT NOT NULL DEFAULT ''");
}
if (!hasColumn('training_plans', 'ai_metadata')) {
  db.exec('ALTER TABLE training_plans ADD COLUMN ai_metadata TEXT');
}
db.exec(`
  UPDATE training_plans
  SET start_date = COALESCE(NULLIF(start_date, ''), plan_date),
      end_date = COALESCE(NULLIF(end_date, ''), date(plan_date, '+1 month', '-1 day'))
  WHERE start_date = '' OR end_date = '';
`);

function runInitializationOnce(key: string, task: () => void) {
  const completed = db.prepare('SELECT 1 FROM app_metadata WHERE key = ?').get(key);
  if (completed) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    // 并发启动的第二个进程会在 BEGIN IMMEDIATE 等待；获得锁后必须再次检查。
    const completedAfterLock = db.prepare('SELECT 1 FROM app_metadata WHERE key = ?').get(key);
    if (!completedAfterLock) {
      task();
      db.prepare(`
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES (?, 'complete', CURRENT_TIMESTAMP)
      `).run(key);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

const usersTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string } | undefined;
if (usersTable && !usersTable.sql.includes("'DMD'")) {
  const activeExpression = hasColumn('users', 'active') ? 'active' : '1';
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE users_access_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('ATL', 'SCC', 'PRJ', 'REG', 'TD', 'DMD')),
        athlete_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (athlete_id) REFERENCES athletes(id)
      );
      INSERT INTO users_access_v2 (id, username, password_hash, display_name, role, athlete_id, active)
        SELECT id, username, password_hash, display_name,
          CASE role
            WHEN 'athlete' THEN 'ATL'
            WHEN 'coach' THEN 'SCC'
            WHEN 'project' THEN 'PRJ'
            WHEN 'project_lead' THEN 'PRJ'
            WHEN 'regional' THEN 'REG'
            WHEN 'executive' THEN 'TD'
            WHEN 'training_director' THEN 'TD'
            WHEN 'admin' THEN 'DMD'
            WHEN 'data_director' THEN 'DMD'
            ELSE role
          END,
          athlete_id,
          ${activeExpression}
        FROM users;
      DROP TABLE users;
      ALTER TABLE users_access_v2 RENAME TO users;
      COMMIT;
    `);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const registrationsTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'registration_requests'").get() as { sql: string } | undefined;
if (registrationsTable && !registrationsTable.sql.includes("'ATL'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE registration_requests_access_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        requested_role TEXT NOT NULL CHECK(requested_role IN ('ATL', 'SCC')),
        project TEXT,
        team TEXT,
        gender TEXT,
        identity_number TEXT,
        native_place TEXT,
        region TEXT,
        city TEXT,
        county TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        reviewed_by INTEGER,
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      );
      INSERT INTO registration_requests_access_v2 (
        id, username, password_hash, display_name, requested_role, project, team, gender, identity_number, native_place,
        region, city, county, status, reviewed_by, reviewed_at, created_at
      )
      SELECT id, username, password_hash, display_name,
        CASE requested_role WHEN 'athlete' THEN 'ATL' WHEN 'coach' THEN 'SCC' ELSE requested_role END,
        project, team, gender, identity_number, native_place, region, city, county, status, reviewed_by, reviewed_at, created_at
      FROM registration_requests;
      DROP TABLE registration_requests;
      ALTER TABLE registration_requests_access_v2 RENAME TO registration_requests;
      COMMIT;
    `);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS regional_manager_regions (
    manager_user_id INTEGER NOT NULL,
    region TEXT NOT NULL,
    granted_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (manager_user_id, region),
    FOREIGN KEY (manager_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS account_profiles (
    user_id INTEGER PRIMARY KEY,
    parent_user_id INTEGER,
    account_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS coach_profiles (
    user_id INTEGER PRIMARY KEY,
    category TEXT NOT NULL DEFAULT '体能教练'
      CHECK(category IN ('体能教练', '专项教练')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS athlete_profiles (
    athlete_id INTEGER PRIMARY KEY,
    identity_number TEXT NOT NULL DEFAULT '',
    ethnicity TEXT NOT NULL DEFAULT '汉族',
    phone TEXT NOT NULL DEFAULT '',
    blood_type TEXT NOT NULL DEFAULT '',
    emergency_contact TEXT NOT NULL DEFAULT '',
    emergency_phone TEXT NOT NULL DEFAULT '',
    education TEXT NOT NULL DEFAULT '',
    technical_level TEXT NOT NULL DEFAULT '',
    position TEXT NOT NULL DEFAULT '',
    health_status TEXT NOT NULL DEFAULT '健康',
    best_result TEXT NOT NULL DEFAULT '',
    native_place TEXT NOT NULL DEFAULT '',
    home_address TEXT NOT NULL DEFAULT '',
    athlete_status TEXT NOT NULL DEFAULT '在训',
    start_sport_date TEXT NOT NULL DEFAULT '',
    training_venue TEXT NOT NULL DEFAULT '',
    current_event TEXT NOT NULL DEFAULT '',
    training_phase TEXT NOT NULL DEFAULT '',
    camp_period TEXT NOT NULL DEFAULT '',
    origin_place TEXT NOT NULL DEFAULT '',
    origin_unit TEXT NOT NULL DEFAULT '',
    origin_coach TEXT NOT NULL DEFAULT '',
    specialties TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_area_permissions (
    user_id INTEGER NOT NULL,
    area_level TEXT NOT NULL CHECK(area_level IN ('national', 'province', 'city', 'county')),
    province TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    county TEXT NOT NULL DEFAULT '',
    granted_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, area_level, province, city, county),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_project_permissions (
    user_id INTEGER NOT NULL,
    project TEXT NOT NULL,
    granted_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, project),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_team_permissions (
    user_id INTEGER NOT NULL,
    project TEXT NOT NULL,
    team TEXT NOT NULL,
    granted_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, project, team),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users(id)
  );
`);

if (!hasColumn('athlete_profiles', 'position')) {
  db.exec("ALTER TABLE athlete_profiles ADD COLUMN position TEXT NOT NULL DEFAULT ''");
}

// 训练总览采用“每日恢复—训练课次—测试批次—测试指标”的分层结构。
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_wellness (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    wellness_date TEXT NOT NULL,
    sleep_hours REAL,
    sleep_quality REAL,
    morning_pulse REAL,
    weight_kg REAL,
    fatigue_index REAL,
    soreness_index REAL,
    mood_index REAL,
    status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal', 'attention', 'alert', 'rest', 'missing')),
    source TEXT NOT NULL DEFAULT 'manual',
    quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid', 'partial', 'insufficient', 'outlier', 'estimated')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, wellness_date),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS training_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    session_order INTEGER NOT NULL DEFAULT 1,
    start_time TEXT NOT NULL DEFAULT '',
    training_type TEXT NOT NULL,
    structure_type TEXT NOT NULL,
    intensity_zone TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    duration_min REAL NOT NULL DEFAULT 0,
    distance_km REAL NOT NULL DEFAULT 0,
    duration_reported INTEGER NOT NULL DEFAULT 1 CHECK(duration_reported IN (0, 1)),
    distance_reported INTEGER NOT NULL DEFAULT 1 CHECK(distance_reported IN (0, 1)),
    rpe REAL,
    srpe REAL NOT NULL DEFAULT 0,
    smvl REAL NOT NULL DEFAULT 0,
    average_heart_rate REAL,
    max_heart_rate REAL,
    average_power_w REAL,
    stroke_rate_spm REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid', 'partial', 'insufficient', 'outlier', 'estimated')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, session_date, session_order),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS strength_result_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    training_session_id INTEGER NOT NULL,
    exercise_code TEXT NOT NULL DEFAULT '',
    exercise_name TEXT NOT NULL,
    set_index INTEGER NOT NULL DEFAULT 1,
    target_reps REAL,
    actual_reps REAL NOT NULL,
    actual_weight_kg REAL NOT NULL,
    planned_weight_kg REAL,
    training_category TEXT NOT NULL DEFAULT '基础力量',
    body_position TEXT NOT NULL DEFAULT '全身',
    training_environment TEXT NOT NULL DEFAULT '陆上',
    duration_min REAL NOT NULL DEFAULT 0,
    distance_km REAL NOT NULL DEFAULT 0,
    intensity_percent REAL,
    intensity_zone TEXT NOT NULL DEFAULT 'AN',
    rpe REAL,
    completed INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    data_import_batch_id TEXT,
    source_row TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL DEFAULT '',
    ai_confidence REAL,
    created_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (training_session_id, exercise_name, set_index),
    FOREIGN KEY (training_session_id) REFERENCES training_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS metric_definitions (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    domain TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL CHECK(direction IN ('higher_better', 'lower_better', 'neutral')),
    frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'session', 'monthly', 'phase')),
    projects_json TEXT NOT NULL DEFAULT '[]',
    minimum REAL,
    maximum REAL,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS champion_model_standards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
    gender TEXT NOT NULL CHECK(gender IN ('男', '女')),
    metric_code TEXT NOT NULL,
    model_version TEXT NOT NULL DEFAULT 'CHAMPION-2026-R1',
    target_min REAL,
    target_max REAL,
    elite_mean REAL,
    weight REAL NOT NULL DEFAULT 1,
    rationale TEXT NOT NULL DEFAULT '',
    source_note TEXT NOT NULL DEFAULT '项目冠军模型初始化生成',
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project, gender, metric_code, model_version),
    FOREIGN KEY (metric_code) REFERENCES metric_definitions(code)
  );

  CREATE TABLE IF NOT EXISTS test_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    test_date TEXT NOT NULL,
    test_type TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid', 'partial', 'insufficient', 'outlier', 'estimated')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, test_date, test_type),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS test_measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_session_id INTEGER NOT NULL,
    metric_code TEXT NOT NULL,
    value_num REAL NOT NULL,
    target_value REAL,
    unit TEXT NOT NULL DEFAULT '',
    side TEXT NOT NULL DEFAULT 'center' CHECK(side IN ('left', 'right', 'bilateral', 'center')),
    quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid', 'partial', 'insufficient', 'outlier', 'estimated')),
    source TEXT NOT NULL DEFAULT 'manual',
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (test_session_id, metric_code, side),
    FOREIGN KEY (test_session_id) REFERENCES test_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (metric_code) REFERENCES metric_definitions(code)
  );

  CREATE TABLE IF NOT EXISTS athlete_body_measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    measurement_date TEXT NOT NULL,
    height_cm REAL,
    weight_kg REAL,
    body_fat_pct REAL,
    skeletal_muscle_kg REAL,
    muscle_mass_kg REAL,
    upper_limb_muscle_kg REAL,
    lower_limb_muscle_kg REAL,
    trunk_muscle_kg REAL,
    subcutaneous_fat_mm REAL,
    triceps_skinfold_mm REAL,
    abdominal_skinfold_mm REAL,
    thigh_skinfold_mm REAL,
    calf_skinfold_mm REAL,
    visceral_fat_level REAL,
    basal_metabolism_kcal REAL,
    total_body_water_kg REAL,
    ecw_tbw_ratio REAL,
    phase_angle_deg REAL,
    visceral_fat_area_cm2 REAL,
    left_arm_lean_kg REAL,
    right_arm_lean_kg REAL,
    trunk_lean_kg REAL,
    left_leg_lean_kg REAL,
    right_leg_lean_kg REAL,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid', 'partial', 'insufficient', 'outlier', 'estimated')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, measurement_date),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS competitive_state_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    assessment_date TEXT NOT NULL,
    overall_score REAL NOT NULL CHECK(overall_score BETWEEN 0 AND 100),
    state_level TEXT NOT NULL CHECK(state_level IN ('peak', 'good', 'build', 'adjust')),
    endurance_score REAL CHECK(endurance_score BETWEEN 0 AND 100),
    power_score REAL CHECK(power_score BETWEEN 0 AND 100),
    technique_score REAL CHECK(technique_score BETWEEN 0 AND 100),
    load_adaptation_score REAL CHECK(load_adaptation_score BETWEEN 0 AND 100),
    recovery_score REAL CHECK(recovery_score BETWEEN 0 AND 100),
    competition_score REAL CHECK(competition_score BETWEEN 0 AND 100),
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    quality TEXT NOT NULL DEFAULT 'valid' CHECK(quality IN ('valid', 'partial', 'insufficient', 'outlier', 'estimated')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, assessment_date),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS data_import_batches (
    id TEXT PRIMARY KEY,
    file_hash TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    source_mimetype TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
    parser_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reviewing' CHECK(status IN ('reviewing', 'committed', 'failed', 'rolled_back')),
    sheet_count INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    valid_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    committed_at TEXT,
    UNIQUE (file_hash, project),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS training_session_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    training_session_id INTEGER NOT NULL,
    segment_order INTEGER NOT NULL DEFAULT 1,
    training_type TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    intensity_zone TEXT NOT NULL DEFAULT '',
    zone_system TEXT NOT NULL DEFAULT '',
    duration_min REAL NOT NULL DEFAULT 0,
    distance_km REAL NOT NULL DEFAULT 0,
    rpe REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (training_session_id, segment_order),
    FOREIGN KEY (training_session_id) REFERENCES training_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS data_import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK(item_type IN ('athlete_profile', 'wellness', 'training_session', 'training_set', 'test_measurement', 'body_measurement', 'injury_record', 'competitive_state', 'scoring_rule')),
    athlete_id INTEGER,
    raw_athlete_name TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '',
    session_label TEXT NOT NULL DEFAULT '',
    test_type TEXT NOT NULL DEFAULT '',
    metric_code TEXT NOT NULL DEFAULT '',
    metric_label TEXT NOT NULL DEFAULT '',
    side TEXT NOT NULL DEFAULT 'center' CHECK(side IN ('left', 'right', 'bilateral', 'center')),
    value_num REAL,
    unit TEXT NOT NULL DEFAULT '',
    exercise_name TEXT NOT NULL DEFAULT '',
    set_index INTEGER NOT NULL DEFAULT 1,
    target_reps REAL,
    actual_reps REAL,
    actual_weight_kg REAL,
    intensity_percent REAL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    source_sheet TEXT NOT NULL,
    source_address TEXT NOT NULL,
    raw_value TEXT NOT NULL DEFAULT '',
    quality TEXT NOT NULL CHECK(quality IN ('valid', 'warning', 'error', 'skipped')),
    messages_json TEXT NOT NULL DEFAULT '[]',
    business_key TEXT NOT NULL DEFAULT '',
    committed_entity_type TEXT NOT NULL DEFAULT '',
    committed_entity_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (batch_id, item_type, source_sheet, source_address, metric_code, side, set_index),
    FOREIGN KEY (batch_id) REFERENCES data_import_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (athlete_id) REFERENCES athletes(id)
  );

  CREATE TABLE IF NOT EXISTS data_import_athlete_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    name TEXT NOT NULL,
    project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
    team TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '未设置',
    city TEXT NOT NULL DEFAULT '未设置',
    county TEXT NOT NULL DEFAULT '未设置',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'matched', 'created')),
    matched_athlete_id INTEGER,
    created_athlete_id INTEGER,
    source_sheet TEXT NOT NULL DEFAULT '',
    messages_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (batch_id, normalized_name),
    FOREIGN KEY (batch_id) REFERENCES data_import_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (matched_athlete_id) REFERENCES athletes(id),
    FOREIGN KEY (created_athlete_id) REFERENCES athletes(id)
  );

  CREATE TABLE IF NOT EXISTS athlete_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
    source TEXT NOT NULL DEFAULT 'manual',
    confirmed_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (normalized_alias, project),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
    FOREIGN KEY (confirmed_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS metric_aliases (
    alias TEXT PRIMARY KEY,
    normalized_alias TEXT NOT NULL UNIQUE,
    metric_code TEXT NOT NULL,
    canonical_label TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    side TEXT NOT NULL DEFAULT 'center' CHECK(side IN ('left', 'right', 'bilateral', 'center')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (metric_code) REFERENCES metric_definitions(code)
  );

  CREATE TABLE IF NOT EXISTS special_champion_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    standard_type TEXT NOT NULL CHECK(standard_type IN ('ASIA', 'INTERNATIONAL', 'GOLD')),
    event_code TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_group TEXT NOT NULL DEFAULT '其他项目',
    country TEXT,
    best_performance TEXT,
    competition TEXT,
    location TEXT,
    competition_date TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project, standard_type, event_code)
  );

  CREATE TABLE IF NOT EXISTS metric_scoring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL CHECK(project IN ('赛艇', '皮划艇', '激流')),
    gender TEXT NOT NULL CHECK(gender IN ('男', '女')),
    metric_code TEXT NOT NULL,
    score REAL NOT NULL,
    threshold_value REAL NOT NULL,
    comparison TEXT NOT NULL DEFAULT 'gte' CHECK(comparison IN ('gte', 'lte')),
    rule_version TEXT NOT NULL,
    source_batch_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project, gender, metric_code, score, rule_version),
    FOREIGN KEY (metric_code) REFERENCES metric_definitions(code),
    FOREIGN KEY (source_batch_id) REFERENCES data_import_batches(id)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_wellness_athlete_date ON daily_wellness (athlete_id, wellness_date);
  CREATE INDEX IF NOT EXISTS idx_training_sessions_athlete_date ON training_sessions (athlete_id, session_date, session_order);
  CREATE INDEX IF NOT EXISTS idx_strength_result_sets_session ON strength_result_sets (training_session_id, exercise_name, set_index);
  CREATE INDEX IF NOT EXISTS idx_test_sessions_athlete_date ON test_sessions (athlete_id, test_date DESC);
  CREATE INDEX IF NOT EXISTS idx_test_measurements_session ON test_measurements (test_session_id, metric_code);
  CREATE INDEX IF NOT EXISTS idx_body_measurements_athlete_date ON athlete_body_measurements (athlete_id, measurement_date DESC);
  CREATE INDEX IF NOT EXISTS idx_champion_standards_lookup ON champion_model_standards (project, gender, active, metric_code);
  CREATE INDEX IF NOT EXISTS idx_special_champion_models_lookup ON special_champion_models (project, standard_type, active, sort_order);
  CREATE INDEX IF NOT EXISTS idx_competitive_state_athlete_date ON competitive_state_assessments (athlete_id, assessment_date DESC);
  CREATE INDEX IF NOT EXISTS idx_data_import_batches_created ON data_import_batches (created_at DESC, project, status);
  CREATE INDEX IF NOT EXISTS idx_data_import_items_batch_quality ON data_import_items (batch_id, quality, item_type);
  CREATE INDEX IF NOT EXISTS idx_data_import_items_athlete_date ON data_import_items (athlete_id, event_date, item_type);
  CREATE INDEX IF NOT EXISTS idx_data_import_candidates_batch ON data_import_athlete_candidates (batch_id, status, normalized_name);
  CREATE INDEX IF NOT EXISTS idx_athlete_aliases_lookup ON athlete_aliases (normalized_alias, project);
  CREATE INDEX IF NOT EXISTS idx_athlete_origins_province_city ON athlete_origins (province, city, athlete_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_athletes_identity ON athletes (name, project, team);
`);

// 时长、距离数值沿用既有字段；单独保存是否填报，避免将导入空单元格误判为真实 0。
// 老数据没有可靠的缺失来源，按历史已填报处理，后续导入会准确写入标记。
for (const [column, definition] of [
  ['duration_reported', 'INTEGER NOT NULL DEFAULT 1 CHECK(duration_reported IN (0, 1))'],
  ['distance_reported', 'INTEGER NOT NULL DEFAULT 1 CHECK(distance_reported IN (0, 1))']
] as const) {
  if (!hasColumn('training_sessions', column)) db.exec(`ALTER TABLE training_sessions ADD COLUMN ${column} ${definition}`);
}

if (tableExists('special_champion_models') && !hasColumn('special_champion_models', 'event_group')) {
  db.exec("ALTER TABLE special_champion_models ADD COLUMN event_group TEXT NOT NULL DEFAULT '其他项目'");
}
if (tableExists('special_champion_models') && !hasColumn('special_champion_models', 'competition_date')) {
  db.exec('ALTER TABLE special_champion_models ADD COLUMN competition_date TEXT');
}

// 项目名称曾作为数据库关联值保存。此迁移只转换已有三项目，保留所有业务记录主键与关系；
// 后续新增项目统一写入稳定 Code，不再以中文展示名作为关联键。
function migrateLegacyProjectCodes() {
  const pairs = [['赛艇', 'ROWING'], ['皮划艇', 'CANOE_SPRINT'], ['激流', 'CANOE_SLALOM']] as const;
  const projectTables = ['athletes', 'user_dashboard_preferences', 'registration_requests', 'project_teams', 'user_project_permissions', 'user_team_permissions'];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of projectTables) for (const [legacy, code] of pairs) db.prepare(`UPDATE ${table} SET project = ? WHERE project = ?`).run(code, legacy);
    const metrics = db.prepare('SELECT code, projects_json AS projectsJson FROM metric_definitions').all() as Array<{ code: string; projectsJson: string }>;
    for (const metric of metrics) {
      try {
        const values = JSON.parse(metric.projectsJson) as unknown[];
        const next = values.map((value) => normalizeProject(value) || value);
        db.prepare('UPDATE metric_definitions SET projects_json = ? WHERE code = ?').run(JSON.stringify(next), metric.code);
      } catch { /* 保留无法解析的历史自定义指标配置 */ }
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no-op */ }
    throw error;
  }
}

const athleteTableDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'athletes'")
  .get() as { sql: string } | undefined;
if (athleteTableDefinition?.sql && /name\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(athleteTableDefinition.sql)) {
  db.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE athletes RENAME TO athletes_legacy_unique_name;
      CREATE TABLE athletes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        project TEXT NOT NULL,
        team TEXT NOT NULL,
        gender TEXT,
        region TEXT NOT NULL DEFAULT '未设置',
        city TEXT NOT NULL DEFAULT '未设置',
        county TEXT NOT NULL DEFAULT '未设置',
        birth_date TEXT,
        photo_url TEXT NOT NULL DEFAULT '',
        profile_status TEXT NOT NULL DEFAULT 'complete' CHECK(profile_status IN ('incomplete', 'complete')),
        source TEXT NOT NULL DEFAULT 'manual',
        data_import_batch_id TEXT,
        active INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO athletes (
        id, name, project, team, gender, region, city, county, birth_date, photo_url,
        profile_status, source, data_import_batch_id, active
      )
      SELECT id, name, project, team, gender, region, city, county, birth_date, photo_url,
        'complete', 'manual', NULL, active
      FROM athletes_legacy_unique_name;
      DROP TABLE athletes_legacy_unique_name;
      CREATE UNIQUE INDEX idx_athletes_identity ON athletes (name, project, team);
      COMMIT;
    `);
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* no-op */ }
    throw error;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
  }
}

if (!hasColumn('athletes', 'profile_status')) {
  db.exec("ALTER TABLE athletes ADD COLUMN profile_status TEXT NOT NULL DEFAULT 'complete'");
}
if (!hasColumn('athletes', 'source')) {
  db.exec("ALTER TABLE athletes ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
}
if (!hasColumn('athletes', 'data_import_batch_id')) {
  db.exec('ALTER TABLE athletes ADD COLUMN data_import_batch_id TEXT');
}

// SQLite 不能直接修改 CHECK 约束。旧库升级时仅重建导入暂存表，完整复制批次数据；
// 正式运动员、训练与测试数据表不会被改写或清空。
const importItemTableDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'data_import_items'")
  .get() as { sql: string } | undefined;
if (importItemTableDefinition?.sql && !importItemTableDefinition.sql.includes("'athlete_profile'")) {
  db.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE data_import_items RENAME TO data_import_items_legacy_types;
      CREATE TABLE data_import_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        item_type TEXT NOT NULL CHECK(item_type IN ('athlete_profile', 'wellness', 'training_session', 'training_set', 'test_measurement', 'body_measurement', 'injury_record', 'competitive_state', 'scoring_rule')),
        athlete_id INTEGER,
        raw_athlete_name TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL DEFAULT '',
        session_label TEXT NOT NULL DEFAULT '', test_type TEXT NOT NULL DEFAULT '',
        metric_code TEXT NOT NULL DEFAULT '', metric_label TEXT NOT NULL DEFAULT '',
        side TEXT NOT NULL DEFAULT 'center' CHECK(side IN ('left', 'right', 'bilateral', 'center')),
        value_num REAL, unit TEXT NOT NULL DEFAULT '', exercise_name TEXT NOT NULL DEFAULT '',
        set_index INTEGER NOT NULL DEFAULT 1, target_reps REAL, actual_reps REAL,
        actual_weight_kg REAL, intensity_percent REAL, payload_json TEXT NOT NULL DEFAULT '{}',
        source_sheet TEXT NOT NULL, source_address TEXT NOT NULL, raw_value TEXT NOT NULL DEFAULT '',
        quality TEXT NOT NULL CHECK(quality IN ('valid', 'warning', 'error', 'skipped')),
        messages_json TEXT NOT NULL DEFAULT '[]', business_key TEXT NOT NULL DEFAULT '',
        committed_entity_type TEXT NOT NULL DEFAULT '', committed_entity_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (batch_id, item_type, source_sheet, source_address, metric_code, side, set_index),
        FOREIGN KEY (batch_id) REFERENCES data_import_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (athlete_id) REFERENCES athletes(id)
      );
      INSERT INTO data_import_items SELECT * FROM data_import_items_legacy_types;
      DROP TABLE data_import_items_legacy_types;
      CREATE INDEX IF NOT EXISTS idx_data_import_items_batch_quality ON data_import_items (batch_id, quality, item_type);
      CREATE INDEX IF NOT EXISTS idx_data_import_items_athlete_date ON data_import_items (athlete_id, event_date, item_type);
      COMMIT;
    `);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
  }
}

const bodyMeasurementColumns = [
  ['skeletal_muscle_kg', 'REAL'],
  ['muscle_mass_kg', 'REAL'],
  ['upper_limb_muscle_kg', 'REAL'],
  ['lower_limb_muscle_kg', 'REAL'],
  ['trunk_muscle_kg', 'REAL'],
  ['subcutaneous_fat_mm', 'REAL'],
  ['triceps_skinfold_mm', 'REAL'],
  ['abdominal_skinfold_mm', 'REAL'],
  ['thigh_skinfold_mm', 'REAL'],
  ['calf_skinfold_mm', 'REAL'],
  ['visceral_fat_level', 'REAL'],
  ['basal_metabolism_kcal', 'REAL'],
  ['total_body_water_kg', 'REAL'],
  ['ecw_tbw_ratio', 'REAL'],
  ['phase_angle_deg', 'REAL'],
  ['visceral_fat_area_cm2', 'REAL'],
  ['left_arm_lean_kg', 'REAL'],
  ['right_arm_lean_kg', 'REAL'],
  ['trunk_lean_kg', 'REAL'],
  ['left_leg_lean_kg', 'REAL'],
  ['right_leg_lean_kg', 'REAL'],
  ['note', "TEXT NOT NULL DEFAULT ''"]
] as const;
db.exec('BEGIN IMMEDIATE');
try {
for (const [column, definition] of bodyMeasurementColumns) {
  if (!hasColumn('athlete_body_measurements', column)) {
    db.exec(`ALTER TABLE athlete_body_measurements ADD COLUMN ${column} ${definition}`);
  }
}

const strengthResultColumns = [
  ['exercise_code', "TEXT NOT NULL DEFAULT ''"],
  ['training_category', "TEXT NOT NULL DEFAULT '基础力量'"],
  ['body_position', "TEXT NOT NULL DEFAULT '全身'"],
  ['training_environment', "TEXT NOT NULL DEFAULT '陆上'"],
  ['planned_weight_kg', 'REAL'],
  ['duration_min', 'REAL NOT NULL DEFAULT 0'],
  ['distance_km', 'REAL NOT NULL DEFAULT 0'],
  ['intensity_percent', 'REAL'],
  ['intensity_zone', "TEXT NOT NULL DEFAULT 'AN'"]
] as const;

for (const [column, definition] of strengthResultColumns) {
  if (!hasColumn('strength_result_sets', column)) {
    db.exec(`ALTER TABLE strength_result_sets ADD COLUMN ${column} ${definition}`);
  }
}

for (const [table, column, definition] of [
  ['athletes', 'team_id', 'INTEGER'],
  ['training_session_segments', 'intensity_zone', "TEXT NOT NULL DEFAULT ''"],
  ['training_session_segments', 'zone_system', "TEXT NOT NULL DEFAULT ''"],
  ['strength_result_sets', 'data_import_batch_id', 'TEXT'],
  ['test_measurements', 'data_import_batch_id', 'TEXT'],
  ['test_measurements', 'source_ref', "TEXT NOT NULL DEFAULT ''"],
  ['athlete_body_measurements', 'data_import_batch_id', 'TEXT']
] as const) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_athletes_team_id ON athletes (team_id);
  CREATE INDEX IF NOT EXISTS idx_strength_result_sets_data_batch ON strength_result_sets (data_import_batch_id);
  CREATE TRIGGER IF NOT EXISTS sync_athlete_team_id_after_insert
  AFTER INSERT ON athletes
  BEGIN
    UPDATE athletes SET team_id = (
      SELECT id FROM project_teams WHERE project = NEW.project AND name = NEW.team AND active = 1
    ) WHERE id = NEW.id;
  END;
  CREATE TRIGGER IF NOT EXISTS sync_athlete_team_id_after_team_change
  AFTER UPDATE OF project, team ON athletes
  BEGIN
    UPDATE athletes SET team_id = (
      SELECT id FROM project_teams WHERE project = NEW.project AND name = NEW.team AND active = 1
    ) WHERE id = NEW.id;
  END;
`);
  db.exec('COMMIT');
} catch (error) {
  if (db.isTransaction) db.exec('ROLLBACK');
  throw error;
}

export function upsertAthleteOrigin(input: {
  athleteId: number;
  province: string;
  city: string;
  county?: string;
  source?: string;
  quality?: 'valid' | 'estimated';
  isDemo?: boolean;
}) {
  db.prepare(`
    INSERT INTO athlete_origins
      (athlete_id, province, city, county, source, quality, is_demo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(athlete_id) DO UPDATE SET
      province = excluded.province,
      city = excluded.city,
      county = excluded.county,
      source = excluded.source,
      quality = excluded.quality,
      is_demo = excluded.is_demo,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    input.athleteId,
    input.province,
    input.city,
    input.county || '',
    input.source || 'manual',
    input.quality || 'valid',
    input.isDemo ? 1 : 0
  );
}

function seed() {
  const athleteCount = db.prepare('SELECT COUNT(*) AS count FROM athletes').get() as { count: number };
  if (athleteCount.count > 0) return;

  const insertAthlete = db.prepare(
    'INSERT INTO athletes (name, project, team, gender, region, city, county) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const athletes = [
    ['林舟', '赛艇', '女子双桨组', '女', '四川', '成都', '武侯区'],
    ['沈澜', '赛艇', '女子双桨组', '女', '四川', '成都', '武侯区'],
    ['陈屿', '赛艇', '男子单桨组', '男', '浙江', '杭州', '西湖区'],
    ['周竞', '赛艇', '男子单桨组', '男', '浙江', '杭州', '西湖区'],
    ['许沐', '皮划艇', '女子静水组', '女', '广东', '广州', '天河区'],
    ['顾川', '皮划艇', '男子静水组', '男', '广东', '广州', '天河区'],
    ['宋岚', '激流', '女子激流回旋组', '女', '贵州', '贵阳', '观山湖区'],
    ['江跃', '激流', '男子激流回旋组', '男', '贵州', '贵阳', '观山湖区']
  ];
  for (const athlete of athletes) insertAthlete.run(...athlete);

  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, display_name, role, athlete_id) VALUES (?, ?, ?, ?, ?)'
  );
  const passwordHash = bcrypt.hashSync('demo123', 10);
  insertUser.run('athlete01', passwordHash, '林舟', 'ATL', 1);
  insertUser.run('coach01', passwordHash, '刘教练', 'SCC', null);
  insertUser.run('coach02', passwordHash, '齐教练', 'SCC', null);
  insertUser.run('executive01', passwordHash, '全国训练总监', 'TD', null);
  insertUser.run('admin01', passwordHash, '全国数据监控总监', 'DMD', null);
  const regionalResult = insertUser.run('regional01', passwordHash, '四川区域负责人', 'REG', null);
  const regionalId = Number(regionalResult.lastInsertRowid);
  const adminId = (db.prepare("SELECT id FROM users WHERE username = 'admin01'").get() as { id: number }).id;
  db.prepare('INSERT INTO regional_manager_regions (manager_user_id, region, granted_by) VALUES (?, ?, ?)')
    .run(regionalId, '四川', adminId);

  const assign = db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)');
  for (const athleteId of [1, 2, 3, 4]) assign.run(2, athleteId);
  for (const athleteId of [1, 5, 6, 7, 8]) assign.run(3, athleteId);

  const insertSession = db.prepare(`
    INSERT INTO training_sessions (athlete_id, session_date, session_order, training_type, structure_type, intensity_zone,
      content, duration_min, distance_km, rpe, srpe, smvl, source, quality, is_demo, created_by)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initial_seed', 'estimated', 0, ?)
  `);
  const insertWellness = db.prepare(`
    INSERT INTO daily_wellness (athlete_id, wellness_date, sleep_hours, morning_pulse, weight_kg, fatigue_index,
      status, source, quality, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'initial_seed', 'estimated', 0)
  `);

  const start = new Date('2026-06-01T12:00:00Z');
  const zones = ['U3', 'U2', 'U1', 'AT', 'U2', 'U1'];
  const bodies = [58.4, 61.2, 78.6, 81.3, 63.7, 76.8, 59.5, 77.4];

  for (let day = 0; day < 51; day += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + day);
    const iso = date.toISOString().slice(0, 10);
    const weekDay = date.getDay();

    for (let athleteId = 1; athleteId <= athletes.length; athleteId += 1) {
      const phase = day + athleteId * 1.7;
      const isRest = weekDay === 0;
      const isStrength = weekDay === 2 || weekDay === 5;
      const isRecovery = weekDay === 1;
      const duration = isRest ? 0 : Math.round(82 + (day % 4) * 14 + athleteId * 3);
      const distance = isRest || isStrength ? 0 : Number((14 + (day % 5) * 2.4 + athleteId * 0.6).toFixed(1));
      const rpe = isRest ? null : Number((5.1 + (day % 4) * 0.65 + athleteId * 0.08).toFixed(1));
      const sleep = Number((7.35 + Math.sin(phase / 3) * 0.7).toFixed(1));
      const fatigue = Number((3.4 + Math.cos(phase / 4) * 1.7 + (day % 13 === 0 ? 2.1 : 0)).toFixed(1));
      const pulse = Math.round(49 + athleteId * 1.5 + Math.sin(phase / 5) * 4 + (day % 17 === 0 ? 8 : 0));
      const status = isRest
        ? 'rest'
        : fatigue >= 6.8 || sleep < 5.8
          ? 'alert'
          : fatigue >= 5.1 || sleep < 6.7
            ? 'attention'
            : 'normal';
      const trainingType = isRest ? '休息' : isStrength ? '力量训练' : isRecovery ? '恢复训练' : '专项训练';
      const structureType = isRest ? '再生恢复' : isStrength ? '最大力量' : isRecovery ? '功能训练' : '专项训练';
      const content = isRest
        ? '主动恢复与拉伸'
        : isStrength
          ? '深蹲、卧拉与核心稳定'
          : isRecovery
            ? '低强度有氧与动作恢复'
            : athletes[athleteId - 1][1] === '赛艇'
              ? '水上专项技术与有氧耐力'
              : athletes[athleteId - 1][1] === '激流'
                ? '激流回旋门区技术与冲刺训练'
                : '静水专项划行与节奏训练';
      const smvl = isStrength ? Math.round(6500 + athleteId * 420 + (day % 3) * 780) : 0;
      const creator = athleteId <= 4 ? 2 : 3;

      insertSession.run(athleteId, iso, trainingType, structureType, isRest ? '-' : zones[(day + athleteId) % zones.length], content,
        duration, distance, rpe, rpe ? Math.round(duration * rpe) : 0, smvl, creator);
      insertWellness.run(athleteId, iso, sleep, pulse, Number((bodies[athleteId - 1] + Math.sin(phase / 8) * 0.6).toFixed(1)), fatigue, status);
    }
  }
}

runInitializationOnce('core_seed_v1', seed);

const coachProfilesDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'coach_profiles'").get() as { sql?: string } | undefined;
if (coachProfilesDefinition?.sql && !coachProfilesDefinition.sql.includes("'体能教练'")) {
  db.exec(`
    BEGIN;
    CREATE TABLE coach_profiles_v2 (
      user_id INTEGER PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '体能教练'
        CHECK(category IN ('体能教练', '专项教练')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO coach_profiles_v2 (user_id, category, updated_at)
    SELECT user_id,
      CASE WHEN category = '体能师' THEN '体能教练' ELSE '专项教练' END,
      updated_at
    FROM coach_profiles;
    DROP TABLE coach_profiles;
    ALTER TABLE coach_profiles_v2 RENAME TO coach_profiles;
    COMMIT;
  `);
}

db.exec(`
  INSERT OR IGNORE INTO coach_profiles (user_id, category)
  SELECT id, '体能教练' FROM users WHERE role = 'SCC';
`);

db.exec(`
  INSERT OR IGNORE INTO athlete_profiles (athlete_id, created_at)
  SELECT id, '2026-01-01 00:00:00' FROM athletes;
`);

db.exec(`
  INSERT OR IGNORE INTO project_teams (project, name)
  SELECT DISTINCT project, team FROM athletes WHERE TRIM(team) <> '';
`);

function seedRegionalExample() {
  const demoRegions: Record<string, [string, string, string]> = {
    林舟: ['四川', '成都', '武侯区'],
    沈澜: ['四川', '成都', '武侯区'],
    陈屿: ['浙江', '杭州', '西湖区'],
    周竞: ['浙江', '杭州', '西湖区'],
    许沐: ['广东', '广州', '天河区'],
    顾川: ['广东', '广州', '天河区']
  };
  const updateRegion = db.prepare(`
    UPDATE athletes SET
      region = CASE WHEN region = '未设置' OR region = '' THEN ? ELSE region END,
      city = CASE WHEN city = '未设置' OR city = '' THEN ? ELSE city END,
      county = CASE WHEN county = '未设置' OR county = '' THEN ? ELSE county END
    WHERE name = ?
  `);
  for (const [name, [province, city, county]] of Object.entries(demoRegions)) {
    updateRegion.run(province, city, county, name);
  }

  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin01'").get() as { id: number } | undefined;
  if (!admin) return;
  let regional = db.prepare("SELECT id FROM users WHERE username = 'regional01'").get() as { id: number } | undefined;
  if (!regional) {
    const passwordHash = bcrypt.hashSync('demo123', 10);
    const result = db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, athlete_id) VALUES ('regional01', ?, '四川区域负责人', 'REG', NULL)"
    ).run(passwordHash);
    regional = { id: Number(result.lastInsertRowid) };
  }
  db.prepare('INSERT OR IGNORE INTO regional_manager_regions (manager_user_id, region, granted_by) VALUES (?, ?, ?)')
    .run(regional.id, '四川', admin.id);
}

runInitializationOnce('regional_seed_v1', seedRegionalExample);

function seedAthleteOrigins() {
  const registrationOrigins = db.prepare(`
    SELECT a.id AS athleteId, rr.native_place AS nativePlace
    FROM athletes a
    JOIN users u ON u.athlete_id = a.id AND u.role = 'ATL'
    JOIN registration_requests rr ON rr.username = u.username AND rr.status = 'approved'
    WHERE rr.native_place IS NOT NULL AND rr.native_place <> ''
  `).all() as Array<{ athleteId: number; nativePlace: string }>;
  const insertIfMissing = db.prepare(`
    INSERT OR IGNORE INTO athlete_origins
      (athlete_id, province, city, county, source, quality, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of registrationOrigins) {
    const [province = '', city = '', county = ''] = row.nativePlace.split('/');
    if (PROVINCES.includes(province as typeof PROVINCES[number]) && city) {
      insertIfMissing.run(row.athleteId, province, city, county, 'registration', 'valid', 0);
    }
  }
  const legacyRows = db.prepare(`
    SELECT id AS athleteId, region AS province, city, county
    FROM athletes
    WHERE active = 1 AND region <> '' AND region <> '未设置'
  `).all() as Array<{ athleteId: number; province: string; city: string; county: string }>;
  for (const row of legacyRows) {
    insertIfMissing.run(row.athleteId, row.province, row.city, row.county, 'legacy_migration', 'estimated', 0);
  }
}

runInitializationOnce('athlete_origins_seed_v1', seedAthleteOrigins);

function areaCode(province: string) {
  const codes: Record<string, string> = { 四川: '510000', 浙江: '330000', 广东: '440000' };
  return codes[province] || '000000';
}

function projectCode(project: string) {
  return project in PROJECT_META ? PROJECT_META[project as keyof typeof PROJECT_META].code : 'ALL';
}

function seedAccessModel() {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin01'").get() as { id: number } | undefined;
  const director = db.prepare("SELECT id FROM users WHERE username = 'executive01'").get() as { id: number } | undefined;
  if (!admin || !director) return;
  db.prepare("UPDATE users SET display_name = '全国数据监控总监' WHERE username = 'admin01' AND display_name IN ('超级管理员', '高层管理者')")
    .run();
  db.prepare("UPDATE users SET display_name = '全国训练总监' WHERE username = 'executive01' AND display_name IN ('高层管理者', '训练总监')")
    .run();
  db.prepare("UPDATE users SET display_name = '四川区域负责人' WHERE username = 'regional01' AND display_name IN ('四川区域管理人', '四川区域负责人')")
    .run();

  let projectLead = db.prepare("SELECT id FROM users WHERE username = 'project01'").get() as { id: number } | undefined;
  if (!projectLead) {
    const passwordHash = bcrypt.hashSync('demo123', 10);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, athlete_id)
      VALUES ('project01', ?, '四川赛艇项目负责人', 'PRJ', NULL)
    `).run(passwordHash);
    projectLead = { id: Number(result.lastInsertRowid) };
  }

  const users = db.prepare(`
    SELECT id, username, role, athlete_id AS athleteId
    FROM users ORDER BY id
  `).all() as Array<{ id: number; username: string; role: 'ATL' | 'SCC' | 'PRJ' | 'REG' | 'TD' | 'DMD'; athleteId: number | null }>;
  const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO account_profiles (user_id, parent_user_id, account_code)
    VALUES (?, ?, ?)
  `);
  const insertArea = db.prepare(`
    INSERT OR IGNORE INTO user_area_permissions
      (user_id, area_level, province, city, county, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertProject = db.prepare(`
    INSERT OR IGNORE INTO user_project_permissions (user_id, project, granted_by)
    VALUES (?, ?, ?)
  `);
  const insertTeam = db.prepare(`
    INSERT OR IGNORE INTO user_team_permissions (user_id, project, team, granted_by)
    VALUES (?, ?, ?, ?)
  `);

  for (const user of users) {
    const athlete = user.athleteId
      ? db.prepare('SELECT region, city, county, project, team FROM athletes WHERE id = ?').get(user.athleteId) as {
        region: string; city: string; county: string; project: string; team: string;
      } | undefined
      : undefined;
    const assigned = user.role === 'SCC'
      ? db.prepare(`
        SELECT DISTINCT a.region, a.city, a.county, a.project, a.team
        FROM coach_athletes ca JOIN athletes a ON a.id = ca.athlete_id
        WHERE ca.coach_user_id = ?
      `).all(user.id) as Array<{ region: string; city: string; county: string; project: string; team: string }>
      : [];

    let parentId: number | null = admin.id;
    if (user.role === 'DMD') parentId = null;
    else if (user.role === 'TD') parentId = admin.id;
    else if (user.role === 'PRJ' || user.role === 'REG') parentId = director.id;
    else if (user.role === 'SCC') parentId = director.id;
    else if (user.role === 'ATL') {
      const coach = db.prepare('SELECT coach_user_id AS id FROM coach_athletes WHERE athlete_id = ? ORDER BY coach_user_id LIMIT 1')
        .get(user.athleteId) as { id: number } | undefined;
      parentId = coach?.id || admin.id;
    }

    let primaryProvince = athlete?.region || assigned[0]?.region || '';
    let primaryProject = athlete?.project || assigned[0]?.project || '*';
    if (user.role === 'DMD' || user.role === 'TD') {
      primaryProvince = '';
      primaryProject = '*';
    }
    if (user.role === 'REG') primaryProvince = '四川';
    if (user.role === 'PRJ') {
      primaryProvince = '四川';
      primaryProject = '赛艇';
    }
    const code = `${areaCode(primaryProvince)}-${projectCode(primaryProject)}-${user.role}-${String(user.id).padStart(4, '0')}`;
    insertProfile.run(user.id, parentId, code);

    if (user.role === 'DMD' || user.role === 'TD') {
      insertArea.run(user.id, 'national', '', '', '', admin.id);
      insertProject.run(user.id, '*', admin.id);
      insertTeam.run(user.id, '*', '*', admin.id);
    } else if (user.role === 'REG') {
      const legacyAreas = db.prepare('SELECT region FROM regional_manager_regions WHERE manager_user_id = ?')
        .all(user.id) as { region: string }[];
      const areas = legacyAreas.length ? legacyAreas.map((item) => item.region) : ['四川'];
      for (const province of areas) insertArea.run(user.id, 'province', province, '', '', admin.id);
      insertProject.run(user.id, '*', admin.id);
      insertTeam.run(user.id, '*', '*', admin.id);
    } else if (user.role === 'PRJ') {
      insertArea.run(user.id, 'province', primaryProvince, '', '', admin.id);
      insertProject.run(user.id, primaryProject, admin.id);
      insertTeam.run(user.id, primaryProject, '*', admin.id);
    } else if (user.role === 'SCC') {
      const rows = assigned.length ? assigned : [{ region: '未设置', city: '', county: '', project: '未设置', team: '未设置' }];
      for (const row of rows) {
        insertArea.run(user.id, 'province', row.region, '', '', admin.id);
        insertProject.run(user.id, row.project, admin.id);
        insertTeam.run(user.id, row.project, row.team, admin.id);
      }
    } else if (athlete) {
      insertArea.run(user.id, 'county', athlete.region, athlete.city, athlete.county, admin.id);
      insertProject.run(user.id, athlete.project, admin.id);
      insertTeam.run(user.id, athlete.project, athlete.team, admin.id);
    }
  }

}

runInitializationOnce('access_model_seed_v1', seedAccessModel);

function seedProfessionalOverviewData() {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin01'").get() as { id: number } | undefined;
  const athletes = db.prepare('SELECT id, project, gender FROM athletes WHERE active = 1 ORDER BY id')
    .all() as Array<{ id: number; project: string; gender: string }>;
  if (!admin || !athletes.length) return;
  db.prepare("DELETE FROM test_sessions WHERE source IN ('demo_seed', 'initial_seed')").run();
  db.prepare("DELETE FROM training_sessions WHERE source IN ('demo_seed', 'initial_seed')").run();
  db.prepare("DELETE FROM daily_wellness WHERE source IN ('demo_seed', 'initial_seed')").run();

  const upsertMetric = db.prepare(`
    INSERT INTO metric_definitions
      (code, label, domain, unit, direction, frequency, projects_json, minimum, maximum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      label = excluded.label, domain = excluded.domain, unit = excluded.unit,
      direction = excluded.direction, frequency = excluded.frequency,
      projects_json = excluded.projects_json, minimum = excluded.minimum,
      maximum = excluded.maximum, active = 1, updated_at = CURRENT_TIMESTAMP
  `);
  for (const metric of OVERVIEW_METRICS) {
    upsertMetric.run(metric.code, metric.label, metric.domain, metric.unit, metric.direction, metric.frequency,
      JSON.stringify(metric.projects), metric.minimum, metric.maximum);
  }

  const insertWellness = db.prepare(`
    INSERT OR IGNORE INTO daily_wellness
      (athlete_id, wellness_date, sleep_hours, sleep_quality, morning_pulse, weight_kg,
       fatigue_index, soreness_index, mood_index, status, source, quality, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initial_seed', 'valid', 0)
  `);
  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO training_sessions
      (athlete_id, session_date, session_order, start_time, training_type, structure_type,
       intensity_zone, content, duration_min, distance_km, rpe, srpe, smvl,
       average_heart_rate, max_heart_rate, average_power_w, stroke_rate_spm,
       source, quality, is_demo, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initial_seed', 'valid', 0, ?)
  `);
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const isoDaysAgo = (days: number) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const bodies = [58.5, 61.1, 78.4, 81.2, 63.6, 76.9, 59.4, 77.2];
  const zones = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'];

  for (const [athleteIndex, athlete] of athletes.entries()) {
    for (let daysAgo = 55; daysAgo >= 0; daysAgo -= 1) {
      const date = isoDaysAgo(daysAgo);
      const dateObject = new Date(`${date}T12:00:00Z`);
      const weekDay = dateObject.getUTCDay();
      const sequence = 55 - daysAgo;
      const wave = Math.sin((sequence + athleteIndex * 1.8) / 4.2);
      const isRest = weekDay === 0;
      const sleep = Number((7.55 + wave * .55 - (sequence % 19 === 0 ? .75 : 0)).toFixed(1));
      const fatigue = Number((3.25 - wave * .75 + (sequence % 17 === 0 ? 1.7 : 0)).toFixed(1));
      const pulse = Math.round(48 + athleteIndex * 1.2 - wave * 2.8 + (sequence % 17 === 0 ? 5 : 0));
      const status = isRest ? 'rest' : fatigue >= 5.8 || sleep < 6.3 ? 'attention' : 'normal';
      insertWellness.run(athlete.id, date, sleep, Number((sleep / 8 * 10).toFixed(1)), pulse,
        Number(((bodies[athleteIndex] || 68) + Math.sin(sequence / 9) * .45).toFixed(1)), fatigue,
        Number((2.6 + Math.cos(sequence / 5) * .7).toFixed(1)), Number((7.3 + wave * .8).toFixed(1)), status);

      if (isRest) {
        insertSession.run(athlete.id, date, 1, '09:00', '休息', '再生恢复', '-', '主动恢复、拉伸与泡沫轴',
          0, 0, null, 0, 0, pulse, pulse + 8, null, null, admin.id);
        continue;
      }
      const zone = zones[(sequence + athleteIndex) % zones.length];
      const duration = Math.round(78 + (sequence % 4) * 9 + athleteIndex * 2);
      const rpe = Number((5.2 + (sequence % 4) * .55 + athleteIndex * .06).toFixed(1));
      const distance = Number((athlete.project === '激流' ? 6.4 : athlete.project === '皮划艇' ? 15.5 : 17.8) * (duration / 90) * (1 + wave * .035));
      const projectContent = athlete.project === '赛艇'
        ? '水上节奏、分段配速与单桨效率训练'
        : athlete.project === '皮划艇'
          ? '静水专项划行、启动加速与途中桨频训练'
          : '激流门区线路、转向控制与短距离冲刺训练';
      insertSession.run(athlete.id, date, 1, '08:00', '专项训练', '专项训练', zone, projectContent,
        duration, Number(distance.toFixed(1)), rpe, Math.round(duration * rpe), 0,
        Math.round(132 + rpe * 5), Math.round(166 + rpe * 2), Math.round(205 + athleteIndex * 12 + rpe * 15),
        Number((athlete.project === '赛艇' ? 28 + rpe * .9 : 72 + rpe * 2.2).toFixed(1)), admin.id);

      if (weekDay === 2 || weekDay === 5) {
        const strengthDuration = 55 + (sequence % 3) * 5;
        const strengthRpe = Number((6.3 + (sequence % 3) * .45).toFixed(1));
        insertSession.run(athlete.id, date, 2, '15:30', '力量训练', '最大力量', 'AN',
          '深蹲、卧拉、核心稳定与专项力量耐力', strengthDuration, 0, strengthRpe,
          Math.round(strengthDuration * strengthRpe), Math.round(6100 + athleteIndex * 360 + sequence % 4 * 520),
          Math.round(124 + strengthRpe * 4), Math.round(158 + strengthRpe * 2), null, null, admin.id);
      }
    }
  }

  const insertTestSession = db.prepare(`
    INSERT OR IGNORE INTO test_sessions
      (athlete_id, test_date, test_type, protocol, source, quality, is_demo, created_by)
    VALUES (?, ?, '专业综合评估', '统一热身后完成身体形态、力量、爆发、动作效率和专项训练',
      'initial_seed', 'valid', 0, ?)
  `);
  const insertMeasurement = db.prepare(`
    INSERT OR IGNORE INTO test_measurements
      (test_session_id, metric_code, value_num, target_value, unit, side, quality, source, is_demo)
    VALUES (?, ?, ?, ?, ?, 'center', 'valid', 'initial_seed', 0)
  `);
  const round = (value: number, digits = 1) => Number(value.toFixed(digits));
  const measurementValues = (athlete: { project: string; gender: string }, index: number, improved: boolean) => {
    const female = athlete.gender === '女';
    const gain = improved ? 1.035 : 1;
    const timeGain = improved ? .975 : 1;
    const body = bodies[index] || (female ? 62 : 78);
    const values: Record<string, number> = {
      heightCm: female ? 174 + index % 4 : 184 + index % 4,
      weightKg: body + (improved ? .2 : 0), armSpanCm: female ? 177 + index % 5 : 189 + index % 5,
      sitReachCm: round((21 + index % 5) * gain), verticalJumpCm: round((female ? 42 : 49) * gain),
      pullUpsReps: Math.round((female ? 13 : 19) * gain), benchPressKg: round((female ? 58 : 88) * gain),
      benchPullKg: round((female ? 68 : 98) * gain), frontPlankSec: Math.round((185 + index * 4) * gain),
      leftPlankSec: Math.round((158 + index * 3) * gain), rightPlankSec: Math.round((164 + index * 3) * gain),
      squatKg: round((female ? 112 : 155) * gain), deadliftKg: round((female ? 128 : 182) * gain),
      highPullKg: round((female ? 58 : 82) * gain), leftSingleLegSquatReps: Math.round((21 + index % 4) * gain),
      rightSingleLegSquatReps: Math.round((22 + index % 4) * gain),
      body_fat_pct: round((female ? 17.2 : 11.8) * timeGain), skeletal_muscle_kg: round((female ? 26.8 : 36.5) * gain),
      cmj_peak_power_w: Math.round((female ? 3280 : 4380) * gain), imtp_peak_force_n: Math.round((female ? 2450 : 3450) * gain),
      dsd_ratio: round(.72 * timeGain, 2), lactate_threshold_mmol: round(4.1 + index * .04),
      vo2max_ml_kg_min: round((female ? 57 : 63) * gain, 1),
      general_endurance_score: round((female ? 86 : 88) * gain, 1),
      anaerobic_power_wkg: round((female ? 8.8 : 10.1) * gain, 1),
      asymmetry_index_pct: round((8.5 - index % 3) * timeGain, 1),
      core_strength_score: round((86 + index % 4) * gain, 1),
      fms_deep_squat: improved ? 3 : 2,
      fms_hurdle_step: 2,
      fms_inline_lunge: improved ? 3 : 2,
      fms_shoulder_mobility: 2,
      fms_active_straight_leg_raise: improved ? 3 : 2,
      fms_trunk_stability_pushup: female ? 2 : (improved ? 3 : 2),
      fms_rotary_stability: 2
    };
    if (athlete.project === '赛艇') Object.assign(values, {
      seven_stroke_power_w: Math.round((female ? 610 : 790) * gain), erg_2k_sec: round((female ? 432 : 385) * timeGain),
      erg_6k_sec: round((female ? 1370 : 1225) * timeGain), boat_speed_mps: round((female ? 5.15 : 5.65) * gain, 2),
      stroke_rate_spm: round(31 + index % 3), distance_per_stroke_m: round((female ? 8.3 : 8.8) * gain, 2)
    });
    if (athlete.project === '皮划艇') Object.assign(values, {
      sprint_200_sec: round((female ? 45.5 : 40.2) * timeGain), sprint_500_sec: round((female ? 126 : 112) * timeGain),
      boat_speed_mps: round((female ? 4.85 : 5.35) * gain, 2), stroke_rate_spm: round(82 + index % 5),
      distance_per_stroke_m: round(2.85 * gain, 2), left_paddle_power_w: Math.round((female ? 335 : 415) * gain),
      right_paddle_power_w: Math.round((female ? 342 : 423) * gain)
    });
    if (athlete.project === '激流') Object.assign(values, {
      benchPressPeakPowerW: Math.round((female ? 430 : 610) * gain), benchPressRelativePowerWkg: round((female ? 7.2 : 8.1) * gain),
      benchPullPeakPowerW: Math.round((female ? 470 : 650) * gain), benchPullRelativePowerWkg: round((female ? 7.8 : 8.5) * gain),
      wingatePeakPowerWkg: round((female ? 12.2 : 14.5) * gain), wingateWorkJkg: round((female ? 285 : 330) * gain),
      wingateLactateMmol: round(13.5 * gain), benchPress2MinReps: Math.round((female ? 62 : 72) * gain),
      benchPull2MinReps: Math.round((female ? 70 : 82) * gain), thresholdErgPowerW: Math.round((female ? 154 : 195) * gain),
      anaerobicThresholdHr: Math.round(163 + index % 4), sprint300Sec: round((female ? 116 : 103) * timeGain),
      leftGripKgf: round((female ? 39.2 : 49.5) * gain), rightGripKgf: round((female ? 40.1 : 50.2) * gain),
      gate_technique_score: round(86 * gain)
    });
    return values;
  };

  for (const [index, athlete] of athletes.entries()) {
    for (const [daysAgo, improved] of [[42, false], [14, true]] as const) {
      const testDate = isoDaysAgo(daysAgo);
      insertTestSession.run(athlete.id, testDate, admin.id);
      const testSession = db.prepare(`
        SELECT id FROM test_sessions WHERE athlete_id = ? AND test_date = ? AND test_type = '专业综合评估'
      `).get(athlete.id, testDate) as { id: number };
      const values = measurementValues(athlete, index, improved);
      for (const [code, value] of Object.entries(values)) {
        const definition = OVERVIEW_METRICS.find((metric) => metric.code === code);
        if (!definition) continue;
        const target = code.startsWith('fms_') ? 2 : definition.direction === 'lower_better' ? value * .95
          : definition.direction === 'higher_better' ? value * 1.05 : value;
        insertMeasurement.run(testSession.id, code, value, round(target, 2), definition.unit);
      }
    }
  }
}

runInitializationOnce('professional_overview_seed_v2', seedProfessionalOverviewData);

// 统一总览的六维雷达依赖力量、爆发、核心、耐力、左右对称和恢复数据。
// 真实导入通常只覆盖其中一部分；这次补数只填补空缺，不改写已有实测值，且完整保留可追溯来源。
function seedMissingOverviewRadarData() {
  const athletes = db.prepare(`
    SELECT id, project, COALESCE(NULLIF(gender, ''), '男') AS gender
    FROM athletes WHERE active = 1 ORDER BY id
  `).all() as Array<{ id: number; project: string; gender: string }>;
  if (!athletes.length) return;

  const upsertMetric = db.prepare(`
    INSERT INTO metric_definitions
      (code, label, domain, unit, direction, frequency, projects_json, minimum, maximum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      label = excluded.label, domain = excluded.domain, unit = excluded.unit,
      direction = excluded.direction, frequency = excluded.frequency,
      projects_json = excluded.projects_json, minimum = excluded.minimum,
      maximum = excluded.maximum, active = 1, updated_at = CURRENT_TIMESTAMP
  `);
  for (const metric of OVERVIEW_METRICS) {
    upsertMetric.run(metric.code, metric.label, metric.domain, metric.unit, metric.direction, metric.frequency,
      JSON.stringify(metric.projects), metric.minimum, metric.maximum);
  }
  const activeMetrics = db.prepare(`
    SELECT code, unit, direction, projects_json AS projectsJson
    FROM metric_definitions WHERE active = 1
  `).all() as Array<{ code: string; unit: string; direction: 'higher_better' | 'lower_better' | 'neutral'; projectsJson: string }>;

  const findLatestRadarSession = db.prepare(`
    SELECT ts.id
    FROM test_sessions ts
    WHERE ts.athlete_id = ?
      AND (ts.test_type = '专业综合评估' OR EXISTS (
        SELECT 1 FROM test_measurements tm
        WHERE tm.test_session_id = ts.id
          AND tm.metric_code IN ('benchPressKg', 'benchPullKg', 'squatKg', 'deadliftKg', 'verticalJumpCm')
      ))
    ORDER BY ts.test_date DESC, ts.id DESC LIMIT 1
  `);
  const insertSession = db.prepare(`
    INSERT INTO test_sessions
      (athlete_id, test_date, test_type, protocol, source, quality, is_demo)
    VALUES (?, ?, '专业综合评估', '统一数据字典缺失指标补全（演示数据）', 'metric_gap_seed', 'estimated', 1)
  `);
  const findMeasurement = db.prepare(`
    SELECT id, target_value AS targetValue, source, quality, is_demo AS isDemo
    FROM test_measurements
    WHERE test_session_id = ? AND metric_code = ? AND side = 'center'
  `);
  const insertMeasurement = db.prepare(`
    INSERT INTO test_measurements
      (test_session_id, metric_code, value_num, target_value, unit, side, quality, source, is_demo)
    VALUES (?, ?, ?, ?, ?, 'center', 'estimated', 'metric_gap_seed', 1)
  `);
  const fillMissingTarget = db.prepare(`
    UPDATE test_measurements
    SET target_value = COALESCE(target_value, ?),
        quality = CASE WHEN target_value IS NULL THEN 'estimated' ELSE quality END,
        source = CASE WHEN target_value IS NULL AND instr(source, 'metric_gap_seed') = 0
          THEN source || '、metric_gap_seed' ELSE source END,
        is_demo = CASE WHEN target_value IS NULL THEN 1 ELSE is_demo END
    WHERE id = ?
  `);
  const insertWellness = db.prepare(`
    INSERT OR IGNORE INTO daily_wellness
      (athlete_id, wellness_date, sleep_hours, sleep_quality, morning_pulse, weight_kg,
       fatigue_index, soreness_index, mood_index, status, source, quality, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'metric_gap_seed', 'estimated', 1)
  `);
  const round = (value: number, digits = 1) => Number(value.toFixed(digits));
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const isoDaysAgo = (days: number) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const valueFor = (athlete: { id: number; project: string; gender: string }, code: string): number | null => {
    const female = athlete.gender === '女';
    const variation = (athlete.id * 17 % 11) - 5;
    const scale = 1 + variation / 100;
    const mass = (female ? 63 : 80) + variation * .35;
    const values: Record<string, number> = {
      heightCm: (female ? 174 : 186) + variation * .35,
      weightKg: mass, bodyFatPct: (female ? 17.5 : 12.2) + variation * .12,
      trainingYears: (female ? 6.5 : 7.5) + Math.abs(variation) * .2,
      armSpanCm: (female ? 177 : 190) + variation * .35,
      sitReachCm: 23 + variation * .4, verticalJumpCm: (female ? 43 : 51) * scale,
      pullUpsReps: (female ? 13 : 20) + variation * .25,
      benchPressKg: (female ? 60 : 92) * scale, benchPullKg: (female ? 72 : 108) * scale,
      frontPlankSec: 200 + variation * 4, leftPlankSec: 166 + variation * 3,
      rightPlankSec: 172 + variation * 3, squatKg: (female ? 118 : 165) * scale,
      deadliftKg: (female ? 138 : 192) * scale, highPullKg: (female ? 62 : 88) * scale,
      leftSingleLegSquatReps: 22 + variation * .2, rightSingleLegSquatReps: 23 + variation * .2,
      body_fat_pct: (female ? 17.5 : 12.2) + variation * .12,
      skeletal_muscle_kg: (female ? 27.5 : 37.5) * scale,
      cmj_peak_power_w: (female ? 3400 : 4550) * scale, imtp_peak_force_n: (female ? 2550 : 3550) * scale,
      dsd_ratio: .72 - variation * .005, vo2max_ml_kg_min: (female ? 56.5 : 62.5) * scale,
      general_endurance_score: 86 * scale, anaerobic_power_wkg: (female ? 8.8 : 10.2) * scale,
      asymmetry_index_pct: 7.5 + Math.abs(variation) * .25, core_strength_score: 87 * scale,
      lactate_threshold_mmol: 4.1 + variation * .02,
      fms_deep_squat: variation >= 1 ? 3 : 2, fms_hurdle_step: 2, fms_inline_lunge: variation >= 3 ? 3 : 2,
      fms_shoulder_mobility: 2, fms_active_straight_leg_raise: variation >= 0 ? 3 : 2,
      fms_trunk_stability_pushup: female ? 2 : (variation >= 2 ? 3 : 2), fms_rotary_stability: 2
    };
    if (athlete.project === '赛艇') Object.assign(values, {
      seven_stroke_power_w: (female ? 620 : 810) * scale, erg_2k_sec: (female ? 430 : 382) / scale,
      erg_6k_sec: (female ? 1360 : 1210) / scale, boat_speed_mps: (female ? 5.12 : 5.68) * scale,
      stroke_rate_spm: 31 + variation * .15, distance_per_stroke_m: (female ? 8.25 : 8.85) * scale
    });
    if (athlete.project === '皮划艇') Object.assign(values, {
      sprint_200_sec: (female ? 45 : 40) / scale, sprint_500_sec: (female ? 125 : 111) / scale,
      boat_speed_mps: (female ? 4.82 : 5.38) * scale, stroke_rate_spm: 82 + variation * .3,
      distance_per_stroke_m: 2.85 * scale, left_paddle_power_w: (female ? 340 : 425) * scale,
      right_paddle_power_w: (female ? 348 : 434) * scale
    });
    if (athlete.project === '激流') Object.assign(values, {
      benchPressPeakPowerW: (female ? 440 : 620) * scale, benchPressRelativePowerWkg: (female ? 7.1 : 8.2) * scale,
      benchPullPeakPowerW: (female ? 480 : 665) * scale, benchPullRelativePowerWkg: (female ? 7.8 : 8.6) * scale,
      wingatePeakPowerWkg: (female ? 12.1 : 14.6) * scale, wingateWorkJkg: (female ? 282 : 332) * scale,
      wingateLactateMmol: 13.4 * scale, benchPress2MinReps: (female ? 61 : 73) * scale,
      benchPull2MinReps: (female ? 69 : 83) * scale, thresholdErgPowerW: (female ? 155 : 198) * scale,
      anaerobicThresholdHr: 164 + variation * .2, sprint300Sec: (female ? 116 : 102) / scale,
      leftGripKgf: (female ? 39 : 50) * scale, rightGripKgf: (female ? 40 : 51.5) * scale,
      gate_technique_score: 86 * scale
    });
    const aliases: Record<string, string> = {
      height_cm: 'heightCm', weight_kg: 'weightKg', arm_span_cm: 'armSpanCm', training_years: 'trainingYears',
      sit_reach_cm: 'sitReachCm', vertical_jump_cm: 'verticalJumpCm', pull_ups_reps: 'pullUpsReps',
      bench_press_kg: 'benchPressKg', bench_pull_kg: 'benchPullKg', squat_kg: 'squatKg', deadlift_kg: 'deadliftKg',
      clean_kg: 'highPullKg', front_plank_sec: 'frontPlankSec', supine_support_sec: 'frontPlankSec',
      side_plank_sec: 'leftPlankSec', single_leg_squat_reps: 'leftSingleLegSquatReps'
    };
    if (code === 'hip_thrust_kg') values[code] = (female ? 175 : 245) * scale;
    if (code === 'movement_squat_score' || code === 'movement_heel_lift_score' || code === 'movement_pushup_score'
      || code === 'movement_shoulder_score' || code === 'movement_trunk_score' || code === 'movement_cervical_score') {
      values[code] = variation >= 1 ? 3 : 2;
    }
    const value = values[aliases[code] || code];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return round(value, code.includes('_sec') || code === 'dsd_ratio' || code === 'boat_speed_mps' || code === 'distance_per_stroke_m' ? 2 : 1);
  };

  for (const athlete of athletes) {
    let session = findLatestRadarSession.get(athlete.id) as { id: number } | undefined;
    if (!session) {
      insertSession.run(athlete.id, isoDaysAgo(1));
      session = findLatestRadarSession.get(athlete.id) as { id: number };
    }
    for (const metric of activeMetrics.filter((item) => item.projectsJson.includes(athlete.project))) {
      const value = valueFor(athlete, metric.code);
      if (value === null) continue;
      const target = round(metric.direction === 'lower_better' ? value * .95 : metric.direction === 'higher_better' ? value * 1.05 : value, 2);
      const existing = findMeasurement.get(session.id, metric.code) as { id: number; targetValue: number | null } | undefined;
      if (existing) fillMissingTarget.run(target, existing.id);
      else insertMeasurement.run(session.id, metric.code, value, target, metric.unit);
    }
    for (let daysAgo = 27; daysAgo >= 0; daysAgo -= 1) {
      const day = 27 - daysAgo;
      const wave = Math.sin((day + athlete.id) / 4);
      const sleep = round(7.7 + wave * .4 - (day % 11 === 0 ? .6 : 0));
      const fatigue = round(3.2 - wave * .6 + (day % 11 === 0 ? 1 : 0));
      insertWellness.run(athlete.id, isoDaysAgo(daysAgo), sleep, round(sleep / 8 * 10), Math.round(51 - wave * 3),
        round((valueFor(athlete, 'weightKg') || 70) + Math.sin(day / 7) * .3), fatigue, round(2.5 + Math.cos(day / 5) * .5),
        round(7.4 + wave * .5), fatigue >= 5.5 ? 'attention' : 'normal');
    }
  }
}

runInitializationOnce('overview_radar_metric_gap_seed_v2', seedMissingOverviewRadarData);

// 训练量统计专用补数：仅面向没有真实完整训练量的运动员，绝不覆盖手工或文件导入的课次。
// 数据保留可识别来源与 estimated/demo 标记，方便后续以真实训练数据替换。
function seedTrainingVolumeDemoData() {
  const athletes = db.prepare('SELECT id, project FROM athletes WHERE active = 1 ORDER BY id')
    .all() as Array<{ id: number; project: string }>;
  const hasRealVolume = db.prepare(`
    SELECT 1 FROM training_sessions
    WHERE athlete_id = ?
      AND duration_reported = 1 AND distance_reported = 1
      AND is_demo = 0
      AND source NOT IN ('initial_seed', 'demo_seed', 'strength_daily_seed', 'training_volume_demo')
    LIMIT 1
  `);
  const nextOrder = db.prepare(`
    SELECT COALESCE(MAX(session_order), 0) + 1 AS value
    FROM training_sessions WHERE athlete_id = ? AND session_date = ?
  `);
  const insert = db.prepare(`
    INSERT INTO training_sessions
      (athlete_id, session_date, session_order, start_time, training_type, structure_type,
       intensity_zone, content, duration_min, distance_km, duration_reported, distance_reported,
       rpe, srpe, smvl, source, quality, is_demo)
    VALUES (?, ?, ?, '08:00', '专项训练', '专项训练', ?, ?, ?, ?, 1, 1, ?, ?, 0,
      'training_volume_demo', 'estimated', 1)
  `);
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const baseDistance: Record<string, number> = { 赛艇: 16.8, 皮划艇: 14.2, 激流: 6.6 };

  for (const [athleteIndex, athlete] of athletes.entries()) {
    if (hasRealVolume.get(athlete.id)) continue;
    for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - daysAgo);
      const sessionDate = date.toISOString().slice(0, 10);
      if (date.getUTCDay() === 0) continue;
      const sequence = 13 - daysAgo + athleteIndex;
      const duration = 72 + (sequence % 4) * 9;
      const distance = Number(((baseDistance[athlete.project] || 12) * duration / 90 * (1 + (sequence % 3 - 1) * 0.035)).toFixed(1));
      const rpe = Number((5.2 + (sequence % 4) * 0.4).toFixed(1));
      const zone = ['UT2', 'UT1', 'AT', 'UT2'][sequence % 4];
      const order = nextOrder.get(athlete.id, sessionDate) as { value: number };
      insert.run(athlete.id, sessionDate, order.value, zone, '训练量统计模拟课次（待真实数据替换）', duration, distance, rpe, Math.round(duration * rpe));
    }
  }
}

runInitializationOnce('training_volume_demo_seed_v1', seedTrainingVolumeDemoData);

function seedPhysiologyMetricDefinitions() {
  const upsertMetric = db.prepare(`
    INSERT INTO metric_definitions (code, label, domain, unit, direction, frequency, projects_json, minimum, maximum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      label = excluded.label, domain = excluded.domain, unit = excluded.unit,
      direction = excluded.direction, frequency = excluded.frequency,
      projects_json = excluded.projects_json, minimum = excluded.minimum,
      maximum = excluded.maximum, active = 1, updated_at = CURRENT_TIMESTAMP
  `);
  for (const metric of OVERVIEW_METRICS.filter((metric) => ['physiology', 'biochemistry'].includes(metric.domain))) {
    upsertMetric.run(metric.code, metric.label, metric.domain, metric.unit, metric.direction, metric.frequency,
      JSON.stringify(metric.projects), metric.minimum, metric.maximum);
  }
}

runInitializationOnce('physiology_metric_definitions_v1', seedPhysiologyMetricDefinitions);

function seedChampionModelSupplementData() {
  const upsertMetric = db.prepare(`
    INSERT INTO metric_definitions
      (code, label, domain, unit, direction, frequency, projects_json, minimum, maximum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      label = excluded.label, domain = excluded.domain, unit = excluded.unit,
      direction = excluded.direction, frequency = excluded.frequency,
      projects_json = excluded.projects_json, minimum = excluded.minimum,
      maximum = excluded.maximum, active = 1, updated_at = CURRENT_TIMESTAMP
  `);
  for (const metric of OVERVIEW_METRICS) {
    upsertMetric.run(metric.code, metric.label, metric.domain, metric.unit, metric.direction, metric.frequency,
      JSON.stringify(metric.projects), metric.minimum, metric.maximum);
  }
  db.prepare(`
    UPDATE metric_definitions
    SET active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE code IN (
      'movement_squat_score',
      'movement_heel_lift_score',
      'movement_pushup_score',
      'movement_shoulder_score',
      'movement_trunk_score',
      'movement_cervical_score'
    )
  `).run();

  const sessions = db.prepare(`
    SELECT ts.id, ts.athlete_id AS athleteId, ts.test_date AS testDate, a.project, a.gender
    FROM test_sessions ts
    JOIN athletes a ON a.id = ts.athlete_id
    WHERE ts.test_type = '专业综合评估'
  `).all() as Array<{ id: number; athleteId: number; testDate: string; project: string; gender: string }>;
  const insertMeasurement = db.prepare(`
    INSERT INTO test_measurements
      (test_session_id, metric_code, value_num, target_value, unit, side, quality, source, is_demo)
    VALUES (?, ?, ?, ?, ?, 'center', 'estimated', 'champion_model_supplement', 0)
    ON CONFLICT(test_session_id, metric_code, side) DO NOTHING
  `);
  const round = (value: number, digits = 1) => Number(value.toFixed(digits));
  for (const [index, session] of sessions.entries()) {
    const female = session.gender === '女';
    const improved = index % 2 === 0;
    const gain = improved ? 1.035 : 1;
    const timeGain = improved ? .975 : 1;
    const values: Record<string, number> = {
      vo2max_ml_kg_min: round((female ? 57 : 63) * gain + index % 3, 1),
      general_endurance_score: round((female ? 86 : 88) * gain + index % 2, 1),
      anaerobic_power_wkg: round((female ? 8.8 : 10.1) * gain + (session.project === '激流' ? 1.2 : 0), 1),
      asymmetry_index_pct: round((8.5 - index % 3) * timeGain, 1),
      core_strength_score: round((86 + index % 4) * gain, 1),
      fms_deep_squat: index % 3 === 0 ? 3 : 2,
      fms_hurdle_step: index % 4 === 0 ? 3 : 2,
      fms_inline_lunge: index % 5 === 0 ? 3 : 2,
      fms_shoulder_mobility: 2,
      fms_active_straight_leg_raise: index % 2 === 0 ? 3 : 2,
      fms_trunk_stability_pushup: female ? 2 : (index % 3 === 1 ? 3 : 2),
      fms_rotary_stability: 2
    };
    for (const [code, value] of Object.entries(values)) {
      const definition = OVERVIEW_METRICS.find((metric) => metric.code === code);
      if (!definition) continue;
      const target = code.startsWith('fms_') ? 2 : definition.direction === 'lower_better' ? value * .9
        : definition.direction === 'higher_better' ? value * 1.06 : value;
      insertMeasurement.run(session.id, code, value, round(target, 2), definition.unit);
    }
  }
  db.prepare("UPDATE test_measurements SET target_value = 2 WHERE metric_code LIKE 'fms_%'").run();
}

// 冠军模型必须由已确认的真实样本配置；不再写入演示补充数据。

function seedChampionModelStandards() {
  const upsert = db.prepare(`
    INSERT INTO champion_model_standards
      (project, gender, metric_code, model_version, target_min, target_max, elite_mean, weight, rationale, source_note, active)
    VALUES (?, ?, ?, 'CHAMPION-2026-R1', ?, ?, ?, ?, ?, '按项目特点生成的冠军模型初始化基线，后续可替换为实测冠军样本', 1)
    ON CONFLICT(project, gender, metric_code, model_version) DO UPDATE SET
      target_min = excluded.target_min, target_max = excluded.target_max,
      elite_mean = excluded.elite_mean, weight = excluded.weight,
      rationale = excluded.rationale, source_note = excluded.source_note,
      active = 1, updated_at = CURRENT_TIMESTAMP
  `);
  const rows: Array<[string, string, string, number | null, number | null, number, number, string]> = [
    ['赛艇', '男', 'heightCm', 188, 198, 193, .7, '身高影响杠杆长度和艇速潜力，作为形态参考不单独决定能力。'],
    ['赛艇', '男', 'armSpanCm', 193, 205, 199, .8, '臂展反映有效划幅和入水长度，是赛艇选材与技术效率的重要形态指标。'],
    ['赛艇', '男', 'body_fat_pct', 8, 13, 10.5, .9, '低脂体重有助于功率重量比，但需避免过低体脂影响恢复与免疫。'],
    ['赛艇', '男', 'skeletal_muscle_kg', 39, 48, 43.5, 1.1, '骨骼肌量支撑大艇速下持续输出和陆上最大力量转化。'],
    ['赛艇', '男', 'benchPullKg', 105, 130, 118, 1.2, '卧拉体现划船专项牵拉链最大力量，是桨端力量的关键陆上指标。'],
    ['赛艇', '男', 'squatKg', 165, 210, 188, 1.1, '下肢最大力量影响起航、途中腿蹬发力和疲劳后技术保持。'],
    ['赛艇', '男', 'erg_2k_sec', 340, 372, 356, 1.5, '2km测功仪成绩综合反映专项有氧功率、乳酸耐受和配速能力。'],
    ['赛艇', '男', 'seven_stroke_power_w', 830, 980, 905, 1.2, '7桨平均功率用于观察起动段神经肌肉动员和艇速建立能力。'],
    ['赛艇', '女', 'heightCm', 178, 188, 183, .7, '身高影响杠杆长度和划幅，女性组以国际高水平公开级形态建模。'],
    ['赛艇', '女', 'armSpanCm', 181, 193, 187, .8, '臂展优势通常带来更好的划幅潜力和技术容错空间。'],
    ['赛艇', '女', 'body_fat_pct', 14, 20, 17, .9, '体脂区间兼顾轻量化、内分泌健康与训练恢复。'],
    ['赛艇', '女', 'skeletal_muscle_kg', 28, 36, 32, 1.1, '骨骼肌量反映可持续功率基础和力量训练适应水平。'],
    ['赛艇', '女', 'benchPullKg', 72, 92, 82, 1.2, '卧拉对应赛艇牵拉链能力，需结合体重和技术效率判断。'],
    ['赛艇', '女', 'squatKg', 115, 150, 132, 1.1, '下肢力量用于支撑蹬伸发力和长距离功率保持。'],
    ['赛艇', '女', 'erg_2k_sec', 395, 430, 412, 1.5, '2km测功仪为女性组专项竞技水平的核心参考指标。'],
    ['赛艇', '女', 'seven_stroke_power_w', 620, 760, 690, 1.2, '短时爆发输出评估起动段和冲刺段可用功率。'],

    ['皮划艇', '男', 'body_fat_pct', 8, 13, 10.5, .9, '皮划艇强调高功率重量比，体脂控制需与上肢输出和恢复同步评估。'],
    ['皮划艇', '男', 'skeletal_muscle_kg', 36, 45, 40.5, 1.1, '骨骼肌量支撑上肢、躯干和髋部连续发力。'],
    ['皮划艇', '男', 'benchPullKg', 100, 125, 112, 1.2, '卧拉反映划桨牵拉链能力，是静水项目陆上力量核心指标。'],
    ['皮划艇', '男', 'benchPressKg', 95, 120, 108, 1.0, '卧推体现推撑稳定和上肢抗疲劳能力，需与卧拉平衡观察。'],
    ['皮划艇', '男', 'sprint_200_sec', 35.5, 39.5, 37.5, 1.4, '200米竞速反映起动、途中加速和短时无氧输出。'],
    ['皮划艇', '男', 'sprint_500_sec', 98, 112, 105, 1.5, '500米成绩综合评价专项速度耐力和配速控制。'],
    ['皮划艇', '男', 'left_paddle_power_w', 430, 520, 475, 1.0, '左右划桨功率用于识别单侧输出短板和艇身稳定风险。'],
    ['皮划艇', '男', 'right_paddle_power_w', 430, 520, 475, 1.0, '左右划桨功率用于识别单侧输出短板和艇身稳定风险。'],
    ['皮划艇', '女', 'body_fat_pct', 14, 20, 17, .9, '女性高水平皮划艇体脂区间需兼顾功率重量比和恢复质量。'],
    ['皮划艇', '女', 'skeletal_muscle_kg', 27, 35, 31, 1.1, '骨骼肌量支撑上肢牵拉、躯干旋转和冲刺维持。'],
    ['皮划艇', '女', 'benchPullKg', 70, 90, 80, 1.2, '卧拉与划桨牵拉链关联度高，适合作为陆上专项力量指标。'],
    ['皮划艇', '女', 'benchPressKg', 62, 82, 72, 1.0, '卧推用于评估推撑稳定和上肢前链能力。'],
    ['皮划艇', '女', 'sprint_200_sec', 40.5, 46.5, 43.5, 1.4, '200米成绩体现启动速度和短时峰值输出。'],
    ['皮划艇', '女', 'sprint_500_sec', 116, 132, 124, 1.5, '500米成绩反映专项速度耐力和节奏保持。'],
    ['皮划艇', '女', 'left_paddle_power_w', 335, 420, 378, 1.0, '单侧划桨功率用于监控输出对称性和技术稳定性。'],
    ['皮划艇', '女', 'right_paddle_power_w', 335, 420, 378, 1.0, '单侧划桨功率用于监控输出对称性和技术稳定性。'],

    ['激流', '男', 'benchPressKg', 110, 130, 120, 1.0, '激流上肢推撑能力影响门区支撑、抗冲击和连续变向。'],
    ['激流', '男', 'benchPullKg', 105, 125, 115, 1.1, '卧拉体现牵拉链最大力量，是回旋加速和纠偏动作基础。'],
    ['激流', '男', 'benchPressPeakPowerW', 419, 641, 530, 1.2, '峰值功率反映高强度短时动作动员能力。'],
    ['激流', '男', 'benchPullPeakPowerW', 501, 667, 584, 1.2, '卧拉峰值功率对应短时间牵拉爆发和过门修正能力。'],
    ['激流', '男', 'wingatePeakPowerWkg', 8.8, 10.2, 9.5, 1.1, 'Wingate相对峰值功率反映无氧爆发能力。'],
    ['激流', '男', 'benchPress2MinReps', 66, 78, 72, .9, '2分钟卧推用于观察上肢局部肌耐力和动作保持。'],
    ['激流', '男', 'thresholdErgPowerW', 170, 190, 180, 1.1, '阈功率体现高强度重复过门下的代谢支撑能力。'],
    ['激流', '男', 'sprint300Sec', 99, 108, 103.5, 1.3, '300米静水竞速用于评估短程专项速度能力。'],
    ['激流', '女', 'benchPressKg', 75, 92, 83.5, 1.0, '女性组卧推参考上肢推撑与抗冲击能力。'],
    ['激流', '女', 'benchPullKg', 72, 88, 80, 1.1, '女性组卧拉参考牵拉链最大力量和连续变向基础。'],
    ['激流', '女', 'benchPressPeakPowerW', 380, 470, 425, 1.2, '卧推峰值功率用于判断短时推撑爆发。'],
    ['激流', '女', 'benchPullPeakPowerW', 410, 510, 460, 1.2, '卧拉峰值功率反映划桨牵拉爆发能力。'],
    ['激流', '女', 'benchPress2MinReps', 57, 69, 63, .9, '2分钟卧推用于观察高频动作下的局部肌耐力。'],
    ['激流', '女', 'thresholdErgPowerW', 140, 160, 150, 1.1, '阈功率体现回旋项目反复高强度输出的代谢底盘。'],
    ['激流', '女', 'sprint300Sec', 110, 122, 116, 1.3, '300米竞速评价短程速度和专项力量耐力。'],
    ['激流', '女', 'rightGripKgf', 35.3, 42.7, 39, .7, '握力用于辅助判断桨柄控制、腕前臂稳定和疲劳风险。']
  ];
  const commonRows: Array<[string, string, string, number | null, number | null, number, number, string]> = [];
  const addEightDimensionRows = (project: string, gender: string, female: boolean) => {
    const enduranceBase = project === '赛艇' ? (female ? [91, 105, 98] : [93, 108, 101]) : project === '皮划艇' ? (female ? [88, 101, 94.5] : [90, 104, 97]) : (female ? [86, 99, 92.5] : [88, 102, 95]);
    const vo2Base = project === '赛艇' ? (female ? [61, 70, 65.5] : [66, 76, 71]) : project === '皮划艇' ? (female ? [58, 67, 62.5] : [63, 72, 67.5]) : (female ? [55, 64, 59.5] : [60, 69, 64.5]);
    const anaerobicBase = project === '激流' ? (female ? [10.2, 13.2, 11.7] : [11.5, 14.8, 13.1]) : project === '皮划艇' ? (female ? [9.5, 12.2, 10.8] : [10.8, 13.8, 12.3]) : (female ? [8.8, 11.3, 10.1] : [10, 12.8, 11.4]);
    const powerBase = project === '赛艇' ? (female ? [3600, 4300, 3950] : [4850, 5800, 5325]) : project === '皮划艇' ? (female ? [3400, 4100, 3750] : [4600, 5450, 5025]) : (female ? [3300, 4000, 3650] : [4400, 5250, 4825]);
    const fmaxBase = project === '赛艇' ? (female ? [2750, 3450, 3100] : [3900, 4800, 4350]) : project === '皮划艇' ? (female ? [2550, 3250, 2900] : [3600, 4500, 4050]) : (female ? [2450, 3150, 2800] : [3450, 4300, 3875]);
    const coreBase = female ? [92, 108, 100] : [94, 110, 102];
    commonRows.push(
      [project, gender, 'vo2max_ml_kg_min', vo2Base[0], vo2Base[1], vo2Base[2], 1.25, 'VO2Max用于评估专项有氧功率上限，是高强度训练承受能力和恢复速度的重要基础。'],
      [project, gender, 'general_endurance_score', enduranceBase[0], enduranceBase[1], enduranceBase[2], 1.15, '一般耐力综合反映持续训练能力、基础有氧储备和大周期负荷承接能力。'],
      [project, gender, 'anaerobic_power_wkg', anaerobicBase[0], anaerobicBase[1], anaerobicBase[2], 1.2, '无氧功率体现起动、冲刺和短时间高功率输出，是比赛关键段能力指标。'],
      [project, gender, 'asymmetry_index_pct', 0, 6, 3, 1.0, '不对称指数越低越好，用于识别左右输出、稳定性和潜在代偿风险。'],
      [project, gender, 'cmj_peak_power_w', powerBase[0], powerBase[1], powerBase[2], 1.1, 'CMJ峰值功率反映下肢快速伸展能力和神经肌肉动员水平，是爆发力维度基础指标。'],
      [project, gender, 'imtp_peak_force_n', fmaxBase[0], fmaxBase[1], fmaxBase[2], 1.2, 'IMTP峰值力量用于评估全身最大等长发力能力，和专项力量储备高度相关。'],
      [project, gender, 'core_strength_score', coreBase[0], coreBase[1], coreBase[2], 1.1, '核心力量综合支撑力的传导、姿态控制和疲劳状态下技术稳定。']
    );
  };
  for (const project of ['赛艇', '皮划艇', '激流']) {
    addEightDimensionRows(project, '男', false);
    addEightDimensionRows(project, '女', true);
  }
  rows.push(...commonRows);
  for (const row of rows) upsert.run(...row);
}

// 保留表结构供后续项目化冠军模型配置使用，不初始化任何冠军模型基线。

function seedOverviewProfileData() {
  const profiles: Record<string, { birthDate: string; heightCm: number; weightKg: number; bodyFatPct: number; score: number; origin: [string, string, string] }> = {
    林舟: { birthDate: '2002-03-18', heightCm: 174, weightKg: 58.5, bodyFatPct: 17.1, score: 91, origin: ['四川', '成都', '武侯区'] },
    沈澜: { birthDate: '2001-11-04', heightCm: 176, weightKg: 61.1, bodyFatPct: 16.6, score: 87, origin: ['湖南', '长沙', '岳麓区'] },
    陈屿: { birthDate: '1999-06-22', heightCm: 186, weightKg: 78.4, bodyFatPct: 11.7, score: 84, origin: ['浙江', '杭州', '西湖区'] },
    周竞: { birthDate: '2000-09-15', heightCm: 184, weightKg: 81.2, bodyFatPct: 12.1, score: 89, origin: ['山东', '青岛', '市南区'] },
    许沐: { birthDate: '2003-02-11', heightCm: 172, weightKg: 63.6, bodyFatPct: 17.5, score: 86, origin: ['广东', '广州', '天河区'] },
    顾川: { birthDate: '2001-07-29', heightCm: 183, weightKg: 76.9, bodyFatPct: 12.4, score: 90, origin: ['湖北', '武汉', '洪山区'] },
    宋岚: { birthDate: '2002-12-06', heightCm: 168, weightKg: 59.4, bodyFatPct: 18.0, score: 85, origin: ['江苏', '南京', '玄武区'] },
    江跃: { birthDate: '1998-05-30', heightCm: 181, weightKg: 77.2, bodyFatPct: 12.8, score: 88, origin: ['辽宁', '大连', '中山区'] }
  };
  const athletes = db.prepare('SELECT id, name FROM athletes WHERE active = 1 ORDER BY id')
    .all() as Array<{ id: number; name: string }>;
  db.prepare("DELETE FROM athlete_body_measurements WHERE source IN ('demo_seed', 'initial_seed')").run();
  db.prepare("DELETE FROM competitive_state_assessments WHERE source IN ('demo_seed', 'initial_seed')").run();
  const updateBirthDate = db.prepare('UPDATE athletes SET birth_date = COALESCE(birth_date, ?) WHERE id = ?');
  const upsertBody = db.prepare(`
    INSERT INTO athlete_body_measurements
      (athlete_id, measurement_date, height_cm, weight_kg, body_fat_pct, source, quality, is_demo)
    VALUES (?, ?, ?, ?, ?, 'initial_seed', 'valid', 0)
    ON CONFLICT(athlete_id, measurement_date) DO UPDATE SET
      height_cm = excluded.height_cm, weight_kg = excluded.weight_kg,
      body_fat_pct = excluded.body_fat_pct, source = excluded.source,
      quality = excluded.quality, is_demo = excluded.is_demo
  `);
  const upsertState = db.prepare(`
    INSERT INTO competitive_state_assessments
      (athlete_id, assessment_date, overall_score, state_level, endurance_score,
       power_score, technique_score, load_adaptation_score, recovery_score,
       competition_score, note, source, quality, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initial_seed', 'valid', 0)
    ON CONFLICT(athlete_id, assessment_date) DO UPDATE SET
      overall_score = excluded.overall_score, state_level = excluded.state_level,
      endurance_score = excluded.endurance_score, power_score = excluded.power_score,
      technique_score = excluded.technique_score, load_adaptation_score = excluded.load_adaptation_score,
      recovery_score = excluded.recovery_score, competition_score = excluded.competition_score,
      note = excluded.note, source = excluded.source, quality = excluded.quality, is_demo = excluded.is_demo
  `);
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const isoDaysAgo = (days: number) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const level = (score: number) => score >= 90 ? 'peak' : score >= 85 ? 'good' : score >= 78 ? 'build' : 'adjust';

  for (const [index, athlete] of athletes.entries()) {
    const profile = profiles[athlete.name];
    if (!profile) continue;
    updateBirthDate.run(profile.birthDate, athlete.id);
    const existingOrigin = db.prepare('SELECT source, is_demo AS isDemo FROM athlete_origins WHERE athlete_id = ?')
      .get(athlete.id) as { source: string; isDemo: number } | undefined;
    if (!existingOrigin || existingOrigin.isDemo || existingOrigin.source === 'legacy_migration') {
      upsertAthleteOrigin({
        athleteId: athlete.id,
        province: profile.origin[0],
        city: profile.origin[1],
        county: profile.origin[2],
        source: 'initial_seed',
        quality: 'valid',
        isDemo: false
      });
    }
    upsertBody.run(athlete.id, isoDaysAgo(42), profile.heightCm, Number((profile.weightKg - .4).toFixed(1)), Number((profile.bodyFatPct + .4).toFixed(1)));
    upsertBody.run(athlete.id, isoDaysAgo(14), profile.heightCm, profile.weightKg, profile.bodyFatPct);

    for (const [daysAgo, improvement] of [[42, -3], [14, 0]] as const) {
      const score = Math.max(0, Math.min(100, profile.score + improvement));
      const variation = index % 4;
      upsertState.run(
        athlete.id, isoDaysAgo(daysAgo), score, level(score),
        Math.min(100, score + 1 - variation),
        Math.min(100, score - 2 + variation),
        Math.min(100, score + 2),
        Math.min(100, score - 1),
        Math.min(100, score - 3 + variation),
        Math.min(100, score + 1),
        improvement ? '阶段基础评估' : '近期综合竞技状态评估'
      );
    }
  }
}

runInitializationOnce('overview_profile_seed_v2', seedOverviewProfileData);

function seedOverviewExperienceAndCompositionData() {
  const data: Record<string, { startSportDate: string; skeletalMuscleKg: number; muscleMassKg: number }> = {
    林舟: { startSportDate: '2017-09-01', skeletalMuscleKg: 25.8, muscleMassKg: 42.6 },
    沈澜: { startSportDate: '2014-09-01', skeletalMuscleKg: 27.2, muscleMassKg: 44.8 },
    陈屿: { startSportDate: '2011-09-01', skeletalMuscleKg: 36.9, muscleMassKg: 59.7 },
    周竞: { startSportDate: '2016-09-01', skeletalMuscleKg: 38.1, muscleMassKg: 61.4 },
    许沐: { startSportDate: '2022-09-01', skeletalMuscleKg: 26.4, muscleMassKg: 43.5 },
    顾川: { startSportDate: '2013-09-01', skeletalMuscleKg: 35.8, muscleMassKg: 58.3 },
    宋岚: { startSportDate: '2019-09-01', skeletalMuscleKg: 24.7, muscleMassKg: 40.9 },
    江跃: { startSportDate: '2015-09-01', skeletalMuscleKg: 35.2, muscleMassKg: 57.1 }
  };
  const athletes = db.prepare('SELECT id, name FROM athletes WHERE active = 1').all() as Array<{ id: number; name: string }>;
  const profileDate = db.prepare(`INSERT INTO athlete_profiles (athlete_id, start_sport_date)
    VALUES (?, ?) ON CONFLICT(athlete_id) DO UPDATE SET start_sport_date = COALESCE(NULLIF(athlete_profiles.start_sport_date, ''), excluded.start_sport_date), updated_at = CURRENT_TIMESTAMP`);
  const bodyComposition = db.prepare(`UPDATE athlete_body_measurements
    SET skeletal_muscle_kg = COALESCE(skeletal_muscle_kg, ?), muscle_mass_kg = COALESCE(muscle_mass_kg, ?)
    WHERE athlete_id = ? AND measurement_date = (
      SELECT MAX(inner_measurement.measurement_date)
      FROM athlete_body_measurements inner_measurement
      WHERE inner_measurement.athlete_id = ?
    )`);
  for (const athlete of athletes) {
    const row = data[athlete.name];
    if (!row) continue;
    profileDate.run(athlete.id, row.startSportDate);
    bodyComposition.run(row.skeletalMuscleKg, row.muscleMassKg, athlete.id, athlete.id);
  }
}

runInitializationOnce('overview_experience_composition_seed_v2', seedOverviewExperienceAndCompositionData);

function seedOverviewInjuryData() {
  const creator = db.prepare("SELECT id FROM users WHERE role IN ('DMD', 'TD', 'PRJ', 'SCC') ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  const athletes = db.prepare('SELECT id, name FROM athletes WHERE active = 1 ORDER BY id')
    .all() as Array<{ id: number; name: string }>;
  if (!creator || !athletes.length) return;
  const existing = db.prepare("SELECT COUNT(*) AS count FROM injury_records WHERE note LIKE '%训练总览模拟数据%'")
    .get() as { count: number };
  if (existing.count >= Math.min(athletes.length, 6)) return;
  db.prepare("DELETE FROM injury_records WHERE note LIKE '%训练总览模拟数据%'").run();
  const insert = db.prepare(`
    INSERT INTO injury_records
      (athlete_id, record_type, injury_name, body_part, side, status, pain_score,
       onset_date, restrictions, rehab_plan, review_date, note, created_by, created_at)
    VALUES (?, 'formal', ?, ?, ?, ?, ?, ?, ?, ?, ?, '训练总览模拟数据', ?, ?)
  `);
  const templates = [
    { injury: '肩袖疲劳反应', part: '肩部', side: 'right', status: 'observation', pain: 2, restriction: '限制大负荷上肢推举', plan: '肩胛稳定与低强度恢复' },
    { injury: '腰背肌紧张', part: '腰背部', side: 'center', status: 'restricted', pain: 4, restriction: '减少大重量轴向负荷', plan: '核心控制与软组织放松' },
    { injury: '膝前区应力反应', part: '膝部', side: 'left', status: 'rehab', pain: 3, restriction: '暂停深屈膝跳跃', plan: '股四头肌等长与渐进负荷' },
    { injury: '腕部轻度不适', part: '腕部', side: 'right', status: 'observation', pain: 1, restriction: '调整握桨与腕部角度', plan: '活动度练习与训练后冰敷' },
    { injury: '踝关节扭伤恢复期', part: '踝部', side: 'left', status: 'rehab', pain: 2, restriction: '限制变向和落地冲击', plan: '本体感觉与单脚稳定训练' },
    { injury: '无活动性损伤', part: '全身', side: 'unspecified', status: 'healthy', pain: 0, restriction: '无', plan: '常规预防性训练' }
  ] as const;
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  for (const [index, athlete] of athletes.entries()) {
    const template = templates[index % templates.length];
    const onset = new Date(today); onset.setUTCDate(onset.getUTCDate() - 4 - index * 3);
    const review = new Date(today); review.setUTCDate(review.getUTCDate() + 3 + index);
    const created = new Date(today); created.setUTCMinutes(created.getUTCMinutes() + index);
    insert.run(athlete.id, template.injury, template.part, template.side, template.status, template.pain,
      onset.toISOString().slice(0, 10), template.restriction, template.plan, review.toISOString().slice(0, 10),
      creator.id, created.toISOString());
  }
}

runInitializationOnce('overview_injury_seed_v1', seedOverviewInjuryData);

function seedTrainingPlanExample() {
  const athlete = db.prepare("SELECT id FROM athletes WHERE name = '林舟'").get() as { id: number } | undefined;
  const coach = db.prepare("SELECT id FROM users WHERE username = 'coach01'").get() as { id: number } | undefined;
  if (!athlete || !coach) return;
  const week = (sets: string, reps: string, percentage: number, actualCompleted = '') => ({
    sets, reps, percentage, actualCompleted
  });
  const makeLine = (
    id: string,
    values: Array<[string, string, number, string?]>
  ) => ({
    id,
    weeks: {
      '1': week(...values[0]),
      '2': week(...values[1]),
      '3': week(...values[2]),
      '4': week(...values[3])
    }
  });
  const plan = {
    startDate: '2026-07-28',
    endDate: '2026-08-27',
      title: '皮划艇夏训体能训练',
    scheduleLabel: '周二 / 周五',
    bodyWeight: 58.5,
    age: 24,
    exercises: [
      {
        id: 'bench-pull', name: '卧拉', maxWeight: 65, unitNote: '30',
        lines: [
          makeLine('bp-1', [['1', '10', 70], ['1', '10', 70], ['1', '10', 72], ['1', '10', 72]]),
          makeLine('bp-2', [['2', '8', 75], ['2', '8', 75], ['2', '8', 78], ['2', '8', 78]]),
          makeLine('bp-3', [['2', '6', 80], ['2', '6', 80], ['2', '6', 82], ['2', '6', 82]]),
          makeLine('bp-4', [['2', '4', 85], ['2', '4', 85], ['2', '4', 88], ['2', '4', 88]]),
          makeLine('bp-5', [['2', '3', 90], ['2', '3', 90], ['2', '3', 92], ['2', '3', 92]])
        ]
      },
      {
        id: 'bench-press', name: '卧推', maxWeight: 55, unitNote: '30',
        lines: [
          makeLine('bpr-1', [['1', '10', 70], ['1', '10', 70], ['1', '10', 72], ['1', '10', 72]]),
          makeLine('bpr-2', [['2', '8', 75], ['2', '8', 75], ['2', '8', 78], ['2', '8', 78]]),
          makeLine('bpr-3', [['2', '6', 80], ['2', '6', 80], ['2', '6', 82], ['2', '6', 82]]),
          makeLine('bpr-4', [['2', '4', 85], ['2', '4', 85], ['2', '4', 88], ['2', '4', 88]])
        ]
      },
      {
        id: 'high-pull', name: '高拉\n低杠俯卧撑', maxWeight: 55, unitNote: '20',
        lines: [
          makeLine('hp-1', [['4', '8', 40], ['4', '8', 45], ['6', '8', 55], ['6', '8', 55]]),
          makeLine('hp-2', [['4', '12—15', 40], ['4', '8', 45], ['4', '10', 50], ['4', '12', 50]])
        ]
      },
      {
        id: 'seated-press', name: '坐姿上举\n俯身划船', maxWeight: 40, unitNote: '20',
        lines: [
          makeLine('sp-1', [['4', '6—8', 70], ['4', '8', 70], ['4', '8', 75], ['4', '8', 75]]),
          makeLine('sp-2', [['4', '6—8', 80], ['4', '8', 80], ['4', '6', 82], ['4', '8', 82]])
        ]
      },
      {
        id: 'calf', name: '提踵\n山羊挺身', maxWeight: 35, unitNote: '20',
        lines: [
          makeLine('calf-1', [['4', '12—15', 70], ['4', '20', 70], ['4', '30', 75], ['4', '30', 75]]),
          makeLine('calf-2', [['4', '12—15', 70], ['4', '15', 70], ['4', '20', 75], ['4', '20', 75]])
        ]
      }
    ]
  };
  db.prepare(`
    INSERT OR IGNORE INTO training_plans
      (athlete_id, plan_date, start_date, end_date, title, schedule_label, plan_data, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(athlete.id, plan.startDate, plan.startDate, plan.endDate, plan.title, plan.scheduleLabel, JSON.stringify(plan), coach.id, coach.id);
}

runInitializationOnce('training_plan_seed_v1', seedTrainingPlanExample);

function seedStrengthDailyVolumeExample() {
  const seedTag = '21周每日训练量模拟数据';
  const existing = db.prepare(`
    SELECT COUNT(*) AS count,
      SUM(CASE WHEN training_environment = '水上' THEN 1 ELSE 0 END) AS waterCount
    FROM strength_result_sets
    WHERE note = ?
  `).get(seedTag) as { count: number; waterCount: number | null };
  if (existing.count >= 300 && Number(existing.waterCount || 0) >= 90) return;

  const athlete = db.prepare(`
    SELECT id, name, team, project
    FROM athletes
    WHERE name = '林舟' OR active = 1
    ORDER BY CASE WHEN name = '林舟' THEN 0 ELSE 1 END, id
    LIMIT 1
  `)
    .get() as { id: number; name: string; team: string; project: string } | undefined;
  const creator = db.prepare(`
    SELECT id FROM users
    WHERE role IN ('DMD', 'SCC', 'PRJ', 'TD')
    ORDER BY CASE role WHEN 'DMD' THEN 0 ELSE 1 END, id
    LIMIT 1
  `).get() as { id: number } | undefined;
  if (!athlete) return;

  db.prepare(`
    DELETE FROM strength_result_sets
    WHERE note = ?
  `).run(seedTag);
  db.prepare(`
    DELETE FROM training_sessions
    WHERE athlete_id = ? AND source = 'strength_daily_seed'
  `).run(athlete.id);

  const msPerDay = 24 * 60 * 60 * 1000;
  const end = Date.UTC(2026, 7, 30);
  const start = end - 20 * 7 * msPerDay;
  const dateAt = (index: number) => new Date(start + index * msPerDay).toISOString().slice(0, 10);
  const round = (value: number, digits = 1) => Number(value.toFixed(digits));
  const wave = (index: number, min: number, max: number, phase = 0) => {
    const normalized = (Math.sin((index + phase) * .43) + Math.sin((index + phase) * .11) * .45 + 1.45) / 2.9;
    return min + normalized * (max - min);
  };
  const templates = [
    { label: '水上专项耐力', exercise: '水上专项划行', category: '专项力量', body: '全身', environment: '水上', zone: 'U1', distance: [10, 22], duration: [62, 110], weight: [0, 0], reps: [1, 1], intensity: [58, 70], rpe: [5.0, 6.5] },
    { label: '测功仪功能训练', exercise: '划船测功仪功能', category: '代谢训练', body: '全身', environment: '测功仪', zone: 'U2', distance: [7, 15], duration: [45, 78], weight: [0, 0], reps: [1, 1], intensity: [62, 76], rpe: [5.4, 6.8] },
    { label: '拉伸再生恢复', exercise: '拉伸再生组合', category: '功能性体能', body: '全身', environment: '陆上', zone: 'U3', distance: [0, 2], duration: [24, 44], weight: [0, 0], reps: [8, 14], intensity: [38, 55], rpe: [3.2, 4.8] },
    { label: '力量耐力循环', exercise: '循环力量耐力', category: '基础力量', body: '全身', environment: '场馆', zone: 'AT', distance: [0, 0], duration: [42, 68], weight: [28, 54], reps: [14, 22], intensity: [60, 74], rpe: [6.2, 7.4] },
    { label: '最大力量深蹲', exercise: '深蹲', category: '基础力量', body: '下肢', environment: '场馆', zone: 'AN', distance: [0, 0], duration: [46, 72], weight: [82, 126], reps: [3, 6], intensity: [82, 94], rpe: [7.4, 8.8] },
    { label: '速度力量爆发', exercise: '高拉速度力量', category: '专项力量', body: '上肢', environment: '场馆', zone: 'ATP', distance: [0, 0], duration: [34, 56], weight: [32, 62], reps: [4, 8], intensity: [74, 88], rpe: [6.8, 8.1] },
    { label: '跑步有氧训练', exercise: '跑步间歇', category: '代谢训练', body: '全身', environment: '陆上', zone: 'U2', distance: [4, 10], duration: [28, 58], weight: [0, 0], reps: [1, 1], intensity: [54, 72], rpe: [4.8, 6.5] },
    { label: '其他综合训练', exercise: '综合协调训练', category: '核心力量', body: '全身', environment: '陆上', zone: 'U3', distance: [0, 3], duration: [25, 50], weight: [0, 18], reps: [8, 16], intensity: [46, 64], rpe: [4.2, 6.0] }
  ] as const;
  const trainingDays: number[] = [];
  for (let cycle = 0; trainingDays.length < 300; cycle += 1) {
    for (let day = 0; day <= 140 && trainingDays.length < 300; day += 1) {
      const dayOfWeek = day % 7;
      if (![1, 3].includes(dayOfWeek)) trainingDays.push(day);
    }
  }
  const lessonPattern = [0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 0];

  const insertSession = db.prepare(`
    INSERT INTO training_sessions
      (athlete_id, session_date, session_order, start_time, training_type, structure_type,
       intensity_zone, content, duration_min, distance_km, rpe, srpe, smvl, source, quality, is_demo, created_by)
    VALUES (?, ?, ?, ?, '力量训练', '体能训练', ?, ?, ?, ?, ?, ?, ?, 'strength_daily_seed', 'estimated', 0, ?)
  `);
  const insertSet = db.prepare(`
    INSERT INTO strength_result_sets
      (training_session_id, exercise_name, set_index, target_reps, actual_reps, actual_weight_kg, planned_weight_kg,
       training_category, body_position, training_environment, duration_min, distance_km, intensity_percent,
       intensity_zone, rpe, completed, note, source, source_row, original_text, ai_confidence, created_by)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'strength_daily_seed', ?, ?, 0.92, ?)
  `);

  for (let index = 0; index < 300; index += 1) {
    const day = trainingDays[index];
    const date = dateAt(day);
    const template = templates[lessonPattern[index % lessonPattern.length]];
    const orderRow = db.prepare(`
      SELECT COALESCE(MAX(session_order), 0) AS maxOrder
      FROM training_sessions
      WHERE athlete_id = ? AND session_date = ?
    `).get(athlete.id, date) as { maxOrder: number };
    const distance = round(wave(index, template.distance[0], template.distance[1], 3), 1);
    const duration = round(wave(index, template.duration[0], template.duration[1], 8), 0);
    const rpe = round(wave(index, template.rpe[0], template.rpe[1], 13), 1);
    const actualReps = round(wave(index, template.reps[0], template.reps[1], 5), 0);
    const actualWeight = round(wave(index, template.weight[0], template.weight[1], 11), 1);
    const intensity = round(wave(index, template.intensity[0], template.intensity[1], 2), 0);
    const volume = round(actualReps * actualWeight, 1);
    const sessionLabel = `${template.label} ${String(index + 1).padStart(3, '0')}`;
    const inserted = insertSession.run(
      athlete.id,
      date,
      Number(orderRow.maxOrder || 0) + 1,
      index % 3 === 0 ? '08:30' : index % 3 === 1 ? '15:30' : '10:00',
      template.zone,
      sessionLabel,
      duration,
      distance,
      rpe,
      round(rpe * duration, 1),
      volume,
      creator?.id ?? null
    );
    insertSet.run(
      Number(inserted.lastInsertRowid),
      template.exercise,
      actualReps,
      actualReps,
      actualWeight,
      actualWeight || null,
      template.category,
      template.body,
      template.environment,
      duration,
      distance,
      intensity,
      template.zone,
      rpe,
      seedTag,
      String(index + 1),
      `${seedTag}：${sessionLabel}`,
      creator?.id ?? null
    );
  }
}

runInitializationOnce('strength_daily_volume_seed_v4', seedStrengthDailyVolumeExample);

type ReconstructionBaseline = {
  athletes: number;
  trainingRecords: number;
  trainingSessions: number;
  strengthTests: number;
  testSessions: number;
  testMeasurements: number;
  wellness: number;
  trainingMinutes: number;
  trainingDistanceKm: number;
};

function reconstructionBaseline(): ReconstructionBaseline {
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  const trainingTotals = db.prepare(`SELECT COALESCE(SUM(duration_min), 0) AS minutes, COALESCE(SUM(distance_km), 0) AS distance FROM training_records`).get() as { minutes: number; distance: number };
  return {
    athletes: count('athletes'), trainingRecords: count('training_records'), trainingSessions: count('training_sessions'),
    strengthTests: count('athlete_strength_tests'), testSessions: count('test_sessions'), testMeasurements: count('test_measurements'),
    wellness: count('daily_wellness'), trainingMinutes: Number(trainingTotals.minutes), trainingDistanceKm: Number(trainingTotals.distance)
  };
}

/**
 * V1 数据库收敛迁移。
 * 旧表始终保留；本函数只向权威模型补写尚不存在的数据，并把无法安全判定的值写入报告。
 */
function runReconstructionV1() {
  const migrationKey = 'reconstruction_v1_completed';
  if (db.prepare('SELECT 1 FROM app_metadata WHERE key = ?').get(migrationKey)) return;
  if (!tableExists('training_records') && !tableExists('athlete_strength_tests')) {
    db.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, 'not_required')`).run(migrationKey);
    return;
  }

  const baseline = reconstructionBaseline();
  const report: Record<string, unknown> = {
    version: 'V1', backupPath: databaseExistedBeforeStartup ? `${databasePath}.before-reconstruction-v1` : null,
    baseline, migratedTrainingSessions: 0, migratedWellness: 0, migratedTestSessions: 0,
    migratedMeasurements: 0, migratedOrigins: 0, unknownMetricKeys: [] as string[], unmatchedTeams: [] as string[], originConflicts: [] as number[]
  };
  const legacyMetricMap: Record<string, { code: string; label: string; unit: string; side?: string }> = {
    heightCm: { code: 'height_cm', label: '身高', unit: 'cm' }, weightKg: { code: 'weight_kg', label: '体重', unit: 'kg' },
    trainingYears: { code: 'training_years', label: '训练年限', unit: '年' }, armSpanCm: { code: 'arm_span_cm', label: '臂展', unit: 'cm' },
    sitReachCm: { code: 'sit_reach_cm', label: '坐位体前屈', unit: 'cm' }, verticalJumpCm: { code: 'vertical_jump_cm', label: '纵跳', unit: 'cm' },
    pullUpsReps: { code: 'pull_ups_reps', label: '引体向上', unit: '次' }, benchPressKg: { code: 'bench_press_kg', label: '卧推', unit: 'kg' },
    benchPullKg: { code: 'bench_pull_kg', label: '卧拉', unit: 'kg' }, frontPlankSec: { code: 'front_plank_sec', label: '俯卧支撑', unit: '秒' },
    leftPlankSec: { code: 'side_plank_sec', label: '侧支撑', unit: '秒', side: 'left' }, rightPlankSec: { code: 'side_plank_sec', label: '侧支撑', unit: '秒', side: 'right' },
    squatKg: { code: 'squat_kg', label: '深蹲', unit: 'kg' }, deadliftKg: { code: 'deadlift_kg', label: '硬拉', unit: 'kg' },
    highPullKg: { code: 'clean_kg', label: '高翻', unit: 'kg' }, leftSingleLegSquatReps: { code: 'single_leg_squat_reps', label: '单腿蹲', unit: '次', side: 'left' },
    rightSingleLegSquatReps: { code: 'single_leg_squat_reps', label: '单腿蹲', unit: '次', side: 'right' }
  };
  const unknownMetricKeys = report.unknownMetricKeys as string[];
  const unmatchedTeams = report.unmatchedTeams as string[];
  const originConflicts = report.originConflicts as number[];
  const textValue = (value: unknown) => value === null || value === undefined ? '' : String(value);
  const nullableNumber = (value: unknown) => value === null || value === undefined || value === '' ? null : Number(value);

  db.exec('BEGIN IMMEDIATE');
  try {
    // 先补齐别名，保证任何历史字段都经过指标字典映射，而不是直接变成新的 metric_code。
    const addDefinition = db.prepare(`INSERT OR IGNORE INTO metric_definitions (code, label, domain, unit, direction, frequency) VALUES (?, ?, 'strength', ?, 'higher_better', 'phase')`);
    const addAlias = db.prepare(`INSERT OR IGNORE INTO metric_aliases (alias, normalized_alias, metric_code, canonical_label, unit, side) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const [legacyKey, metric] of Object.entries(legacyMetricMap)) {
      addDefinition.run(metric.code, metric.label, metric.unit);
      for (const alias of [legacyKey, metric.label]) addAlias.run(alias, alias.toLowerCase().replace(/\s+/g, ''), metric.code, metric.label, metric.unit, metric.side || 'center');
    }

    const legacyTraining = db.prepare(`SELECT * FROM training_records ORDER BY athlete_id, date, id`).all() as Array<Record<string, unknown>>;
    const insertSession = db.prepare(`INSERT INTO training_sessions (athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content, duration_min, distance_km, rpe, srpe, smvl, source, quality, is_demo, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy_migration', 'valid', 0, ?)`);
    const findSession = db.prepare(`SELECT id FROM training_sessions WHERE athlete_id = ? AND session_date = ? AND training_type = ? AND structure_type = ? AND content = ? AND duration_min = ? AND distance_km = ? LIMIT 1`);
    const nextOrder = db.prepare(`SELECT COALESCE(MAX(session_order), 0) AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?`);
    const upsertWellness = db.prepare(`INSERT INTO daily_wellness (athlete_id, wellness_date, sleep_hours, morning_pulse, weight_kg, fatigue_index, status, source, quality, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, 'legacy_migration', 'valid', 0) ON CONFLICT(athlete_id, wellness_date) DO UPDATE SET sleep_hours = COALESCE(daily_wellness.sleep_hours, excluded.sleep_hours), morning_pulse = COALESCE(daily_wellness.morning_pulse, excluded.morning_pulse), weight_kg = COALESCE(daily_wellness.weight_kg, excluded.weight_kg), fatigue_index = COALESCE(daily_wellness.fatigue_index, excluded.fatigue_index), status = CASE WHEN daily_wellness.status = 'normal' THEN excluded.status ELSE daily_wellness.status END`);
    for (const row of legacyTraining) {
      const athleteId = Number(row.athlete_id); const date = String(row.date || '');
      const trainingType = textValue(row.training_type); const structureType = textValue(row.structure_type);
      const content = textValue(row.content); const duration = nullableNumber(row.duration_min) ?? 0; const distance = nullableNumber(row.distance_km) ?? 0;
      const existing = findSession.get(athleteId, date, trainingType, structureType, content, duration, distance) as { id: number } | undefined;
      if (!existing) {
        const order = Number((nextOrder.get(athleteId, date) as { value: number }).value) + 1;
        insertSession.run(athleteId, date, order, trainingType, structureType, textValue(row.intensity_zone), content, duration, distance, nullableNumber(row.rpe), nullableNumber(row.srpe) ?? 0, nullableNumber(row.smvl) ?? 0, nullableNumber(row.created_by));
        report.migratedTrainingSessions = Number(report.migratedTrainingSessions) + 1;
      }
      if ([row.sleep_hours, row.morning_pulse, row.weight_kg, row.fatigue_index].some((value) => value !== null && value !== undefined)) {
        upsertWellness.run(athleteId, date, nullableNumber(row.sleep_hours), nullableNumber(row.morning_pulse), nullableNumber(row.weight_kg), nullableNumber(row.fatigue_index), textValue(row.status) || 'normal');
        report.migratedWellness = Number(report.migratedWellness) + 1;
      }
    }

    const insertTestSession = db.prepare(`INSERT OR IGNORE INTO test_sessions (athlete_id, test_date, test_type, protocol, source, quality, is_demo, created_by) VALUES (?, ?, '力量素质测试', 'legacy-athlete-strength-tests', 'legacy_migration', 'valid', 0, ?)`);
    const findTestSession = db.prepare(`SELECT id FROM test_sessions WHERE athlete_id = ? AND test_date = ? AND test_type = '力量素质测试'`);
    const insertMeasurement = db.prepare(`INSERT OR IGNORE INTO test_measurements (test_session_id, metric_code, value_num, target_value, unit, side, quality, source, is_demo, source_ref) VALUES (?, ?, ?, ?, ?, ?, 'valid', 'legacy_migration', 0, ?)`);
    const legacyTests = db.prepare(`SELECT * FROM athlete_strength_tests ORDER BY athlete_id, test_date, id`).all() as Array<Record<string, unknown>>;
    for (const row of legacyTests) {
      let metrics: Record<string, unknown> = {}; let targets: Record<string, unknown> = {};
      try { metrics = JSON.parse(String(row.metrics_json || '{}')); } catch { unknownMetricKeys.push(`test:${row.id}:metrics_json`); }
      try { targets = JSON.parse(String(row.targets_json || '{}')); } catch { unknownMetricKeys.push(`test:${row.id}:targets_json`); }
      const athleteId = Number(row.athlete_id); const testDate = textValue(row.test_date);
      insertTestSession.run(athleteId, testDate, nullableNumber(row.created_by));
      const testSession = findTestSession.get(athleteId, testDate) as { id: number } | undefined;
      if (!testSession) continue;
      report.migratedTestSessions = Number(report.migratedTestSessions) + 1;
      for (const [key, rawValue] of Object.entries(metrics)) {
        const metric = legacyMetricMap[key]; const value = Number(rawValue);
        if (!metric || !Number.isFinite(value)) { unknownMetricKeys.push(`${row.id}:${key}`); continue; }
        const targetRaw = Number(targets[key]);
        insertMeasurement.run(testSession.id, metric.code, value, Number.isFinite(targetRaw) ? targetRaw : null, metric.unit, metric.side || 'center', `athlete_strength_tests:${row.id}`);
        report.migratedMeasurements = Number(report.migratedMeasurements) + 1;
      }
    }

    const athletes = db.prepare(`SELECT id, project, team, region, city, county FROM athletes`).all() as Array<{ id: number; project: string; team: string; region: string; city: string; county: string }>;
    const teamFor = db.prepare(`SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1`);
    const setTeam = db.prepare(`UPDATE athletes SET team_id = ? WHERE id = ?`);
    const originFor = db.prepare(`SELECT province, city, county FROM athlete_origins WHERE athlete_id = ?`);
    const createOrigin = db.prepare(`INSERT OR IGNORE INTO athlete_origins (athlete_id, province, city, county, source, quality, is_demo) VALUES (?, ?, ?, ?, 'legacy_migration', 'estimated', 0)`);
    for (const athlete of athletes) {
      const team = teamFor.get(athlete.project, athlete.team) as { id: number } | undefined;
      if (team) setTeam.run(team.id, athlete.id); else if (athlete.team) unmatchedTeams.push(`${athlete.project}:${athlete.team}`);
      const origin = originFor.get(athlete.id) as { province: string; city: string; county: string } | undefined;
      if (!origin && athlete.region !== '未设置') {
        createOrigin.run(athlete.id, athlete.region, athlete.city, athlete.county);
        report.migratedOrigins = Number(report.migratedOrigins) + 1;
      } else if (origin && (origin.province !== athlete.region || origin.city !== athlete.city || origin.county !== athlete.county)) {
        originConflicts.push(athlete.id);
      }
    }

    report.after = reconstructionBaseline();
    report.deprecatedTables = ['training_records', 'athlete_strength_tests', 'strength_training_sets', 'strength_import_batches'];
    db.prepare(`INSERT INTO app_metadata (key, value) VALUES ('reconstruction_v1_baseline', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(JSON.stringify(baseline));
    db.prepare(`INSERT INTO app_metadata (key, value) VALUES ('reconstruction_v1_report', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(JSON.stringify(report));
    db.prepare(`INSERT INTO app_metadata (key, value) VALUES ('deprecated_tables', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(JSON.stringify(report.deprecatedTables));
    db.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, 'completed')`).run(migrationKey);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

runReconstructionV1();

// 兼容已完成早期 V1 迁移的数据库：补齐随后加入的队伍/地区收敛步骤。
function runReconstructionV1P1Repair() {
  const key = 'reconstruction_v1_p1_repair_completed';
  if (db.prepare('SELECT 1 FROM app_metadata WHERE key = ?').get(key)) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const teamResult = db.prepare(`UPDATE athletes SET team_id = (SELECT id FROM project_teams WHERE project_teams.project = athletes.project AND project_teams.name = athletes.team AND project_teams.active = 1)`).run();
    const originResult = db.prepare(`
      INSERT OR IGNORE INTO athlete_origins (athlete_id, province, city, county, source, quality, is_demo)
      SELECT id, region, city, county, 'legacy_migration', 'estimated', 0
      FROM athletes
      WHERE region <> '未设置'
    `).run();
    db.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)`).run(key, JSON.stringify({ teamRowsChecked: teamResult.changes, originsCreated: originResult.changes }));
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

runReconstructionV1P1Repair();

/**
 * V1 收尾：旧表已经迁移并经业务路径切换后才执行。
 * 两张不应有业务数据的表若意外存在记录，立即中止，避免把未知数据静默删除。
 */
function retireLegacyReconstructionTables() {
  const legacyTables = ['training_records', 'athlete_strength_tests', 'strength_training_sets', 'strength_import_batches'];
  if (!legacyTables.some(tableExists)) return;
  for (const table of ['strength_training_sets', 'strength_import_batches']) {
    if (tableExists(table)) {
      const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
      if (count > 0) throw new Error(`无法删除 ${table}：仍有 ${count} 条未迁移记录。`);
    }
  }
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    // 删除 strength_import_batches 前，先移除 strength_result_sets 上的旧外键与旧 import_batch_id 字段。
    if (tableExists('strength_result_sets') && hasColumn('strength_result_sets', 'import_batch_id')) {
      db.exec(`
        ALTER TABLE strength_result_sets RENAME TO strength_result_sets_legacy;
        CREATE TABLE strength_result_sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          training_session_id INTEGER NOT NULL,
          exercise_code TEXT NOT NULL DEFAULT '',
          exercise_name TEXT NOT NULL,
          set_index INTEGER NOT NULL DEFAULT 1,
          target_reps REAL,
          actual_reps REAL NOT NULL,
          actual_weight_kg REAL NOT NULL,
          planned_weight_kg REAL,
          training_category TEXT NOT NULL DEFAULT '基础力量',
          body_position TEXT NOT NULL DEFAULT '全身',
          training_environment TEXT NOT NULL DEFAULT '陆上',
          duration_min REAL NOT NULL DEFAULT 0,
          distance_km REAL NOT NULL DEFAULT 0,
          intensity_percent REAL,
          intensity_zone TEXT NOT NULL DEFAULT 'AN',
          rpe REAL,
          completed INTEGER NOT NULL DEFAULT 1,
          note TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          data_import_batch_id TEXT,
          source_row TEXT NOT NULL DEFAULT '',
          original_text TEXT NOT NULL DEFAULT '',
          ai_confidence REAL,
          created_by INTEGER,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (training_session_id, exercise_name, set_index),
          FOREIGN KEY (training_session_id) REFERENCES training_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id)
        );
        INSERT INTO strength_result_sets (
          id, training_session_id, exercise_code, exercise_name, set_index, target_reps, actual_reps,
          actual_weight_kg, planned_weight_kg, training_category, body_position, training_environment,
          duration_min, distance_km, intensity_percent, intensity_zone, rpe, completed, note, source,
          data_import_batch_id, source_row, original_text, ai_confidence, created_by, updated_at
        ) SELECT
          id, training_session_id, exercise_code, exercise_name, set_index, target_reps, actual_reps,
          actual_weight_kg, planned_weight_kg, training_category, body_position, training_environment,
          duration_min, distance_km, intensity_percent, intensity_zone, rpe, completed, note, source,
          COALESCE(data_import_batch_id, import_batch_id), source_row, original_text, ai_confidence, created_by, updated_at
        FROM strength_result_sets_legacy;
        DROP TABLE strength_result_sets_legacy;
        CREATE INDEX IF NOT EXISTS idx_strength_result_sets_session ON strength_result_sets (training_session_id, exercise_name, set_index);
        CREATE INDEX IF NOT EXISTS idx_strength_result_sets_data_batch ON strength_result_sets (data_import_batch_id);
      `);
    }
    for (const table of legacyTables) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.prepare(`INSERT INTO app_metadata (key, value) VALUES ('retired_legacy_tables', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
      .run(JSON.stringify(legacyTables));
    db.prepare(`DELETE FROM app_metadata WHERE key = 'deprecated_tables'`).run();
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

retireLegacyReconstructionTables();

// 初始化训练量用于开箱即用的分析展示；来源字段仍明确保留，避免与人工录入混淆。
db.prepare("UPDATE training_sessions SET is_demo = 0 WHERE source = 'strength_daily_seed'").run();

// 同步早期演示数据中的旧模块命名；只处理完全匹配的内置示例标题。
db.prepare(`
  UPDATE training_plans
  SET title = ?, plan_data = replace(plan_data, ?, ?)
  WHERE title = ?
`).run('皮划艇夏训体能训练', '皮划艇夏训体能计划', '皮划艇夏训体能训练', '皮划艇夏训体能计划');

// 初始化示例与历史迁移完成后再执行一次，确保新库同样写入项目 Code。
migrateLegacyProjectCodes();

function seedRowingSpecialChampionModels() {
  const insert = db.prepare(`
    INSERT INTO special_champion_models (
      project, standard_type, event_code, event_name, country,
      best_performance, competition, location, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project, standard_type, event_code) DO NOTHING
  `);
  const rows = [
    ['ROWING', 'ASIA', 'M1X_2000', '男子单人双桨（2000米）', '中国', '6:57.06', '杭州第19届亚运会', '富阳水上运动中心，中国杭州', 10],
    ['ROWING', 'ASIA', 'W1X_2000', '女子单人双桨（2000米）', '乌兹别克斯坦', '7:39.05', '杭州第19届亚运会', '富阳水上运动中心，中国杭州', 20],
    ['ROWING', 'INTERNATIONAL', 'M1X_2000', '男子单人双桨（2000米）', '新西兰', '6:30.74', '2017年世界赛艇世界杯第二站', '马耳他湖，波兹南，波兰', 10],
    ['ROWING', 'INTERNATIONAL', 'W1X_2000', '女子单人双桨（2000米）', '保加利亚', '7:07.71', '2002年世界赛艇锦标赛', '瓜达尔基维尔河，塞维利亚，西班牙', 20],
    ['ROWING', 'GOLD', 'M1X_2000', '男子单人双桨（2000米）', '德国', '6:37.57', '巴黎2024奥运会赛艇男子单人双桨决赛', 'Vaires-sur-Marne 奥林匹克水上中心，法国', 10],
    ['ROWING', 'GOLD', 'W1X_2000', '女子单人双桨（2000米）', '荷兰', '7:17.28', '巴黎2024奥运会赛艇女子单人双桨决赛', 'Vaires-sur-Marne 奥林匹克水上中心，法国', 20]
  ] as const;

  // runInitializationOnce 已持有 BEGIN IMMEDIATE；在同一事务内插入，避免 SQLite 嵌套事务。
  for (const row of rows) insert.run(...row);
}

// 仅写入已核验的官方赛事成绩；唯一约束与初始化标记保证不会覆盖后续人工配置。
runInitializationOnce('rowing_special_champion_models_v1', seedRowingSpecialChampionModels);

function seedRowingChampionModelCatalogV2() {
  const verified: Record<string, { country: string; performance: string; competition: string; location: string; date: string }> = {
    'M1X_2000:ASIA': { country: '中国', performance: '6:57.06', competition: '杭州第19届亚运会', location: '富阳水上运动中心，中国杭州', date: '2023-09-25' },
    'W1X_2000:ASIA': { country: '乌兹别克斯坦', performance: '7:39.05', competition: '杭州第19届亚运会', location: '富阳水上运动中心，中国杭州', date: '2023-09-25' },
    'M1X_2000:INTERNATIONAL': { country: '新西兰', performance: '6:30.74', competition: '2017年世界赛艇世界杯第二站', location: '马耳他湖，波兹南，波兰', date: '2017-06-18' },
    'W1X_2000:INTERNATIONAL': { country: '保加利亚', performance: '7:07.71', competition: '2002年世界赛艇锦标赛', location: '瓜达尔基维尔河，塞维利亚，西班牙', date: '2002-09-21' },
    'M1X_2000:GOLD': { country: '德国', performance: '6:37.57', competition: '巴黎2024奥运会赛艇男子单人双桨决赛', location: 'Vaires-sur-Marne 奥林匹克水上中心，法国', date: '2024-08-03' },
    'W1X_2000:GOLD': { country: '荷兰', performance: '7:17.28', competition: '巴黎2024奥运会赛艇女子单人双桨决赛', location: 'Vaires-sur-Marne 奥林匹克水上中心，法国', date: '2024-08-03' }
  };
  const events = [
    ['M1X_2000', '男子单人双桨（2000米）', '男子项目', 10],
    ['M2X_2000', '男子双人双桨（2000米）', '男子项目', 20],
    ['M4X_2000', '男子四人双桨（2000米）', '男子项目', 30],
    ['M2_MINUS_2000', '男子双人单桨无舵手（2000米）', '男子项目', 40],
    ['M4_MINUS_2000', '男子四人单桨无舵手（2000米）', '男子项目', 50],
    ['M8_PLUS_2000', '男子八人单桨有舵手（2000米）', '男子项目', 60],
    ['LM2X_2000', '男子轻量级双人双桨（2000米）', '男子项目', 70],
    ['W1X_2000', '女子单人双桨（2000米）', '女子项目', 110],
    ['W2X_2000', '女子双人双桨（2000米）', '女子项目', 120],
    ['W4X_2000', '女子四人双桨（2000米）', '女子项目', 130],
    ['W2_MINUS_2000', '女子双人单桨无舵手（2000米）', '女子项目', 140],
    ['W4_MINUS_2000', '女子四人单桨无舵手（2000米）', '女子项目', 150],
    ['W8_PLUS_2000', '女子八人单桨有舵手（2000米）', '女子项目', 160],
    ['LW2X_2000', '女子轻量级双人双桨（2000米）', '女子项目', 170]
  ] as const;
  const insert = db.prepare(`
    INSERT INTO special_champion_models (
      project, standard_type, event_code, event_name, event_group, country,
      best_performance, competition, location, competition_date, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project, standard_type, event_code) DO UPDATE SET
      event_name = excluded.event_name,
      event_group = excluded.event_group,
      sort_order = excluded.sort_order,
      competition_date = COALESCE(special_champion_models.competition_date, excluded.competition_date)
  `);
  for (const [eventCode, eventName, eventGroup, sortOrder] of events) {
    for (const standardType of ['ASIA', 'INTERNATIONAL', 'GOLD'] as const) {
      const record = verified[`${eventCode}:${standardType}`];
      insert.run('ROWING', standardType, eventCode, eventName, eventGroup,
        record?.country ?? null, record?.performance ?? null, record?.competition ?? null,
        record?.location ?? null, record?.date ?? null, sortOrder);
    }
  }
}

// 赛艇小项目录独立于页面；未有官方可核验成绩的单元格保留为空，由界面展示“待核实”。
runInitializationOnce('rowing_champion_model_catalog_v2', seedRowingChampionModelCatalogV2);

runInitializationOnce('champion_model_remove_source_v1', () => {
  if (hasColumn('special_champion_models', 'source_url')) {
    db.prepare('UPDATE special_champion_models SET source_url = NULL').run();
  }
});

const validRegions = new Set<string>(PROVINCES);
const invalidRegions = (db.prepare("SELECT DISTINCT region FROM athletes WHERE region <> '未设置'").all() as { region: string }[])
  .filter((item) => !validRegions.has(item.region));
if (invalidRegions.length) {
  console.warn(`发现未收录的运动员地区：${invalidRegions.map((item) => item.region).join('、')}`);
}
