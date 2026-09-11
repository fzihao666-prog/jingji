import { summarizeDailyRpe } from './rpe-statistics.ts';
import { db } from './db.ts';
import { STRENGTH_INTENSITY_ZONES } from '../shared/strength-training.ts';
import { trainingLoadCategory } from '../shared/training-content-category.ts';

const zones = STRENGTH_INTENSITY_ZONES;

type SessionRow = {
  id: number;
  athleteId: number;
  athleteName: string;
  project: string;
  teamId: number | null;
  team: string;
  province: string;
  city: string;
  county: string;
  date: string;
  sessionOrder: number;
  startTime: string;
  trainingType: string;
  structureType: string;
  intensityZone: string;
  content: string;
  durationMin: number;
  distanceKm: number;
  durationReported: number;
  distanceReported: number;
  rpe: number | null;
  srpe: number;
  smvl: number;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  averagePowerW: number | null;
  strokeRateSpm: number | null;
  sessionSource: string;
  sessionQuality: string;
  sessionDemo: number;
  morningPulse: number | null;
  weightKg: number | null;
  sleepHours: number | null;
  fatigueIndex: number | null;
  status: string | null;
  wellnessSource: string | null;
  wellnessQuality: string | null;
  wellnessDemo: number | null;
  updatedAt: string;
};

type MeasurementRow = {
  sessionId: number;
  athleteId: number;
  testDate: string;
  testType: string;
  testSource: string;
  testDemo: number;
  code: string;
  label: string;
  domain: string;
  value: number;
  target: number | null;
  unit: string;
  quality: string;
  source: string;
  isDemo: number;
};

type ProfileRow = {
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  gender: string;
  athletePosition: string;
  bestResult: string;
  technicalLevel: string;
  currentEvent: string;
  originUnit: string;
  province: string;
  city: string;
  county: string;
  originSource: string;
  originIsDemo: number;
  birthDate: string | null;
  startSportDate: string;
};

type BodyRow = {
  athleteId: number;
  measurementDate: string;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  skeletalMuscleKg: number | null;
  muscleMassKg: number | null;
  upperLimbMuscleKg: number | null;
  lowerLimbMuscleKg: number | null;
  trunkMuscleKg: number | null;
  subcutaneousFatMm: number | null;
  tricepsSkinfoldMm: number | null;
  abdominalSkinfoldMm: number | null;
  thighSkinfoldMm: number | null;
  calfSkinfoldMm: number | null;
  visceralFatLevel: number | null;
  basalMetabolismKcal: number | null;
  totalBodyWaterKg: number | null;
  ecwTbwRatio: number | null;
  phaseAngleDeg: number | null;
  visceralFatAreaCm2: number | null;
  leftArmLeanKg: number | null;
  rightArmLeanKg: number | null;
  trunkLeanKg: number | null;
  leftLegLeanKg: number | null;
  rightLegLeanKg: number | null;
  note: string;
  source: string;
  isDemo: number;
};

type CompetitiveRow = {
  athleteId: number;
  assessmentDate: string;
  competitiveScore: number;
  competitiveLevel: 'peak' | 'good' | 'build' | 'adjust';
  endurance: number | null;
  power: number | null;
  technique: number | null;
  loadAdaptation: number | null;
  recovery: number | null;
  competition: number | null;
  source: string;
  isDemo: number;
};

function emptyBreakdown() {
  return {
    waterMinutes: 0,
    ergMinutes: 0,
    landMinutes: { functional: 0, endurance: 0, maxStrength: 0, speedStrength: 0, recovery: 0, running: 0, other: 0 },
    waterDistanceByZone: Object.fromEntries(zones.map((zone) => [zone, 0])),
    waterTimeByZone: Object.fromEntries(zones.map((zone) => [zone, 0])),
    ergDistanceByZone: Object.fromEntries(zones.map((zone) => [zone, 0]))
  };
}

function sessionBreakdown(row: SessionRow) {
  const breakdown = emptyBreakdown();
  if (zones.includes(row.intensityZone as typeof zones[number]) && row.trainingType === '专项训练') {
    breakdown.waterMinutes = row.durationMin;
    breakdown.waterDistanceByZone[row.intensityZone] = row.distanceKm;
    breakdown.waterTimeByZone[row.intensityZone] = row.durationMin;
  } else if (row.structureType === '最大力量') breakdown.landMinutes.maxStrength = row.durationMin;
  else if (row.structureType === '速度力量') breakdown.landMinutes.speedStrength = row.durationMin;
  else if (row.structureType === '功能训练') breakdown.landMinutes.functional = row.durationMin;
  else if (row.structureType === '再生恢复') breakdown.landMinutes.recovery = row.durationMin;
  else breakdown.landMinutes.other = row.durationMin;
  return breakdown;
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function round(value: number | null, digits = 2) {
  return value === null ? null : Number(value.toFixed(digits));
}

function emptyTrainingVolume() {
  return {
    days: [], totalDurationMin: null, totalDistanceKm: null,
    averageDurationMin: null, averageDistanceKm: null,
    durationDayCount: 0, distanceDayCount: 0
  };
}

function teamDurationSessions(sessions: SessionRow[], individual: boolean) {
  if (individual) return sessions;
  const grouped = new Map<string, SessionRow>();
  for (const row of sessions) {
    if (row.sessionDemo) continue;
    // 以同队同日同一开训时段识别共同训练；团队时长、距离和训练负荷均只保留一条代表记录。
    const scope = row.teamId === null ? `athlete:${row.athleteId}` : `team:${row.teamId}`;
    const activity = `${row.trainingType}|${row.structureType}|${row.content}`.trim();
    const slot = row.startTime.trim()
      ? `start:${row.startTime.trim()}`
      : row.content.trim() ? `activity:${activity}` : `order:${row.sessionOrder}|${activity}`;
    const key = `${scope}|${row.date}|${slot}`;
    const current = grouped.get(key);
    if (!current || (row.durationReported && (!current.durationReported || row.durationMin > current.durationMin))) grouped.set(key, row);
  }
  return [...grouped.values()];
}

function aggregateTrainingVolume(sessions: SessionRow[], individual: boolean) {
  const byDate = new Map<string, { date: string; durationMin: number; distanceKm: number; durationCount: number; distanceCount: number; sessionCount: number }>();
  const durationSessions = teamDurationSessions(sessions, individual);
  for (const session of durationSessions) {
    if (session.sessionDemo) continue;
    const row = byDate.get(session.date) || { date: session.date, durationMin: 0, distanceKm: 0, durationCount: 0, distanceCount: 0, sessionCount: 0 };
    row.sessionCount += 1;
    if (session.durationReported) { row.durationMin += session.durationMin; row.durationCount += 1; }
    byDate.set(session.date, row);
  }
  for (const session of durationSessions) {
    if (session.sessionDemo) continue;
    const row = byDate.get(session.date) || { date: session.date, durationMin: 0, distanceKm: 0, durationCount: 0, distanceCount: 0, sessionCount: 0 };
    if (session.distanceReported) { row.distanceKm += session.distanceKm; row.distanceCount += 1; }
    byDate.set(session.date, row);
  }
  const days = [...byDate.values()].map((row) => ({
    date: row.date,
    durationMin: row.durationCount ? round(row.durationMin, 1) : null,
    distanceKm: row.distanceCount ? round(row.distanceKm, 1) : null,
    sessionCount: row.sessionCount
  }));
  const durationDays = days.filter((row) => row.durationMin !== null);
  const distanceDays = days.filter((row) => row.distanceKm !== null);
  const totalDurationMin = durationDays.length ? round(durationDays.reduce((sum, row) => sum + Number(row.durationMin), 0), 1) : null;
  const totalDistanceKm = distanceDays.length ? round(distanceDays.reduce((sum, row) => sum + Number(row.distanceKm), 0), 1) : null;
  return {
    days,
    totalDurationMin,
    totalDistanceKm,
    averageDurationMin: totalDurationMin === null ? null : round(totalDurationMin / durationDays.length, 1),
    averageDistanceKm: totalDistanceKm === null ? null : round(totalDistanceKm / distanceDays.length, 1),
    durationDayCount: durationDays.length,
    distanceDayCount: distanceDays.length
  };
}

function emptyTrainingAnalytics() {
  return {
    summary: {
      totalDurationMin: null as number | null,
      testSessionCount: 0,
      testedAthleteCount: 0,
      recoveryDurationMin: null as number | null,
      specialDurationMin: null as number | null,
      specialDistanceKm: null as number | null,
      physicalDurationMin: null as number | null,
      physicalLoad: null as number | null,
      rpeAverage: null as number | null,
      rpeHighest: null as number | null,
      rpeLowest: null as number | null
    },
    days: [] as Array<{
      date: string;
      physicalDurationMin: number | null;
      physicalLoad: number | null;
      specialDurationMin: number | null;
      specialDistanceKm: number | null;
      averageRpe: number | null;
      stdRpe: number | null;
      lowerRpe: number | null;
      upperRpe: number | null;
      rpeCount: number;
      morningPulse: number | null;
      averageHeartRate: number | null;
    }>
  };
}

function aggregateTrainingAnalytics(sessions: SessionRow[], individual: boolean) {
  const actualSessions = sessions.filter((row) => !row.sessionDemo);
  const durationSessions = teamDurationSessions(actualSessions, individual);
  const days = new Map<string, {
    date: string;
    physicalDurationMin: number; physicalDurationCount: number;
    physicalLoad: number; physicalLoadCount: number;
    specialDurationMin: number; specialDurationCount: number;
    specialDistanceKm: number; specialDistanceCount: number;
    rpe: Array<{ athleteId: number; rpe: number }>; morningPulse: number[]; averageHeartRate: number[];
    wellnessKeys: Set<string>;
  }>();
  const totals = {
    totalDurationMin: 0, totalDurationCount: 0,
    recoveryDurationMin: 0, recoveryDurationCount: 0,
    specialDurationMin: 0, specialDurationCount: 0,
    specialDistanceKm: 0, specialDistanceCount: 0,
    physicalDurationMin: 0, physicalDurationCount: 0,
    physicalLoad: 0, physicalLoadCount: 0,
    rpe: [] as number[]
  };
  const getDay = (row: SessionRow) => days.get(row.date) || {
    date: row.date,
    physicalDurationMin: 0, physicalDurationCount: 0,
    physicalLoad: 0, physicalLoadCount: 0,
    specialDurationMin: 0, specialDurationCount: 0,
    specialDistanceKm: 0, specialDistanceCount: 0,
    rpe: [], morningPulse: [], averageHeartRate: [], wellnessKeys: new Set<string>()
  };
  for (const row of durationSessions) {
    const day = getDay(row);
    const category = trainingLoadCategory(row);
    if (category === 'physical' && Number.isFinite(row.srpe)) {
      day.physicalLoad += row.srpe;
      day.physicalLoadCount += 1;
      totals.physicalLoad += row.srpe;
      totals.physicalLoadCount += 1;
    }
    if (category === 'special' && row.distanceReported) {
      day.specialDistanceKm += row.distanceKm;
      day.specialDistanceCount += 1;
      totals.specialDistanceKm += row.distanceKm;
      totals.specialDistanceCount += 1;
    }
    days.set(row.date, day);
  }
  for (const row of actualSessions) {
    const day = getDay(row);
    if (row.rpe !== null && Number.isFinite(row.rpe)) {
      day.rpe.push({ athleteId: row.athleteId, rpe: row.rpe });
      totals.rpe.push(row.rpe);
    }
    if (row.averageHeartRate !== null && Number.isFinite(row.averageHeartRate)) day.averageHeartRate.push(row.averageHeartRate);
    const wellnessKey = `${row.athleteId}:${row.date}`;
    if (!row.wellnessDemo && !day.wellnessKeys.has(wellnessKey) && row.morningPulse !== null && Number.isFinite(row.morningPulse)) {
      day.morningPulse.push(row.morningPulse);
      day.wellnessKeys.add(wellnessKey);
    }
    days.set(row.date, day);
  }
  for (const row of durationSessions) {
    const day = days.get(row.date) || {
      date: row.date,
      physicalDurationMin: 0, physicalDurationCount: 0,
      physicalLoad: 0, physicalLoadCount: 0,
      specialDurationMin: 0, specialDurationCount: 0,
      specialDistanceKm: 0, specialDistanceCount: 0,
      rpe: [], morningPulse: [], averageHeartRate: [], wellnessKeys: new Set<string>()
    };
    if (row.durationReported) {
      totals.totalDurationMin += row.durationMin;
      totals.totalDurationCount += 1;
    }
    const category = trainingLoadCategory(row);
    if (category === 'physical' && row.durationReported) {
      day.physicalDurationMin += row.durationMin;
      day.physicalDurationCount += 1;
      totals.physicalDurationMin += row.durationMin;
      totals.physicalDurationCount += 1;
    }
    if (category === 'special' && row.durationReported) {
      day.specialDurationMin += row.durationMin;
      day.specialDurationCount += 1;
      totals.specialDurationMin += row.durationMin;
      totals.specialDurationCount += 1;
    }
    if (category === 'recovery' && row.durationReported) {
      totals.recoveryDurationMin += row.durationMin;
      totals.recoveryDurationCount += 1;
    }
    days.set(row.date, day);
  }
  const value = (sum: number, count: number) => count ? round(sum, 1) : null;
  return {
    summary: {
      totalDurationMin: value(totals.totalDurationMin, totals.totalDurationCount),
      testSessionCount: 0,
      testedAthleteCount: 0,
      recoveryDurationMin: value(totals.recoveryDurationMin, totals.recoveryDurationCount),
      specialDurationMin: value(totals.specialDurationMin, totals.specialDurationCount),
      specialDistanceKm: value(totals.specialDistanceKm, totals.specialDistanceCount),
      physicalDurationMin: value(totals.physicalDurationMin, totals.physicalDurationCount),
      physicalLoad: value(totals.physicalLoad, totals.physicalLoadCount),
      rpeAverage: average(totals.rpe) === null ? null : round(average(totals.rpe), 1),
      rpeHighest: totals.rpe.length ? round(Math.max(...totals.rpe), 1) : null,
      rpeLowest: totals.rpe.length ? round(Math.min(...totals.rpe), 1) : null
    },
    days: [...days.values()].map((day) => ({
      date: day.date,
      physicalDurationMin: value(day.physicalDurationMin, day.physicalDurationCount),
      physicalLoad: value(day.physicalLoad, day.physicalLoadCount),
      specialDurationMin: value(day.specialDurationMin, day.specialDurationCount),
      specialDistanceKm: value(day.specialDistanceKm, day.specialDistanceCount),
      ...summarizeDailyRpe(day.rpe),
      morningPulse: average(day.morningPulse) === null ? null : round(average(day.morningPulse), 1),
      averageHeartRate: average(day.averageHeartRate) === null ? null : round(average(day.averageHeartRate), 1)
    }))
  };
}

function ageAt(birthDate: string | null, date: string) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(target.getTime())) return null;
  let age = target.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed = target.getUTCMonth() > birth.getUTCMonth()
    || (target.getUTCMonth() === birth.getUTCMonth() && target.getUTCDate() >= birth.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : null;
}

type PhysiologyMetricCode = 'blood_lactate_mmol' | 'creatine_kinase_u_l' | 'blood_urea_n_mmol_l' | 'hemoglobin_g_l' | 'hrv_rmssd_ms' | 'resting_heart_rate_bpm';
type PhysiologyStatus = 'NORMAL' | 'FLUCTUATION' | 'ATTENTION' | 'ABNORMAL' | 'MISSING';

const physiologyMetricDefinitions: Array<{ code: PhysiologyMetricCode; label: string; unit: string; direction: 'higher' | 'lower'; thresholds: [number, number, number]; baseline: number }> = [
  { code: 'blood_lactate_mmol', label: '血乳酸 Lactate', unit: 'mmol/L', direction: 'higher', thresholds: [2.5, 4, 6], baseline: 1.9 },
  { code: 'creatine_kinase_u_l', label: '肌酸激酶 CK', unit: 'U/L', direction: 'higher', thresholds: [300, 500, 700], baseline: 240 },
  { code: 'blood_urea_n_mmol_l', label: '血尿素 BUN', unit: 'mmol/L', direction: 'higher', thresholds: [6, 8, 10], baseline: 4.9 },
  { code: 'hemoglobin_g_l', label: '血红蛋白 Hb', unit: 'g/L', direction: 'lower', thresholds: [130, 120, 110], baseline: 145 },
  { code: 'hrv_rmssd_ms', label: '心率变异性 HRV', unit: 'ms', direction: 'lower', thresholds: [55, 40, 30], baseline: 66 },
  { code: 'resting_heart_rate_bpm', label: '静息心率 RHR', unit: 'bpm', direction: 'higher', thresholds: [60, 70, 80], baseline: 53 }
];

function calendarDays(from: string, to: string) {
  const count = Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
  const cursor = new Date(`${to}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const current = new Date(cursor);
    current.setUTCDate(cursor.getUTCDate() - (count - 1 - index));
    return current.toISOString().slice(0, 10);
  });
}

function physiologyStatus(definition: typeof physiologyMetricDefinitions[number], value: number): Exclude<PhysiologyStatus, 'MISSING'> {
  const [fluctuation, attention, abnormal] = definition.thresholds;
  if (definition.direction === 'higher') return value >= abnormal ? 'ABNORMAL' : value >= attention ? 'ATTENTION' : value >= fluctuation ? 'FLUCTUATION' : 'NORMAL';
  return value <= abnormal ? 'ABNORMAL' : value <= attention ? 'ATTENTION' : value <= fluctuation ? 'FLUCTUATION' : 'NORMAL';
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildPhysiologyHeatmap(athleteIds: number[], from: string, to: string) {
  const dates = calendarDays(from, to);
  const placeholders = athleteIds.map(() => '?').join(',');
  const metricCodes = physiologyMetricDefinitions.filter((item) => item.code !== 'resting_heart_rate_bpm').map((item) => item.code);
  const metricPlaceholders = metricCodes.map(() => '?').join(',');
  const measurements = db.prepare(`
    SELECT ts.test_date AS date, tm.metric_code AS code, tm.value_num AS value, tm.is_demo AS isDemo, tm.source
    FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id
    WHERE ts.athlete_id IN (${placeholders}) AND ts.test_date BETWEEN ? AND ? AND tm.metric_code IN (${metricPlaceholders})
  `).all(...athleteIds, from, to, ...metricCodes) as Array<{ date: string; code: PhysiologyMetricCode; value: number; isDemo: number; source: string }>;
  const restingHeartRates = db.prepare(`
    SELECT wellness_date AS date, morning_pulse AS value, is_demo AS isDemo, source
    FROM daily_wellness
    WHERE athlete_id IN (${placeholders}) AND wellness_date BETWEEN ? AND ? AND morning_pulse IS NOT NULL
  `).all(...athleteIds, from, to) as Array<{ date: string; value: number; isDemo: number; source: string }>;
  for (const row of restingHeartRates) measurements.push({ ...row, code: 'resting_heart_rate_bpm' });
  const demoScope = measurements.some((row) => row.isDemo || /seed|demo|estimated/i.test(row.source));
  const valuesByCell = new Map<string, Array<{ value: number; isDemo: number; source: string }>>();
  for (const row of measurements) {
    const key = `${row.code}|${row.date}`;
    const rows = valuesByCell.get(key) || [];
    rows.push(row);
    valuesByCell.set(key, rows);
  }
  const simulatedCounts = (seed: number) => {
    const sampleCount = Math.max(1, athleteIds.length);
    const abnormal = seed % 9 === 0 ? Math.max(1, Math.round(sampleCount * .12)) : 0;
    const attention = seed % 5 === 0 ? Math.max(1, Math.round(sampleCount * .16)) : 0;
    const fluctuation = Math.max(1, Math.round(sampleCount * (.12 + (seed % 3) * .05)));
    const normal = Math.max(0, sampleCount - abnormal - attention - fluctuation);
    return { sampleCount, normal, fluctuation, attention, abnormal };
  };
  return {
    metrics: physiologyMetricDefinitions.map((definition, metricIndex) => {
      let previousAbnormalRate: number | null = null;
      return {
        code: definition.code,
        label: definition.label,
        unit: definition.unit,
        days: dates.map((date, dayIndex) => {
          const rows = valuesByCell.get(`${definition.code}|${date}`) || [];
          let normal = 0; let fluctuation = 0; let attention = 0; let abnormal = 0;
          let valueMedian: number | null = null; let isEstimated = false;
          if (rows.length) {
            valueMedian = median(rows.map((row) => row.value));
            for (const row of rows) {
              const status = physiologyStatus(definition, row.value);
              if (status === 'NORMAL') normal += 1;
              else if (status === 'FLUCTUATION') fluctuation += 1;
              else if (status === 'ATTENTION') attention += 1;
              else abnormal += 1;
            }
            isEstimated = rows.every((row) => row.isDemo || /seed|demo|estimated/i.test(row.source));
          } else if (demoScope) {
            const seed = [...`${definition.code}${date}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
            ({ normal, fluctuation, attention, abnormal } = simulatedCounts(seed));
            const shift = (seed % 7 - 3) / 10;
            valueMedian = round(definition.baseline * (1 + shift), definition.unit === 'U/L' ? 0 : 1);
            isEstimated = true;
          }
          const sampleCount = normal + fluctuation + attention + abnormal;
          const abnormalRate = sampleCount ? abnormal / sampleCount : null;
          const attentionRate = sampleCount ? (attention + abnormal) / sampleCount : null;
          const status: PhysiologyStatus = !sampleCount ? 'MISSING'
            : abnormalRate! >= .15 ? 'ABNORMAL'
              : attentionRate! >= .25 ? 'ATTENTION'
                : (fluctuation + attention + abnormal) / sampleCount >= .25 ? 'FLUCTUATION' : 'NORMAL';
          const abnormalRateChange = abnormalRate === null || previousAbnormalRate === null ? null : round((abnormalRate - previousAbnormalRate) * 100, 1);
          if (abnormalRate !== null) previousAbnormalRate = abnormalRate;
          return { date, status, median: valueMedian, sampleCount, normal, fluctuation, attention, abnormal, abnormalRateChange, isEstimated };
        })
      };
    })
  };
}

export function buildOverviewPayload(input: { athleteIds: number[]; from: string; to: string; project: string; individual: boolean; period?: 'day' | 'week' | 'month' | null }) {
  if (!input.athleteIds.length) return {
    records: [], trainingVolume: emptyTrainingVolume(), trainingAnalytics: emptyTrainingAnalytics(), physiologyHeatmap: { metrics: [] }, intensityDistribution: zones.map((zone) => ({ zone, durationMin: 0, sessionCount: 0, percentage: 0 })),
    trainingLoadRatio: { specialLoad: 0, physicalLoad: 0, recoveryLoad: 0, totalLoad: 0, specialPercentage: 0, physicalPercentage: 0, recoveryPercentage: 0 },
    strengthTests: [], measurements: [], profiles: [], injuries: [],
    meta: { project: input.project, from: input.from, to: input.to, period: input.period ?? null, athleteCount: 0, sessionCount: 0, wellnessDays: 0, testCount: 0, coverage: 0, containsDemoData: false, sources: [], scope: input.individual ? 'individual' : 'team', generatedAt: new Date().toISOString() }
  };
  const placeholders = input.athleteIds.map(() => '?').join(',');
  const sessions = db.prepare(`
    SELECT ts.id, ts.athlete_id AS athleteId, a.name AS athleteName, a.project, a.team_id AS teamId, COALESCE(pt.name, '') AS team,
      COALESCE(ao.province, '未设置') AS province, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county, ts.session_date AS date, ts.session_order AS sessionOrder, COALESCE(ts.start_time, '') AS startTime,
      ts.training_type AS trainingType, ts.structure_type AS structureType,
      ts.intensity_zone AS intensityZone, ts.content, ts.duration_min AS durationMin,
      ts.distance_km AS distanceKm, ts.duration_reported AS durationReported,
      ts.distance_reported AS distanceReported, ts.rpe, ts.srpe, ts.smvl,
      ts.average_heart_rate AS averageHeartRate, ts.max_heart_rate AS maxHeartRate,
      ts.average_power_w AS averagePowerW, ts.stroke_rate_spm AS strokeRateSpm,
      ts.source AS sessionSource, ts.quality AS sessionQuality, ts.is_demo AS sessionDemo,
      dw.morning_pulse AS morningPulse, dw.weight_kg AS weightKg,
      dw.sleep_hours AS sleepHours, dw.fatigue_index AS fatigueIndex,
      COALESCE(dw.status, 'missing') AS status, dw.source AS wellnessSource,
      dw.quality AS wellnessQuality, dw.is_demo AS wellnessDemo, ts.updated_at AS updatedAt
    FROM training_sessions ts
    JOIN athletes a ON a.id = ts.athlete_id
    LEFT JOIN project_teams pt ON pt.id = a.team_id
    LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
    LEFT JOIN daily_wellness dw ON dw.athlete_id = ts.athlete_id AND dw.wellness_date = ts.session_date
    WHERE ts.athlete_id IN (${placeholders}) AND ts.session_date BETWEEN ? AND ?
    ORDER BY ts.session_date, ts.session_order, a.name
  `).all(...input.athleteIds, input.from, input.to) as SessionRow[];

  const records = sessions.map((row) => ({
    id: row.id,
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    project: row.project,
    team: row.team,
    region: row.province,
    province: row.province,
    city: row.city,
    county: row.county,
    date: row.date,
    trainingType: row.trainingType,
    structureType: row.structureType,
    intensityZone: row.intensityZone,
    content: row.content,
    durationMin: row.durationMin,
    distanceKm: row.distanceKm,
    durationReported: Boolean(row.durationReported),
    distanceReported: Boolean(row.distanceReported),
    rpe: row.rpe,
    srpe: row.srpe,
    smvl: row.smvl,
    morningPulse: row.morningPulse,
    weightKg: row.weightKg,
    sleepHours: row.sleepHours,
    fatigueIndex: row.fatigueIndex,
    status: row.status,
    coachNote: '',
    trainingBreakdown: sessionBreakdown(row),
    updatedAt: row.updatedAt,
    updatedBy: row.sessionSource,
    dataQuality: row.sessionQuality,
    dataSource: row.sessionSource,
    isDemo: Boolean(row.sessionDemo),
    deviceSummary: {
      averageHeartRate: row.averageHeartRate,
      maxHeartRate: row.maxHeartRate,
      averagePowerW: row.averagePowerW,
      strokeRateSpm: row.strokeRateSpm
    }
  }));
  const actualSessions = sessions.filter((row) => !row.sessionDemo);
  const intensityTotalDuration = actualSessions
    .filter((row) => zones.includes(row.intensityZone as typeof zones[number]) && Boolean(row.durationReported))
    .reduce((sum, row) => sum + row.durationMin, 0);
  const intensityDistribution = zones.map((zone) => {
    const rows = actualSessions.filter((row) => row.intensityZone === zone && Boolean(row.durationReported));
    const durationMin = rows.reduce((sum, row) => sum + row.durationMin, 0);
    return {
      zone,
      durationMin: round(durationMin, 1),
      sessionCount: rows.length,
      percentage: intensityTotalDuration ? round(durationMin / intensityTotalDuration * 100, 2) : 0
    };
  });
  const trainingVolume = aggregateTrainingVolume(sessions, input.individual);
  const trainingAnalytics = aggregateTrainingAnalytics(sessions, input.individual);
  const physiologyHeatmap = buildPhysiologyHeatmap(input.athleteIds, input.from, input.to);
  const trainingLoads = teamDurationSessions(actualSessions, input.individual).reduce((totals, row) => {
    const load = Number(row.srpe);
    const category = trainingLoadCategory(row);
    if (category && Number.isFinite(load) && load > 0) totals[category] += load;
    return totals;
  }, { special: 0, physical: 0, recovery: 0 });
  const trainingLoadTotal = trainingLoads.special + trainingLoads.physical + trainingLoads.recovery;
  const trainingLoadRatio = {
    specialLoad: round(trainingLoads.special, 1),
    physicalLoad: round(trainingLoads.physical, 1),
    recoveryLoad: round(trainingLoads.recovery, 1),
    totalLoad: round(trainingLoadTotal, 1),
    specialPercentage: trainingLoadTotal ? round(trainingLoads.special / trainingLoadTotal * 100, 2) : 0,
    physicalPercentage: trainingLoadTotal ? round(trainingLoads.physical / trainingLoadTotal * 100, 2) : 0,
    recoveryPercentage: trainingLoadTotal ? round(trainingLoads.recovery / trainingLoadTotal * 100, 2) : 0
  };

  const profileRows = db.prepare(`
    SELECT a.id AS athleteId, a.name AS athleteName, a.project, COALESCE(pt.name, '') AS team, a.gender,
      COALESCE(ap.position, '') AS athletePosition,
      COALESCE(ap.best_result, '') AS bestResult,
      COALESCE(ap.technical_level, '') AS technicalLevel,
      COALESCE(ap.current_event, '') AS currentEvent,
      COALESCE(ap.origin_unit, '') AS originUnit,
      COALESCE(ao.province, '未设置') AS province,
      COALESCE(ao.city, '') AS city,
      COALESCE(ao.county, '') AS county,
      COALESCE(ao.source, 'missing') AS originSource,
      COALESCE(ao.is_demo, 0) AS originIsDemo,
      a.birth_date AS birthDate,
      COALESCE(ap.start_sport_date, '') AS startSportDate
    FROM athletes a
    LEFT JOIN project_teams pt ON pt.id = a.team_id
    LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
    LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
    WHERE a.id IN (${placeholders}) AND a.active = 1
    ORDER BY pt.name, a.name
  `).all(...input.athleteIds) as ProfileRow[];
  const bodyRows = db.prepare(`
    SELECT athlete_id AS athleteId, measurement_date AS measurementDate,
      height_cm AS heightCm, weight_kg AS weightKg, body_fat_pct AS bodyFatPct,
      skeletal_muscle_kg AS skeletalMuscleKg, muscle_mass_kg AS muscleMassKg,
      upper_limb_muscle_kg AS upperLimbMuscleKg, lower_limb_muscle_kg AS lowerLimbMuscleKg,
      trunk_muscle_kg AS trunkMuscleKg, subcutaneous_fat_mm AS subcutaneousFatMm,
      triceps_skinfold_mm AS tricepsSkinfoldMm, abdominal_skinfold_mm AS abdominalSkinfoldMm,
      thigh_skinfold_mm AS thighSkinfoldMm, calf_skinfold_mm AS calfSkinfoldMm,
      visceral_fat_level AS visceralFatLevel, basal_metabolism_kcal AS basalMetabolismKcal,
      total_body_water_kg AS totalBodyWaterKg, ecw_tbw_ratio AS ecwTbwRatio,
      phase_angle_deg AS phaseAngleDeg, visceral_fat_area_cm2 AS visceralFatAreaCm2,
      left_arm_lean_kg AS leftArmLeanKg, right_arm_lean_kg AS rightArmLeanKg,
      trunk_lean_kg AS trunkLeanKg, left_leg_lean_kg AS leftLegLeanKg,
      right_leg_lean_kg AS rightLegLeanKg,
      note,
      source, is_demo AS isDemo
    FROM athlete_body_measurements
    WHERE athlete_id IN (${placeholders}) AND measurement_date <= ?
    ORDER BY athlete_id, measurement_date DESC, id DESC
  `).all(...input.athleteIds, input.to) as BodyRow[];
  const competitiveRows = db.prepare(`
    SELECT athlete_id AS athleteId, assessment_date AS assessmentDate,
      overall_score AS competitiveScore, state_level AS competitiveLevel,
      endurance_score AS endurance, power_score AS power, technique_score AS technique,
      load_adaptation_score AS loadAdaptation, recovery_score AS recovery,
      competition_score AS competition, source, is_demo AS isDemo
    FROM competitive_state_assessments
    WHERE athlete_id IN (${placeholders}) AND assessment_date <= ?
    ORDER BY athlete_id, assessment_date DESC, id DESC
  `).all(...input.athleteIds, input.to) as CompetitiveRow[];
  const profiles = profileRows.map((profile) => {
    const bodyHistory = bodyRows.filter((row) => row.athleteId === profile.athleteId);
    const stateHistory = competitiveRows.filter((row) => row.athleteId === profile.athleteId);
    const body = bodyHistory[0];
    const state = stateHistory[0];
    return {
      ...profile,
      age: ageAt(profile.birthDate, input.to),
      startSportDate: profile.startSportDate || null,
      bodyMeasurementDate: body?.measurementDate || null,
      heightCm: body?.heightCm ?? null,
      weightKg: body?.weightKg ?? null,
      previousWeightKg: bodyHistory[1]?.weightKg ?? null,
      bodyFatPct: body?.bodyFatPct ?? null,
      skeletalMuscleKg: body?.skeletalMuscleKg ?? null,
      muscleMassKg: body?.muscleMassKg ?? null,
      upperLimbMuscleKg: body?.upperLimbMuscleKg ?? null,
      lowerLimbMuscleKg: body?.lowerLimbMuscleKg ?? null,
      trunkMuscleKg: body?.trunkMuscleKg ?? null,
      subcutaneousFatMm: body?.subcutaneousFatMm ?? null,
      tricepsSkinfoldMm: body?.tricepsSkinfoldMm ?? null,
      abdominalSkinfoldMm: body?.abdominalSkinfoldMm ?? null,
      thighSkinfoldMm: body?.thighSkinfoldMm ?? null,
      calfSkinfoldMm: body?.calfSkinfoldMm ?? null,
      visceralFatLevel: body?.visceralFatLevel ?? null,
      basalMetabolismKcal: body?.basalMetabolismKcal ?? null,
      totalBodyWaterKg: body?.totalBodyWaterKg ?? null,
      ecwTbwRatio: body?.ecwTbwRatio ?? null,
      phaseAngleDeg: body?.phaseAngleDeg ?? null,
      visceralFatAreaCm2: body?.visceralFatAreaCm2 ?? null,
      leftArmLeanKg: body?.leftArmLeanKg ?? null,
      rightArmLeanKg: body?.rightArmLeanKg ?? null,
      trunkLeanKg: body?.trunkLeanKg ?? null,
      leftLegLeanKg: body?.leftLegLeanKg ?? null,
      rightLegLeanKg: body?.rightLegLeanKg ?? null,
      bodyMeasurementNote: body?.note || '',
      bodyCompositionHistory: bodyHistory.slice(0, 8).map((row) => ({
        measurementDate: row.measurementDate,
        heightCm: row.heightCm,
        weightKg: row.weightKg,
        bodyFatPct: row.bodyFatPct,
        skeletalMuscleKg: row.skeletalMuscleKg,
        muscleMassKg: row.muscleMassKg,
        upperLimbMuscleKg: row.upperLimbMuscleKg,
        lowerLimbMuscleKg: row.lowerLimbMuscleKg,
        trunkMuscleKg: row.trunkMuscleKg,
        subcutaneousFatMm: row.subcutaneousFatMm,
        tricepsSkinfoldMm: row.tricepsSkinfoldMm,
        abdominalSkinfoldMm: row.abdominalSkinfoldMm,
        thighSkinfoldMm: row.thighSkinfoldMm,
        calfSkinfoldMm: row.calfSkinfoldMm,
        visceralFatLevel: row.visceralFatLevel,
        basalMetabolismKcal: row.basalMetabolismKcal,
        totalBodyWaterKg: row.totalBodyWaterKg,
        ecwTbwRatio: row.ecwTbwRatio,
        phaseAngleDeg: row.phaseAngleDeg,
        visceralFatAreaCm2: row.visceralFatAreaCm2,
        leftArmLeanKg: row.leftArmLeanKg,
        rightArmLeanKg: row.rightArmLeanKg,
        trunkLeanKg: row.trunkLeanKg,
        leftLegLeanKg: row.leftLegLeanKg,
        rightLegLeanKg: row.rightLegLeanKg,
        note: row.note || ''
      })),
      competitiveAssessmentDate: state?.assessmentDate || null,
      technicalLevel: profile.technicalLevel || null,
      currentEvent: profile.currentEvent || null,
      competitiveScore: state?.competitiveScore ?? null,
      previousCompetitiveScore: stateHistory[1]?.competitiveScore ?? null,
      competitiveLevel: state?.competitiveLevel || null,
      competitiveDimensions: {
        endurance: state?.endurance ?? null,
        power: state?.power ?? null,
        technique: state?.technique ?? null,
        loadAdaptation: state?.loadAdaptation ?? null,
        recovery: state?.recovery ?? null,
        competition: state?.competition ?? null
      },
      originSource: profile.originSource,
      originIsDemo: Boolean(profile.originIsDemo),
      source: [...new Set([body?.source, state?.source].filter(Boolean))].join('、'),
      isDemo: Boolean(profile.originIsDemo || body?.isDemo || state?.isDemo)
    };
  });

  const injuries = db.prepare(`
    SELECT ir.athlete_id AS athleteId, a.name AS athleteName,
      ir.injury_name AS injuryName, ir.body_part AS bodyPart, ir.side, ir.status,
      ir.pain_score AS painScore, ir.onset_date AS onsetDate, ir.review_date AS reviewDate,
      CASE WHEN ir.note LIKE '%模拟数据%' THEN 1 ELSE 0 END AS isDemo
    FROM injury_records ir
    JOIN athletes a ON a.id = ir.athlete_id
    WHERE ir.athlete_id IN (${placeholders})
      AND ir.id = (
        SELECT latest.id FROM injury_records latest
        WHERE latest.athlete_id = ir.athlete_id
        ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
      )
    ORDER BY ir.pain_score DESC, a.name
  `).all(...input.athleteIds);

  const measurementRows = db.prepare(`
    SELECT ts.id AS sessionId, ts.athlete_id AS athleteId, ts.test_date AS testDate,
      ts.test_type AS testType, ts.source AS testSource, ts.is_demo AS testDemo,
      tm.metric_code AS code, md.label, md.domain, tm.value_num AS value,
      tm.target_value AS target, tm.unit, tm.quality, tm.source, tm.is_demo AS isDemo
    FROM test_sessions ts
    JOIN test_measurements tm ON tm.test_session_id = ts.id
    JOIN metric_definitions md ON md.code = tm.metric_code
    WHERE ts.athlete_id IN (${placeholders})
    ORDER BY ts.test_date DESC, ts.id DESC, tm.metric_code
  `).all(...input.athleteIds) as MeasurementRow[];

  const testDates = [...new Set(measurementRows.map((row) => row.testDate))].slice(0, 2);
  const strengthTests = testDates.map((testDate, index) => {
    const rows = measurementRows.filter((row) => row.testDate === testDate && !row.code.includes('_'));
    const codes = [...new Set(rows.map((row) => row.code))];
    const metrics = Object.fromEntries(codes.flatMap((code) => {
      const value = average(rows.filter((row) => row.code === code).map((row) => row.value));
      return value === null ? [] : [[code, round(value, 2)]];
    }));
    const targets = Object.fromEntries(codes.flatMap((code) => {
      const value = average(rows.filter((row) => row.code === code).map((row) => row.target));
      return value === null ? [] : [[code, round(value, 2)]];
    }));
    return {
      id: input.individual ? rows[0]?.sessionId || -(index + 1) : -(index + 1),
      athleteId: input.individual ? input.athleteIds[0] : 0,
      testDate,
      metrics,
      targets,
      notes: input.individual ? '专业综合评估' : `${input.project}项目组均值`,
      updatedAt: `${testDate} 12:00:00`,
      updatedBy: '测试数据汇总'
    };
  });

  const codes = [...new Set(measurementRows.map((row) => row.code))];
  const measurements = codes.map((code) => {
    const codeRows = measurementRows.filter((row) => row.code === code);
    const latestDate = codeRows[0]?.testDate;
    const previousDate = codeRows.find((row) => row.testDate !== latestDate)?.testDate;
    const rows = codeRows.filter((row) => row.testDate === latestDate);
    const previous = codeRows.filter((row) => row.testDate === previousDate);
    const value = average(rows.map((row) => row.value));
    const previousValue = average(previous.map((row) => row.value));
    return {
      code,
      label: rows[0].label,
      domain: rows[0].domain,
      value: round(value, 2),
      target: round(average(rows.map((row) => row.target)), 2),
      previous: round(previousValue, 2),
      changePct: value !== null && previousValue !== null && previousValue !== 0 ? round((value - previousValue) / previousValue * 100, 1) : null,
      unit: rows[0].unit,
      quality: rows.some((row) => row.quality !== 'valid') ? 'partial' : 'valid',
      source: [...new Set(rows.map((row) => row.source))].join('、'),
      sampleCount: rows.length,
      isDemo: rows.every((row) => Boolean(row.isDemo))
    };
  });

  const wellnessCells = sessions.flatMap((row) => [row.sleepHours, row.morningPulse, row.weightKg, row.fatigueIndex]);
  const availableCells = wellnessCells.filter((value) => typeof value === 'number' && Number.isFinite(value)).length;
  const sources = [...new Set([
    ...sessions.flatMap((row) => [row.sessionSource, row.wellnessSource]),
    ...profileRows.map((row) => row.originSource),
    ...bodyRows.map((row) => row.source), ...competitiveRows.map((row) => row.source)
  ].filter(Boolean) as string[])];
  const wellnessDays = db.prepare(`
    SELECT COUNT(*) AS count FROM daily_wellness
    WHERE athlete_id IN (${placeholders}) AND wellness_date BETWEEN ? AND ?
  `).get(...input.athleteIds, input.from, input.to) as { count: number };
  const testSummary = db.prepare(`
    SELECT COUNT(*) AS count, COUNT(DISTINCT athlete_id) AS athleteCount
    FROM test_sessions
    WHERE athlete_id IN (${placeholders}) AND test_date BETWEEN ? AND ? AND is_demo = 0
  `).get(...input.athleteIds, input.from, input.to) as { count: number; athleteCount: number };
  trainingAnalytics.summary.testSessionCount = testSummary.count;
  trainingAnalytics.summary.testedAthleteCount = testSummary.athleteCount;

  return {
    records,
    trainingVolume,
    trainingAnalytics,
    physiologyHeatmap,
    intensityDistribution,
    trainingLoadRatio,
    strengthTests,
    measurements,
    profiles,
    injuries,
    meta: {
      project: input.project,
      from: input.from,
      to: input.to,
      period: input.period ?? null,
      athleteCount: input.athleteIds.length,
      sessionCount: sessions.length,
      wellnessDays: wellnessDays.count,
      testCount: testSummary.count,
      coverage: wellnessCells.length ? round(availableCells / wellnessCells.length * 100, 1) : 0,
      containsDemoData: sessions.some((row) => Boolean(row.sessionDemo)) || measurementRows.some((row) => Boolean(row.isDemo))
        || profiles.some((profile) => profile.isDemo),
      sources,
      scope: input.individual ? 'individual' : 'team',
      generatedAt: new Date().toISOString()
    }
  };
}
