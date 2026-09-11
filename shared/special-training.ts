import { trainingContentCategory, trainingLoadCategory, TRAINING_CONTENT_CATEGORIES } from './training-content-category';
import { PRIMARY_INTENSITY_ZONE_CODES } from './training-intensity';

export type SpecialSession = {
  id: number; date: string; athleteId: number; athleteName: string; project: string; team: string;
  trainingType: string; structureType: string; content: string; intensityZone: string;
  durationMin: number; distanceKm: number; durationReported: number | boolean; distanceReported: number | boolean;
  srpe: number; rpe: number | null; sessionDemo: number; sessionSource?: string; sessionQuality?: string;
};

const total = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
};
const duration = (row: SpecialSession) => row.durationReported ? row.durationMin : null;
const distance = (row: SpecialSession) => row.distanceReported ? row.distanceKm : null;
const load = (row: SpecialSession) => Number.isFinite(row.srpe) && row.srpe >= 0 && (row.rpe !== null || row.srpe > 0) ? row.srpe : null;

/** 输入复用总览服务已去重的课次，统计只读取原始强度和既有SRPE，不推导新负荷。 */
export function aggregateSpecialTraining(input: SpecialSession[]) {
  const records = input.filter((row) => !row.sessionDemo && !/seed|demo|estimated/i.test(row.sessionSource || '') && row.sessionQuality !== 'estimated' && trainingLoadCategory(row) === 'special');
  const dates = [...new Set(records.map((row) => row.date))].sort();
  const days = dates.map((date) => {
    const rows = records.filter((row) => row.date === date);
    return { date, durationMin: total(rows.map(duration)), distanceKm: total(rows.map(distance)), load: total(rows.map(load)), sessionCount: rows.length };
  });
  // 当前系统各项目均保存原始分区；未知分区原样展示，不套用其他项目阈值。
  const zoneNames = [...new Set(records.map((row) => row.intensityZone).filter(Boolean))].sort((a, b) => {
    const left = PRIMARY_INTENSITY_ZONE_CODES.indexOf(a as typeof PRIMARY_INTENSITY_ZONE_CODES[number]);
    const right = PRIMARY_INTENSITY_ZONE_CODES.indexOf(b as typeof PRIMARY_INTENSITY_ZONE_CODES[number]);
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.localeCompare(b);
  });
  const zones = zoneNames.map((name) => ({ name, durationMin: total(records.filter((row) => row.intensityZone === name).map(duration)) }));
  const zoneTotal = total(zones.map((row) => row.durationMin)) || 0;
  const intensity = zones.map((row) => ({ ...row, percentage: zoneTotal ? (row.durationMin || 0) / zoneTotal * 100 : 0 }));
  const content = TRAINING_CONTENT_CATEGORIES.map((name) => {
    const count = records.filter((row) => trainingContentCategory(row) === name).length;
    return { name, count, percentage: records.length ? count / records.length * 100 : 0 };
  }).filter((row) => row.count);
  return {
    summary: { durationMin: total(records.map(duration)), distanceKm: total(records.map(distance)), load: total(records.map(load)), sessionCount: records.length },
    days, intensity, content,
    recent: [...records].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 10).map((row) => ({
      id: row.id, date: row.date, content: row.content || row.structureType || row.trainingType, intensityZone: row.intensityZone,
      durationMin: duration(row), distanceKm: distance(row), load: load(row)
    }))
  };
}
export type SpecialTrainingAnalytics = ReturnType<typeof aggregateSpecialTraining>;
