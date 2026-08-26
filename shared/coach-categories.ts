export const COACH_CATEGORIES = [
  '体能教练',
  '专项教练'
] as const;

export type CoachCategory = typeof COACH_CATEGORIES[number];

export const DEFAULT_COACH_CATEGORY: CoachCategory = '体能教练';

export function isCoachCategory(value: unknown): value is CoachCategory {
  return typeof value === 'string' && COACH_CATEGORIES.includes(value as CoachCategory);
}
