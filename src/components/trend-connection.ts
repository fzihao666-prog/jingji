import type { EChartsOption } from 'echarts';

/** 折线跨缺失日期连接前后真实点；不补 0、不插值，也不新增数据点。 */
export const TREND_CONNECTS_NULLS = true;

/** ECharts 公共连接规则：折线系列统一跨空值连接，其他图表类型保持不变。 */
export function connectTrendLines(option: EChartsOption): EChartsOption {
  if (!option.series) return option;
  const series = Array.isArray(option.series) ? option.series : [option.series];
  return {
    ...option,
    series: series.map((item) =>
      item?.type === 'line' ? { ...item, connectNulls: TREND_CONNECTS_NULLS } : item
    ),
  };
}

/** 图表数据统一按真实日期升序排列，不改变日期、数值或缺失值。 */
export function sortTrendRows<T>(rows: readonly T[], dateOf: (row: T) => string): T[] {
  return [...rows].sort((left, right) => dateOf(left).localeCompare(dateOf(right)));
}
