export const COACH_WORK_STATUS_LABELS = {
  training: '带队训练',
  substituting: '代训',
  at_center: '返体育中心',
  resting: '休假',
} as const;

export const TEAM_WORK_STATUS_LABELS = {
  training: '训练中',
  on_leave: '休假中',
  phase_ended: '阶段已结束',
} as const;

export type CoachWorkStatus = keyof typeof COACH_WORK_STATUS_LABELS;
export type TeamWorkStatus = keyof typeof TEAM_WORK_STATUS_LABELS;
export type WorkStatusRecord<T> = { status: T; updatedAt: string };
export type CoachWorkStatusRecord = WorkStatusRecord<CoachWorkStatus>;
