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

// 专项测试成绩按赛艇习惯显示为 m:ss.xx（如 0:55.15、6:30.74），与录入端 parseRaceTime 的口径对称。
function raceTime(ms) {
  if (ms == null) return '';
  const total = Number(ms);
  if (!Number.isFinite(total) || total < 0) return '';
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = (total % 60000) / 1000;
  const secondText = seconds.toFixed(2).padStart(5, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secondText}`
    : `${minutes}:${secondText}`;
}

// 与上次最好成绩的差值：负数代表更快（提升）。按绝对秒数展示，避免把差值套进 m:ss 造成误读。
function raceDelta(deltaMs) {
  if (deltaMs == null) return '';
  const delta = Number(deltaMs);
  if (!Number.isFinite(delta)) return '';
  const secondsText = `${(Math.abs(delta) / 1000).toFixed(2)}s`;
  if (delta < 0) return `较上次快 ${secondsText}`;
  if (delta > 0) return `较上次慢 ${secondsText}`;
  return '与上次持平';
}

module.exports = {
  ROLE_LABELS,
  INJURY_LABELS,
  STRENGTH_METRICS,
  number,
  maskIdentity,
  maskPhone,
  strengthMetricRows,
  raceTime,
  raceDelta
};
