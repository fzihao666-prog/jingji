import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./chart-placeholder.js', import.meta.url), 'utf8'), context);
const { displaySeries, trendPlaceholder, ratioPlaceholder, physiologyPlaceholder, completeRatioRows, INTENSITY_ZONE_NAMES, CONTENT_CATEGORY_NAMES } = context.module.exports;

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

describe('占比固定展示全部分类', () => {
  const intensityOf = (row) => row.durationMin;
  const formatMin = (value) => `${value} min`;

  it('没有数据的分类保留 0 值行，不隐藏也不顶替模拟值', () => {
    const rows = completeRatioRows([], INTENSITY_ZONE_NAMES, intensityOf, formatMin);
    expect(rows.map((row) => row.name)).toEqual(INTENSITY_ZONE_NAMES);
    expect(rows.every((row) => row.value === '0 min' && row.percentage === 0 && row.width === 0)).toBe(true);
  });

  it('真实分类保留真实值，缺失分类以 0 展示并重算百分比', () => {
    const rows = completeRatioRows(
      [{ name: 'U2', durationMin: 200 }],
      INTENSITY_ZONE_NAMES,
      intensityOf,
      formatMin
    );
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('U2').value).toBe('200 min');
    expect(byName.get('U2').percentage).toBe(100);
    expect(byName.get('U3').value).toBe('0 min');
    expect(rows.reduce((sum, row) => sum + row.percentage, 0)).toBeLessThanOrEqual(100);
  });

  it('名单之外的分区不展示，占比只在选定维度内归一', () => {
    const rows = completeRatioRows(
      [
        { name: '水上', count: 3 },
        { name: '自定义分区', count: 1 },
      ],
      CONTENT_CATEGORY_NAMES,
      (row) => row.count,
      (value) => `${value} 课次`
    );
    expect(rows.map((row) => row.name)).toEqual(CONTENT_CATEGORY_NAMES);
    expect(rows.some((row) => row.name === '自定义分区')).toBe(false);
    expect(rows[0]).toMatchObject({ name: '水上', value: '3 课次', percentage: 100 });
  });
});
