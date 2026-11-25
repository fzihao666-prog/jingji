// 状态检测页的纯视图逻辑：状态指标卡、单指标趋势、历史记录与教练队伍概览。
// 只做展示口径换算：缺失显 '--'、真实 0 显 0，不生成医学判断。

function statusValue(value) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  return String(Number(value));
}

// 六项状态指标：前五项来自恢复日报，RPE 来自训练课次（与晨间疲劳分列）。
function statusMetricCards(record, rpeValue) {
  const row = record || {};
  return [
    { key: 'sleepHours', label: '睡眠时长', value: statusValue(row.sleepHours), unit: '小时', note: '晨间自评' },
    { key: 'morningPulse', label: '晨脉', value: statusValue(row.morningPulse), unit: 'bpm', note: '晨间自评' },
    { key: 'weightKg', label: '体重', value: statusValue(row.weightKg), unit: 'kg', note: '晨间自评' },
    { key: 'fatigueIndex', label: '主观疲劳', value: statusValue(row.fatigueIndex), unit: '分', note: '0–10 · 晨间疲劳' },
    { key: 'sorenessIndex', label: '肌肉酸痛', value: statusValue(row.sorenessIndex), unit: '分', note: '0–10 · 晨间自评' },
    { key: 'rpe', label: 'RPE', value: statusValue(rpeValue), unit: '分', note: '0–10 · 训练课次用力' }
  ];
}

const TREND_METRICS = [
  { key: 'sleepHours', label: '睡眠', unit: '小时', zeroBased: true },
  { key: 'morningPulse', label: '晨脉', unit: 'bpm', zeroBased: false },
  { key: 'weightKg', label: '体重', unit: 'kg', zeroBased: false },
  { key: 'fatigue', label: '疲劳', unit: '分', zeroBased: true }
];

// trends 为 wellness-trends 的 trends 数组；metricKey 取 TREND_METRICS 之一。
// zeroBased 指标从 0 起画柱；否则按序列区间缩放并在 note 标注，避免体重/晨脉柱形无差异。
function buildStatusTrend(trends, metricKey) {
  const config = TREND_METRICS.find((item) => item.key === metricKey) || TREND_METRICS[0];
  const series = (trends || []).find((item) => item.key === config.key);
  const points = ((series && series.points) || [])
    .filter((point) => point && point.personalValue != null)
    .map((point) => ({
      date: point.date,
      value: Number(point.personalValue),
      valueText: statusValue(point.personalValue),
    }));
  const values = points.map((point) => point.value);
  const hi = values.length ? Math.max(...values) : 0;
  const lo = values.length ? Math.min(...values) : 0;
  const base = config.zeroBased ? 0 : lo;
  const span = hi - base;
  return {
    key: config.key,
    label: config.label,
    unit: config.unit,
    empty: points.length === 0,
    scaleNote: config.zeroBased ? '' : '纵轴按数据区间缩放',
    points: points.map((point) => ({
      ...point,
      height: span > 0 ? Math.max(4, Math.round((point.value - base) / span * 96) + 4) : 50,
    })),
  };
}

// 历史记录：按日期合并各指标最近值；values 键与指标卡一致（rpe 来自趋势序列）。
function buildStatusHistory(trends, limit = 7) {
  const byDate = new Map();
  const put = (date, key, value) => {
    if (!date || value == null) return;
    const row = byDate.get(date) || { date, values: {} };
    row.values[key] = statusValue(value);
    byDate.set(date, row);
  };
  for (const series of trends || []) {
    const mappedKey = series.key === 'fatigue' ? 'fatigueIndex' : series.key;
    for (const point of series.points || []) {
      put(point.date, mappedKey, point.personalValue);
    }
  }
  return [...byDate.values()]
    .sort((left, right) => (left.date < right.date ? 1 : -1))
    .slice(0, limit);
}

const ATTENTION_STATUSES = ['rest', 'attention', 'alert'];

// 教练队伍概览：应填/已填/未填 + 需关注名单（自评异常或 24 小时高负荷，均有可靠数据依据）。
function buildTeamStatusView(overview) {
  const rows = (overview && overview.athletes) || [];
  const summary = (overview && overview.summary) || {};
  const total = Number(summary.total) || rows.length;
  const reported = Number(summary.wellnessReported) || rows.filter((row) => row.wellnessReported).length;
  const attentionRows = rows
    .filter((row) => ATTENTION_STATUSES.includes(row.wellnessStatus) || row.highLoad)
    .map((row) => ({
      athleteId: row.athleteId,
      name: row.athleteName,
      team: row.team || '未分队',
      reasons: [
        ATTENTION_STATUSES.includes(row.wellnessStatus) ? `自评${row.wellnessStatus === 'rest' ? '需要休息' : row.wellnessStatus === 'attention' ? '需要关注' : '需要警示'}` : '',
        row.highLoad ? '24 小时高负荷' : ''
      ].filter(Boolean),
    }));
  return {
    total,
    reported,
    missing: Math.max(0, total - reported),
    attentionRows,
  };
}

module.exports = {
  TREND_METRICS,
  statusMetricCards,
  buildStatusTrend,
  buildStatusHistory,
  buildTeamStatusView
};
