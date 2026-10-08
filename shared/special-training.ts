import {
  trainingContentCategory,
  trainingLoadCategory,
  TRAINING_CONTENT_CATEGORIES,
} from './training-content-category.js';
import {
  SPECIAL_TRAINING_INTENSITY_ZONE_ORDER,
} from './training-intensity.js';

export type SpecialSession = {
  id: number;
  date: string;
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  trainingType: string;
  structureType: string;
  content: string;
  intensityZone: string;
  durationMin: number;
  distanceKm: number;
  durationReported: number | boolean;
  distanceReported: number | boolean;
  srpe: number;
  rpe: number | null;
  sessionDemo: number;
  sessionSource?: string;
  sessionQuality?: string;
};

const total = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
};
const duration = (row: SpecialSession) => (row.durationReported ? row.durationMin : null);
const distance = (row: SpecialSession) => (row.distanceReported ? row.distanceKm : null);
const load = (row: SpecialSession) =>
  Number.isFinite(row.srpe) && row.srpe >= 0 && (row.rpe !== null || row.srpe > 0)
    ? row.srpe
    : null;

/** 输入复用总览服务已去重的课次，统计只读取原始强度和既有SRPE，不推导新负荷。 */
export function aggregateSpecialTraining(input: SpecialSession[]) {
  const records = input.filter(
    (row) =>
      !row.sessionDemo &&
      !/seed|demo|estimated/i.test(row.sessionSource || '') &&
      row.sessionQuality !== 'estimated' &&
      trainingLoadCategory(row) === 'special'
  );
  const dates = [...new Set(records.map((row) => row.date))].sort();
  const days = dates.map((date) => {
    const rows = records.filter((row) => row.date === date);
    return {
      date,
      durationMin: total(rows.map(duration)),
      distanceKm: total(rows.map(distance)),
      load: total(rows.map(load)),
      sessionCount: rows.length,
    };
  });
  // 当前系统各项目均保存原始分区；未知分区原样展示，不套用其他项目阈值。
  // 强度占比固定展示全部标准分区维度：没有数据的分区保留 0 值行，不隐藏；
  // 标准顺序之外的未知分区原样追加在后面。
  const zoneNames = [
    ...SPECIAL_TRAINING_INTENSITY_ZONE_ORDER,
    ...[...new Set(records.map((row) => row.intensityZone).filter(Boolean))]
      .filter(
        (name) => !SPECIAL_TRAINING_INTENSITY_ZONE_ORDER.includes(name as (typeof SPECIAL_TRAINING_INTENSITY_ZONE_ORDER)[number])
      )
      .sort((a, b) => a.localeCompare(b)),
  ];
  const zones = zoneNames.map((name) => {
    const rows = records.filter((row) => row.intensityZone === name);
    // 未出现该分区的记录时记 0 分钟（没有训练即 0）；有记录但时长未填报时保留缺失，不用 0 代替。
    return {
      name,
      durationMin: rows.length ? total(rows.map(duration)) : 0,
    };
  });
  const zoneTotal = total(zones.map((row) => row.durationMin)) || 0;
  const intensity = zones.map((row) => ({
    ...row,
    percentage: zoneTotal ? ((row.durationMin || 0) / zoneTotal) * 100 : 0,
  }));
  const content = TRAINING_CONTENT_CATEGORIES.map((name) => {
    const count = records.filter((row) => trainingContentCategory(row) === name).length;
    return { name, count, percentage: records.length ? (count / records.length) * 100 : 0 };
  }).filter((row) => row.count);
  return {
    summary: {
      durationMin: total(records.map(duration)),
      distanceKm: total(records.map(distance)),
      load: total(records.map(load)),
      sessionCount: records.length,
    },
    days,
    intensity,
    content,
  };
}
export type SpecialTrainingAnalytics = ReturnType<typeof aggregateSpecialTraining>;

export type SpecialTrainingAthlete = {
  id: number;
  name: string;
  team: string;
  gender: string;
  birthDate: string | null;
  weightKg: number | null;
  summary: SpecialTrainingAnalytics['summary'];
};

export type SpecialTestSample = {
  athleteId: number;
  testDate: string;
  distanceM: number;
  boatClass: string;
  bestMs: number;
};

export type SpecialTestComparison = {
  athlete: SpecialTestSample | null;
  teamAverage: number | null;
  deltaMs: number | null;
};

export function buildSpecialTestComparison(input: {
  athleteId: number;
  tests: SpecialTestSample[];
}): SpecialTestComparison {
  const athlete = input.tests
    .filter((sample) => sample.athleteId === input.athleteId)
    .sort(
      (left, right) =>
        right.testDate.localeCompare(left.testDate) ||
        left.bestMs - right.bestMs ||
        left.distanceM - right.distanceM ||
        left.boatClass.localeCompare(right.boatClass)
    )[0];
  if (!athlete) return { athlete: null, teamAverage: null, deltaMs: null };

  const samples = input.tests.filter(
    (sample) =>
      sample.testDate === athlete.testDate &&
      sample.distanceM === athlete.distanceM &&
      sample.boatClass === athlete.boatClass
  );
  const bestByAthlete = new Map<number, SpecialTestSample>();
  for (const sample of samples) {
    const current = bestByAthlete.get(sample.athleteId);
    if (!current || sample.bestMs < current.bestMs) bestByAthlete.set(sample.athleteId, sample);
  }
  const values = [...bestByAthlete.values()].map((sample) => sample.bestMs);
  const teamAverage = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    athlete,
    teamAverage,
    deltaMs: teamAverage === null ? null : athlete.bestMs - teamAverage,
  };
}
