import { describe, expect, it } from 'vitest';
import { normalizeProject, projectLabel } from './projects.js';

describe('normalizeProject', () => {
  it('将赛艇中文名称规范为 ROWING', () => {
    expect(normalizeProject('赛艇')).toBe('ROWING');
  });

  it('拒绝未知项目', () => {
    expect(normalizeProject('未知项目')).toBeNull();
  });

  it('为项目代码提供中文展示名称并保留未知值', () => {
    expect(projectLabel('ROWING')).toBe('赛艇');
    expect(projectLabel('CANOE_SPRINT')).toBe('皮划艇');
    expect(projectLabel('历史项目')).toBe('历史项目');
  });
});
