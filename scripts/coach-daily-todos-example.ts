import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beijingDate, readDailyTodos } from '../server/core/coach-daily-todos.ts';

// 只创建专用的新场景库，不连接或覆盖日常运行数据库。
const now = new Date();
const output = resolve(process.cwd(), 'tmp', `coach-daily-todos-${beijingDate(now)}.db`);
mkdirSync(dirname(output), { recursive: true });
try {
  // 独占创建，防止并发启动向同一个场景库重复追加正式负荷。
  closeSync(openSync(output, 'wx', 0o600));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
    throw new Error(`场景库已存在，未作修改：${output}。可直接使用此库启动服务。`);
  }
  throw error;
}
process.env.DATABASE_PATH = output;
const { db } = await import('../server/core/db.ts');
try {
  const creator = db.prepare("SELECT id FROM users WHERE username = 'admin01'").get() as {
    id: number;
  };
  const timestamp = new Date(now.getTime() - 60 * 1000);
  const local = new Date(timestamp.getTime() + 8 * 3600000).toISOString();
  const today = beijingDate(now);
  const insert = db.prepare(`
    INSERT INTO training_sessions (athlete_id, session_date, session_order, start_time,
      training_type, structure_type, intensity_zone, content, duration_min, distance_km,
      rpe, srpe, smvl, source, quality, is_demo, created_by)
    SELECT ?, ?, COALESCE(MAX(session_order), 0) + 1, ?, '专项训练', '专项训练', 'U2', ?, ?, 12,
      ?, ?, 0, 'coach_daily_example', 'valid', 0, ?
    FROM training_sessions WHERE athlete_id = ? AND session_date = ?
  `);
  const addSession = (id: number, duration: number, rpe: number, incomplete = false) => {
    const date = incomplete ? today : local.slice(0, 10);
    insert.run(
      id,
      date,
      incomplete ? '' : local.slice(11, 16),
      '每日待办场景训练',
      duration,
      rpe,
      Math.round(duration * rpe),
      creator.id,
      id,
      date
    );
  };
  const addInjury = db.prepare(`
    INSERT INTO injury_records (athlete_id, record_type, injury_name, body_part, side, status,
      pain_score, onset_date, note, created_by, created_at)
    VALUES (?, 'formal', '训练后肩部不适', '肩部', 'left', 'observation', 3, ?,
      '每日待办场景记录，参与正式统计', ?, ?)
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    addSession(1, 120, 5);
    addSession(3, 100, 7, true);
    addSession(4, 40, 4);
    addSession(5, 100, 7);
    addSession(8, 40, 4);
    for (const id of [1, 2, 7]) {
      addInjury.run(id, today, creator.id, now.toISOString().slice(0, 19).replace('T', ' '));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const summaries = ['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM'].map((project) => {
    const todos = readDailyTodos(db, { athleteIds: [1, 2, 3, 4, 5, 6, 7, 8], project, now });
    return { project, ...todos.counts };
  });
  console.log(JSON.stringify({ database: output, date: today, summaries }, null, 2));
} finally {
  db.close();
}
