import { describe, expect, it } from 'vitest';
import { mean, physicalComparison, type PhysicalReference } from './physical-champion.js';

const reference: PhysicalReference = {
  id: 1,
  revision: 0,
  key: 'vertical_jump',
  label: '纵跳',
  unit: 'cm',
  value: 50,
  protocol: 'CMJ双手叉腰',
  direction: 'higher_better',
  sourceType: 'estimated',
  sourceNote: '测试参考',
};

describe('体能冠军标准化计算', () => {
  it('保留真实零成绩及超过百分之百的达成度', () => {
    expect(physicalComparison(0, reference)).toEqual({
      value: 0,
      achievedPercent: 0,
      difference: -50,
    });
    expect(physicalComparison(60, reference)).toEqual({
      value: 60,
      achievedPercent: 120,
      difference: 10,
    });
  });
  it('越小越好的指标使用反向比例，差值保留原单位', () => {
    expect(physicalComparison(40, { ...reference, direction: 'lower_better' })).toEqual({
      value: 40,
      achievedPercent: 125,
      difference: -10,
    });
  });
  it('相对力量平均值和差值保留精度', () => {
    expect(mean([1.375])).toBe(1.375);
    expect(physicalComparison(1.375, { ...reference, value: 1.4 }).difference).toBe(-0.025);
  });
  it('缺测不生成成绩且空团队平均为空', () => {
    expect(physicalComparison(null, reference)).toEqual({
      value: null,
      achievedPercent: null,
      difference: null,
    });
    expect(mean([])).toBeNull();
    expect(mean([0, 50, 100])).toBe(50);
  });
});
