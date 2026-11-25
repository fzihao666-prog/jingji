import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
const captured = vi.hoisted(() => ({ option: {} as EChartsOption, placeholder: false }));
vi.mock('./EChart', () => ({ EChart: (props: { option: EChartsOption; isPlaceholder?: boolean }) => {
  captured.option = props.option; captured.placeholder = Boolean(props.isPlaceholder);
  return createElement('div', { 'data-chart': true });
} }));
import { RecentTestPerformance } from './RecentTestPerformance';
const props = { tests: [], events: [], athleteId: 1, project: 'ROWING', from: '2026-10-01', to: '2026-10-28', strengthLoading: false, specialLoading: false, strengthError: false, specialError: false };
it('空数据仍保留指标、四项摘要和图表参考系，不注入成绩', () => {
  const html = renderToStaticMarkup(createElement(RecentTestPerformance, props));
  for (const label of ['暂无可选测试指标','最近成绩','测试日期','周期最好','较上次差值']) expect(html).toContain(label);
  expect(captured.placeholder).toBe(true);
  expect(captured.option).toMatchObject({ legend: { data: ['测试成绩'] }, xAxis: { type: 'value' }, yAxis: { data: ['测试记录'] }, series: [{ data: [] }] });
});
it('加载失败显示错误，不标记暂无数据', () => {
  const html = renderToStaticMarkup(createElement(RecentTestPerformance, { ...props, strengthError: true }));
  expect(html).toContain('体能测试读取失败');
  expect(captured.placeholder).toBe(false);
});
