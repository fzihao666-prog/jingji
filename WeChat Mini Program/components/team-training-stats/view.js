const { shortDate } = require('../../utils/date');
const { number } = require('../../utils/format');

const display = (value) => value == null ? '—' : number(value, 2);
const ratioColor = (name) => name === '未分类' ? '#737e88' : name === '主课' || name === '水上' ? '#176f7f' : '#be7329';
const dateLabel = (date, year) => year ? `${Number(date.slice(5, 7))}月` : shortDate(date);

function volume(stats, metric, title, unit, year) {
  const max = Math.max(0, ...stats.buckets.map((bucket) => bucket[metric] || 0));
  return {
    title, unit, total: display(stats.totals[metric]), hasValues: stats.totals[metric] !== null,
    points: stats.buckets.map((bucket) => {
      const value = bucket[metric];
      return {
        date: year ? bucket.start.slice(0, 7) : bucket.start,
        label: dateLabel(bucket.start, year),
        value: display(value), missing: value == null, zero: value === 0,
        height: value > 0 ? Math.max(2, value / max * 100) : 0
      };
    })
  };
}

function ratio(title, groups) {
  let offset = 0;
  const slices = [];
  const rows = groups.map(({ name, value, percentage }) => {
    const color = ratioColor(name);
    if (percentage > 0) {
      slices.push(`${color} ${offset}% ${offset + percentage}%`);
      offset += percentage;
    }
    return { name, value: display(value), color, share: percentage === null ? '—' : `${display(percentage)}%` };
  });
  return { title, rows, background: slices.length ? `conic-gradient(${slices.join(',')})` : '' };
}

function buildView(stats, period) {
  const ratios = [ratio('主辅训练比例', stats.lessonRatio)];
  if (stats.waterProject) ratios.push(ratio('水陆训练比例', stats.waterRatio));
  return {
    start: stats.start, end: stats.end, hasData: stats.details.length > 0,
    volumes: [
      volume(stats, 'minutes', '训练时长', 'min', period === 'year'),
      volume(stats, 'distance', '训练距离', 'km', period === 'year'),
    ],
    ratios,
    timeAnalysis: stats.timeAnalysis.map(({ title, points }) => {
      const max = Math.max(0, ...points.map(({ value }) => value));
      return { title, points: points.map(({ name, value }) => ({ name, value: display(value), width: max ? value / max * 100 : 0 })) };
    }),
    hasTotals: stats.details.some(({ total }) => total !== null),
    hasRaw: stats.details.some(({ total }) => total === null),
  };
}

function buildDetails(stats, period, raw, page) {
  const rows = stats.details.filter(({ total }) => (total === null) === raw);
  const dates = raw
    ? [...new Set(rows.flatMap(({ values }) => Object.keys(values)))].sort()
    : stats.buckets.map(({ start }) => start);
  const year = period === 'year' && !raw;
  const size = year ? 12 : 7;
  const visible = dates.slice(page * size, (page + 1) * size);
  return {
    columns: visible.map((date) => ({ date, label: dateLabel(date, year) })),
    datesCount: dates.length, pageCount: Math.ceil(dates.length / size),
    rows: rows.map(({ category, unit, total, values }) => ({
      key: JSON.stringify([category, unit]), name: `${category} · ${unit}`,
      total: display(total), cells: visible.map((date) => ({ date, text: display(values[date]) })),
    })),
  };
}

module.exports = { buildView, buildDetails };
