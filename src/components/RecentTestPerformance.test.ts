import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import type { DailyTrainingData } from '../../shared/daily-training';
const captured = vi.hoisted(() => ({ option: {} as EChartsOption, placeholder: false, result: { data: { rows: [], athletes: [], truncated: false } } as { data?: DailyTrainingData; error?: string } }));
vi.mock('./EChart', () => ({ EChart: (props: { option: EChartsOption; isPlaceholder?: boolean }) => {
  captured.option = props.option; captured.placeholder = Boolean(props.isPlaceholder);
  return createElement('div', { 'data-chart': true });
} }));
vi.mock('./DailyTrainingCards', () => ({ useDailyTraining: () => ({ result: captured.result, retry: vi.fn() }) }));
import { RecentTestPerformance } from './RecentTestPerformance';
const props = { athleteId: 1, project: 'ROWING' as const, teamId: 1, from: '2026-10-01', to: '2026-10-28' };
it('空数据仍保留指标、四项摘要和图表参考系，不注入成绩', () => {
  const html = renderToStaticMarkup(createElement(RecentTestPerformance, props));
  for (const label of ['暂无可选训练指标','最近成绩','记录日期','记录次数','较上次差值']) expect(html).toContain(label);
  expect(captured.placeholder).toBe(true);
  expect(captured.option).toMatchObject({ legend: { data: ['测试成绩'] }, xAxis: { type: 'value' }, yAxis: { data: ['测试记录'] }, series: [{ data: [] }] });
});
it('加载失败显示错误，不标记暂无数据', () => {
  captured.result = { error: '读取失败' };
  const html = renderToStaticMarkup(createElement(RecentTestPerformance, props));
  expect(html).toContain('训练数据读取失败');
  expect(captured.placeholder).toBe(false);
});
