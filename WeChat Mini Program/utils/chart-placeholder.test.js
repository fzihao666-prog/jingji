import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./chart-placeholder.js', import.meta.url), 'utf8'), context);
const { displaySeries, trendPlaceholder, ratioPlaceholder, physiologyPlaceholder, completeRatioRows, INTENSITY_FILL, CONTENT_FILL } = context.module.exports;

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

describe('占比缺失分类演示补全', () => {
  const intensityOf = (row) => row.durationMin;
  const formatMin = (value) => `${value} min`;

  it('空数据补全为完整分布，按真实数据口径展示', () => {
    const rows = completeRatioRows([], INTENSITY_FILL, intensityOf, formatMin);
    expect(rows.map((row) => row.name)).toEqual(INTENSITY_FILL.map((row) => row.name));
    expect(rows.every((row) => !row.isPlaceholder)).toBe(true);
    expect(Math.round(rows.reduce((sum, row) => sum + row.percentage, 0) * 10) / 10).toBe(100);
  });

  it('真实分类保留真实值，缺失分类取补全值并重算百分比', () => {
    const rows = completeRatioRows(
      [{ name: 'U2', durationMin: 200 }],
      INTENSITY_FILL,
      intensityOf,
      formatMin
    );
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('U2').value).toBe('200 min');
    expect(byName.get('U3').value).toBe(`${INTENSITY_FILL[0].value} min`);
    const total = INTENSITY_FILL.reduce((sum, row) => sum + row.value, 0) - INTENSITY_FILL[1].value + 200;
    expect(byName.get('U2').percentage).toBeCloseTo((200 / total) * 100, 0);
    expect(Math.round(rows.reduce((sum, row) => sum + row.percentage, 0) * 10) / 10).toBe(100);
  });

  it('课次口径按整数格式化，缺失分类同样补全', () => {
    const rows = completeRatioRows(
      [{ name: '水上', count: 5 }],
      CONTENT_FILL,
      (row) => row.count,
      (value) => `${value} 课次`
    );
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('水上').value).toBe('5 课次');
    expect(byName.get('跑步').value).toBe(`${CONTENT_FILL[7].value} 课次`);
  });

  it('补全表之外的真实分类原样保留并参与占比', () => {
    const rows = completeRatioRows(
      [{ name: '自定义分区', durationMin: 50 }],
      INTENSITY_FILL,
      intensityOf,
      formatMin
    );
    expect(rows.at(-1)).toMatchObject({ name: '自定义分区', value: '50 min' });
  });
});
