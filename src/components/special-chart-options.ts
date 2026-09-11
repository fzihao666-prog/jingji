import type { EChartsOption } from 'echarts';
import type { SpecialTrainingAnalytics } from '../../shared/special-training';
import { addDays } from '../utils';

const chartMetrics = { top: 56, right: 64, bottom: 36, left: 60, barWidth: 24, lineWidth: 2, symbolSize: 6 };
const pointDate = (date: string) => Date.parse(`${date}T00:00:00Z`);
const base = (from: string, to: string): EChartsOption => ({
  animation: false,
  tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
  legend: { top: 8 },
  grid: { ...chartMetrics, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
  xAxis: { type: 'time', min: pointDate(from) - 43200000, max: pointDate(to) + 43200000, axisLabel: { formatter: '{MM}/{dd}', hideOverlap: true } },
  yAxis: { type: 'value', min: 0 },
  useUTC: true
});
const calendar = (from: string, to: string) => {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
};
export function volumeOption(data: SpecialTrainingAnalytics, from: string, to: string): EChartsOption {
  const rows = new Map(data.days.map((day) => [day.date, day]));
  const dates = calendar(from, to);
  return { ...base(from, to), yAxis: [{ type: 'value', name: '时长（min）', min: 0 }, { type: 'value', name: '距离（km）', min: 0, splitLine: { show: false } }], series: [
    { id: 'duration', name: '专项时长（min）', type: 'bar', barMaxWidth: chartMetrics.barWidth, data: dates.map((date) => [pointDate(date), rows.get(date)?.durationMin ?? null]) },
    { id: 'distance', name: '专项距离（km）', type: 'line', yAxisIndex: 1, connectNulls: false, symbolSize: chartMetrics.symbolSize, data: dates.map((date) => [pointDate(date), rows.get(date)?.distanceKm ?? null]) }
  ] };
}
export function loadOption(data: SpecialTrainingAnalytics, from: string, to: string): EChartsOption {
  const rows = new Map(data.days.map((day) => [day.date, day]));
  return { ...base(from, to), yAxis: { type: 'value', name: 'SRPE（AU）', min: 0 }, series: [
    { id: 'load', name: '专项负荷（AU）', type: 'line', connectNulls: false, symbolSize: chartMetrics.symbolSize, lineStyle: { width: chartMetrics.lineWidth }, data: calendar(from, to).map((date) => [pointDate(date), rows.get(date)?.load ?? null]) }
  ] };
}
export function intensityOption(data: SpecialTrainingAnalytics): EChartsOption {
  return { animation: false, tooltip: { trigger: 'item', renderMode: 'richText', confine: true, formatter: '{b}：{c} min（{d}%）' },
    legend: { bottom: 4, type: 'plain' }, series: [{ id: 'intensity', type: 'pie', radius: ['38%', '65%'], center: ['50%', '44%'], label: { show: false },
      data: data.intensity.filter((row) => row.durationMin !== null && row.durationMin > 0).map((row) => ({ name: row.name, value: row.durationMin! })) }] };
}
export function contentOption(data: SpecialTrainingAnalytics): EChartsOption {
  return { animation: false, tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (value) => `${value} 课次` },
    grid: { top: 16, right: 32, bottom: 28, left: 80, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    xAxis: { type: 'value', minInterval: 1 }, yAxis: { type: 'category', data: data.content.map((row) => row.name), inverse: true },
    series: [{ id: 'content', name: '课次数', type: 'bar', barMaxWidth: chartMetrics.barWidth, data: data.content.map((row) => row.count) }] };
}
