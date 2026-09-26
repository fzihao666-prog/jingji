const { roleLabels: ROLE_LABELS, strengthMetrics: STRENGTH_METRICS } = require('../data/format-data');

const INJURY_LABELS = {
  healthy: '健康',
  observation: '观察',
  restricted: '受限',
  rehab: '康复',
  suspended: '停训'
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
