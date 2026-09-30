import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./chart-placeholder.js', import.meta.url), 'utf8'), context);
const { displaySeries, trendPlaceholder, ratioPlaceholder, physiologyPlaceholder } = context.module.exports;

describe('小程序图表示例数据选择', () => {
it('真实单点优先于示例，空数据展示固定趋势', () => {
  const real = [{ date: '2026-09-30', duration: 12 }];
  expect(displaySeries(real, trendPlaceholder('overview'))).toEqual({ data: real, isPlaceholder: false });
  const first = displaySeries([], trendPlaceholder('overview'));
  expect(first.isPlaceholder).toBe(true);
  expect(first.data).toEqual(trendPlaceholder('overview'));
  expect(first.data.every((item) => item.isPlaceholder)).toBe(true);
});

it('占比与热力图样本不包含真实业务结果', () => {
  const ratio = ratioPlaceholder(['U3', 'U2', 'U1', 'AT'], 'min');
  expect(ratio.reduce((sum, item) => sum + item.percentage, 0)).toBe(100);
  const heatmap = physiologyPlaceholder();
  expect(heatmap.metrics.every((item) => item.summary.latestValue === null)).toBe(true);
  expect(heatmap.metrics.every((item) => item.days.every((day) => day.sampleCount === 0))).toBe(true);
});
});
