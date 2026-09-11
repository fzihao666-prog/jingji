import { useEffect, useRef } from 'react';
import { init, use, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import './EChart.css';

use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
const resizers = new Map<Element, () => void>();
let observer: ResizeObserver | undefined;

/** 共用容器尺寸监听；隐藏容器显示后再初始化，卸载时释放实例。 */
export function EChart({ option, label }: { option: EChartsOption; label: string }) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const currentOption = useRef(option);
  currentOption.current = option;
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
          legend: { textStyle: { color: token('--muted') } }
        });
        chart.current.setOption(currentOption.current);
      } else chart.current.resize();
    };
    observer ??= new ResizeObserver((entries) => entries.forEach((entry) => resizers.get(entry.target)?.()));
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
    chart.current?.setOption(option, { replaceMerge: ['series'] });
  }, [option]);
  return <div ref={element} className="app-echart" role="img" aria-label={label} />;
}
