import { describe, expect, it } from 'vitest';
import { chartDisplay } from '../src/components/chart-placeholder.js';

describe('图表空态数据', () => {
  it('保留真实零值和部分缺失，不修改输入', () => {
    const real = [{ value: 0 }, { value: null }];
    expect(chartDisplay(real)).toEqual({ data: real, isPlaceholder: false });
    expect(chartDisplay(real).data).toBe(real);
  });
  it('空数据不注入样本', () => {
    const real: number[] = [];
    expect(chartDisplay(real)).toEqual({ data: [], isPlaceholder: true });
    expect(chartDisplay(real).data).toBe(real);
  });
});
