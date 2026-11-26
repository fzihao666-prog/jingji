import type { EChartsOption } from 'echarts';
import { expect, it } from 'vitest';
import { connectTrendLines, sortTrendRows } from './trend-connection';

it('ECharts 折线统一跨空值连接，保留真实点与缺失值', () => {
  const data: Array<[number, number | null]> = [
    [Date.parse('2026-10-29T00:00:00Z'), 2],
    [Date.parse('2026-11-02T00:00:00Z'), null],
    [Date.parse('2026-11-05T00:00:00Z'), 4],
  ];
  const option: EChartsOption = {
    series: [
      { type: 'line', connectNulls: false, data },
      { type: 'bar', data: [1, null, 3] },
    ],
  };
  const result = connectTrendLines(option);
  const series = result.series as Array<{ type: string; connectNulls?: boolean; data: unknown[] }>;
  expect(series[0]).toMatchObject({ type: 'line', connectNulls: true });
  expect(series[0].data).toBe(data);
  expect(series[0].data).toContainEqual([Date.parse('2026-11-02T00:00:00Z'), null]);
  expect(series[1]).toMatchObject({ type: 'bar' });
  expect(series[1]).not.toHaveProperty('connectNulls');
  expect(option.series).not.toBe(result.series);
});

it('ECharts 非折线与无系列配置保持原样', () => {
  const barOnly: EChartsOption = { series: [{ type: 'bar', data: [1] }] };
  expect(connectTrendLines(barOnly)).toEqual(barOnly);
  expect(connectTrendLines({})).toEqual({});
});

it('趋势数据按真实日期升序排列，不补中间日期、不改变数值', () => {
  const rows = [
    { date: '2026-11-05', value: 4 },
    { date: '2026-10-29', value: 2 },
    { date: '2026-11-02', value: null },
  ];
  const sorted = sortTrendRows(rows, (row) => row.date);
  expect(sorted).toEqual([
    { date: '2026-10-29', value: 2 },
    { date: '2026-11-02', value: null },
    { date: '2026-11-05', value: 4 },
  ]);
  expect(sorted).toHaveLength(rows.length);
  expect(rows[0].date).toBe('2026-11-05');
});
