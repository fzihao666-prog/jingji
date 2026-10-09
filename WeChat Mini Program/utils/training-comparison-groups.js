const METRICS = [
  { key: 'trainingDuration', label: '训练时长', unit: 'h', scale: 1 / 60 },
  { key: 'trainingLoad', label: '累计负荷', unit: 'AU', scale: 1 },
  { key: 'specialDistance', label: '专项距离', unit: 'km', scale: 1 }
];
const { number } = require('./format');

function validValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function displayValue(value, scale) {
  if (value == null) return '—';
  const scaled = value * scale;
  return scaled > 0 && scaled < 0.1 ? '＜0.1' : number(scaled);
}

// 只展示同周期训练投入、负荷与专项训练量；百分比表示差异，不用于优劣评价。
function trainingComparisonSummary(comparison) {
  const items = comparison && Array.isArray(comparison.items) ? comparison.items : [];
  const metrics = METRICS.map((definition) => {
    const item = items.find((entry) => entry && entry.key === definition.key) || {};
    const personal = validValue(item.personalValue);
    const sample = Number.isInteger(item.teamSampleCount) && item.teamSampleCount >= 2 ? item.teamSampleCount : null;
    const team = item.teamSampleCount != null && sample == null ? null : validValue(item.teamMean);
    let referenceText = '暂无可比队均';
    if (personal == null) referenceText = '个人未记录';
    else if (team != null) {
      if (personal === team) referenceText = '与队均持平';
      else if (team === 0) referenceText = '队均为 0，暂不计算比例';
      else {
        const percent = Math.round(Math.abs((personal - team) / team) * 1000) / 10;
        referenceText = percent === 0 ? '接近队均' : `${personal > team ? '高于' : '低于'}队均 ${number(percent)}%`;
      }
    }
    return {
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      personalText: displayValue(personal, definition.scale),
      teamText: displayValue(team, definition.scale),
      referenceText,
      sampleText: team != null && sample != null ? `${sample} 人参照` : '',
      hasData: personal != null || team != null
    };
  });
  return { metrics, hasData: metrics.some((metric) => metric.hasData) };
}

module.exports = { trainingComparisonSummary };
