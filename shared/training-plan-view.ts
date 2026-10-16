import type { CatalogPlan } from './training-plan-catalog.ts';
export const PLAN_KIND_LABELS = { special: '专项计划', physical: '体能计划', combined: '综合计划' };
export function planObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function planText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(planText).join('、');
  if (typeof value === 'object')
    return Object.entries(planObject(value))
      .map(([key, item]) => `${key}：${planText(item)}`)
      .join('；');
  return String(value);
}
export type PlanDay = {
  key: string;
  date: string;
  focus: string;
  items: Record<string, unknown>[];
  notes?: string;
};
export function planDays(plan: CatalogPlan): PlanDay[] {
  if (plan.source === 'special_training_plans') {
    const days = new Map<string, PlanDay>();
    for (const raw of Array.isArray(plan.data.sessions) ? plan.data.sessions : []) {
      const item = planObject(raw);
      const date = String(item.session_date || '日期未设置');
      const day = days.get(date) || { key: date, date, focus: '', items: [] };
      day.items.push(item);
      days.set(date, day);
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  return (Array.isArray(plan.data.weeklyPlans) ? plan.data.weeklyPlans : []).flatMap(
    (raw, weekIndex) => {
      const week = planObject(raw);
      return (Array.isArray(week.days) ? week.days : []).map((rawDay, dayIndex) => {
        const day = planObject(rawDay);
        return {
          key: `${weekIndex}:${dayIndex}`,
          date: String(
            day.date ||
              day.dayLabel ||
              `第${week.weekNumber || weekIndex + 1}周 ${day.dayOfWeek || day.label || '日期未设置'}`
          ),
          focus: String(day.focus || week.focus || ''),
          notes: String(day.notes || day.note || ''),
          items: (Array.isArray(day.exercises)
            ? day.exercises
            : Array.isArray(day.items)
              ? day.items
              : []
          ).map(planObject),
        };
      });
    }
  );
}
export function filterCatalog(
  plans: CatalogPlan[],
  filters: { kind: string; project: string; team: string; from: string; to: string }
) {
  return plans.filter(
    (plan) =>
      (!filters.kind || plan.kind === filters.kind) &&
      (!filters.project || plan.project === filters.project) &&
      (!filters.team || String(plan.teamId) === filters.team) &&
      (!filters.from || !plan.endDate || plan.endDate >= filters.from) &&
      (!filters.to || !plan.startDate || plan.startDate <= filters.to)
  );
}
