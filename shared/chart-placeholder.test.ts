import { describe, expect, it } from 'vitest';
import { chartDisplay, placeholderRatio, placeholderTrend } from '../src/components/chart-placeholder.js';

describe('图表示例数据选择', () => {
  it('优先保留真实数据，包括只有一条的部分数据', () => {
    const real = [{ value: 12 }];
    const result = chartDisplay(real, [{ value: 42 }]);
    expect(result).toEqual({ data: real, isPlaceholder: false });
    expect(result.data).toBe(real);
  });

  it('空数据使用固定样本且不修改输入', () => {
    const real: number[] = [];
    const first = chartDisplay(real, placeholderTrend);
    const second = chartDisplay(real, placeholderTrend);
    expect(first).toEqual({ data: placeholderTrend, isPlaceholder: true });
    expect(second).toEqual(first);
    expect(real).toEqual([]);
    expect(placeholderRatio.reduce((sum, value) => sum + value, 0)).toBe(100);
  });
});
