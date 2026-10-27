import { z } from 'zod';
import { db } from '../core/db.ts';
import { isValidIsoDate } from '../core/utils.ts';
import { trainingContext, TrainingInputError } from '../../shared/training-context.ts';
export { TrainingInputError } from '../../shared/training-context.ts';
import {
  resolveTrainingPlanLink,
  saveTrainingPlanLink,
  TrainingPlanLinkError,
} from '../core/training-plan-links.ts';

const optionalNumber = (max: number) =>
  z
    .union([z.string().max(20), z.number(), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ? null : Number(value)))
    .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= max));

// 本人填报与教练代填共用同一份校验，保证两条写入路径口径一致。
export const sessionSchema = z
  .strictObject({
    teamPlanId: z.number().int().positive().optional(),
    planSessionId: z.string().trim().min(1).max(100).optional(),
    date: z.string().refine(isValidIsoDate),
    startTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .or(z.literal('')),
    trainingType: z.enum(['专项训练', '体能训练', '恢复训练']),
    intensityZone: z.string().trim().max(20).optional().default(''),
    intensitySystem: z.string().trim().max(40).optional(),
    activityCode: z.string().trim().max(40).optional(),
    rulesVersion: z.string().trim().max(60).optional(),
    cadenceRpm: optionalNumber(300).optional(),
    content: z.string().trim().min(1).max(500),
    duration: optionalNumber(1440).refine(value => value === null || value > 0),
    distance: optionalNumber(500),
    rpe: optionalNumber(10),
    averageHeartRate: optionalNumber(250),
    maxHeartRate: optionalNumber(250),
    averagePowerW: optionalNumber(3000),
    strokeRateSpm: optionalNumber(100),
  })
  .refine(row => row.duration !== null || (row.distance !== null && row.distance > 0), { path: ['duration'], message: '请填写有效时长或距离。' })
  .refine(
    (row) =>
      row.averageHeartRate === null ||
      row.maxHeartRate === null ||
      row.averageHeartRate <= row.maxHeartRate,
    { path: ['averageHeartRate'] }
  );

export type SessionInput = z.infer<typeof sessionSchema>;

export type SessionRow = {
  projectCode: string | null;
  activityCode: string | null;
  intensitySystem: string | null;
  rulesVersion: string | null;
  cadenceRpm: number | null;
  id: number;
  date: string;
  startTime: string;
  trainingType: string;
  intensityZone: string;
  content: string;
  duration: number | null;
  distance: number | null;
  rpe: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  averagePowerW: number | null;
  strokeRateSpm: number | null;
  source: string;
  createdBy: number | null;
  teamPlanId: number | null;
  planSessionId: string | null;
};

function saveContext(athleteId: number, sessionId: number, row: SessionInput, isNew = false) {
  const athlete = db.prepare('SELECT project FROM athletes WHERE id = ?').get(athleteId) as { project: string } | undefined;
  if (!athlete) throw new TrainingInputError('运动员不存在。');
  const context = trainingContext(athlete.project, row);
  const stored = db.prepare('SELECT project_code AS project FROM training_sessions WHERE id=? AND athlete_id=?').get(sessionId,athleteId) as { project: string | null } | undefined;
  if (stored?.project && stored.project !== context.project) throw new TrainingInputError('历史课次不属于当前项目，不能修改其归属。');
  if (row.cadenceRpm != null && !db.prepare(`SELECT 1 FROM metric_definitions md
    JOIN training_metric_applicability ma ON ma.metric_code=md.code
    WHERE md.code='cadenceRpm' AND md.unit='rpm' AND md.active=1 AND ma.activity_code=?`).get(context.activity))
    throw new TrainingInputError('踏频指标未启用或活动配置已变化，请刷新后重试。');
  db.prepare(`UPDATE training_sessions SET project_code = CASE WHEN ? THEN ? ELSE project_code END,
    project_status = CASE WHEN ? THEN 'confirmed' ELSE project_status END,
    project_source = CASE WHEN ? THEN 'authenticated_write' ELSE project_source END, activity_code = ?, training_category = ?, rules_version = ?,
    intensity_system = ?, duration_reported = ? WHERE id = ? AND athlete_id = ?`)
    .run(Number(isNew),context.project,Number(isNew),Number(isNew), context.activity, context.category, context.version, context.system, row.duration === null ? 0 : 1, sessionId, athleteId);
  if (row.cadenceRpm == null) db.prepare("DELETE FROM training_session_metrics WHERE training_session_id = ? AND metric_code = 'cadenceRpm'").run(sessionId);
  else db.prepare(`INSERT INTO training_session_metrics(training_session_id, metric_code, value_num, unit, source)
    VALUES (?, 'cadenceRpm', ?, 'rpm', 'manual') ON CONFLICT(training_session_id, metric_code) DO UPDATE SET value_num = excluded.value_num`)
    .run(sessionId, row.cadenceRpm);
}

export function readSession(athleteId: number, id: number): SessionRow | undefined {
  return db
    .prepare(
      `SELECT id, project_code AS projectCode, activity_code AS activityCode, intensity_system AS intensitySystem,
    rules_version AS rulesVersion, (SELECT value_num FROM training_session_metrics WHERE training_session_id = training_sessions.id AND metric_code = 'cadenceRpm') AS cadenceRpm,
    session_date AS date, start_time AS startTime,
    training_type AS trainingType, intensity_zone AS intensityZone, content,
    CASE WHEN duration_reported = 1 THEN duration_min ELSE NULL END AS duration, CASE WHEN distance_reported = 1 THEN distance_km ELSE NULL END AS distance, rpe,
    average_heart_rate AS averageHeartRate, max_heart_rate AS maxHeartRate,
    average_power_w AS averagePowerW, stroke_rate_spm AS strokeRateSpm,
    source, created_by AS createdBy,
    (SELECT plan_id FROM training_plan_execution_links WHERE training_session_id = training_sessions.id) AS teamPlanId,
    (SELECT session_id FROM training_plan_execution_links WHERE training_session_id = training_sessions.id) AS planSessionId
    FROM training_sessions WHERE id = ? AND athlete_id = ? AND is_demo = 0
      AND (project_code IS NULL OR project_code=(SELECT project FROM athletes WHERE athletes.id=training_sessions.athlete_id))`
    )
    .get(id, athleteId) as SessionRow | undefined;
}

export function listSessions(athleteId: number, limit = 200): SessionRow[] {
  return db
    .prepare(
      `SELECT id, project_code AS projectCode, activity_code AS activityCode, intensity_system AS intensitySystem,
    rules_version AS rulesVersion, (SELECT value_num FROM training_session_metrics WHERE training_session_id = training_sessions.id AND metric_code = 'cadenceRpm') AS cadenceRpm,
    session_date AS date, start_time AS startTime,
    training_type AS trainingType, intensity_zone AS intensityZone, content,
    CASE WHEN duration_reported = 1 THEN duration_min ELSE NULL END AS duration, CASE WHEN distance_reported = 1 THEN distance_km ELSE NULL END AS distance, rpe,
    average_heart_rate AS averageHeartRate, max_heart_rate AS maxHeartRate,
    average_power_w AS averagePowerW, stroke_rate_spm AS strokeRateSpm,
    source, created_by AS createdBy,
    (SELECT plan_id FROM training_plan_execution_links WHERE training_session_id = training_sessions.id) AS teamPlanId,
    (SELECT session_id FROM training_plan_execution_links WHERE training_session_id = training_sessions.id) AS planSessionId
    FROM training_sessions WHERE athlete_id = ? AND is_demo = 0
      AND (project_code IS NULL OR project_code=(SELECT project FROM athletes WHERE athletes.id=training_sessions.athlete_id))
    ORDER BY session_date DESC, session_order DESC LIMIT ?`
    )
    .all(athleteId, limit) as SessionRow[];
}

export function parseSessionId(value: string): number | null {
  const id = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function insertSession(
  athleteId: number,
  row: SessionInput,
  source: string,
  createdBy: number
): number {
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    const link = resolveTrainingPlanLink(db, athleteId, row);
    const order = db
      .prepare(
        'SELECT COALESCE(MAX(session_order), 0) + 1 AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?'
      )
      .get(athleteId, row.date) as { value: number };
    const inserted = db
      .prepare(
        `INSERT INTO training_sessions
    (athlete_id, session_date, session_order, start_time, training_type, structure_type, intensity_zone,
     content, duration_min, distance_km, distance_reported, rpe, srpe, average_heart_rate,
     max_heart_rate, average_power_w, stroke_rate_spm, source, quality, is_demo, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', 0, ?)`
      )
      .run(
        athleteId,
        row.date,
        order.value,
        row.startTime,
        row.trainingType,
        row.trainingType,
        row.intensityZone,
        row.content,
        row.duration ?? 0,
        row.distance ?? 0,
        row.distance === null ? 0 : 1,
        row.rpe,
        (row.duration !== null && row.rpe !== null ? row.duration * row.rpe : null),
        row.averageHeartRate,
        row.maxHeartRate,
        row.averagePowerW,
        row.strokeRateSpm,
        source,
        createdBy
      );
    const id = Number(inserted.lastInsertRowid);
    saveContext(athleteId, id, row, true);
    saveTrainingPlanLink(db, id, link);
    if (ownTransaction) db.exec('COMMIT');
    return id;
  } catch (error) {
    if (ownTransaction && db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function updateSession(
  athleteId: number,
  id: number,
  row: SessionInput,
  existing: SessionRow
): void {
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec('BEGIN IMMEDIATE');
  try {
  // 已关联训练的版本与训练课不可静默改绑，事实数值仍可修正。
  if (
    existing.teamPlanId &&
    (row.date !== existing.date ||
      row.trainingType !== existing.trainingType ||
      (row.teamPlanId !== undefined && row.teamPlanId !== existing.teamPlanId) ||
      (row.planSessionId !== undefined && row.planSessionId !== existing.planSessionId))
  ) {
    throw new TrainingPlanLinkError('已关联训练不可更改计划版本、训练课、日期或类别。');
  }
  if (!existing.teamPlanId && (row.teamPlanId || row.planSessionId)) {
    throw new TrainingPlanLinkError('请从已发布训练课新增关联填报，历史记录不自动改绑。');
  }
  // 日期变化时把课次排到新日期末尾，同日修改保持原有顺序。
  const order =
    row.date === existing.date
      ? null
      : (db
          .prepare(
            'SELECT COALESCE(MAX(session_order), 0) + 1 AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?'
          )
          .get(athleteId, row.date) as { value: number });
  db.prepare(
    `UPDATE training_sessions SET session_date = ?, session_order = COALESCE(?, session_order),
    start_time = ?, training_type = ?, structure_type = ?, intensity_zone = ?, content = ?,
    duration_min = ?, distance_km = ?, distance_reported = ?, rpe = ?, srpe = ?,
    average_heart_rate = ?, max_heart_rate = ?, average_power_w = ?, stroke_rate_spm = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND athlete_id = ?`
  ).run(
    row.date,
    order?.value ?? null,
    row.startTime,
    row.trainingType,
    row.trainingType,
    row.intensityZone,
    row.content,
    row.duration ?? 0,
    row.distance ?? 0,
    row.distance === null ? 0 : 1,
    row.rpe,
    (row.duration !== null && row.rpe !== null ? row.duration * row.rpe : null),
    row.averageHeartRate,
    row.maxHeartRate,
    row.averagePowerW,
    row.strokeRateSpm,
    id,
    athleteId
  );
  saveContext(athleteId, id, row);
  if (ownTransaction) db.exec('COMMIT');
  } catch (error) {
    if (ownTransaction && db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
