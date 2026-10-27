import { normalizeProject, projectCapability, type Project } from './projects.js';

export const SPORT_RULES_VERSION = 'multi-sport-v1';
export type CapabilityStatus = 'available' | 'pending_configuration' | 'unsupported';
export type SportCapability = { status: CapabilityStatus; reason: string };
export type ActivityCode = 'unknown' | 'on_water' | 'ergometer' | 'cycling' | 'volleyball_technique' | 'strength' | 'running' | 'recovery';
export type TrainingCategory = 'special' | 'physical' | 'recovery';

export const SPORT_MODULES = [
  { key: 'people', label: '人员与队伍', kind: 'common' },
  { key: 'plans', label: '训练计划', kind: 'common' },
  { key: 'sessions', label: '训练记录', kind: 'common' },
  { key: 'wellness', label: '每日恢复', kind: 'common' },
  { key: 'injuries', label: '伤病管理', kind: 'common' },
  { key: 'measurements', label: '身体测量', kind: 'common' },
  { key: 'fitness', label: '通用体能测试', kind: 'common' },
  { key: 'special', label: '项目专项', kind: 'specific' },
  { key: 'overview', label: '训练总览', kind: 'composed' },
  { key: 'profile', label: '个人档案', kind: 'composed' },
  { key: 'reports', label: '训练报告', kind: 'composed' },
  { key: 'references', label: '参考评价', kind: 'composed' },
] as const;

export const ACTIVITY_LABELS: Record<ActivityCode, string> = {
  unknown: '未分类', on_water: '水上训练', ergometer: '测功仪', cycling: '骑行',
  volleyball_technique: '排球技术', strength: '力量训练', running: '跑步', recovery: '恢复训练',
};

export type SportRules = {
  project: Project;
  version: string;
  activities: ActivityCode[];
  capabilities: Record<'management' | 'training' | 'special' | 'reference', SportCapability>;
};

const available = (): SportCapability => ({ status: 'available', reason: '' });
const pending = (reason: string): SportCapability => ({ status: 'pending_configuration', reason });

export function projectRules(input: unknown): SportRules | null {
  const project = normalizeProject(input);
  if (!project) return null;
  const water = projectCapability(project) !== null;
  const cycling = project === 'CYCLING_ROAD' || project === 'CYCLING_TRACK';
  const volleyball = project === 'VOLLEYBALL';
  const firstWave = water || cycling || volleyball;
  return {
    project,
    version: SPORT_RULES_VERSION,
    activities: [
      'unknown', 'strength', 'running', 'recovery',
      ...(water ? ['on_water', 'ergometer', 'cycling'] as const : []),
      ...(cycling ? ['cycling'] as const : []),
      ...(volleyball ? ['volleyball_technique'] as const : []),
    ],
    capabilities: {
      management: available(),
      training: firstWave ? available() : pending('公共填报可用，项目专属采集链路尚待配置。'),
      special: firstWave ? available() : pending('该项目专项分析尚待配置和验证。'),
      reference: pending('需匹配适用人群、测试协议和已审核参考标准。'),
    },
  };
}

export function isActivityCode(value: unknown): value is ActivityCode {
  return typeof value === 'string' && Object.hasOwn(ACTIVITY_LABELS, value);
}
