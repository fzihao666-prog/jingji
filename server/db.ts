import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { PROVINCES } from '../shared/regions.ts';
import { PROJECT_META } from '../shared/projects.ts';

const databasePath = resolve(process.env.DATABASE_PATH || resolve(process.cwd(), 'data', 'training-monitor.db'));
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS athletes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    project TEXT NOT NULL,
    team TEXT NOT NULL,
    gender TEXT,
    region TEXT NOT NULL DEFAULT '未设置',
    city TEXT NOT NULL DEFAULT '未设置',
    county TEXT NOT NULL DEFAULT '未设置',
    photo_url TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
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
    region TEXT,
    city TEXT,
    county TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
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
if (!hasColumn('registration_requests', 'region')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN region TEXT');
}
if (!hasColumn('registration_requests', 'city')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN city TEXT');
}
if (!hasColumn('registration_requests', 'county')) {
  db.exec('ALTER TABLE registration_requests ADD COLUMN county TEXT');
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
db.exec(`
  UPDATE training_plans
  SET start_date = COALESCE(NULLIF(start_date, ''), plan_date),
      end_date = COALESCE(NULLIF(end_date, ''), date(plan_date, '+1 month', '-1 day'));
`);

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
        id, username, password_hash, display_name, requested_role, project, team, gender,
        region, city, county, status, reviewed_by, reviewed_at, created_at
      )
      SELECT id, username, password_hash, display_name,
        CASE requested_role WHEN 'athlete' THEN 'ATL' WHEN 'coach' THEN 'SCC' ELSE requested_role END,
        project, team, gender, region, city, county, status, reviewed_by, reviewed_at, created_at
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

seed();

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

seedRegionalExample();

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

seedAccessModel();

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

seedStrengthExample();

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

seedSlalomStrengthExample();

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
    title: '皮划艇夏训体能计划',
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

seedTrainingPlanExample();

const validRegions = new Set<string>(PROVINCES);
const invalidRegions = (db.prepare("SELECT DISTINCT region FROM athletes WHERE region <> '未设置'").all() as { region: string }[])
  .filter((item) => !validRegions.has(item.region));
if (invalidRegions.length) {
  console.warn(`发现未收录的运动员地区：${invalidRegions.map((item) => item.region).join('、')}`);
}
