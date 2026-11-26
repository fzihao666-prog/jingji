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
    ...Array.from(new Set(rows.filter(row => row.intensity !== null).map(row => row.intensityUnit ?? '')))
      .map(unit => ({ field: 'intensity', label: unit ? `强度（${unit}）` : '强度', unit } as const)),
    { field: 'durationMin', label: '时长（分钟）', unit: '分钟' },
    { field: 'distanceKm', label: '距离（km）', unit: 'km' },
    { field: 'repetitions', label: '每组次数', unit: '次' },
    { field: 'sets', label: '组数', unit: '组' },
    { field: 'rpe', label: 'RPE', unit: '' },
    { field: 'pre', label: 'PRE', unit: '' },
  ] as const;
  return metrics.flatMap(metric => {
    const points = rows.flatMap(row => {
      const value = row[metric.field];
      return value === null || (metric.field === 'intensity' && (row.intensityUnit ?? '') !== metric.unit)
        ? [] : [{ date: row.date, value }];
    }).sort((a, b) => a.date.localeCompare(b.date));
    return points.length ? [{ ...metric, key: JSON.stringify([metric.field, metric.unit]), points }] : [];
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
