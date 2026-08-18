import type { RowingAnalysisRecord, RowingPeriodAnalysis } from './rowing-model';

export const CANOE_MODEL_STANDARD = {
  version: 'GJ-CAN-2026.07-R1',
  title: '皮划艇训练负荷监测标准',
  decision: '独立项目口径',
  decisionNote: '皮划艇与赛艇分别统计；当前仅依据训练负荷、恢复状态和教练标记进行周期判断。',
  missingDataRule: '未采集的数据统一显示“未测试”，不按0分处理。',
  zones: [
    { key: 'target', label: '目标区', color: '#168f8a', automation: '正常状态' },
    { key: 'improve', label: '可改善区', color: '#d9a326', automation: '关注状态' },
    { key: 'practice', label: '重点练习区', color: '#e87a35', automation: '等待教练确认专项阈值' },
    { key: 'alert', label: '预警区', color: '#d94a3d', automation: '异常状态' }
  ],
  latestAdditions: [
    { shortLabel: '桨频 / 航速', status: '建议采集', usage: '用于皮划艇专项技术效率的个人纵向分析' },
    { shortLabel: '分段配速', status: '建议采集', usage: '按200米、500米、1000米等距离建立个人基线' },
    { shortLabel: '左右功率差', status: '待确认', usage: '仅在双侧功率设备口径一致时使用' }
  ]
} as const;

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function distribution(records: RowingAnalysisRecord[], key: (record: RowingAnalysisRecord) => string) {
  const values = new Map<string, number>();
  for (const record of records) {
    const label = key(record).trim() || '未分类';
    values.set(label, (values.get(label) || 0) + record.durationMin);
  }
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  return [...values.entries()].map(([label, minutes]) => ({ label, minutes, ratio: total ? Math.round(minutes / total * 1000) / 10 : 0 })).sort((a, b) => b.minutes - a.minutes);
}

export function analyzeCanoePeriod(records: RowingAnalysisRecord[]): RowingPeriodAnalysis {
  const training = records.filter((record) => record.status !== 'rest');
  const alertCount = records.filter((record) => record.status === 'alert').length;
  const attentionCount = records.filter((record) => record.status === 'attention').length;
  const normalCount = records.filter((record) => record.status === 'normal').length;
  const tracked = training.flatMap((record) => [record.rpe, record.morningPulse, record.weightKg, record.sleepHours, record.fatigueIndex]);
  const available = tracked.filter((value) => typeof value === 'number' && Number.isFinite(value)).length;
  const dataCoverage = tracked.length ? Math.round(available / tracked.length * 1000) / 10 : 0;
  const status = alertCount
    ? { key: 'alert' as const, label: '预警区', color: '#d94a3d', basis: '本期存在已标记异常记录' }
    : attentionCount
      ? { key: 'improve' as const, label: '可改善区', color: '#d9a326', basis: '本期存在已标记关注记录' }
      : normalCount
        ? { key: 'target' as const, label: '目标区', color: '#168f8a', basis: '本期记录均为正常或恢复状态' }
        : { key: 'unrated' as const, label: '未评级', color: '#7f9098', basis: '缺少可用于分级的训练状态数据' };
  const recommendations: string[] = [];
  if (!records.length) recommendations.push('本期没有皮划艇训练记录，请先补充数据。');
  if (alertCount) recommendations.push(`复核${alertCount}条异常记录，由教练确认训练调整与恢复安排。`);
  if (!alertCount && attentionCount) recommendations.push(`持续跟踪${attentionCount}条关注记录，下次训练前完成教练复核。`);
  if (training.length && dataCoverage < 80) recommendations.push('RPE、晨脉、睡眠和疲劳数据完整率不足80%，建议补齐后再判断趋势。');
  if (training.length && !alertCount && !attentionCount) recommendations.push('维持当前皮划艇训练节奏，继续用统一口径记录距离、强度、桨频和恢复指标。');
  return {
    status,
    sessions: training.length,
    trainingDays: new Set(records.map((record) => record.date)).size,
    totalDurationMin: training.reduce((sum, record) => sum + record.durationMin, 0),
    totalDistanceKm: training.reduce((sum, record) => sum + record.distanceKm, 0),
    totalSrpe: training.reduce((sum, record) => sum + record.srpe, 0),
    totalSmvl: training.reduce((sum, record) => sum + record.smvl, 0),
    averageRpe: average(training.map((record) => record.rpe)),
    averageSleepHours: average(records.map((record) => record.sleepHours)),
    averageFatigueIndex: average(records.map((record) => record.fatigueIndex)),
    averageMorningPulse: average(records.map((record) => record.morningPulse)),
    averageWeightKg: average(records.map((record) => record.weightKg)),
    dataCoverage,
    alertCount,
    attentionCount,
    distributions: {
      trainingTypes: distribution(training, (record) => record.structureType || record.trainingType),
      intensityZones: distribution(training, (record) => record.intensityZone === '-' ? '未分区' : record.intensityZone)
    },
    recommendations,
    unavailableMetrics: ['桨频与航速', '分段配速', '左右功率差', '乳酸与心率阈值']
  };
}
