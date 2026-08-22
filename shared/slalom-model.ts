import { analyzeCanoePeriod } from './canoe-model';
import type { RowingAnalysisRecord, RowingPeriodAnalysis } from './rowing-model';
import type { StrengthMetricKey, StrengthMetricValues } from './strength-model';

export const SLALOM_MODEL_STANDARD = {
  version: 'GJ-SLA-2026.08-R1',
  title: '激流回旋冠军模型',
  decision: '激流独立项目口径',
  decisionNote: '训练数据、运动员、队伍、测试与报告均与赛艇、皮划艇分开查询。',
  missingDataRule: '未测试项目显示“未测试”，不按0分处理，也不参与完成率。',
  zones: [
    { key: 'target', label: '冠军区间', color: '#168f8a', automation: '达到参考区间下限或更优' },
    { key: 'improve', label: '接近区间', color: '#d9a326', automation: '达到参考下限的85%—99.9%' },
    { key: 'practice', label: '重点补强', color: '#e87a35', automation: '低于参考下限的85%' },
    { key: 'alert', label: '数据复核', color: '#d94a3d', automation: '异常值或测试口径待确认' }
  ],
  latestAdditions: [
    { shortLabel: '力量与相对力量', status: '已接入', usage: '卧推、卧拉及其体重倍数按性别冠军区间对比' },
    { shortLabel: '上肢功率与耐力', status: '已接入', usage: '峰值功率、Wingate和2分钟次数独立比较' },
    { shortLabel: '激流专项能力', status: '已接入', usage: '阈功率、阈心率、300米成绩与握力按性别比较' }
  ]
} as const;

export type SlalomDirection = 'higher' | 'lower';
export type SlalomMetric = {
  key: string;
  label: string;
  unit: string;
  group: string;
  direction: SlalomDirection;
  sourceKey?: StrengthMetricKey;
  derive?: (values: StrengthMetricValues) => number | null;
  male?: readonly [number, number];
  female?: readonly [number, number];
};

const relative = (key: 'benchPressKg' | 'benchPullKg') => (values: StrengthMetricValues) => {
  const value = values[key];
  const weight = values.weightKg;
  return typeof value === 'number' && typeof weight === 'number' && weight > 0 ? value / weight : null;
};

export const SLALOM_CHAMPION_METRICS: SlalomMetric[] = [
  { key: 'benchPressKg', label: '卧推绝对重量', unit: 'kg', group: '基础力量', direction: 'higher', sourceKey: 'benchPressKg', male: [110, 130], female: [75, 92] },
  { key: 'benchPressRelative', label: '卧推相对力量', unit: '倍体重', group: '基础力量', direction: 'higher', derive: relative('benchPressKg'), male: [1.55, 1.85], female: [1.4, 1.7] },
  { key: 'benchPullKg', label: '卧拉绝对重量', unit: 'kg', group: '基础力量', direction: 'higher', sourceKey: 'benchPullKg', male: [105, 125], female: [72, 88] },
  { key: 'benchPullRelative', label: '卧拉相对力量', unit: '倍体重', group: '基础力量', direction: 'higher', derive: relative('benchPullKg'), male: [1.5, 1.8], female: [1.35, 1.65] },
  { key: 'benchPressPeakPowerW', label: '卧推峰值功率', unit: 'W', group: '上肢功率', direction: 'higher', sourceKey: 'benchPressPeakPowerW', male: [419, 641], female: [380, 470] },
  { key: 'benchPressRelativePowerWkg', label: '卧推相对功率', unit: 'W/kg', group: '上肢功率', direction: 'higher', sourceKey: 'benchPressRelativePowerWkg', male: [5.7, 8.5], female: [6, 7.2] },
  { key: 'benchPullPeakPowerW', label: '卧拉峰值功率', unit: 'W', group: '上肢功率', direction: 'higher', sourceKey: 'benchPullPeakPowerW', male: [501, 667], female: [410, 510] },
  { key: 'benchPullRelativePowerWkg', label: '卧拉相对功率', unit: 'W/kg', group: '上肢功率', direction: 'higher', sourceKey: 'benchPullRelativePowerWkg', male: [7.1, 8.7], female: [6.5, 7.8] },
  { key: 'wingatePeakPowerWkg', label: 'Wingate峰值功率', unit: 'W/kg', group: 'Wingate', direction: 'higher', sourceKey: 'wingatePeakPowerWkg', male: [8.8, 10.2] },
  { key: 'wingateWorkJkg', label: 'Wingate 30秒总做功', unit: 'J/kg', group: 'Wingate', direction: 'higher', sourceKey: 'wingateWorkJkg', male: [210, 250] },
  { key: 'wingateLactateMmol', label: 'Wingate乳酸峰值', unit: 'mmol/L', group: 'Wingate', direction: 'higher', sourceKey: 'wingateLactateMmol', male: [11.2, 14.6] },
  { key: 'benchPress2MinReps', label: '卧推2分钟', unit: '次', group: '肌耐力', direction: 'higher', sourceKey: 'benchPress2MinReps', male: [66, 78], female: [57, 69] },
  { key: 'benchPull2MinReps', label: '卧拉2分钟', unit: '次', group: '肌耐力', direction: 'higher', sourceKey: 'benchPull2MinReps', male: [74, 89], female: [64, 77] },
  { key: 'thresholdErgPowerW', label: '乳酸阈测功仪功率', unit: 'W', group: '专项能力', direction: 'higher', sourceKey: 'thresholdErgPowerW', male: [170, 190], female: [140, 160] },
  { key: 'anaerobicThresholdHr', label: '无氧阈心率', unit: '次/分', group: '专项能力', direction: 'higher', sourceKey: 'anaerobicThresholdHr', male: [155, 175], female: [150, 170] },
  { key: 'sprint300Sec', label: '300米静水竞速', unit: '秒', group: '专项能力', direction: 'lower', sourceKey: 'sprint300Sec', male: [99, 108], female: [110, 122] },
  { key: 'leftGripKgf', label: '左手握力', unit: 'kgf', group: '握力', direction: 'higher', sourceKey: 'leftGripKgf', female: [32.8, 43.2] },
  { key: 'rightGripKgf', label: '右手握力', unit: 'kgf', group: '握力', direction: 'higher', sourceKey: 'rightGripKgf', female: [35.3, 42.7] }
];

export function slalomMetricValue(metric: SlalomMetric, values: StrengthMetricValues) {
  if (metric.derive) return metric.derive(values);
  const value = metric.sourceKey ? values[metric.sourceKey] : undefined;
  return typeof value === 'number' ? value : null;
}

export function slalomComparison(metric: SlalomMetric, values: StrengthMetricValues, gender: string) {
  const range = gender.includes('女') ? metric.female : metric.male;
  const value = slalomMetricValue(metric, values);
  if (!range) return { value, range: null, percent: null, status: 'no-standard' as const };
  if (value === null) return { value, range, percent: null, status: 'missing' as const };
  const threshold = metric.direction === 'higher' ? range[0] : range[1];
  const percent = metric.direction === 'higher' ? value / threshold * 100 : threshold / value * 100;
  return {
    value,
    range,
    percent: Math.round(percent * 10) / 10,
    status: percent >= 100 ? 'target' as const : percent >= 85 ? 'improve' as const : 'practice' as const
  };
}

export function analyzeSlalomPeriod(records: RowingAnalysisRecord[]): RowingPeriodAnalysis {
  const analysis = analyzeCanoePeriod(records);
  return {
    ...analysis,
    recommendations: analysis.recommendations.map((item) => item.replaceAll('皮划艇', '激流')),
    unavailableMetrics: ['赛道门区分段', '桨频与航速', '乳酸阈测功仪功率', '300米专项训练']
  };
}
