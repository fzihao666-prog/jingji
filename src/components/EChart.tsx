import { useEffect, useMemo, useRef } from 'react';
import { init, use as registerEChartsComponents, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  RadarComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import './EChart.css';

registerEChartsComponents([
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  RadarComponent,
  CanvasRenderer,
]);
const resizers = new Map<Element, () => void>();
let observer: ResizeObserver | undefined;

/** 共用容器尺寸监听；隐藏容器显示后再初始化，卸载时释放实例。 */
export function EChart({ option, label, isPlaceholder = false }: { option: EChartsOption; label: string; isPlaceholder?: boolean }) {
  const displayOption: EChartsOption = useMemo(() => isPlaceholder
    ? { ...option, tooltip: { trigger: 'item', renderMode: 'richText', formatter: () => '示例数据，仅用于展示图表效果' } }
    : option, [option, isPlaceholder]);
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const currentOption = useRef(displayOption);
  currentOption.current = displayOption;
  useEffect(() => {
    const container = element.current!;
    const resize = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      if (!chart.current) {
        const styles = getComputedStyle(container);
        const token = (name: string) => styles.getPropertyValue(name).trim();
        chart.current = init(container, {
          color: ['--teal', '--river', '--amber', '--mint', '--signal', '--ink'].map(token),
          textStyle: { fontFamily: styles.fontFamily, color: token('--muted') },
          categoryAxis: { axisLine: { lineStyle: { color: token('--line') } } },
          timeAxis: { axisLine: { lineStyle: { color: token('--line') } } },
          valueAxis: { splitLine: { lineStyle: { color: token('--line') } } },
          legend: { textStyle: { color: token('--muted') } },
        });
        chart.current.setOption(currentOption.current);
      } else chart.current.resize();
    };
    observer ??= new ResizeObserver((entries) =>
      entries.forEach((entry) => resizers.get(entry.target)?.())
    );
    resizers.set(container, resize);
    observer.observe(container);
    resize();
    return () => {
      observer?.unobserve(container);
      resizers.delete(container);
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    // 系列数量随成绩分组/数据变化；替换系列避免残留，同时保留其他交互状态。
    chart.current?.setOption(displayOption, { notMerge: true });
  }, [displayOption]);
  return <div className="app-echart-wrap">
    {isPlaceholder && <span className="app-chart-example">示例数据</span>}
    <div ref={element} className="app-echart" role="img" aria-label={isPlaceholder ? `${label}；示例数据，仅用于展示图表效果` : label} />
    {isPlaceholder && <p className="app-chart-example-note">暂无当前周期真实数据 · 当前图表为示例效果</p>}
  </div>;
}
