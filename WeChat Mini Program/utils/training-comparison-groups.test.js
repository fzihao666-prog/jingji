import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const cjsModule = { exports: {} };
const url = new URL('./training-comparison-groups.js', import.meta.url);
vm.runInNewContext(readFileSync(url, 'utf8'), { module: cjsModule });
const { trainingComparisonGroups } = cjsModule.exports;

describe('训练对比分组', () => {
  it('按训练、身体和测试分组，保留差值、缺失与真实零值', () => {
    const items = [
      { key: 'trainingDuration', label: '训练时长', personalText: '0', teamText: '12', diffText: '-12' },
      { key: 'trainingLoad', label: '训练负荷', personalText: '—', teamText: '20', diffText: '—' },
      { key: 'specialDistance', label: '专项距离' },
      { key: 'weightKg', label: '体重' },
      { key: 'measurement:jump', label: '纵跳' }
    ];
    const groups = trainingComparisonGroups(items);
    expect(groups.map((group) => group.label)).toEqual(['训练量与负荷', '身体指标', '体能测试']);
    expect(groups.map((group) => group.expanded)).toEqual([true, false, false]);
    expect(groups[0].metrics).toEqual(items.slice(0, 3));
    expect(groups[0].metrics[0].personalText).toBe('0');
    expect(groups[0].metrics[1].personalText).toBe('—');
    expect(items[0]).not.toHaveProperty('expanded');
  });

  it('较多测试每块最多四项，全部保留且分组键不重复', () => {
    const items = Array.from({ length: 9 }, (_, index) => ({ key: `measurement:${index}`, label: `测试${index}` }));
    const groups = trainingComparisonGroups(items);
    expect(groups.map((group) => group.metrics.length)).toEqual([4, 4, 1]);
    expect(groups.flatMap((group) => group.metrics)).toEqual(items);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
    expect(groups.map((group) => group.expanded)).toEqual([true, false, false]);
  });

  it('无指标返回空状态，未识别指标保留在其他指标组', () => {
    expect(trainingComparisonGroups(null)).toEqual([]);
    expect(trainingComparisonGroups([])).toEqual([]);
    const groups = trainingComparisonGroups([{ key: 'newMetric', label: '新指标' }]);
    expect(groups[0].label).toBe('其他指标');
    expect(groups[0].expanded).toBe(true);
  });
});
