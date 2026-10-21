const format = (n) => n == null || !Number.isFinite(n) ? '—' : String(Math.round(n * 100) / 100);
function reportPeriod(kind, anchor) {
  const date = new Date(`${anchor}T00:00:00Z`);
  const end = new Date(date);
  if (kind === 'week') {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    end.setTime(date.getTime() + 6 * 86400000);
  } else if (kind === 'month') {
    date.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }
  return { kind, from: date.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
function reportView(data) {
  const maxDuration = Math.max(1, ...data.daily.map(d => d.duration || 0));
  const maxLoad = Math.max(1, ...data.daily.map(d => d.srpe || 0));
  return {
    kpis: [['sessions', '训练课次', '次', null], ['duration', '训练时长', '分钟', data.totals.durationCount],
      ['distance', '训练距离', 'km', data.totals.distanceCount], ['srpe', 'SRPE 负荷', 'AU', data.totals.srpeCount]]
      .map(([key, label, unit, count]) => ({ key, label, unit, value: format(data.totals[key]), previous: format(data.previous[key]),
        coverage: count == null ? '' : `有效填报 ${count}/${data.totals.sessions} 课次` })),
    categories: data.categories.map(c => ({ ...c, durationText: format(c.duration) })),
    daily: data.daily.map(d => ({ ...d, shortDate: d.date.slice(5), durationText: format(d.duration), srpeText: format(d.srpe),
      segments: ['special', 'physical', 'recovery', 'other'].map(key => ({ key, height: Math.max(0, (d[key] || 0) / maxDuration * 100) })),
      loadHeight: Math.max(0, (d.srpe || 0) / maxLoad * 100) })),
    tests: data.tests.map(t => ({ ...t, firstText: format(t.first.value), lastText: format(t.last.value),
      changeText: `${t.change > 0 ? '+' : ''}${format(t.change)}`, sideText: ({ left: '左侧', right: '右侧', center: '中立', bilateral: '双侧' })[t.side] || t.side })),
    wellness: data.wellness.map(w => {
      const max = Math.max(1, ...w.points.map(p => p.value));
      return { ...w, averageText: format(w.average), bars: data.daily.map(d => {
        const point = w.points.find(p => p.date === d.date);
        return { date: d.date, shortDate: d.date.slice(5), value: point ? format(point.value) : '—', height: point ? Math.max(0, point.value / max * 100) : 0 };
      }) };
    }),
  };
}
module.exports = { reportPeriod, reportView };
