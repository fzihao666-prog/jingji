export const PROJECTS = ['赛艇', '皮划艇', '激流'] as const;

export type Project = (typeof PROJECTS)[number];

export function isProject(value: unknown): value is Project {
  return typeof value === 'string' && PROJECTS.includes(value as Project);
}

export const PROJECT_META: Record<Project, { english: string; report: string; code: string; key: string; color: string; accent: string }> = {
  赛艇: { english: 'ROWING', report: 'ROWING PERFORMANCE REPORT', code: 'ROW', key: 'rowing', color: '#66d8cb', accent: '#15998e' },
  皮划艇: { english: 'CANOE / KAYAK', report: 'CANOE / KAYAK PERFORMANCE REPORT', code: 'CAN', key: 'canoe', color: '#79c9ee', accent: '#2f7da3' },
  激流: { english: 'CANOE SLALOM', report: 'CANOE SLALOM PERFORMANCE REPORT', code: 'SLA', key: 'slalom', color: '#f1aa64', accent: '#c76d22' }
};

export function projectKey(project: Project | string): string {
  return isProject(project) ? PROJECT_META[project].key : 'unknown';
}

export function projectColor(project: Project | string): string {
  return isProject(project) ? PROJECT_META[project].color : '#9aa8ab';
}

export function projectAccent(project: Project | string): string {
  return isProject(project) ? PROJECT_META[project].accent : '#74888f';
}
