import type { EChartsOption } from 'echarts';
import type { SpecialTrainingAnalytics } from '../../shared/special-training';
import { addDays } from '../utils';

const chartMetrics = {
  top: 40,
  right: 32,
  bottom: 28,
  left: 36,
  barWidth: 24,
  lineWidth: 3,
  symbolSize: 7,
};
export const specialTooltip = {
  renderMode: 'richText' as const, confine: true, padding: [12, 16],
  borderWidth: 1, borderColor: '#dce6e9', backgroundColor: '#ffffff',
  textStyle: { fontSize: 12, lineHeight: 22, color: '#234b55' },
};
const barStyle = { borderRadius: [5, 5, 0, 0], opacity: 0.85 };
const pointDate = (date: string) => Date.parse(`${date}T00:00:00Z`);
const base = (from: string, to: string): EChartsOption => ({
  animation: false,
  tooltip: { ...specialTooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: '#9db7b6', type: 'dashed' } } },
  legend: { top: 4, icon: 'roundRect', itemWidth: 14, itemHeight: 8, itemGap: 20, textStyle: { fontSize: 12 } },
  grid: { ...chartMetrics, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
  xAxis: {
    type: 'time',
    min: pointDate(from) - 43200000,
    max: pointDate(to) + 43200000,
    axisLabel: { formatter: '{MM}/{dd}', hideOverlap: true },
  },
  yAxis: { type: 'value', min: 0, axisLabel: { fontSize: 11 }, splitLine: { lineStyle: { color: '#e4eded', type: 'dashed' } } },
  useUTC: true,
});
const calendar = (from: string, to: string) => {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
};
export function volumeOption(
  data: SpecialTrainingAnalytics,
  from: string,
  to: string,
  isPlaceholder = false
): EChartsOption {
  const rows = new Map(data.days.map((day) => [day.date, day]));
  const dates = calendar(from, to);
  return {
    ...base(from, to),
    yAxis: [
      { type: 'value', name: '时长（min）', min: 0 },
      { type: 'value', name: '距离（km）', min: 0, splitLine: { show: false } },
    ],
    series: [
      {
        id: 'duration',
        name: '专项时长（min）',
        type: 'bar',
        barMaxWidth: chartMetrics.barWidth,
        itemStyle: barStyle,
        data: dates.map((date) => [
          pointDate(date),
          isPlaceholder ? null : (rows.get(date)?.durationMin ?? null),
        ]),
      },
      {
        id: 'distance',
        name: '专项距离（km）',
        type: 'line',
        yAxisIndex: 1,
        connectNulls: false,
        lineStyle: { width: chartMetrics.lineWidth },
        itemStyle: { borderWidth: 2, borderColor: '#ffffff' },
        emphasis: { scale: 1.4 },
        symbolSize: chartMetrics.symbolSize,
        data: dates.map((date) => [
          pointDate(date),
          isPlaceholder ? null : (rows.get(date)?.distanceKm ?? null),
        ]),
      },
    ],
  };
}
export function loadOption(
  data: SpecialTrainingAnalytics,
  from: string,
  to: string,
  isPlaceholder = false
): EChartsOption {
  const rows = new Map(data.days.map((day) => [day.date, day]));
  return {
    ...base(from, to),
    yAxis: { type: 'value', name: 'SRPE（AU）', min: 0 },
    series: [
      {
        id: 'load',
        name: '专项负荷（AU）',
        type: 'line',
        connectNulls: false,
        symbolSize: chartMetrics.symbolSize,
        lineStyle: { width: chartMetrics.lineWidth },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(23,111,127,0.18)' }, { offset: 1, color: 'rgba(23,111,127,0.01)' }] } },
        data: calendar(from, to).map((date) => [
          pointDate(date),
          isPlaceholder ? null : (rows.get(date)?.load ?? null),
        ]),
      },
    ],
  };
}
export function intensityOption(
  data: SpecialTrainingAnalytics,
  isPlaceholder = false
): EChartsOption {
  return {
    animation: false,
    tooltip: {
      ...specialTooltip,
      trigger: 'item',
      renderMode: 'richText',
      confine: true,
      formatter: '{b}：{c} min（{d}%）',
    },
    legend: { bottom: 0, type: 'scroll', icon: 'roundRect', itemWidth: 12, itemHeight: 8, itemGap: 16, textStyle: { fontSize: 12 } },
    series: [
      {
        id: 'intensity',
        type: 'pie',
        radius: ['42%', '67%'],
        itemStyle: { borderRadius: 4, borderColor: '#ffffff', borderWidth: 2 },
        emphasis: { scaleSize: 4 },
        center: ['50%', '44%'],
        label: { show: false },
        data: isPlaceholder
          ? []
          : data.intensity.map((row) => ({ name: row.name, value: row.durationMin ?? undefined })),
      },
    ],
  };
}
export function contentOption(
  data: SpecialTrainingAnalytics,
  isPlaceholder = false
): EChartsOption {
  const rows = isPlaceholder ? [] : data.content;
  return {
    animation: false,
    tooltip: {
      ...specialTooltip,
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      valueFormatter: (value) => `${value} 课次`,
    },
    grid: {
      top: 16,
      right: 44,
      bottom: 28,
      left: 90,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: { type: 'value', name: '课次', minInterval: 1, splitLine: { lineStyle: { color: '#e4eded', type: 'dashed' } } },
    yAxis: { type: 'category', data: rows.map((row) => row.name), inverse: true },
    series: [
      {
        id: 'content',
        name: '课次数',
        type: 'bar',
        barMaxWidth: chartMetrics.barWidth,
        data: rows.map((row) => row.count),
        itemStyle: { borderRadius: [0, 5, 5, 0], opacity: 0.85 },
        label: { show: true, position: 'right', fontSize: 12 },
      },
    ],
  };
}
