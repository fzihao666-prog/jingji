const ROLE_LABELS = {
  ATL: '运动员',
  SCC: '队伍体能教练',
  PRJ: '项目负责人',
  REG: '区域负责人',
  TD: '训练总监',
  DMD: '数据监控总监'
};

const INJURY_LABELS = {
  healthy: '健康',
  observation: '观察',
  restricted: '受限',
  rehab: '康复',
  suspended: '停训'
};

const STRENGTH_METRICS = {
  heightCm: ['身高', 'cm'], weightKg: ['体重', 'kg'], bodyFatPct: ['体脂率', '%'],
  trainingYears: ['训练年限', '年'], armSpanCm: ['臂展', 'cm'], sitReachCm: ['坐位体前屈', 'cm'],
  verticalJumpCm: ['垂直纵跳', 'cm'], pullUpsReps: ['引体向上', '次'], benchPressKg: ['卧推', 'kg'],
  benchPullKg: ['卧拉', 'kg'], frontPlankSec: ['俯卧支撑', '秒'], leftPlankSec: ['左侧支撑', '秒'],
  rightPlankSec: ['右侧支撑', '秒'], squatKg: ['深蹲', 'kg'], deadliftKg: ['硬拉', 'kg'],
  highPullKg: ['高翻/高拉', 'kg'], leftSingleLegSquatReps: ['左侧单腿蹲', '次'],
  rightSingleLegSquatReps: ['右侧单腿蹲', '次'], benchPressPeakPowerW: ['卧推峰值功率', 'W'],
  benchPullPeakPowerW: ['卧拉峰值功率', 'W'], wingatePeakPowerWkg: ['Wingate峰值功率', 'W/kg']
};

function number(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const rounded = numeric.toFixed(digits);
  return digits ? rounded.replace(/\.0+$/, '') : rounded;
}

function maskIdentity(value) {
  if (!value) return '未录入';
  if (value.length < 8) return '已保护';
  return `${value.slice(0, 3)}***********${value.slice(-4)}`;
}

function maskPhone(value) {
  if (!value) return '未录入';
  if (value.length < 7) return '已保护';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function strengthMetricRows(test) {
  if (!test || !test.metrics) return [];
  return Object.keys(test.metrics).flatMap((key) => {
    const value = test.metrics[key];
    const definition = STRENGTH_METRICS[key];
    if (!definition || typeof value !== 'number') return [];
    const target = test.targets && typeof test.targets[key] === 'number' ? test.targets[key] : null;
    const rate = target && target > 0 ? Math.min(120, value / target * 100) : null;
    return [{ key, label: definition[0], unit: definition[1], value: number(value), target: target === null ? '—' : number(target), rate: rate === null ? '—' : `${number(rate, 0)}%`, rateWidth: rate === null ? 0 : Math.min(100, rate) }];
  });
}

module.exports = {
  ROLE_LABELS,
  INJURY_LABELS,
  STRENGTH_METRICS,
  number,
  maskIdentity,
  maskPhone,
  strengthMetricRows
};
