export type PlanKind = 'special' | 'physical' | 'combined';
export type CatalogPlan = {
  key: string;
  id: number;
  source: 'training_plans' | 'special_training_plans';
  kind: PlanKind;
  title: string;
  project: string;
  teamId: number | null;
  team: string;
  athleteId: number | null;
  athleteName: string;
  startDate: string;
  endDate: string;
  createdBy: string;
  sourceStatus: string;
  data: Record<string, unknown>;
};
export type PlanExecutionRow = {
  athleteId: number;
  athleteName: string;
  team: string;
  plannedDays: number;
  actualDays: number;
  completionRate: number | null;
  totalDurationMin: number;
  status: string;
  todayStatus: string;
  todayDurationMin: number | null;
  todayDistanceKm: number | null;
  todayRpeReported: boolean;
};
export function planPeriodStatus(
  plan: Pick<CatalogPlan, 'startDate' | 'endDate' | 'sourceStatus'>,
  today: string
) {
  if (plan.sourceStatus === 'draft') return '草案';
  if (plan.sourceStatus === 'completed' || (plan.endDate && plan.endDate < today)) return '已完成';
  if (plan.startDate && plan.startDate > today) return '尚未开始';
  return '进行中';
}
