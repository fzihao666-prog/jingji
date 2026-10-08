const TRAINING_KEYS = ['trainingDuration', 'trainingLoad', 'specialDistance'];

// 测试指标数量不固定，每块最多四项，避免折叠组内仍出现过长列表。
function trainingComparisonGroups(items) {
  const list = Array.isArray(items) ? items : [];
  const categories = [
    { key: 'training', label: '训练量与负荷', metrics: list.filter((item) => TRAINING_KEYS.includes(item.key)) },
    { key: 'body', label: '身体指标', metrics: list.filter((item) => item.key === 'weightKg') },
    { key: 'tests', label: '体能测试', metrics: list.filter((item) => item.key.startsWith('measurement:')) },
    { key: 'other', label: '其他指标', metrics: list.filter((item) => !TRAINING_KEYS.includes(item.key) && item.key !== 'weightKg' && !item.key.startsWith('measurement:')) }
  ];
  return categories.flatMap((category) => {
    const groups = [];
    for (let start = 0; start < category.metrics.length; start += 4) {
      const metrics = category.metrics.slice(start, start + 4);
      const part = start / 4 + 1;
      const total = Math.ceil(category.metrics.length / 4);
      groups.push({
        key: `${category.key}-${part}`,
        label: total > 1 ? `${category.label} ${part}/${total}` : category.label,
        summary: metrics.map((metric) => metric.label).join(' · '),
        metrics
      });
    }
    return groups;
  }).map((group, index) => ({ ...group, expanded: index === 0 }));
}

module.exports = { trainingComparisonGroups };
