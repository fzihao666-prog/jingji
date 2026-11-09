import type { EChartsOption } from 'echarts';
import type { SpecialTrainingAnalytics } from '../../shared/special-training';
import { specialTooltip } from './special-chart-options';
import { addDays, startOfWeek } from '../utils';

/** 只合计接口已提供的日值；整周缺测仍为null，部分覆盖在图例说明。 */
export function specialWeeklyRows(days: SpecialTrainingAnalytics['days']) {
  const weeks = new Map<string, SpecialTrainingAnalytics['days']>();
  days.forEach(day => {
    const week = startOfWeek(day.date);
    weeks.set(week, [...(weeks.get(week) ?? []), day]);
  });
  const sum = (values: Array<number | null>) => {
    const valid = values.filter((value): value is number => value !== null);
    return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
  };
  return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, rows]) => ({
    week, durationMin: sum(rows.map(row => row.durationMin)), distanceKm: sum(rows.map(row => row.distanceKm)),
  }));
}
export function specialWeeklyOption(
  days: SpecialTrainingAnalytics['days'],
  from: string,
  to: string
): EChartsOption {
  const recordedWeeks = new Map(specialWeeklyRows(days).map((row) => [row.week, row]));
  const rows: ReturnType<typeof specialWeeklyRows> = [];
  for (let week = startOfWeek(from); week <= to; week = addDays(week, 7)) {
    rows.push(recordedWeeks.get(week) ?? { week, durationMin: null, distanceKm: null });
  }
  return {
    animation: false,
    legend: { data: ['训练时长', '训练距离'], top: 0 },
    tooltip: { ...specialTooltip, trigger: 'axis' },
    grid: { top: 50, bottom: 40, left: 60, right: 60 },
    xAxis: { type: 'category', data: rows.map(row => `${row.week.slice(5)}周`) },
    yAxis: [{ type: 'value', name: 'min', min: 0 }, { type: 'value', name: 'km', min: 0 }],
    series: [{ name: '训练时长', type: 'bar', data: rows.map(row => row.durationMin), barMaxWidth: 28, itemStyle: { borderRadius: [5, 5, 0, 0], opacity: 0.85 } },
      { name: '训练距离', type: 'line', yAxisIndex: 1, data: rows.map(row => row.distanceKm), connectNulls: false, lineStyle: { width: 3 }, symbolSize: 7 }],
  };
}
