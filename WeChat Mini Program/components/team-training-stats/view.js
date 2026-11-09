const { shortDate } = require('../../utils/date');
const { number } = require('../../utils/format');

const display = (value) => value == null ? '—' : number(value, 2);

const SPECIAL_METRICS = [
  ['water', '水上时长'],
  ['slalomProxy', '激流训练口径', '无氧能力、无氧功率与测功仪时长合计'],
  ['maxStrength', '大力量时长'],
  ['endurance', '力量耐力时长'],
  ['explosive', '爆发力时长'],
  ['functionalCore', '功能与核心训练时长']
];

function sum(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((total, value) => total + value, 0) : null;
}

function trend(title, unit, rows, field, monthly, note = '') {
  const max = Math.max(0, ...rows.map((row) => row[field] || 0));
  return {
    title, unit, note, monthly,
    hasValues: rows.some((row) => Number.isFinite(row[field])),
    points: rows.map((row) => {
      const value = row[field];
      const date = monthly ? row.start.slice(0, 7) : row.start;
      return {
        date, label: monthly ? `${Number(date.slice(5))}月` : shortDate(date),
        value: display(value), missing: value == null, zero: value === 0,
        height: value > 0 ? Math.max(2, value / max * 100) : 0
      };
    })
  };
}

function composition(title, unit, rows) {
  const total = sum(rows.map((row) => row.value));
  return {
    title, unit, hasShare: total > 0,
    rows: rows.map(({ name, value }) => ({
      name, value: display(value), share: total > 0 ? `${display(value / total * 100)}%` : '—',
      width: total > 0 ? value / total * 100 : 0
    }))
  };
}

function breakdown(categories, property, labels, title) {
  const groups = labels.map(([key, name]) => ({
    name, value: sum(categories.filter((row) => row[property] === key).map((row) => row.value))
  })).filter((row) => row.value !== null);
  return composition(title, 'min', groups);
}

function buildView(stats, period, water) {
  const monthly = period === 'year';
  const categories = ['min', 'km'].map((unit) => {
    const totals = new Map();
    for (const row of stats.categories) {
      if (row.unit === unit) totals.set(row.category, (totals.get(row.category) || 0) + row.value);
    }
    return composition(unit === 'min' ? '训练时长分项' : '训练距离分项', unit,
      [...totals].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value));
  }).filter(({ rows }) => rows.length);
  const waterGroups = water ? [
    breakdown(stats.categories.filter(({ unit }) => unit === 'min'), 'waterGroup',
      [['water', '水上'], ['land', '陆上'], [null, '未分类']], '水上与陆上时长'),
    breakdown(stats.categories.filter(({ unit }) => unit === 'min'), 'lessonGroup',
      [['main', '主课'], ['auxiliary', '辅课'], [null, '未分类']], '主课与辅课时长')
  ].filter(({ rows }) => rows.length) : [];
  return {
    start: stats.start, end: stats.end, hasData: !!(stats.categories.length || stats.otherMeasures.length),
    minutes: display(sum(stats.buckets.map(({ minutes }) => minutes))),
    distance: display(sum(stats.buckets.map(({ distance }) => distance))),
    trends: [
      trend('训练时长趋势', 'min', stats.buckets, 'minutes', monthly),
      trend('训练距离趋势', 'km', stats.buckets, 'distance', monthly)
    ].filter(({ hasValues }) => hasValues),
    categories, waterGroups,
    annual: monthly && water ? SPECIAL_METRICS.map(([key, title]) => ({ key, title })) : []
  };
}

function annualTrend(stats, index) {
  const [key, title, note] = SPECIAL_METRICS[index];
  return trend(title, 'min', stats.buckets, key, true, note);
}

function rawMetrics(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.category, row.unit]);
    if (!grouped.has(key)) grouped.set(key, { title: row.category, unit: row.unit, rows: [] });
    grouped.get(key).rows.push({ start: row.date, value: row.value });
  }
  return [...grouped.values()];
}

function rawTrend(metric, page, size) {
  return trend(metric.title, metric.unit, metric.rows.slice(page * size, (page + 1) * size), 'value', false);
}

module.exports = { buildView, annualTrend, rawMetrics, rawTrend };
