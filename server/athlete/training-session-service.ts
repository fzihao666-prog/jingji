import { z } from 'zod';
import { db } from '../core/db.ts';
import { isValidIsoDate } from '../core/utils.ts';

const optionalNumber = (max: number) => z.union([z.string().max(20), z.number()]).optional()
  .transform((value) => value === '' || value === undefined ? null : Number(value))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= max));
const requiredNumber = (min: number, max: number) => z.union([z.string().max(20), z.number()])
  .transform(Number)
  .refine((value) => Number.isFinite(value) && value >= min && value <= max);

// 本人填报与教练代填共用同一份校验，保证两条写入路径口径一致。
export const sessionSchema = z.strictObject({
  date: z.string().refine(isValidIsoDate),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).or(z.literal('')),
  trainingType: z.enum(['专项训练', '体能训练', '恢复训练']),
  intensityZone: z.enum(['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP']),
  content: z.string().trim().min(1).max(500),
  duration: requiredNumber(1, 1440),
  distance: optionalNumber(500),
  rpe: requiredNumber(1, 10),
  averageHeartRate: optionalNumber(250),
  maxHeartRate: optionalNumber(250),
  averagePowerW: optionalNumber(3000),
  strokeRateSpm: optionalNumber(100),
}).refine((row) => row.averageHeartRate === null || row.maxHeartRate === null
  || row.averageHeartRate <= row.maxHeartRate, { path: ['averageHeartRate'] });

export type SessionInput = z.infer<typeof sessionSchema>;

export type SessionRow = {
  id: number; date: string; startTime: string; trainingType: string; intensityZone: string;
  content: string; duration: number; distance: number | null; rpe: number | null;
  averageHeartRate: number | null; maxHeartRate: number | null; averagePowerW: number | null;
  strokeRateSpm: number | null; source: string; createdBy: number | null;
};

export function readSession(athleteId: number, id: number): SessionRow | undefined {
  return db.prepare(`SELECT id, session_date AS date, start_time AS startTime,
    training_type AS trainingType, intensity_zone AS intensityZone, content,
    duration_min AS duration, CASE WHEN distance_reported = 1 THEN distance_km ELSE NULL END AS distance, rpe,
    average_heart_rate AS averageHeartRate, max_heart_rate AS maxHeartRate,
    average_power_w AS averagePowerW, stroke_rate_spm AS strokeRateSpm,
    source, created_by AS createdBy
    FROM training_sessions WHERE id = ? AND athlete_id = ? AND is_demo = 0`)
    .get(id, athleteId) as SessionRow | undefined;
}

export function listSessions(athleteId: number, limit = 200): SessionRow[] {
  return db.prepare(`SELECT id, session_date AS date, start_time AS startTime,
    training_type AS trainingType, intensity_zone AS intensityZone, content,
    duration_min AS duration, CASE WHEN distance_reported = 1 THEN distance_km ELSE NULL END AS distance, rpe,
    average_heart_rate AS averageHeartRate, max_heart_rate AS maxHeartRate,
    average_power_w AS averagePowerW, stroke_rate_spm AS strokeRateSpm,
    source, created_by AS createdBy
    FROM training_sessions WHERE athlete_id = ? AND is_demo = 0
    ORDER BY session_date DESC, session_order DESC LIMIT ?`)
    .all(athleteId, limit) as SessionRow[];
}

export function parseSessionId(value: string): number | null {
  const id = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function insertSession(
  athleteId: number, row: SessionInput, source: string, createdBy: number
): number {
  const order = db.prepare('SELECT COALESCE(MAX(session_order), 0) + 1 AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?')
    .get(athleteId, row.date) as { value: number };
  const inserted = db.prepare(`INSERT INTO training_sessions
    (athlete_id, session_date, session_order, start_time, training_type, structure_type, intensity_zone,
     content, duration_min, distance_km, distance_reported, rpe, srpe, average_heart_rate,
     max_heart_rate, average_power_w, stroke_rate_spm, source, quality, is_demo, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', 0, ?)`)
    .run(athleteId, row.date, order.value, row.startTime, row.trainingType,
      row.trainingType, row.intensityZone, row.content, row.duration, row.distance ?? 0,
      row.distance === null ? 0 : 1, row.rpe, row.duration * row.rpe,
      row.averageHeartRate, row.maxHeartRate, row.averagePowerW, row.strokeRateSpm, source, createdBy);
  return Number(inserted.lastInsertRowid);
}

export function updateSession(athleteId: number, id: number, row: SessionInput, existing: SessionRow): void {
  // 日期变化时把课次排到新日期末尾，同日修改保持原有顺序。
  const order = row.date === existing.date
    ? null
    : db.prepare('SELECT COALESCE(MAX(session_order), 0) + 1 AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?').get(athleteId, row.date) as { value: number };
  db.prepare(`UPDATE training_sessions SET session_date = ?, session_order = COALESCE(?, session_order),
    start_time = ?, training_type = ?, structure_type = ?, intensity_zone = ?, content = ?,
    duration_min = ?, distance_km = ?, distance_reported = ?, rpe = ?, srpe = ?,
    average_heart_rate = ?, max_heart_rate = ?, average_power_w = ?, stroke_rate_spm = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND athlete_id = ?`).run(row.date, order?.value ?? null, row.startTime, row.trainingType,
    row.trainingType, row.intensityZone, row.content, row.duration, row.distance ?? 0,
    row.distance === null ? 0 : 1, row.rpe, row.duration * row.rpe,
    row.averageHeartRate, row.maxHeartRate, row.averagePowerW, row.strokeRateSpm, id, athleteId);
}
