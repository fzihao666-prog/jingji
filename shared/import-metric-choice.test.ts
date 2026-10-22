import { describe, expect, it } from 'vitest';
import { importMetricChoices, resolveImportMetricName, metricAppliesToProject } from './import-metric-choice.js';

describe('教练选择中文测试项目', () => {
  const metrics = [
    { code: 'vertical_jump_cm', label: '纵跳', unit: 'cm' },
    { code: 'verticalJumpCm', label: '纵跳', unit: 'cm' },
    { code: 'grip_kg', label: '握力', unit: 'kg' },
    { code: 'grip_n', label: '握力', unit: 'N' },
  ];
  it('下拉只显示中文名称和单位，同义内部代码只显示一次', () => {
    expect(importMetricChoices(metrics).map(choice => choice.name)).toEqual(['纵跳（cm）', '握力（kg）', '握力（N）']);
    expect(resolveImportMetricName('纵跳（cm）', '', metrics)).toMatchObject({ metric: { code: 'vertical_jump_cm', unit: 'cm' } });
    expect(resolveImportMetricName('纵跳', '', metrics)).toMatchObject({ metric: { code: 'vertical_jump_cm' } });
  });
  it('同名不同单位不能猜；中文选项或明确单位可以确定', () => {
    expect(resolveImportMetricName('握力', '', metrics).error).toContain('多个');
    expect(resolveImportMetricName('握力（N）', '', metrics).metric?.code).toBe('grip_n');
    expect(resolveImportMetricName('握力', 'kg', metrics).metric?.code).toBe('grip_kg');
    expect(resolveImportMetricName('纵跳（cm）', 'kg', metrics).error).toContain('单位');
    expect(resolveImportMetricName('未知测试', '', metrics).error).toContain('未识别');
  });
  it('不同内部项目共用同一中文名称和单位时拒绝，不能取第一项', () => {
    const ambiguous = [{ code: 'a', label: '测试甲', unit: '分' }, { code: 'b', label: '测试甲', unit: '分' }];
    expect(importMetricChoices(ambiguous)).toEqual([]);
    expect(resolveImportMetricName('测试甲（分）', '', ambiguous).error).toContain('多个');
  });
  it('项目归属同时支持项目名称及规范代码', () => {
    expect(metricAppliesToProject({ projects: ['赛艇'] }, 'ROWING')).toBe(true);
    expect(metricAppliesToProject({ projects: ['ROWING'] }, '皮划艇')).toBe(false);
    expect(metricAppliesToProject({ projects: [] }, 'ROWING')).toBe(true);
  });
});
