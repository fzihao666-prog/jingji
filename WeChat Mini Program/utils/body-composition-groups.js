const METRICS = [
  { key: 'weightKg', label: '体重', unit: 'kg' },
  { key: 'bodyFatPct', label: '体脂率', unit: '%' },
  { key: 'skeletalMuscleKg', label: '骨骼肌', unit: 'kg' },
  { key: 'muscleMassKg', label: '肌肉量', unit: 'kg' },
  { key: 'totalBodyWaterKg', label: '体水分', unit: 'kg' },
  { key: 'visceralFatLevel', label: '内脏脂肪等级', unit: '级' },
  { key: 'basalMetabolismKcal', label: '基础代谢', unit: 'kcal' }
];
const { number } = require('./format');

// 每项独立寻找最近两次有效实测，缺测不按零处理，也不跨指标比较。
function bodyCompositionSummary(history) {
  const records = (Array.isArray(history) ? history : [])
    .filter((record) => record && typeof record.measurementDate === 'string')
    .slice().sort((a, b) => b.measurementDate.localeCompare(a.measurementDate));
  const metrics = METRICS.map((definition) => {
    const points = records.flatMap((record) => {
      const item = (Array.isArray(record.items) ? record.items : []).find((entry) => entry.key === definition.key);
      return item && typeof item.value === 'number' && Number.isFinite(item.value) && item.value >= 0
        ? [{ date: record.measurementDate, value: item.value }] : [];
    });
    const latest = points[0];
    const previous = latest && points.find((point) => point.date !== latest.date);
    const delta = previous ? Number((latest.value - previous.value).toFixed(1)) : null;
    return {
      ...definition,
      latestText: latest ? number(latest.value) : '—',
      latestDate: latest ? latest.date : '',
      previousDate: previous ? previous.date : '',
      deltaText: delta == null ? '—' : delta === 0 ? '持平' : `${delta > 0 ? '+' : ''}${number(delta)}`,
      deltaUnit: delta == null || delta === 0 ? '' : definition.key === 'bodyFatPct' ? '个百分点' : definition.unit
    };
  });
  const latestDate = metrics.reduce((date, metric) => metric.latestDate > date ? metric.latestDate : date, '');
  const datedMetrics = metrics.map((metric) => ({ ...metric, isOlder: !!metric.latestDate && metric.latestDate !== latestDate }));
  return { hasData: !!latestDate, latestDate, core: datedMetrics.slice(0, 3), more: datedMetrics.slice(3).filter((metric) => metric.latestDate) };
}

module.exports = { bodyCompositionSummary };
