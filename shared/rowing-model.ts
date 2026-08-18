export type RowingAnalysisStatus = 'normal' | 'attention' | 'alert' | 'rest' | 'missing';

export type RowingAnalysisRecord = {
  date: string;
  trainingType: string;
  structureType: string;
  intensityZone: string;
  durationMin: number;
  distanceKm: number;
  rpe: number | null;
  srpe: number;
  smvl: number;
  morningPulse: number | null;
  weightKg: number | null;
  sleepHours: number | null;
  fatigueIndex: number | null;
  status: RowingAnalysisStatus;
};

export type RowingPeriodAnalysis = {
  status: {
    key: 'target' | 'improve' | 'alert' | 'unrated';
    label: string;
    color: string;
    basis: string;
  };
  sessions: number;
  trainingDays: number;
  totalDurationMin: number;
  totalDistanceKm: number;
  totalSrpe: number;
  totalSmvl: number;
  averageRpe: number | null;
  averageSleepHours: number | null;
  averageFatigueIndex: number | null;
  averageMorningPulse: number | null;
  averageWeightKg: number | null;
  dataCoverage: number;
  alertCount: number;
  attentionCount: number;
  distributions: {
    trainingTypes: Array<{ label: string; minutes: number; ratio: number }>;
    intensityZones: Array<{ label: string; minutes: number; ratio: number }>;
  };
  recommendations: string[];
  unavailableMetrics: string[];
};

export const ROWING_MODEL_STANDARD = {
  version: 'GJ-ROW-2026.07-R1',
  title: '国家赛艇队数据分析模型体系',
  decision: '保留原分级，新增监测项',
  decisionNote: '截至2026年7月，未发现可公开验证、可直接替换现有国家队阈值的统一数值分级表。',
  missingDataRule: '未采集的数据统一显示“未测试”，不按0分处理。',
  zones: [
    { key: 'target', label: '目标区', color: '#1a9b83', automation: '现有正常状态可自动归入' },
    { key: 'improve', label: '可改善区', color: '#d9a326', automation: '现有关注状态可自动归入' },
    { key: 'practice', label: '重点练习区', color: '#e87a35', automation: '等待专家确认数值边界' },
    { key: 'alert', label: '预警区', color: '#d94a3d', automation: '现有异常状态可自动归入' }
  ],
  scoreScales: [
    { label: '一般体能', maximum: 100 },
    { label: '重要基础体能', maximum: 160 },
    { label: '专项基础', maximum: 200 },
    { label: '专项成绩', maximum: 250 }
  ],
  confirmedRules: [
    { label: '力量缺陷 DSD', rule: '<0.60 爆发力/快速力量偏弱；0.60–0.81 相对均衡；>0.81 最大力量偏弱' },
    { label: '相对力量', rule: '绝对力量 ÷ 体重' },
    { label: '力量训练量', rule: '组数 × 次数 × 负重' },
    { label: '训练完成率', rule: '实际完成量 ÷ 计划训练量 × 100%' }
  ],
  latestAdditions: [
    {
      label: '6km次最大强度功率/运动心率效率',
      shortLabel: '6km PO/HR',
      status: '建议新增',
      evidence: '2026同行评议研究',
      usage: '用于个人纵向监测，不作为全国统一等级阈值'
    },
    {
      label: '血氧状态',
      shortLabel: '血氧',
      status: '建议预留',
      evidence: 'World Rowing 2026规则更新',
      usage: '作为比赛期可采集数据字段，不直接参与评分'
    },
    {
      label: '船速、桨频、单桨距离与舟桨效率',
      shortLabel: '艇上效率',
      status: '建议新增',
      evidence: 'World Rowing数据规范与2026国家队研究',
      usage: '用于技术表现分析，建立本队个人基线后再分级'
    }
  ],
  expertPending: [
    'Wingate分级区间',
    '左右侧不对称阈值',
    '生理生化风险星级阈值',
    'Z-Score参考人群、均值与标准差',
    '综合冠军模型权重'
  ]
} as const;

function nullableAverage(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function distribution(
  records: RowingAnalysisRecord[],
  key: (record: RowingAnalysisRecord) => string
) {
  const map = new Map<string, number>();
  for (const record of records) {
    const label = key(record).trim() || '未分类';
    map.set(label, (map.get(label) || 0) + record.durationMin);
  }
  const total = [...map.values()].reduce((sum, value) => sum + value, 0);
  return [...map.entries()]
    .map(([label, minutes]) => ({
      label,
      minutes,
      ratio: total ? Math.round(minutes / total * 1000) / 10 : 0
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function analyzeRowingPeriod(records: RowingAnalysisRecord[]): RowingPeriodAnalysis {
  const training = records.filter((record) => record.status !== 'rest');
  const alertCount = records.filter((record) => record.status === 'alert').length;
  const attentionCount = records.filter((record) => record.status === 'attention').length;
  const normalCount = records.filter((record) => record.status === 'normal').length;
  const trackedValues = training.flatMap((record) => [
    record.rpe,
    record.morningPulse,
    record.weightKg,
    record.sleepHours,
    record.fatigueIndex
  ]);
  const availableValues = trackedValues.filter((value) => typeof value === 'number' && Number.isFinite(value)).length;
  const dataCoverage = trackedValues.length ? Math.round(availableValues / trackedValues.length * 1000) / 10 : 0;

  const status = alertCount
    ? { key: 'alert' as const, label: '预警区', color: '#d94a3d', basis: '本期存在已标记异常记录' }
    : attentionCount
      ? { key: 'improve' as const, label: '可改善区', color: '#d9a326', basis: '本期存在已标记关注记录' }
      : normalCount
        ? { key: 'target' as const, label: '目标区', color: '#1a9b83', basis: '本期记录均为正常或恢复状态' }
        : { key: 'unrated' as const, label: '未评级', color: '#7f9098', basis: '缺少可用于分级的训练状态数据' };

  const recommendations: string[] = [];
  if (!records.length) recommendations.push('本期没有训练记录，请先补充数据。');
  if (alertCount) recommendations.push(`复核${alertCount}条异常记录，由教练确认训练调整与恢复安排。`);
  if (!alertCount && attentionCount) recommendations.push(`持续跟踪${attentionCount}条关注记录，下一训练日前完成教练复核。`);
  if (training.length && dataCoverage < 80) recommendations.push('晨脉、体重、睡眠、疲劳和RPE数据完整率不足80%，建议先补齐再做趋势判断。');
  if (training.length && !alertCount && !attentionCount) recommendations.push('维持当前训练节奏，继续用相同口径记录负荷与恢复指标。');

  return {
    status,
    sessions: training.length,
    trainingDays: new Set(records.map((record) => record.date)).size,
    totalDurationMin: training.reduce((sum, record) => sum + record.durationMin, 0),
    totalDistanceKm: training.reduce((sum, record) => sum + record.distanceKm, 0),
    totalSrpe: training.reduce((sum, record) => sum + record.srpe, 0),
    totalSmvl: training.reduce((sum, record) => sum + record.smvl, 0),
    averageRpe: nullableAverage(training.map((record) => record.rpe)),
    averageSleepHours: nullableAverage(records.map((record) => record.sleepHours)),
    averageFatigueIndex: nullableAverage(records.map((record) => record.fatigueIndex)),
    averageMorningPulse: nullableAverage(records.map((record) => record.morningPulse)),
    averageWeightKg: nullableAverage(records.map((record) => record.weightKg)),
    dataCoverage,
    alertCount,
    attentionCount,
    distributions: {
      trainingTypes: distribution(training, (record) => record.structureType || record.trainingType),
      intensityZones: distribution(training, (record) => record.intensityZone === '-' ? '未分区' : record.intensityZone)
    },
    recommendations,
    unavailableMetrics: ['2km/5km/6km测功仪成绩', 'VO₂max与乳酸阈', '7桨功率', 'CMJ与DSD', '艇上效率指标']
  };
}
