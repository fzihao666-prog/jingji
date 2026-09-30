import { db } from '../core/db.ts';

export type WellnessRow = {
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

export type WellnessInput = {
  sleepHours: number | null;
  sleepQuality: number | null;
  morningPulse: number | null;
  weightKg: number | null;
  fatigueIndex: number | null;
  sorenessIndex: number | null;
  moodIndex: number | null;
  status?: string;
};

export function readWellness(athleteId: number, date: string): WellnessRow | null {
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

// 按 (athlete_id, wellness_date) 幂等 upsert：同日重复提交只保留一条。
export function upsertWellness(athleteId: number, date: string, row: WellnessInput, source: string): void {
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
    source
  );
}
