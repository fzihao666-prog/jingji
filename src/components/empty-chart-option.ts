import type { EChartsOption } from 'echarts';

/** 空态只保留图表结构；调用方的占位样本不能进入 Tooltip 或分析。 */
export function emptyChartOption(option: EChartsOption): EChartsOption {
  const series = option.series ? (Array.isArray(option.series) ? option.series : [option.series]) : [];
  return {
    ...option,
    tooltip: { show: false },
    series: series.map((item) => {
      if (item.type === 'pie') return {
        ...item, data: [], silent: true, showEmptyCircle: true,
        emptyCircleStyle: { color: '#e5e9e8' }, label: { show: false },
      };
      return { ...item, data: [], silent: true };
    }),
  };
}
