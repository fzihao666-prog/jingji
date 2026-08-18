export type StrengthMetricKey =
  | 'heightCm'
  | 'weightKg'
  | 'armSpanCm'
  | 'sitReachCm'
  | 'verticalJumpCm'
  | 'pullUpsReps'
  | 'benchPressKg'
  | 'benchPullKg'
  | 'frontPlankSec'
  | 'leftPlankSec'
  | 'rightPlankSec'
  | 'squatKg'
  | 'deadliftKg'
  | 'highPullKg'
  | 'leftSingleLegSquatReps'
  | 'rightSingleLegSquatReps'
  | 'benchPressPeakPowerW'
  | 'benchPressRelativePowerWkg'
  | 'benchPullPeakPowerW'
  | 'benchPullRelativePowerWkg'
  | 'wingatePeakPowerWkg'
  | 'wingateWorkJkg'
  | 'wingateLactateMmol'
  | 'benchPress2MinReps'
  | 'benchPull2MinReps'
  | 'thresholdErgPowerW'
  | 'anaerobicThresholdHr'
  | 'sprint300Sec'
  | 'leftGripKgf'
  | 'rightGripKgf';

export type StrengthMetricValues = Partial<Record<StrengthMetricKey, number>>;

export const STRENGTH_GROUPS = {
  morphology: { label: '身体形态', color: '#1f9e97' },
  foundation: { label: '基础力量', color: '#d64b3f' },
  core: { label: '核心稳定', color: '#219b63' },
  balance: { label: '力量耐力', color: '#234f8e' },
  explosive: { label: '爆发与柔韧', color: '#d79617' },
  slalom: { label: '激流专项测试', color: '#0f8d98' }
} as const;

export type StrengthGroupKey = keyof typeof STRENGTH_GROUPS;

export const STRENGTH_METRICS: Array<{
  key: StrengthMetricKey;
  label: string;
  unit: string;
  group: StrengthGroupKey;
  min: number;
  max: number;
  targetEnabled: boolean;
  projects?: string[];
}> = [
  { key: 'heightCm', label: '身高', unit: 'cm', group: 'morphology', min: 100, max: 230, targetEnabled: false },
  { key: 'weightKg', label: '体重', unit: 'kg', group: 'morphology', min: 30, max: 200, targetEnabled: false },
  { key: 'armSpanCm', label: '臂展', unit: 'cm', group: 'morphology', min: 100, max: 250, targetEnabled: false },
  { key: 'sitReachCm', label: '坐位体前屈', unit: 'cm', group: 'explosive', min: -30, max: 60, targetEnabled: true },
  { key: 'verticalJumpCm', label: '垂直纵跳', unit: 'cm', group: 'explosive', min: 0, max: 120, targetEnabled: true },
  { key: 'pullUpsReps', label: '引体向上', unit: '次', group: 'balance', min: 0, max: 100, targetEnabled: true },
  { key: 'benchPressKg', label: '卧推', unit: 'kg', group: 'foundation', min: 0, max: 350, targetEnabled: true },
  { key: 'benchPullKg', label: '卧拉', unit: 'kg', group: 'foundation', min: 0, max: 350, targetEnabled: true },
  { key: 'frontPlankSec', label: '俯卧支撑', unit: '秒', group: 'core', min: 0, max: 900, targetEnabled: true },
  { key: 'leftPlankSec', label: '左侧支撑', unit: '秒', group: 'core', min: 0, max: 900, targetEnabled: true },
  { key: 'rightPlankSec', label: '右侧支撑', unit: '秒', group: 'core', min: 0, max: 900, targetEnabled: true },
  { key: 'squatKg', label: '深蹲', unit: 'kg', group: 'foundation', min: 0, max: 450, targetEnabled: true },
  { key: 'deadliftKg', label: '硬拉', unit: 'kg', group: 'foundation', min: 0, max: 500, targetEnabled: true },
  { key: 'highPullKg', label: '高翻/高拉', unit: 'kg', group: 'explosive', min: 0, max: 300, targetEnabled: true },
  { key: 'leftSingleLegSquatReps', label: '左侧单腿蹲', unit: '次', group: 'balance', min: 0, max: 100, targetEnabled: true },
  { key: 'rightSingleLegSquatReps', label: '右侧单腿蹲', unit: '次', group: 'balance', min: 0, max: 100, targetEnabled: true },
  { key: 'benchPressPeakPowerW', label: '卧推峰值功率', unit: 'W', group: 'slalom', min: 0, max: 1500, targetEnabled: false, projects: ['激流'] },
  { key: 'benchPressRelativePowerWkg', label: '卧推相对功率', unit: 'W/kg', group: 'slalom', min: 0, max: 20, targetEnabled: false, projects: ['激流'] },
  { key: 'benchPullPeakPowerW', label: '卧拉峰值功率', unit: 'W', group: 'slalom', min: 0, max: 1500, targetEnabled: false, projects: ['激流'] },
  { key: 'benchPullRelativePowerWkg', label: '卧拉相对功率', unit: 'W/kg', group: 'slalom', min: 0, max: 20, targetEnabled: false, projects: ['激流'] },
  { key: 'wingatePeakPowerWkg', label: 'Wingate峰值功率', unit: 'W/kg', group: 'slalom', min: 0, max: 30, targetEnabled: false, projects: ['激流'] },
  { key: 'wingateWorkJkg', label: 'Wingate 30秒总做功', unit: 'J/kg', group: 'slalom', min: 0, max: 600, targetEnabled: false, projects: ['激流'] },
  { key: 'wingateLactateMmol', label: 'Wingate乳酸峰值', unit: 'mmol/L', group: 'slalom', min: 0, max: 30, targetEnabled: false, projects: ['激流'] },
  { key: 'benchPress2MinReps', label: '卧推2分钟', unit: '次', group: 'slalom', min: 0, max: 200, targetEnabled: false, projects: ['激流'] },
  { key: 'benchPull2MinReps', label: '卧拉2分钟', unit: '次', group: 'slalom', min: 0, max: 200, targetEnabled: false, projects: ['激流'] },
  { key: 'thresholdErgPowerW', label: '乳酸阈测功仪功率', unit: 'W', group: 'slalom', min: 0, max: 600, targetEnabled: false, projects: ['激流'] },
  { key: 'anaerobicThresholdHr', label: '无氧阈心率', unit: '次/分', group: 'slalom', min: 30, max: 240, targetEnabled: false, projects: ['激流'] },
  { key: 'sprint300Sec', label: '300米静水竞速', unit: '秒', group: 'slalom', min: 30, max: 300, targetEnabled: false, projects: ['激流'] },
  { key: 'leftGripKgf', label: '左手握力', unit: 'kgf', group: 'slalom', min: 0, max: 120, targetEnabled: false, projects: ['激流'] },
  { key: 'rightGripKgf', label: '右手握力', unit: 'kgf', group: 'slalom', min: 0, max: 120, targetEnabled: false, projects: ['激流'] }
];

export const STRENGTH_METRIC_MAP = Object.fromEntries(
  STRENGTH_METRICS.map((metric) => [metric.key, metric])
) as Record<StrengthMetricKey, (typeof STRENGTH_METRICS)[number]>;

export function metricDifference(value?: number, target?: number) {
  if (typeof value !== 'number' || typeof target !== 'number' || target === 0) return null;
  return Math.round((value - target) / target * 1000) / 10;
}

export function strengthEvaluation(metrics: StrengthMetricValues, targets: StrengthMetricValues) {
  const comparisons = STRENGTH_METRICS
    .filter((metric) => metric.targetEnabled && !metric.projects)
    .map((metric) => ({
      ...metric,
      value: metrics[metric.key],
      target: targets[metric.key],
      difference: metricDifference(metrics[metric.key], targets[metric.key])
    }))
    .filter((metric) => typeof metric.value === 'number' && typeof metric.target === 'number' && metric.difference !== null);
  const achieved = comparisons.filter((metric) => (metric.difference ?? -Infinity) >= 0);
  const gaps = comparisons.filter((metric) => (metric.difference ?? 0) < 0).sort((left, right) => (left.difference ?? 0) - (right.difference ?? 0));
  const strengths = [...achieved].sort((left, right) => (right.difference ?? 0) - (left.difference ?? 0));
  const parts: string[] = [];

  if (comparisons.length) {
    parts.push(`本次共有${comparisons.length}项指标设置了教练目标，其中${achieved.length}项达到或超过目标。`);
    if (strengths.length) parts.push(`完成较好的指标为${strengths.slice(0, 3).map((item) => item.label).join('、')}。`);
    if (gaps.length) parts.push(`距离目标较大的指标为${gaps.slice(0, 3).map((item) => `${item.label}${Math.abs(item.difference ?? 0).toFixed(1)}%`).join('、')}，建议作为下一阶段补强重点。`);
  } else {
    parts.push('本次尚未录入教练目标值，档案仅展示实测结果，不进行达标判断。');
  }

  const symmetryPairs: Array<[StrengthMetricKey, StrengthMetricKey, string]> = [
    ['leftPlankSec', 'rightPlankSec', '左右侧支撑'],
    ['leftSingleLegSquatReps', 'rightSingleLegSquatReps', '左右单腿蹲']
  ];
  const symmetryNotes = symmetryPairs.flatMap(([leftKey, rightKey, label]) => {
    const left = metrics[leftKey];
    const right = metrics[rightKey];
    if (typeof left !== 'number' || typeof right !== 'number' || Math.max(left, right) === 0) return [];
    const difference = Math.round(Math.abs(left - right) / Math.max(left, right) * 1000) / 10;
    const weaker = left === right ? '两侧一致' : left < right ? '左侧较低' : '右侧较低';
    return [`${label}差异${difference.toFixed(1)}%，${weaker}`];
  });
  if (symmetryNotes.length) parts.push(`${symmetryNotes.join('；')}。`);

  const weight = metrics.weightKg;
  const relativeRows = ([
    ['benchPullKg', '卧拉'],
    ['squatKg', '深蹲'],
    ['deadliftKg', '硬拉']
  ] as Array<[StrengthMetricKey, string]>).flatMap(([key, label]) => {
    const value = metrics[key];
    if (typeof value !== 'number' || typeof weight !== 'number' || weight <= 0) return [];
    return [`${label}${(value / weight).toFixed(2)}倍体重`];
  });
  if (relativeRows.length) parts.push(`相对力量：${relativeRows.join('、')}。`);
  return parts.join('');
}
