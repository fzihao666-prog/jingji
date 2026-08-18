export const ROLE_META = {
  ATL: {
    code: 'ATL',
    label: '运动员',
    level: 1,
    scope: '仅本人数据'
  },
  SCC: {
    code: 'SCC',
    label: '队伍体能教练',
    level: 2,
    scope: '本人负责队伍'
  },
  PRJ: {
    code: 'PRJ',
    label: '项目负责人',
    level: 3,
    scope: '授权区域内本项目'
  },
  REG: {
    code: 'REG',
    label: '区域负责人',
    level: 3,
    scope: '本区域授权项目'
  },
  TD: {
    code: 'TD',
    label: '训练总监',
    level: 4,
    scope: '管辖区域全部训练数据'
  },
  DMD: {
    code: 'DMD',
    label: '数据监控总监',
    level: 5,
    scope: '管辖区域全部数据'
  }
} as const;

export type Role = keyof typeof ROLE_META;

export const ROLES = Object.keys(ROLE_META) as Role[];

export const ROLE_HIERARCHY: Role[][] = [
  ['DMD'],
  ['TD'],
  ['PRJ', 'REG'],
  ['SCC'],
  ['ATL']
];

export const AREA_LEVEL_META = {
  national: { label: '全国', rank: 4 },
  province: { label: '省级', rank: 3 },
  city: { label: '市级', rank: 2 },
  county: { label: '区县级', rank: 1 }
} as const;

export type AreaLevel = keyof typeof AREA_LEVEL_META;

export const AREA_LEVELS = Object.keys(AREA_LEVEL_META) as AreaLevel[];

export function canManageRole(manager: Role, target: Role) {
  return ROLE_META[manager].level > ROLE_META[target].level;
}

export function legacyRoleToCode(role: string): Role | null {
  const map: Record<string, Role> = {
    athlete: 'ATL',
    coach: 'SCC',
    project: 'PRJ',
    project_lead: 'PRJ',
    regional: 'REG',
    executive: 'TD',
    training_director: 'TD',
    admin: 'DMD',
    data_director: 'DMD',
    ATL: 'ATL',
    SCC: 'SCC',
    PRJ: 'PRJ',
    REG: 'REG',
    TD: 'TD',
    DMD: 'DMD'
  };
  return map[role] || null;
}
