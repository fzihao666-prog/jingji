import { describe, expect, it } from 'vitest';
import { normalizeProject } from './projects.js';

describe('normalizeProject', () => {
  it('将赛艇中文名称规范为 ROWING', () => {
    expect(normalizeProject('赛艇')).toBe('ROWING');
  });

  it('拒绝未知项目', () => {
    expect(normalizeProject('未知项目')).toBeNull();
  });
});
