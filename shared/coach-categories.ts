export const HEAD_COACH_CATEGORY = '主管教练';
export const COACH_CATEGORIES = [HEAD_COACH_CATEGORY, '专项教练', '体能教练', '康复治疗师'] as const;

export type CoachCategory = (typeof COACH_CATEGORIES)[number];

export const DEFAULT_COACH_CATEGORY: CoachCategory = '体能教练';

export function isCoachCategory(value: unknown): value is CoachCategory {
  return typeof value === 'string' && COACH_CATEGORIES.includes(value as CoachCategory);
}
