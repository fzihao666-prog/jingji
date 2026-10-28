import type { EChartsOption } from 'echarts';

/** 空态只保留图表结构；调用方的占位样本不能进入 Tooltip 或分析。 */
export function emptyChartOption(option: EChartsOption): EChartsOption {
  const series = option.series ? (Array.isArray(option.series) ? option.series : [option.series]) : [];
  return {
    ...option,
    tooltip: { show: false },
    // 空系列不会自动产生数值范围，给静态标尺保留刻度与网格。
    ...(option.xAxis ? { xAxis: emptyAxes(option.xAxis) } : {}),
    ...(option.yAxis ? { yAxis: emptyAxes(option.yAxis) } : {}),
    series: series.map((item) => {
      if (item.type === 'pie') return {
        ...item, data: [], silent: true, showEmptyCircle: true,
        emptyCircleStyle: { color: '#e5e9e8' }, label: { show: false },
      };
      return { ...item, data: [], silent: true };
    }),
  };
}

function emptyAxes<T extends { type?: string; min?: unknown; max?: unknown }>(axes: T | T[]) {
  const normalized = (Array.isArray(axes) ? axes : [axes]).map((axis) =>
    axis.type === 'category' || axis.type === 'time' || axis.type === 'log'
      ? axis : { ...axis, min: axis.min ?? 0, max: axis.max ?? (typeof axis.min === 'number' ? axis.min + 1 : 1) }
  );
  return Array.isArray(axes) ? normalized : normalized[0];
}
