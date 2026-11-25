import type { DatabaseSync } from 'node:sqlite';
import { beijingDate } from './coach-daily-todos.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
// 基线窗口：近 28 天；预警窗口：近 3 天。
const BASELINE_DAYS = 28;
const ALERT_DAYS = 3;
// 偏离阈值：超过 1 个标准差视为显著偏离。
const DEVIATION_THRESHOLD = 1.0;

type WellnessRow = {
  athleteId: number;
  date: string;
  sleepHours: number | null;
  morningPulse: number | null;
  weightKg: number | null;
  fatigueIndex: number | null;
  sorenessIndex: number | null;
  moodIndex: number | null;
};

type AthleteInfo = {
  athleteId: number;
  athleteName: string;
  team: string;
};

type MetricDef = {
  key: keyof WellnessRow;
  label: string;
  unit: string;
  // 越高越差的指标（疲劳、酸痛），正偏离 = 恶化
  higherIsWorse: boolean;
};

const METRICS: MetricDef[] = [
  { key: 'sleepHours', label: '睡眠时长', unit: '小时', higherIsWorse: false },
  { key: 'morningPulse', label: '晨脉', unit: 'bpm', higherIsWorse: true },
  { key: 'fatigueIndex', label: '疲劳程度', unit: '分', higherIsWorse: true },
  { key: 'sorenessIndex', label: '酸痛程度', unit: '分', higherIsWorse: true },
  { key: 'moodIndex', label: '心情', unit: '分', higherIsWorse: false },
];

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

/**
 * 计算运动员个人基线偏离预警。
 * 对每个指标：比较近 3 天均值与 28 天基线的偏离程度（以标准差为单位）。
 * 偏离超过阈值且方向为"恶化"时触发预警。
 */
export function buildWellnessBaseline(input: {
  athletes: AthleteInfo[];
  wellness: WellnessRow[];
  now: Date;
}) {
  const { athletes, now } = input;
  const today = beijingDate(now);
  const baselineStart = beijingDate(new Date(now.getTime() - (BASELINE_DAYS - 1) * DAY_MS));
  const alertStart = beijingDate(new Date(now.getTime() - (ALERT_DAYS - 1) * DAY_MS));

  // 按运动员分组
  const byAthlete = new Map<number, WellnessRow[]>();
  for (const row of input.wellness) {
    if (!byAthlete.has(row.athleteId)) byAthlete.set(row.athleteId, []);
    byAthlete.get(row.athleteId)!.push(row);
  }

  const alerts: Array<{
    athleteId: number;
    athleteName: string;
    team: string;
    metric: string;
    metricLabel: string;
    unit: string;
    currentAvg: number;
    baselineAvg: number;
    deviation: number;
    direction: 'up' | 'down';
    severity: 'warn' | 'alert';
    message: string;
  }> = [];

  const rows = athletes.map((athlete) => {
    const records = (byAthlete.get(athlete.athleteId) || []).filter(
      (r) => r.date >= baselineStart && r.date <= today
    );
    const alertRecords = records.filter((r) => r.date >= alertStart);

    const metricResults = METRICS.map((metric) => {
      const baselineValues = records
        .map((r) => r[metric.key])
        .filter((v): v is number => v !== null && Number.isFinite(v));
      const alertValues = alertRecords
        .map((r) => r[metric.key])
        .filter((v): v is number => v !== null && Number.isFinite(v));

      const baselineAvg = mean(baselineValues);
      const currentAvg = mean(alertValues);
      const sd = stddev(baselineValues);

      // 无足够基线数据时不预警
      if (baselineValues.length < 5 || alertValues.length < 2) {
        return { ...metric, currentAvg, baselineAvg, deviation: 0, flagged: false };
      }

      const deviation = sd > 0 ? (currentAvg - baselineAvg) / sd : 0;
      const isWorse = metric.higherIsWorse ? deviation > 0 : deviation < 0;
      const absDeviation = Math.abs(deviation);
      const flagged = isWorse && absDeviation >= DEVIATION_THRESHOLD;

      if (flagged) {
        const direction = deviation > 0 ? 'up' : 'down';
        const severity = absDeviation >= 2 ? 'alert' : 'warn';
        const arrow = direction === 'up' ? '↑' : '↓';
        alerts.push({
          athleteId: athlete.athleteId,
          athleteName: athlete.athleteName,
          team: athlete.team,
          metric: metric.key as string,
          metricLabel: metric.label,
          unit: metric.unit,
          currentAvg: Math.round(currentAvg * 10) / 10,
          baselineAvg: Math.round(baselineAvg * 10) / 10,
          deviation: Math.round(absDeviation * 100) / 100,
          direction,
          severity,
          message: `${metric.label}近${ALERT_DAYS}天 ${arrow}${Math.round(absDeviation * 100) / 100}σ（当前 ${Math.round(currentAvg * 10) / 10}${metric.unit}，基线 ${Math.round(baselineAvg * 10) / 10}${metric.unit}）`,
        });
      }

      return {
        ...metric,
        currentAvg: Math.round(currentAvg * 10) / 10,
        baselineAvg: Math.round(baselineAvg * 10) / 10,
        deviation: Math.round(deviation * 100) / 100,
        flagged,
      };
    });

    return {
      athleteId: athlete.athleteId,
      athleteName: athlete.athleteName,
      team: athlete.team,
      metrics: metricResults.map((m) => ({
        key: m.key as string,
        label: m.label,
        unit: m.unit,
        currentAvg: m.currentAvg,
        baselineAvg: m.baselineAvg,
        deviation: m.deviation,
        flagged: m.flagged,
      })),
    };
  });

  return {
    date: today,
    timezone: 'Asia/Shanghai',
    generatedAt: now.toISOString(),
    baselineDays: BASELINE_DAYS,
    alertDays: ALERT_DAYS,
    summary: {
      total: rows.length,
      alerted: new Set(alerts.map((a) => a.athleteId)).size,
      alertCount: alerts.length,
    },
    alerts: alerts.sort((a, b) => b.deviation - a.deviation),
    athletes: rows,
  };
}

export function readWellnessBaseline(
  db: DatabaseSync,
  input: { athleteIds: number[]; project: string; now: Date }
) {
  if (!input.athleteIds.length) {
    return buildWellnessBaseline({ athletes: [], wellness: [], now: input.now });
  }
  const athletes = db
    .prepare(
      `
    SELECT a.id AS athleteId, a.name AS athleteName, COALESCE(pt.name, a.team, '') AS team
    FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
    WHERE a.active = 1 AND a.project = ? AND a.id IN (${input.athleteIds.map(() => '?').join(',')})
    ORDER BY a.name, a.id
  `
    )
    .all(input.project, ...input.athleteIds) as AthleteInfo[];
  if (!athletes.length) {
    return buildWellnessBaseline({ athletes, wellness: [], now: input.now });
  }
  const ids = athletes.map((a) => a.athleteId);
  const placeholders = ids.map(() => '?').join(',');
  const wellness = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, wellness_date AS date,
      sleep_hours AS sleepHours, morning_pulse AS morningPulse,
      weight_kg AS weightKg, fatigue_index AS fatigueIndex,
      soreness_index AS sorenessIndex, mood_index AS moodIndex
    FROM daily_wellness
    WHERE athlete_id IN (${placeholders}) AND wellness_date BETWEEN ? AND ?
  `
    )
    .all(
      ...ids,
      beijingDate(new Date(input.now.getTime() - (BASELINE_DAYS - 1) * DAY_MS)),
      beijingDate(input.now)
    ) as WellnessRow[];
  return buildWellnessBaseline({ athletes, wellness, now: input.now });
}
