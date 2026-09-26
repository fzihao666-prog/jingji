import type { Express, Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../core/auth.ts';
import { db } from '../core/db.ts';
import { hasAthleteAccess } from '../core/permissions.ts';
import { isValidIsoDate } from '../core/utils.ts';

const optionalNumber = (max: number) => z.union([z.string().max(20), z.number()]).optional()
  .transform((value) => value === '' || value === undefined ? null : Number(value))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= max));
const requiredNumber = (min: number, max: number) => z.union([z.string().max(20), z.number()])
  .transform(Number)
  .refine((value) => Number.isFinite(value) && value >= min && value <= max);

const sessionSchema = z.strictObject({
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

type SessionRow = {
  id: number; date: string; startTime: string; trainingType: string; intensityZone: string;
  content: string; duration: number; distance: number | null; rpe: number | null;
  averageHeartRate: number | null; maxHeartRate: number | null; averagePowerW: number | null;
  strokeRateSpm: number | null; source: string; createdBy: number | null;
};

function readSession(athleteId: number, id: number): SessionRow | undefined {
  return db.prepare(`SELECT id, session_date AS date, start_time AS startTime,
    training_type AS trainingType, intensity_zone AS intensityZone, content,
    duration_min AS duration, CASE WHEN distance_reported = 1 THEN distance_km ELSE NULL END AS distance, rpe,
    average_heart_rate AS averageHeartRate, max_heart_rate AS maxHeartRate,
    average_power_w AS averagePowerW, stroke_rate_spm AS strokeRateSpm,
    source, created_by AS createdBy
    FROM training_sessions WHERE id = ? AND athlete_id = ? AND is_demo = 0`)
    .get(id, athleteId) as SessionRow | undefined;
}

function ownAthleteId(req: Request): number | null {
  const user = req.authUser!;
  if (user.role !== 'ATL' || !user.athleteId || !hasAthleteAccess(user, user.athleteId)) return null;
  return user.athleteId;
}

function sessionId(value: string): number | null {
  const id = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function registerSelfTrainingRoutes(app: Express) {
  app.get('/api/me/training-sessions', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以查看训练填报。' });
    const rows = db.prepare(`SELECT id, session_date AS date, start_time AS startTime,
      training_type AS trainingType, intensity_zone AS intensityZone, content,
      duration_min AS duration, CASE WHEN distance_reported = 1 THEN distance_km ELSE NULL END AS distance, rpe,
      average_heart_rate AS averageHeartRate, max_heart_rate AS maxHeartRate,
      average_power_w AS averagePowerW, stroke_rate_spm AS strokeRateSpm,
      source, created_by AS createdBy
      FROM training_sessions WHERE athlete_id = ? AND is_demo = 0
      ORDER BY session_date DESC, session_order DESC LIMIT 200`).all(athleteId) as SessionRow[];
    res.json({ sessions: rows.map((row) => ({ ...row, editable: row.source === 'athlete_self_report' && row.createdBy === req.authUser!.id })) });
  });

  app.post('/api/me/training-sessions', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以填写训练记录。' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '训练内容、日期或数值格式无效。' });
    const row = parsed.data;
    const order = db.prepare('SELECT COALESCE(MAX(session_order), 0) + 1 AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?')
      .get(athleteId, row.date) as { value: number };
    const inserted = db.prepare(`INSERT INTO training_sessions
      (athlete_id, session_date, session_order, start_time, training_type, structure_type, intensity_zone,
       content, duration_min, distance_km, distance_reported, rpe, srpe, average_heart_rate,
       max_heart_rate, average_power_w, stroke_rate_spm, source, quality, is_demo, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'athlete_self_report', 'valid', 0, ?)`)
      .run(athleteId, row.date, order.value, row.startTime, row.trainingType,
        row.trainingType, row.intensityZone, row.content, row.duration, row.distance ?? 0,
        row.distance === null ? 0 : 1, row.rpe, row.duration * row.rpe,
        row.averageHeartRate, row.maxHeartRate, row.averagePowerW, row.strokeRateSpm, req.authUser!.id);
    const session = readSession(athleteId, Number(inserted.lastInsertRowid));
    return res.status(201).json({ session: { ...session, editable: true } });
  });

  app.put('/api/me/training-sessions/:id', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以修改训练填报。' });
    const id = sessionId(req.params.id as string);
    if (!id) return res.status(400).json({ message: '训练记录编号无效。' });
    const existing = readSession(athleteId, id);
    if (!existing) return res.status(404).json({ message: '训练记录不存在。' });
    if (existing.source !== 'athlete_self_report' || existing.createdBy !== req.authUser!.id)
      return res.status(403).json({ message: '只能修改本人填报的训练记录。' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '训练内容、日期或数值格式无效。' });
    const row = parsed.data;
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
    return res.json({ session: { ...readSession(athleteId, id), editable: true } });
  });

  app.delete('/api/me/training-sessions/:id', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以删除训练填报。' });
    const id = sessionId(req.params.id as string);
    if (!id) return res.status(400).json({ message: '训练记录编号无效。' });
    const existing = readSession(athleteId, id);
    if (!existing) return res.status(404).json({ message: '训练记录不存在。' });
    if (existing.source !== 'athlete_self_report' || existing.createdBy !== req.authUser!.id)
      return res.status(403).json({ message: '只能删除本人填报的训练记录。' });
    db.prepare('DELETE FROM training_sessions WHERE id = ? AND athlete_id = ?').run(id, athleteId);
    return res.json({ message: '训练记录已删除。' });
  });
}
