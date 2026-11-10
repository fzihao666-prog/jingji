const { shortDate } = require('../../utils/date');
const { number } = require('../../utils/format');

const display = (value) => value == null ? '—' : number(value, 2);
const ratioColor = (name) => name === '未分类' ? 'var(--team-chart-neutral)' : name === '主课' || name === '水上' ? 'var(--team-chart-blue)' : 'var(--team-chart-orange)';
const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const weekLabel = (date) => weekday[new Date(`${date}T00:00:00Z`).getUTCDay()];
const dateLabel = (date, year) => year ? `${Number(date.slice(5, 7))}月` : shortDate(date);

function volume(stats, metric, title, unit, period) {
  const max = Math.max(0, ...stats.buckets.map((bucket) => bucket[metric] || 0));
  const power = max > 0 ? 10 ** Math.floor(Math.log10(max)) : 1;
  const top = ([1, 2, 5, 10].find((step) => step * power >= max) || 10) * power;
  const hasValues = stats.totals[metric] !== null;
  const lastDay = Number(stats.end.slice(8));
  return {
    title, unit, tone: metric === 'minutes' ? 'blue' : 'orange', total: display(stats.totals[metric]), hasValues,
    ticks: [top, top / 2, 0].map((value, index) => ({ index, label: hasValues ? display(value) : '—' })),
    points: stats.buckets.map((bucket, index) => {
      const value = bucket[metric];
      const day = Number(bucket.start.slice(8));
      const first = index === 0;
      const last = index === stats.buckets.length - 1;
      const label = period === 'year' ? String(Number(bucket.start.slice(5, 7))) :
        period === 'week' ? weekLabel(bucket.start) : first || last || (day % 5 === 0 && lastDay - day >= 3) ? String(day) : '';
      return {
        date: period === 'year' ? bucket.start.slice(0, 7) : bucket.start,
        label, edge: first ? 'first' : last ? 'last' : '',
        value: display(value), missing: value == null, zero: value === 0,
        height: value > 0 ? value / top * 100 : 0
      };
    })
  };
}

const analysisPalettes = [
  ['#2458a6', '#167381', '#387c68', '#5d5fa3', '#427ca9', '#536171'],
  ['#b44716', '#9a4d70', '#75599a', '#ac6542', '#996334', '#536171'],
];

function ratio(title, groups, total, colorFor = ratioColor) {
  let offset = 0;
  const slices = [];
  const hasMultipleSlices = groups.filter(({ percentage }) => percentage > 0).length > 1;
  const rows = groups.map(({ name, value, percentage }, index) => {
    const color = colorFor(name, index);
    if (percentage > 0) {
      const end = offset + percentage;
      const gap = hasMultipleSlices ? Math.min(0.6, percentage / 4) : 0;
      slices.push(`${color} ${offset}% ${end - gap}%`);
      if (gap) slices.push(`var(--paper) ${end - gap}% ${end}%`);
      offset = end;
    }
    return { name, value: display(value), color, share: percentage == null ? '—' : `${display(percentage)}%` };
  });
  return { title, rows, total: display(total), background: slices.length ? `conic-gradient(${slices.join(',')})` : '' };
}

function buildView(stats, period) {
  const ratios = [ratio('主辅训练比例', stats.lessonRatio, stats.totals.minutes)];
  if (stats.waterProject) ratios.push(ratio('水陆训练比例', stats.waterRatio, stats.totals.minutes));
  const volumes = [
    volume(stats, 'minutes', '训练时长', 'min', period),
    volume(stats, 'distance', '训练距离', 'km', period),
  ];
  const summary = volumes.map(({ title, unit, total, tone }) => ({ title: `总${title}`, unit, total, tone }));
  if (stats.waterProject) {
    for (const [name, tone] of [['水上', 'blue'], ['陆上', 'orange']]) {
      const group = stats.waterRatio.find((entry) => entry.name === name);
      summary.push({ title: `${name}时长`, tone, unit: 'min', total: display(group && group.value) });
    }
  }
  return {
    start: stats.start, end: stats.end, hasData: stats.details.length > 0,
    volumes, ratios, summary,
    timeAnalysis: stats.timeAnalysis.map(({ title, total, points }, index) => {
      const max = Math.max(0, ...points.map(({ value }) => value));
      const palette = analysisPalettes[index % analysisPalettes.length];
      const distribution = ratio(title, points, total, (_, i) =>
        stats.waterProject ? palette[i % palette.length] : 'var(--team-chart-teal)'
      );
      return {
        ...distribution,
        background: stats.waterProject ? distribution.background : '',
        rows: distribution.rows.map((row, i) => ({ ...row, width: max ? points[i].value / max * 100 : 0 })),
      };
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
  const groups = stats.waterProject ? [
    { label: '水上', rows: rows.filter(({ waterGroup }) => waterGroup === 'water') },
    { label: '陆上', rows: rows.filter(({ waterGroup }) => waterGroup === 'land') },
    { label: '未分类', rows: rows.filter(({ waterGroup }) => !waterGroup) }
  ].filter((group) => group.rows.length) : [{ label: '', rows }];
  return {
    columns: visible.map((date) => ({ date, label: period === 'week' ? weekLabel(date) : dateLabel(date, year) })),
    datesCount: dates.length, pageCount: Math.ceil(dates.length / size),
    rows: groups.flatMap(({ label, rows: members }) => members.map(({ category, unit, total, values }, index) => ({
      group: index === 0 ? label : '',
      key: JSON.stringify([category, unit]), name: `${category} · ${unit}`,
      total: display(total), cells: visible.map((date) => ({ date, text: display(values[date]) })),
    }))),
  };
}

module.exports = { buildView, buildDetails };
