import type { Express, Request } from 'express';
import { requireAuth } from '../core/auth.ts';
import { db } from '../core/db.ts';
import { hasAthleteAccess } from '../core/permissions.ts';
import { readTodayStatus, beijingDate } from '../core/coach-daily-todos.ts';
import {
  WELLNESS_SOURCE,
  firstIssueMessage,
  wellnessQuerySchema,
  wellnessWriteSchema,
  wellnessWindow,
} from './self-daily-service.ts';

type WellnessRow = {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  morningPulse: number | null;
  weightKg: number | null;
  fatigueIndex: number | null;
  sorenessIndex: number | null;
  moodIndex: number | null;
  status: string;
  source: string;
  updatedAt: string;
};

function ownAthleteId(req: Request): number | null {
  const user = req.authUser!;
  if (user.role !== 'ATL' || !user.athleteId || !hasAthleteAccess(user, user.athleteId)) return null;
  return user.athleteId;
}

function readWellness(athleteId: number, date: string): WellnessRow | null {
  const row = db
    .prepare(
      `SELECT wellness_date AS date, sleep_hours AS sleepHours, sleep_quality AS sleepQuality,
        morning_pulse AS morningPulse, weight_kg AS weightKg, fatigue_index AS fatigueIndex,
        soreness_index AS sorenessIndex, mood_index AS moodIndex, status, source, updated_at AS updatedAt
       FROM daily_wellness WHERE athlete_id = ? AND wellness_date = ?`
    )
    .get(athleteId, date) as WellnessRow | undefined;
  return row || null;
}

export function registerSelfDailyRoutes(app: Express) {
  app.get('/api/me/today-status', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以查看今日状态。' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(readTodayStatus(db, { athleteId, now: new Date() }));
  });

  app.get('/api/me/today-sessions', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以查看今日训练。' });
    const date = beijingDate(new Date());
    const sessions = db
      .prepare(
        `SELECT id, session_order AS sessionOrder, start_time AS startTime,
          training_type AS trainingType, structure_type AS structureType,
          intensity_zone AS intensityZone, content,
          duration_min AS durationMin, distance_km AS distanceKm,
          rpe, srpe, average_heart_rate AS averageHeartRate,
          max_heart_rate AS maxHeartRate, source, quality
         FROM training_sessions
         WHERE athlete_id = ? AND session_date = ?
         ORDER BY session_order`
      )
      .all(athleteId, date) as Array<{
        id: number; sessionOrder: number; startTime: string;
        trainingType: string; structureType: string; intensityZone: string;
        content: string; durationMin: number; distanceKm: number;
        rpe: number | null; srpe: number; averageHeartRate: number | null;
        maxHeartRate: number | null; source: string; quality: string;
      }>;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ date, sessions });
  });

  app.get('/api/me/wellness', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以查看恢复日报。' });
    const parsed = wellnessQuerySchema(new Date()).safeParse(req.query);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: firstIssueMessage(parsed.error, '恢复日报日期无效。') });
    const date = parsed.data.date || wellnessWindow(new Date()).today;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ date, record: readWellness(athleteId, date) });
  });

  app.post('/api/me/wellness', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以填写恢复日报。' });
    const parsed = wellnessWriteSchema(new Date()).safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: firstIssueMessage(parsed.error, '恢复日报内容格式无效。') });
    const row = parsed.data;
    const date = row.date || wellnessWindow(new Date()).today;
    // 按 (athlete_id, wellness_date) 幂等 upsert：同日重复提交只保留一条。
    db.prepare(
      `INSERT INTO daily_wellness
        (athlete_id, wellness_date, sleep_hours, sleep_quality, morning_pulse, weight_kg,
         fatigue_index, soreness_index, mood_index, status, source, quality, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', 0)
       ON CONFLICT(athlete_id, wellness_date) DO UPDATE SET
         sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
         morning_pulse = excluded.morning_pulse, weight_kg = excluded.weight_kg,
         fatigue_index = excluded.fatigue_index, soreness_index = excluded.soreness_index,
         mood_index = excluded.mood_index, status = excluded.status,
         source = excluded.source, quality = 'valid', is_demo = 0, updated_at = CURRENT_TIMESTAMP`
    ).run(
      athleteId,
      date,
      row.sleepHours,
      row.sleepQuality,
      row.morningPulse,
      row.weightKg,
      row.fatigueIndex,
      row.sorenessIndex,
      row.moodIndex,
      row.status || 'normal',
      WELLNESS_SOURCE
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ date, record: readWellness(athleteId, date) });
  });
}
