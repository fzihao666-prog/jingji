import type { TrainingRecord, TrainingStatus } from './types';
import { ROLE_META } from '../shared/access';

export const statusMeta: Record<TrainingStatus, { label: string; short: string; color: string }> = {
  normal: { label: '状态正常', short: '正常', color: '#18a38f' },
  attention: { label: '需要关注', short: '关注', color: '#e2a323' },
  alert: { label: '指标异常', short: '异常', color: '#e4533f' },
  rest: { label: '休息恢复', short: '休息', color: '#7c8e97' },
  missing: { label: '数据缺失', short: '缺失', color: '#8d70b8' }
};

export const roleMeta = ROLE_META;

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value);
}

export function formatDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

export function toIsoDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function addDays(date: string, amount: number) {
  const target = new Date(`${date}T00:00:00`);
  target.setDate(target.getDate() + amount);
  return toIsoDate(target);
}

export function startOfWeek(date: string) {
  const target = new Date(`${date}T00:00:00`);
  const day = target.getDay() || 7;
  target.setDate(target.getDate() - day + 1);
  return toIsoDate(target);
}

export function aggregateRecords(records: TrainingRecord[]) {
  const training = records.filter((record) => record.status !== 'rest');
  const days = new Set(records.map((record) => record.date));
  const totalDuration = training.reduce((sum, record) => sum + record.durationMin, 0);
  const totalDistance = training.reduce((sum, record) => sum + record.distanceKm, 0);
  const totalSrpe = training.reduce((sum, record) => sum + record.srpe, 0);
  const totalSmvl = training.reduce((sum, record) => sum + record.smvl, 0);
  const alerts = records.filter((record) => record.status === 'alert').length;
  const attention = records.filter((record) => record.status === 'attention').length;
  const avgSleep = average(records.map((record) => record.sleepHours));
  const avgFatigue = average(records.map((record) => record.fatigueIndex));

  return { totalDuration, totalDistance, totalSrpe, totalSmvl, alerts, attention, avgSleep, avgFatigue, days: days.size };
}

export function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

export function statusPriority(status: TrainingStatus) {
  return { alert: 5, attention: 4, missing: 3, normal: 2, rest: 1 }[status];
}

export function worstStatus(records: TrainingRecord[]): TrainingStatus {
  return records.reduce<TrainingStatus>((worst, record) =>
    statusPriority(record.status) > statusPriority(worst) ? record.status : worst, 'rest');
}

export function groupByDate(records: TrainingRecord[]) {
  const map = new Map<string, TrainingRecord[]>();
  for (const record of records) {
    const current = map.get(record.date) || [];
    current.push(record);
    map.set(record.date, current);
  }
  return map;
}

export function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}
