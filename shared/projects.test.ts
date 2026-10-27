import { describe, expect, expectTypeOf, it } from 'vitest';
import { isProject, normalizeProject, projectLabel, type Project } from './projects.js';

describe('normalizeProject', () => {
  it('将赛艇中文名称规范为 ROWING', () => {
    expect(normalizeProject('赛艇')).toBe('ROWING');
  });

  it('拒绝未知项目', () => {
    expect(normalizeProject('未知项目')).toBeNull();
    expect(normalizeProject('自行车')).toBeNull();
    expect(normalizeProject('')).toBeNull();
    expect(normalizeProject('toString')).toBeNull();
    expect(normalizeProject('__proto__')).toBeNull();
    expect(isProject('constructor')).toBe(false);
  });

  it('保留精确项目类型并规范已知名称', () => {
    expectTypeOf<string>().not.toExtend<Project>();
    expect(normalizeProject('公路自行车')).toBe('CYCLING_ROAD');
    expect(normalizeProject('Cycling Track')).toBe('CYCLING_TRACK');
    expect(normalizeProject('排球')).toBe('VOLLEYBALL');
    expect(normalizeProject('激流')).toBe('CANOE_SLALOM');
  });

  it('为项目代码提供中文展示名称并保留未知值', () => {
    expect(projectLabel('ROWING')).toBe('赛艇');
    expect(projectLabel('CANOE_SPRINT')).toBe('皮划艇');
    expect(projectLabel('历史项目')).toBe('历史项目');
  });
});
