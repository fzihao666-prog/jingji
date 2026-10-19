import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { trainingLoadCategory } from '../../shared/training-content-category.ts';
import type { ReportData, ReportRange } from '../../shared/training-report.ts';

export function initializeTrainingReports(db: DatabaseSync) {
  // 仅保存已确认的报告快照，不创建新的训练事实或数据库。
  db.exec(`CREATE TABLE IF NOT EXISTS training_reports (
    id TEXT PRIMARY KEY, athlete_id INTEGER NOT NULL, project TEXT NOT NULL,
    created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
    from_date TEXT NOT NULL, to_date TEXT NOT NULL, kind TEXT NOT NULL,
    data_json TEXT NOT NULL, commentary_json TEXT NOT NULL,
    FOREIGN KEY(athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id));
    CREATE INDEX IF NOT EXISTS idx_training_reports_athlete ON training_reports(athlete_id, created_at);`);
}
// 与训练总览一致：排除演示、估算、异常和不足质量记录。
const valid = (alias: string) => `${alias}.is_demo = 0 AND ${alias}.quality IN ('valid','partial')
  AND lower(${alias}.source) NOT LIKE '%demo%' AND lower(${alias}.source) NOT LIKE '%seed%'
  AND lower(${alias}.source) NOT LIKE '%estimated%'`;
type Session = {
  date: string;
  trainingType: string;
  structureType: string;
  content: string;
  duration: number | null;
  distance: number | null;
  srpe: number | null;
};
const sum = (values: (number | null)[]) => {
  const numbers = values.filter((n): n is number => n !== null && Number.isFinite(n));
  return numbers.length ? Math.round(numbers.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};
function totals(rows: Session[]) {
  return {
    sessions: rows.length,
    duration: sum(rows.map((r) => r.duration)),
    distance: sum(rows.map((r) => r.distance)),
    srpe: sum(rows.map((r) => r.srpe)),
    durationCount: rows.filter((r) => r.duration !== null).length,
    distanceCount: rows.filter((r) => r.distance !== null).length,
    srpeCount: rows.filter((r) => r.srpe !== null).length,
  };
}
export function readReport(
  db: DatabaseSync,
  athleteId: number,
  project: string,
  range: ReportRange
): ReportData {
  // 多张事实表在同一只读事务内取快照，避免另一连接补录期间读到混合版本。
  db.exec('BEGIN');
  try {
    const data = readReportSnapshot(db, athleteId, project, range);
    db.exec('COMMIT');
    return data;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function readReportSnapshot(
  db: DatabaseSync,
  athleteId: number,
  project: string,
  range: ReportRange
): ReportData {
  const readSessions = (from: string, to: string) =>
    db
      .prepare(
        `SELECT s.session_date AS date,
    s.training_type AS trainingType, s.structure_type AS structureType, s.content,
    CASE WHEN s.duration_reported = 1 THEN s.duration_min END AS duration,
    CASE WHEN s.distance_reported = 1 THEN s.distance_km END AS distance,
    CASE WHEN s.duration_reported = 1 AND s.rpe IS NOT NULL THEN s.srpe END AS srpe
    FROM training_sessions s JOIN athletes a ON a.id = s.athlete_id
    WHERE s.athlete_id = ? AND a.project = ? AND s.session_date BETWEEN ? AND ? AND ${valid('s')}
    ORDER BY s.session_date, s.session_order`
      )
      .all(athleteId, project, from, to) as Session[];
  const rows = readSessions(range.from, range.to);
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
  const previousTo = new Date(Date.parse(range.from) - 86400000).toISOString().slice(0, 10);
  const previousFrom = new Date(Date.parse(range.from) - days * 86400000)
    .toISOString()
    .slice(0, 10);
  const categories = [
    ['special', '专项'],
    ['physical', '体能'],
    ['recovery', '恢复'],
    ['other', '未分类'],
  ];
  const category = (r: Session) => trainingLoadCategory(r) || 'other';
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.parse(range.from) + i * 86400000).toISOString().slice(0, 10);
    const records = rows.filter((r) => r.date === date);
    const duration = (key: string) =>
      sum(records.filter((r) => category(r) === key).map((r) => r.duration));
    return {
      date,
      sessions: records.length,
      special: duration('special'),
      physical: duration('physical'),
      recovery: duration('recovery'),
      other: duration('other'),
      duration: sum(records.map((r) => r.duration)),
      srpe: sum(records.map((r) => r.srpe)),
    };
  });
  type Measurement = {
    code: string;
    label: string;
    unit: string;
    protocol: string;
    side: string;
    date: string;
    value: number;
  };
  const measurements = db
    .prepare(
      `SELECT m.metric_code AS code, d.label, m.unit, t.protocol, m.side,
    t.test_date AS date, m.value_num AS value FROM test_measurements m
    JOIN test_sessions t ON t.id = m.test_session_id JOIN metric_definitions d ON d.code = m.metric_code
    JOIN athletes a ON a.id = t.athlete_id WHERE t.athlete_id = ? AND a.project = ?
    AND t.test_date BETWEEN ? AND ? AND ${valid('t')} AND ${valid('m')} ORDER BY t.test_date, m.id`
    )
    .all(athleteId, project, range.from, range.to) as Measurement[];
  const groups = new Map<string, Measurement[]>();
  for (const row of measurements) {
    const key = JSON.stringify([row.code, row.unit, row.protocol, row.side]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  type Wellness = {
    date: string;
    sleep: number | null;
    pulse: number | null;
    weight: number | null;
  };
  const wellness = db
    .prepare(
      `SELECT w.wellness_date AS date, w.sleep_hours AS sleep,
    w.morning_pulse AS pulse, w.weight_kg AS weight FROM daily_wellness w
    JOIN athletes a ON a.id = w.athlete_id WHERE w.athlete_id = ? AND a.project = ?
    AND w.wellness_date BETWEEN ? AND ? AND ${valid('w')} ORDER BY w.wellness_date`
    )
    .all(athleteId, project, range.from, range.to) as Wellness[];
  const definitions = [
    { key: 'sleep', label: '睡眠', unit: '小时' },
    { key: 'pulse', label: '晨脉', unit: 'bpm' },
    { key: 'weight', label: '体重', unit: 'kg' },
  ] as const;
  return {
    version: 1,
    range,
    project,
    totals: totals(rows),
    previous: totals(readSessions(previousFrom, previousTo)),
    days,
    daily,
    trainingDays: new Set(rows.map((r) => r.date)).size,
    wellnessDays: wellness.length,
    categories: categories.map(([key, label]) => {
      const records = rows.filter((r) => category(r) === key);
      return {
        key,
        label,
        sessions: records.length,
        duration: sum(records.map((r) => r.duration)),
      };
    }),
    tests: [...groups].map(([key, values]) => {
      const first = values[0],
        last = values[values.length - 1];
      return {
        key,
        label: first.label,
        unit: first.unit,
        protocol: first.protocol,
        side: first.side,
        points: values.map(({ date, value }) => ({ date, value })),
        first: { date: first.date, value: first.value },
        last: { date: last.date, value: last.value },
        change:
          values.length > 1 && first.protocol.trim()
            ? Math.round((last.value - first.value) * 100) / 100
            : null,
      };
    }),
    wellness: definitions.map(({ key, label, unit }) => {
      const points = wellness
        .filter((r) => r[key] !== null)
        .map((r) => ({ date: r.date, value: r[key]! }));
      return {
        key,
        label,
        unit,
        days: points.length,
        points,
        average: points.length
          ? Math.round((points.reduce((a, p) => a + p.value, 0) / points.length) * 100) / 100
          : null,
      };
    }),
  };
}
export const reportFingerprint = (data: ReportData) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');

/** 模型仅接收数值汇总和固定分类，排除身份、自由文本、测试协议、伤病与恢复健康信息。 */
export function reportAiInput(data: ReportData) {
  return {
    days: data.days,
    totals: data.totals,
    previous: data.previous,
    categories: data.categories,
    trainingDays: data.trainingDays,
    daily: data.daily.map((d, i) => ({
      day: i + 1,
      sessions: d.sessions,
      duration: d.duration,
      srpe: d.srpe,
    })),
  };
}
