import { describe, expect, it } from 'vitest';
import { normalizeTechnicalLevel, validTechnicalLevel } from './athlete-technical-level.js';
describe('技术等级归一化', () => {
  it.each([['', ''], ['未定级', '未定级'], ['国家一级运动员', '一级运动员'], ['三级', '三级运动员'], ['国家运动健将', '运动健将'], ['自定义一级称号', '自定义一级称号']])('%s → %s', (input, expected) => expect(normalizeTechnicalLevel(input)).toBe(expected));
  it('未知值保留原文并判为无效', () => expect(validTechnicalLevel('自定义一级称号')).toBe(false));
});
