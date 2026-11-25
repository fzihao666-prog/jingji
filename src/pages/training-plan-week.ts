import type { TeamPlanSession } from '../../shared/team-plan';

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function addPlanDays(isoDate: string, days: number): string {
  const date = utcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStart(isoDate: string): string {
  return addPlanDays(isoDate, -((utcDate(isoDate).getUTCDay() + 6) % 7));
}

export function planWeekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addPlanDays(start, index));
}

function sumTargets(values: (number | null)[]): number | null {
  const valid = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  );
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
}

export function summarizePlanWeek(sessions: TeamPlanSession[], start: string) {
  const end = addPlanDays(start, 6);
  const withinWeek = sessions.filter((session) => session.date >= start && session.date <= end);
  const special = withinWeek.filter((session) => session.category === 'special');
  const physical = withinWeek.filter((session) => session.category === 'physical');
  return {
    sessionCount: withinWeek.length,
    specialDurationMin: sumTargets(special.map((session) => session.durationMin)),
    physicalDurationMin: sumTargets(physical.map((session) => session.durationMin)),
    specialDistanceKm: sumTargets(special.map((session) => session.distanceKm)),
  };
}

// 仅识别明确填写的恢复休息课；没有安排或组间休息不能推断为休息日。
export function explicitRestLabel(sessions: TeamPlanSession[]): string | null {
  const isRest = (session: TeamPlanSession) =>
    session.category === 'recovery' && /^(?:全天)?休息(?:日)?$/u.test(session.content.trim());
  if (!sessions.some(isRest)) return null;
  return sessions.every(isRest) ? '休息日' : '含休息安排';
}
