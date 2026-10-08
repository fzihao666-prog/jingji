const GROUPS = [
  { key: 'weight-fat', label: '体重与脂肪', keys: ['weightKg', 'bodyFatPct', 'visceralFatLevel'] },
  { key: 'muscle', label: '肌肉', keys: ['skeletalMuscleKg', 'muscleMassKg'] },
  { key: 'water-metabolism', label: '水分与代谢', keys: ['totalBodyWaterKg', 'basalMetabolismKcal'] }
];

// 保留原始趋势数组索引，分组重排后点击柱体仍指向正确的实测明细。
function bodyCompositionGroups(metrics) {
  const indexed = (Array.isArray(metrics) ? metrics : []).map((metric, metricIndex) => ({ ...metric, metricIndex }));
  const knownKeys = GROUPS.flatMap((group) => group.keys);
  return [...GROUPS, { key: 'other', label: '其他指标', keys: indexed.filter((metric) => !knownKeys.includes(metric.key)).map((metric) => metric.key) }]
    .map((group) => {
      const items = indexed.filter((metric) => group.keys.includes(metric.key));
      return { key: group.key, label: group.label, metrics: items, summary: items.map((metric) => metric.label).join(' · ') };
    })
    .filter((group) => group.metrics.length)
    .map((group, index) => ({ ...group, expanded: index === 0 }));
}

module.exports = { bodyCompositionGroups };
