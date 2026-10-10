import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
function load(url) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), { module, require: (path) => load(new URL(`${path}.js`, url)) });
  return module.exports;
}
describe('训练页面空状态展示模型', () => {
  it('区分缺值与真实零且保留单位', () => {
    const { metricValue } = load(new URL('./training-empty.js', import.meta.url));
    expect(metricValue(0)).toBe('0');
    for (const value of [null, undefined, '', NaN, Infinity]) expect(metricValue(value)).toBe('--');
  });
  it('没有运动员时仍生成完整体能卡片并清空旧记录', () => {
    const { emptyStrengthView } = load(new URL('./training-empty.js', import.meta.url));
    const view = emptyStrengthView();
    expect(view.summaryCards).toHaveLength(4);
    expect(view.metrics.length).toBeGreaterThan(4);
    expect(view.metrics.every((row) => row.value === '--')).toBe(true);
    expect(view.records).toEqual([]);
    expect(view.planLabels).toEqual([]);
    expect(view.trend).toEqual([]);
  });
});
