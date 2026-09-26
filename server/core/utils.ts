import { db } from './db.ts';
import {
  intensityZones,
  type AuthUser,
  type IntensityZoneKey,
  type TrainingBreakdown,
} from './shared-server.ts';

export function validatePersonName(value: unknown) {
  const name = cleanString(value);
  if (name.length < 2 || name.length > 20) {
    return { name, error: '姓名须为2—20个字符。' };
  }
  if (/[\r\n\t<>]/.test(name)) {
    return { name, error: '姓名包含无效字符。' };
  }
  return { name, error: '' };
}

export function cleanString(value: unknown) {
  return String(value ?? '').trim();
}

export function birthDateFromIdentityNumber(identityNumber: string) {
  if (!/^\d{17}[\dX]$/.test(identityNumber)) return '';
  const year = identityNumber.slice(6, 10);
  const month = identityNumber.slice(10, 12);
  const day = identityNumber.slice(12, 14);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) return '';
  const candidate = new Date(Date.UTC(Number(year), numericMonth - 1, numericDay));
  if (
    candidate.getUTCFullYear() !== Number(year) ||
    candidate.getUTCMonth() !== numericMonth - 1 ||
    candidate.getUTCDate() !== numericDay
  ) {
    return '';
  }
  return `${year}-${month}-${day}`;
}

export function userById(userId: number): AuthUser | null {
  const row = db
    .prepare(
      `
    SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId
    FROM users WHERE id = ?
  `
    )
    .get(userId) as AuthUser | undefined;
  return row || null;
}

export function numberOrNull(value: unknown): number | null {
  if (value === '' || value === undefined || value === null) return null;
  const numeric = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const raw = cleanString(value)
    .replace(/[./年]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '');
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function pick(row: Record<string, unknown>, aliases: string[]) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [key.replace(/\s+/g, '').toLowerCase(), value])
  );
  for (const alias of aliases) {
    const value = normalized.get(alias.replace(/\s+/g, '').toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

export function numberOrZero(value: unknown) {
  return numberOrNull(value) ?? 0;
}

export function formatServerNumber(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function emptyZoneDistances(): Record<IntensityZoneKey, number> {
  return { U3: 0, U2: 0, U1: 0, AT: 0, TPT: 0, AN: 0, ATP: 0 };
}

function emptyTrainingBreakdown(): TrainingBreakdown {
  return {
    waterMinutes: 0,
    ergMinutes: 0,
    landMinutes: {
      functional: 0,
      endurance: 0,
      maxStrength: 0,
      speedStrength: 0,
      recovery: 0,
      running: 0,
      other: 0,
    },
    waterDistanceByZone: emptyZoneDistances(),
    waterTimeByZone: emptyZoneDistances(),
    ergDistanceByZone: emptyZoneDistances(),
  };
}

function parseTrainingBreakdownJson(value: string): TrainingBreakdown {
  try {
    const parsed = JSON.parse(value || '{}') as Partial<TrainingBreakdown>;
    const fallback = emptyTrainingBreakdown();
    return {
      waterMinutes: Number(parsed.waterMinutes) || 0,
      ergMinutes: Number(parsed.ergMinutes) || 0,
      landMinutes: { ...fallback.landMinutes, ...(parsed.landMinutes || {}) },
      waterDistanceByZone: {
        ...fallback.waterDistanceByZone,
        ...(parsed.waterDistanceByZone || {}),
      },
      waterTimeByZone: { ...fallback.waterTimeByZone, ...(parsed.waterTimeByZone || {}) },
      ergDistanceByZone: { ...fallback.ergDistanceByZone, ...(parsed.ergDistanceByZone || {}) },
    };
  } catch {
    return emptyTrainingBreakdown();
  }
}

export function trainingSessionBreakdown(input: {
  trainingType: string;
  structureType: string;
  intensityZone: string;
  durationMin: number;
  distanceKm: number;
}): TrainingBreakdown {
  const breakdown = emptyTrainingBreakdown();
  const zone = input.intensityZone as IntensityZoneKey;
  if (
    (input.trainingType === '专项训练' || input.distanceKm > 0) &&
    intensityZones.includes(zone)
  ) {
    breakdown.waterMinutes = input.durationMin;
    breakdown.waterDistanceByZone[zone] = input.distanceKm;
    breakdown.waterTimeByZone[zone] = input.durationMin;
  } else if (input.structureType === '最大力量')
    breakdown.landMinutes.maxStrength = input.durationMin;
  else if (input.structureType === '速度力量')
    breakdown.landMinutes.speedStrength = input.durationMin;
  else if (input.structureType === '功能训练') breakdown.landMinutes.functional = input.durationMin;
  else if (input.structureType === '再生恢复') breakdown.landMinutes.recovery = input.durationMin;
  else breakdown.landMinutes.other = input.durationMin;
  return breakdown;
}

export function strengthImportNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const match = cleanString(value)
    .replace(',', '.')
    .match(/-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}
