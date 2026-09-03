import { db } from './db.ts';

const zones = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;

type SessionRow = {
  id: number;
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  province: string;
  city: string;
  county: string;
  date: string;
  trainingType: string;
  structureType: string;
  intensityZone: string;
  content: string;
  durationMin: number;
  distanceKm: number;
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

export function buildOverviewPayload(input: { athleteIds: number[]; from: string; to: string; project: string; individual: boolean; period?: 'day' | 'week' | 'month' | null }) {
  if (!input.athleteIds.length) return {
    records: [], strengthTests: [], measurements: [], profiles: [], injuries: [],
    meta: { project: input.project, from: input.from, to: input.to, period: input.period ?? null, athleteCount: 0, sessionCount: 0, wellnessDays: 0, testCount: 0, coverage: 0, containsDemoData: false, sources: [], scope: input.individual ? 'individual' : 'team', generatedAt: new Date().toISOString() }
  };
  const placeholders = input.athleteIds.map(() => '?').join(',');
  const sessions = db.prepare(`
    SELECT ts.id, ts.athlete_id AS athleteId, a.name AS athleteName, a.project, a.team,
      a.region AS province, a.city, a.county, ts.session_date AS date,
      ts.training_type AS trainingType, ts.structure_type AS structureType,
      ts.intensity_zone AS intensityZone, ts.content, ts.duration_min AS durationMin,
      ts.distance_km AS distanceKm, ts.rpe, ts.srpe, ts.smvl,
      ts.average_heart_rate AS averageHeartRate, ts.max_heart_rate AS maxHeartRate,
      ts.average_power_w AS averagePowerW, ts.stroke_rate_spm AS strokeRateSpm,
      ts.source AS sessionSource, ts.quality AS sessionQuality, ts.is_demo AS sessionDemo,
      dw.morning_pulse AS morningPulse, dw.weight_kg AS weightKg,
      dw.sleep_hours AS sleepHours, dw.fatigue_index AS fatigueIndex,
      COALESCE(dw.status, 'missing') AS status, dw.source AS wellnessSource,
      dw.quality AS wellnessQuality, dw.is_demo AS wellnessDemo, ts.updated_at AS updatedAt
    FROM training_sessions ts
    JOIN athletes a ON a.id = ts.athlete_id
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

  const profileRows = db.prepare(`
    SELECT a.id AS athleteId, a.name AS athleteName, a.project, a.team, a.gender,
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
      a.birth_date AS birthDate
    FROM athletes a
    LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
    LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
    WHERE a.id IN (${placeholders}) AND a.active = 1
    ORDER BY a.team, a.name
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
  const testCount = db.prepare(`SELECT COUNT(*) AS count FROM test_sessions WHERE athlete_id IN (${placeholders})`)
    .get(...input.athleteIds) as { count: number };

  return {
    records,
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
      testCount: testCount.count,
      coverage: wellnessCells.length ? round(availableCells / wellnessCells.length * 100, 1) : 0,
      containsDemoData: sessions.some((row) => Boolean(row.sessionDemo)) || measurementRows.some((row) => Boolean(row.isDemo))
        || profiles.some((profile) => profile.isDemo),
      sources,
      scope: input.individual ? 'individual' : 'team',
      generatedAt: new Date().toISOString()
    }
  };
}
