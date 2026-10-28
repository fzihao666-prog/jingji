import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const captured = vi.hoisted(() => ({ rows: [] as Array<{ chart: string; data: Array<Record<string, unknown>> }> }));
vi.mock('recharts', () => Object.fromEntries([
  'Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'ComposedChart', 'Legend', 'Line', 'Pie', 'PieChart',
  'PolarAngleAxis', 'PolarGrid', 'PolarRadiusAxis', 'Radar', 'RadarChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis',
].map((chart) => [chart, ({ children, data }: { children?: ReactNode; data?: Array<Record<string, unknown>> }) => {
  if (data) captured.rows.push({ chart, data });
  return createElement('svg', { 'data-chart': chart }, children);
}])));
import { LoadTrendChart, ProfessionalLoadChart, PerformanceRadarChart, RelativeStrengthChart, StrengthChangeChart, StructureChart } from './LoadCharts';
import { StrengthTrainingLoadChart } from './StrengthTrainingLoadChart';
beforeEach(() => { captured.rows = []; });
it('无训练、力量或测试数据时保留坐标结构，不注入成绩趋势', () => {
  for (const element of [createElement(LoadTrendChart, { records: [] }), createElement(ProfessionalLoadChart, { data: [] }),
    createElement(RelativeStrengthChart, { data: [] }), createElement(StrengthChangeChart, { data: [] }), createElement(StrengthTrainingLoadChart, { sessions: [] })]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain('CartesianGrid');
    expect(html).not.toContain('示例');
  }
  expect(captured.rows.every(({ data }) => data.length === 1 && Object.entries(data[0]).filter(([key]) => ['srpe', 'smvl', 'previous', 'current', 'change', 'volume', 'rpe'].includes(key)).every(([, value]) => value === null))).toBe(true);
});
it('雷达全空保留维度，真实零分和部分缺失不被替换', () => {
  renderToStaticMarkup(createElement(PerformanceRadarChart, { data: [] }));
  expect(captured.rows[0].data).toHaveLength(6);
  expect(captured.rows[0].data.every((row) => row.score === null)).toBe(true);
  captured.rows = [];
  const data = [{ key: 'a', label: '力量', score: 0, basis: '' }, { key: 'b', label: '耐力', score: null, basis: '' }];
  renderToStaticMarkup(createElement(PerformanceRadarChart, { data }));
  expect(captured.rows[0].data).toEqual(data);
});
it('训练结构无数据时只有中性环轨，不绘制假训练比例', () => {
  const html = renderToStaticMarkup(createElement(StructureChart, { records: [] }));
  expect(html).toContain('暂无真实训练结构数据');
  expect(html).not.toContain('示例');
  expect(captured.rows.filter(({ chart }) => chart === 'Pie').map(({ data }) => data)).toEqual([[{ value: 1 }], []]);
});
it('真实零负荷不会被示例数据替换', () => {
  const data = [{ date: '2026-10-01', label: '10/01', srpe: 0, smvl: 0, duration: 0, distance: 0, rpe: null, sleep: null, fatigue: null, pulse: null, weight: null, participantCount: 1 }];
  renderToStaticMarkup(createElement(ProfessionalLoadChart, { data }));
  expect(captured.rows[0].data).toEqual(data);
});
