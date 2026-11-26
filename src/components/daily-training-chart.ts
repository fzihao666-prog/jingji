import type { EChartsOption } from 'echarts';
import type { DailyTrainingRecord } from '../../shared/daily-training';

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 12 });
const axisDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
const dateTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dayMs = 86_400_000;

export function dailyTrainingNumber(value: number | null, unit = '') {
  return value === null ? '—' : numberFormat.format(value) + (unit ? ` ${unit}` : '');
}

export function dailyTrainingSeries(rows: DailyTrainingRecord[]) {
  const metrics = [
    { field: 'intensity', source: '强度', label: '强度', unit: '' },
    { field: 'durationMin', source: '时长', label: '时长（分钟）', unit: '分钟' },
    { field: 'distanceKm', source: '距离', label: '距离（km）', unit: 'km' },
    { field: 'repetitions', source: '次数', label: '每组次数', unit: '次' },
    { field: 'sets', source: '组数', label: '组数', unit: '组' },
    { field: 'rpe', source: 'RPE', label: 'RPE', unit: '' },
    { field: 'pre', source: 'PRE', label: 'PRE', unit: '' },
  ] as const;
  return metrics.flatMap(metric => {
    const groups = new Map<string, { key: string; label: string; unit: string; points: Array<{ date: string; value: number }> }>();
    for (const row of rows) {
      const value = row[metric.field];
      if (value === null) continue;
      const unit = metric.field === 'intensity' ? row.intensityUnit ?? '' : metric.unit;
      const definition = row.fields?.find(field => field.source === metric.source);
      const label = definition || metric.field === 'intensity'
        ? [`${definition?.name ?? metric.label}${unit ? `（${unit}）` : ''}`,
            definition?.protocol, definition?.version && `版本 ${definition.version}`].filter(Boolean).join(' · ')
        : metric.label;
      const key = JSON.stringify([metric.field, unit, definition?.name ?? '', definition?.protocol ?? '', definition?.version ?? '']);
      const group = groups.get(key) ?? { key, label, unit, points: [] };
      group.points.push({ date: row.date, value });
      groups.set(key, group);
    }
    return [...groups.values()].map(group => ({ ...group, points: group.points.sort((a, b) => a.date.localeCompare(b.date)) }));
  });
}

export function dailyTrainingTrendOption(series: ReturnType<typeof dailyTrainingSeries>[number], from: string, to: string): EChartsOption {
  const repeatedDates = new Set(series.points.map(point => point.date)).size < series.points.length;
  const data: Array<[number, number | null]> = [];
  for (const point of series.points) {
    const x = dateTime(point.date);
    const previous = data.at(-1)?.[0];
    if (!repeatedDates && previous !== undefined && x - previous > dayMs) data.push([previous + dayMs, null]);
    data.push([x, point.value]);
  }
  return {
    animation: false,
    useUTC: true,
    grid: { top: 34, right: 22, bottom: 42, left: 60 },
    tooltip: {
      trigger: 'item', renderMode: 'richText', confine: true,
      valueFormatter: value => typeof value === 'number' ? dailyTrainingNumber(value, series.unit) : String(value ?? ''),
    },
    xAxis: {
      type: 'time', name: '日期', nameLocation: 'middle', nameGap: 26,
      ...(from === to ? {} : { min: dateTime(from), max: dateTime(to) }),
      axisLabel: { formatter: value => axisDate.format(value), hideOverlap: true },
    },
    yAxis: { type: 'value', name: series.unit || series.label, scale: true },
    series: repeatedDates
      ? [{ type: 'scatter', name: series.label, data, symbolSize: 8 }]
      : [{ type: 'line', name: series.label, data, connectNulls: false, showSymbol: true, symbolSize: 7 }],
  };
}
