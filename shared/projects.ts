export const PROJECTS = ['赛艇', '皮划艇', '激流'] as const;

export type Project = (typeof PROJECTS)[number];

export function isProject(value: unknown): value is Project {
  return typeof value === 'string' && PROJECTS.includes(value as Project);
}

export const PROJECT_META: Record<Project, { english: string; report: string; code: string }> = {
  赛艇: { english: 'ROWING', report: 'ROWING PERFORMANCE REPORT', code: 'ROW' },
  皮划艇: { english: 'CANOE / KAYAK', report: 'CANOE / KAYAK PERFORMANCE REPORT', code: 'CAN' },
  激流: { english: 'CANOE SLALOM', report: 'CANOE SLALOM PERFORMANCE REPORT', code: 'SLA' }
};
