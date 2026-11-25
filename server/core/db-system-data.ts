import type { DatabaseSync } from 'node:sqlite';

/** 创建强度分区与动作字典，并只补入缺少的固定项。 */
export function initializeSystemData(db: DatabaseSync) {
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
    ROWING_UT: ['UT3', 'UT2', 'UT1', 'TR', 'AT', 'AN', 'REC'],
  })) {
    zones.forEach((code, index) =>
      insertIntensityZone.run(system, code, code, `${system} 强度分区`, index + 1)
    );
  }
  const insertExercise = db.prepare(`
    INSERT OR IGNORE INTO exercise_definitions (exercise_code, exercise_name, category, default_unit)
    VALUES (?, ?, ?, 'kg')
  `);
  for (const [code, name] of [
    ['SQUAT', '深蹲'],
    ['BENCH_PULL', '卧拉'],
    ['BENCH_PRESS', '卧推'],
    ['DEADLIFT', '硬拉'],
    ['LEG_PRESS', '腿举'],
    ['PULL_UP', '引体向上'],
    ['ROWING_ERG_FUNCTION', '划船测功仪功能'],
    ['CIRCUIT_STRENGTH_ENDURANCE', '循环力量耐力'],
    ['RECOVERY_MOBILITY', '拉伸再生组合'],
    ['WATER_SPECIAL_ROWING', '水上专项划行'],
    ['COORDINATION_TRAINING', '综合协调训练'],
    ['RUN_INTERVAL', '跑步间歇'],
    ['HIGH_PULL_SPEED', '高拉速度力量'],
  ]) {
    insertExercise.run(code, name, '力量训练');
  }
}
