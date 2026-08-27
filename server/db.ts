import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { PROVINCES } from '../shared/regions.ts';
import { PROJECT_META } from '../shared/projects.ts';
import { OVERVIEW_METRICS } from '../shared/overview-metrics.ts';

const databasePath = resolve(process.env.DATABASE_PATH || resolve(process.cwd(), 'data', 'training-monitor.db'));
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
    name TEXT NOT NULL UNIQUE,
    project TEXT NOT NULL,
    team TEXT NOT NULL,
    gender TEXT,
    region TEXT NOT NULL DEFAULT '未设置',
    city TEXT NOT NULL DEFAULT '未设置',
    county TEXT NOT NULL DEFAULT '未设置',
    birth_date TEXT,
    photo_url TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
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

  CREATE TABLE IF NOT EXISTS training_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    training_type TEXT NOT NULL,
    structure_type TEXT NOT NULL,
    intensity_zone TEXT NOT NULL,
    content TEXT,
    duration_min REAL NOT NULL DEFAULT 0,
    distance_km REAL NOT NULL DEFAULT 0,
    rpe REAL,
    srpe REAL NOT NULL DEFAULT 0,
    smvl REAL NOT NULL DEFAULT 0,
    morning_pulse REAL,
    weight_kg REAL,
    sleep_hours REAL,
    fatigue_index REAL,
    status TEXT NOT NULL CHECK(status IN ('normal', 'attention', 'alert', 'rest', 'missing')),
    coach_note TEXT,
    training_breakdown TEXT NOT NULL DEFAULT '{}',
    province TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    county TEXT NOT NULL DEFAULT '',
    project TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    updated_by INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, date),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS athlete_strength_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    test_date TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '{}',
    targets_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    updated_by INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (athlete_id, test_date),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS strength_ai_advice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strength_test_id INTEGER NOT NULL,
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
    UNIQUE (strength_test_id, version),
    FOREIGN KEY (strength_test_id) REFERENCES athlete_strength_tests(id) ON DELETE CASCADE,
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

if (!hasColumn('athletes', 'region')) {
  db.exec("ALTER TABLE athletes ADD COLUMN region TEXT NOT NULL DEFAULT '未设置'");
}
if (!hasColumn('athletes', 'city')) {
  db.exec("ALTER TABLE athletes ADD COLUMN city TEXT NOT NULL DEFAULT '未设置'");
}
if (!hasColumn('athletes', 'county')) {
  db.exec("ALTER TABLE athletes ADD COLUMN county TEXT NOT NULL DEFAULT '未设置'");
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
for (const column of ['province', 'city', 'county', 'project', 'team']) {
  if (!hasColumn('training_records', column)) {
    db.exec(`ALTER TABLE training_records ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
}
if (!hasColumn('training_records', 'training_breakdown')) {
  db.exec("ALTER TABLE training_records ADD COLUMN training_breakdown TEXT NOT NULL DEFAULT '{}'");
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

// 新版训练总览采用“每日恢复—训练课次—测试批次—测试指标”的分层结构。
// 旧 training_records 与 athlete_strength_tests 继续保留，供日历和既有接口兼容使用。
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

  CREATE TABLE IF NOT EXISTS strength_import_batches (
    id TEXT PRIMARY KEY,
    source_filename TEXT NOT NULL,
    source_mimetype TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL CHECK(source_type IN ('excel', 'csv', 'image', 'pdf', 'manual')),
    model_used TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview', 'committed', 'failed')),
    row_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    committed_at TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS strength_result_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    training_session_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    set_index INTEGER NOT NULL DEFAULT 1,
    target_reps REAL,
    actual_reps REAL NOT NULL,
    actual_weight_kg REAL NOT NULL,
    rpe REAL,
    completed INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    import_batch_id TEXT,
    source_row TEXT NOT NULL DEFAULT '',
    original_text TEXT NOT NULL DEFAULT '',
    ai_confidence REAL,
    created_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (training_session_id, exercise_name, set_index),
    FOREIGN KEY (training_session_id) REFERENCES training_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (import_batch_id) REFERENCES strength_import_batches(id),
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

  CREATE INDEX IF NOT EXISTS idx_daily_wellness_athlete_date ON daily_wellness (athlete_id, wellness_date);
  CREATE INDEX IF NOT EXISTS idx_training_sessions_athlete_date ON training_sessions (athlete_id, session_date, session_order);
  CREATE INDEX IF NOT EXISTS idx_strength_result_sets_session ON strength_result_sets (training_session_id, exercise_name, set_index);
  CREATE INDEX IF NOT EXISTS idx_strength_result_sets_batch ON strength_result_sets (import_batch_id);
  CREATE INDEX IF NOT EXISTS idx_test_sessions_athlete_date ON test_sessions (athlete_id, test_date DESC);
  CREATE INDEX IF NOT EXISTS idx_test_measurements_session ON test_measurements (test_session_id, metric_code);
  CREATE INDEX IF NOT EXISTS idx_body_measurements_athlete_date ON athlete_body_measurements (athlete_id, measurement_date DESC);
  CREATE INDEX IF NOT EXISTS idx_competitive_state_athlete_date ON competitive_state_assessments (athlete_id, assessment_date DESC);
  CREATE INDEX IF NOT EXISTS idx_athlete_origins_province_city ON athlete_origins (province, city, athlete_id);
`);

if (!hasColumn('strength_import_batches', 'model_used')) {
  db.exec("ALTER TABLE strength_import_batches ADD COLUMN model_used TEXT NOT NULL DEFAULT ''");
}

const strengthResultColumns = [
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

  const insertRecord = db.prepare(`
    INSERT INTO training_records (
      athlete_id, date, training_type, structure_type, intensity_zone, content,
      duration_min, distance_km, rpe, srpe, smvl, morning_pulse, weight_kg,
      sleep_hours, fatigue_index, status, coach_note, province, city, county,
      project, team, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      const note = status === 'alert' ? '晨间状态偏离个人基线，训练前需复核。' : '';
      const creator = athleteId <= 4 ? 2 : 3;

      insertRecord.run(
        athleteId,
        iso,
        trainingType,
        structureType,
        isRest ? '-' : zones[(day + athleteId) % zones.length],
        content,
        duration,
        distance,
        rpe,
        rpe ? Math.round(duration * rpe) : 0,
        smvl,
        pulse,
        Number((bodies[athleteId - 1] + Math.sin(phase / 8) * 0.6).toFixed(1)),
        sleep,
        fatigue,
        status,
        note,
        String(athletes[athleteId - 1][4]),
        String(athletes[athleteId - 1][5]),
        String(athletes[athleteId - 1][6]),
        String(athletes[athleteId - 1][1]),
        String(athletes[athleteId - 1][2]),
        creator,
        creator
      );
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

  db.exec(`
    UPDATE training_records
    SET province = COALESCE(NULLIF(province, ''), (SELECT region FROM athletes WHERE athletes.id = training_records.athlete_id)),
        city = COALESCE(NULLIF(city, ''), (SELECT city FROM athletes WHERE athletes.id = training_records.athlete_id)),
        county = COALESCE(NULLIF(county, ''), (SELECT county FROM athletes WHERE athletes.id = training_records.athlete_id)),
        project = COALESCE(NULLIF(project, ''), (SELECT project FROM athletes WHERE athletes.id = training_records.athlete_id)),
        team = COALESCE(NULLIF(team, ''), (SELECT team FROM athletes WHERE athletes.id = training_records.athlete_id));
  `);
}

runInitializationOnce('access_model_seed_v1', seedAccessModel);

function seedStrengthExample() {
  const athlete = db.prepare("SELECT id FROM athletes WHERE name = '林舟'").get() as { id: number } | undefined;
  const coach = db.prepare("SELECT id FROM users WHERE username = 'coach01'").get() as { id: number } | undefined;
  if (!athlete || !coach) return;
  const metrics = {
    heightCm: 178,
    weightKg: 58.5,
    armSpanCm: 181,
    sitReachCm: 22,
    verticalJumpCm: 42,
    pullUpsReps: 12,
    benchPressKg: 55,
    benchPullKg: 65,
    frontPlankSec: 180,
    leftPlankSec: 150,
    rightPlankSec: 165,
    squatKg: 110,
    deadliftKg: 125,
    highPullKg: 55,
    leftSingleLegSquatReps: 20,
    rightSingleLegSquatReps: 22
  };
  const targets = {
    sitReachCm: 25,
    verticalJumpCm: 45,
    pullUpsReps: 15,
    benchPressKg: 55,
    benchPullKg: 70,
    frontPlankSec: 180,
    leftPlankSec: 180,
    rightPlankSec: 180,
    squatKg: 115,
    deadliftKg: 130,
    highPullKg: 60,
    leftSingleLegSquatReps: 24,
    rightSingleLegSquatReps: 24
  };
  db.prepare(`
    INSERT OR IGNORE INTO athlete_strength_tests
      (athlete_id, test_date, metrics_json, targets_json, notes, created_by, updated_by)
    VALUES (?, '2026-07-25', ?, ?, '', ?, ?)
  `).run(athlete.id, JSON.stringify(metrics), JSON.stringify(targets), coach.id, coach.id);
}

runInitializationOnce('strength_seed_v1', seedStrengthExample);

function seedSlalomStrengthExample() {
  const athlete = db.prepare("SELECT id FROM athletes WHERE name = '宋岚'").get() as { id: number } | undefined;
  const coach = db.prepare("SELECT id FROM users WHERE username = 'coach02'").get() as { id: number } | undefined;
  if (!athlete || !coach) return;
  const metrics = {
    heightCm: 168,
    weightKg: 59.5,
    benchPressKg: 80,
    benchPullKg: 78,
    benchPressPeakPowerW: 425,
    benchPressRelativePowerWkg: 7.1,
    benchPullPeakPowerW: 468,
    benchPullRelativePowerWkg: 7.4,
    benchPress2MinReps: 62,
    benchPull2MinReps: 70,
    thresholdErgPowerW: 152,
    anaerobicThresholdHr: 163,
    sprint300Sec: 116,
    leftGripKgf: 39.2,
    rightGripKgf: 40.1
  };
  db.prepare(`
    INSERT OR IGNORE INTO athlete_strength_tests
      (athlete_id, test_date, metrics_json, targets_json, notes, created_by, updated_by)
    VALUES (?, '2026-07-31', ?, '{}', '激流回旋冠军模型基线测试', ?, ?)
  `).run(athlete.id, JSON.stringify(metrics), coach.id, coach.id);
}

runInitializationOnce('slalom_strength_seed_v1', seedSlalomStrengthExample);

function seedProfessionalOverviewData() {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin01'").get() as { id: number } | undefined;
  const athletes = db.prepare('SELECT id, project, gender FROM athletes WHERE active = 1 ORDER BY id')
    .all() as Array<{ id: number; project: string; gender: string }>;
  if (!admin || !athletes.length) return;
  db.prepare("DELETE FROM athlete_strength_tests WHERE notes = '训练总览演示测试数据'").run();
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
      movement_squat_score: round(82 * gain), movement_heel_lift_score: round(86 * gain),
      movement_pushup_score: round(84 * gain), movement_shoulder_score: round(88 * gain),
      movement_trunk_score: round(81 * gain), movement_cervical_score: round(90 * gain)
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
        const target = definition.direction === 'lower_better' ? value * .95
          : definition.direction === 'higher_better' ? value * 1.05 : value;
        insertMeasurement.run(testSession.id, code, value, round(target, 2), definition.unit);
      }
    }
  }
}

runInitializationOnce('professional_overview_seed_v2', seedProfessionalOverviewData);

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

// 同步早期演示数据中的旧模块命名；只处理完全匹配的内置示例标题。
db.prepare(`
  UPDATE training_plans
  SET title = ?, plan_data = replace(plan_data, ?, ?)
  WHERE title = ?
`).run('皮划艇夏训体能训练', '皮划艇夏训体能计划', '皮划艇夏训体能训练', '皮划艇夏训体能计划');

const validRegions = new Set<string>(PROVINCES);
const invalidRegions = (db.prepare("SELECT DISTINCT region FROM athletes WHERE region <> '未设置'").all() as { region: string }[])
  .filter((item) => !validRegions.has(item.region));
if (invalidRegions.length) {
  console.warn(`发现未收录的运动员地区：${invalidRegions.map((item) => item.region).join('、')}`);
}
