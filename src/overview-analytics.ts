import type { StrengthMetricKey } from '../shared/strength-model';
import type { StrengthTest, TrainingRecord } from './types';

export type DailyPerformancePoint = {
  date: string;
  label: string;
  srpe: number;
  smvl: number;
  duration: number;
  distance: number;
  rpe: number | null;
  sleep: number | null;
  fatigue: number | null;
  pulse: number | null;
  weight: number | null;
  participantCount: number;
};

export type LoadDiagnostics = {
  acuteLoad: number;
  chronicWeeklyLoad: number | null;
  acuteChronicRatio: number | null;
  monotony: number | null;
  strain: number | null;
  dataCoverage: number;
  recoveryScore: number | null;
};

export type RadarDimension = {
  key: string;
  label: string;
  score: number | null;
  basis: string;
};

const dayMs = 24 * 60 * 60 * 1000;

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function isoDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const result: string[] = [];
  for (let time = start; time <= end; time += dayMs) result.push(new Date(time).toISOString().slice(0, 10));
  return result;
}

function firstAvailable(rows: TrainingRecord[], key: 'sleepHours' | 'fatigueIndex' | 'morningPulse' | 'weightKg') {
  return rows.find((row) => typeof row[key] === 'number')?.[key] ?? null;
}

export function buildDailyPerformance(records: TrainingRecord[], from: string, to: string, mode: 'individual' | 'team' = 'individual', scopeAthleteCount = 1): DailyPerformancePoint[] {
  const byDate = new Map<string, TrainingRecord[]>();
  for (const record of records) byDate.set(record.date, [...(byDate.get(record.date) || []), record]);
  return isoDays(from, to).map((date) => {
    const rows = byDate.get(date) || [];
    const byAthlete = new Map<number, TrainingRecord[]>();
    for (const row of rows) byAthlete.set(row.athleteId, [...(byAthlete.get(row.athleteId) || []), row]);
    const athleteDays = [...byAthlete.values()];
    const divisor = mode === 'team' ? Math.max(1, scopeAthleteCount) : 1;
    return {
      date,
      label: date.slice(5).replace('-', '/'),
      srpe: rows.reduce((sum, row) => sum + row.srpe, 0) / divisor,
      smvl: rows.reduce((sum, row) => sum + row.smvl, 0) / divisor,
      duration: rows.reduce((sum, row) => sum + row.durationMin, 0) / divisor,
      distance: rows.reduce((sum, row) => sum + row.distanceKm, 0) / divisor,
      rpe: average(athleteDays.map((own) => average(own.map((row) => row.rpe)))),
      sleep: average(athleteDays.map((own) => firstAvailable(own, 'sleepHours'))),
      fatigue: average(athleteDays.map((own) => firstAvailable(own, 'fatigueIndex'))),
      pulse: average(athleteDays.map((own) => firstAvailable(own, 'morningPulse'))),
      weight: average(athleteDays.map((own) => firstAvailable(own, 'weightKg'))),
      participantCount: byAthlete.size
    };
  });
}

export function calculateLoadDiagnostics(records: TrainingRecord[], points: DailyPerformancePoint[]): LoadDiagnostics {
  const recent = points.slice(-7);
  const previous = points.slice(-28, -7);
  const acuteLoad = recent.reduce((sum, point) => sum + point.srpe, 0);
  const chronicWeeklyLoad = previous.length >= 14
    ? previous.reduce((sum, point) => sum + point.srpe, 0) / previous.length * 7
    : null;
  const acuteChronicRatio = chronicWeeklyLoad && chronicWeeklyLoad > 0 ? acuteLoad / chronicWeeklyLoad : null;
  const dailyLoads = recent.map((point) => point.srpe);
  const dailyMean = average(dailyLoads) || 0;
  const variance = dailyLoads.length ? dailyLoads.reduce((sum, value) => sum + (value - dailyMean) ** 2, 0) / dailyLoads.length : 0;
  const deviation = Math.sqrt(variance);
  const monotony = deviation > 0 ? dailyMean / deviation : null;
  const strain = monotony === null ? null : acuteLoad * monotony;
  const training = records.filter((record) => record.status !== 'rest');
  const athleteDays = new Map<string, TrainingRecord[]>();
  for (const record of records) {
    const key = `${record.athleteId}:${record.date}`;
    athleteDays.set(key, [...(athleteDays.get(key) || []), record]);
  }
  const tracked = [
    ...training.map((record) => record.rpe),
    ...[...athleteDays.values()].flatMap((rows) => [
      firstAvailable(rows, 'morningPulse'), firstAvailable(rows, 'weightKg'),
      firstAvailable(rows, 'sleepHours'), firstAvailable(rows, 'fatigueIndex')
    ])
  ];
  const available = tracked.filter((value) => typeof value === 'number' && Number.isFinite(value)).length;
  const dataCoverage = tracked.length ? available / tracked.length * 100 : 0;
  const recoveryParts = [...athleteDays.values()].flatMap((rows) => {
    const parts: number[] = [];
    const sleep = firstAvailable(rows, 'sleepHours');
    const fatigue = firstAvailable(rows, 'fatigueIndex');
    if (typeof sleep === 'number') parts.push(clamp(sleep / 8 * 100));
    if (typeof fatigue === 'number') parts.push(clamp((10 - fatigue) / 9 * 100));
    if (rows.some((record) => record.status === 'alert')) parts.push(30);
    else if (rows.some((record) => record.status === 'attention')) parts.push(65);
    else if (rows.some((record) => record.status === 'normal' || record.status === 'rest')) parts.push(100);
    return parts;
  });
  return {
    acuteLoad,
    chronicWeeklyLoad,
    acuteChronicRatio,
    monotony,
    strain,
    dataCoverage,
    recoveryScore: average(recoveryParts)
  };
}

function targetScore(test: StrengthTest | undefined, keys: StrengthMetricKey[]) {
  if (!test) return null;
  const ratios = keys.flatMap((key) => {
    const value = test.metrics[key];
    const target = test.targets[key];
    return typeof value === 'number' && typeof target === 'number' && target > 0 ? [clamp(value / target * 100)] : [];
  });
  return average(ratios);
}

function symmetryScore(test: StrengthTest | undefined) {
  if (!test) return null;
  const pairs: Array<[StrengthMetricKey, StrengthMetricKey]> = [
    ['leftPlankSec', 'rightPlankSec'],
    ['leftSingleLegSquatReps', 'rightSingleLegSquatReps'],
    ['leftGripKgf', 'rightGripKgf']
  ];
  const scores = pairs.flatMap(([leftKey, rightKey]) => {
    const left = test.metrics[leftKey];
    const right = test.metrics[rightKey];
    if (typeof left !== 'number' || typeof right !== 'number' || Math.max(left, right) <= 0) return [];
    return [clamp(100 - Math.abs(left - right) / Math.max(left, right) * 100)];
  });
  return average(scores);
}

export function buildPerformanceRadar(latest: StrengthTest | undefined, diagnostics: LoadDiagnostics): RadarDimension[] {
  return [
    {
      key: 'strength', label: '最大力量',
      score: targetScore(latest, ['benchPressKg', 'benchPullKg', 'squatKg', 'deadliftKg']),
      basis: '卧推、卧拉、深蹲、硬拉相对教练目标'
    },
    {
      key: 'power', label: '爆发功率',
      score: targetScore(latest, ['verticalJumpCm', 'highPullKg']),
      basis: '纵跳与高拉相对教练目标'
    },
    {
      key: 'core', label: '核心稳定',
      score: targetScore(latest, ['frontPlankSec', 'leftPlankSec', 'rightPlankSec']),
      basis: '正面及双侧支撑相对教练目标'
    },
    {
      key: 'endurance', label: '力量耐力',
      score: targetScore(latest, ['pullUpsReps', 'benchPress2MinReps', 'benchPull2MinReps']),
      basis: '引体向上与2分钟力量耐力测试'
    },
    {
      key: 'symmetry', label: '左右对称',
      score: symmetryScore(latest),
      basis: '双侧支撑、单腿蹲及握力差异'
    },
    {
      key: 'recovery', label: '恢复状态', score: diagnostics.recoveryScore,
      basis: '睡眠、疲劳及教练状态标记综合监测'
    }
  ].map((item) => ({ ...item, score: item.score === null ? null : Math.round(item.score) }));
}

export function strengthChangeRows(tests: StrengthTest[]) {
  const latest = tests[0];
  const previous = tests[1];
  if (!latest) return [];
  const metrics: Array<[StrengthMetricKey, string, string]> = [
    ['verticalJumpCm', '纵跳', 'cm'],
    ['benchPressKg', '卧推', 'kg'],
    ['benchPullKg', '卧拉', 'kg'],
    ['squatKg', '深蹲', 'kg'],
    ['deadliftKg', '硬拉', 'kg'],
    ['highPullKg', '高拉', 'kg'],
    ['pullUpsReps', '引体', '次'],
    ['frontPlankSec', '核心', 's']
  ];
  return metrics.flatMap(([key, label, unit]) => {
    const current = latest.metrics[key];
    if (typeof current !== 'number') return [];
    const before = previous?.metrics[key];
    const change = typeof before === 'number' && before !== 0 ? (current - before) / before * 100 : null;
    return [{ key, label, unit, current, previous: typeof before === 'number' ? before : null, change }];
  });
}

export function relativeStrengthRows(tests: StrengthTest[]) {
  const latest = tests[0];
  const previous = tests[1];
  if (!latest || !latest.metrics.weightKg) return [];
  const metrics: Array<[StrengthMetricKey, string]> = [
    ['benchPressKg', '卧推'], ['benchPullKg', '卧拉'], ['squatKg', '深蹲'], ['deadliftKg', '硬拉']
  ];
  return metrics.flatMap(([key, label]) => {
    const current = latest.metrics[key];
    if (typeof current !== 'number') return [];
    const previousValue = previous?.metrics[key];
    const previousWeight = previous?.metrics.weightKg;
    return [{
      label,
      current: current / latest.metrics.weightKg!,
      previous: typeof previousValue === 'number' && typeof previousWeight === 'number' && previousWeight > 0
        ? previousValue / previousWeight
        : null
    }];
  });
}
