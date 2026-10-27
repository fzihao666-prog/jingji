import { describe, expect, it } from 'vitest';
import { trainingContentCategory, trainingLoadCategory } from './training-content-category.js';
describe('训练分类按活动和项目适用', () => {
  it('通用专项描述不等于水上', () => {
    expect(trainingContentCategory({ trainingType: '专项训练', content: '排球发球' })).toBe('排球技术');
    expect(trainingContentCategory({ trainingType: '专项训练' })).toBe('专项');
    expect(trainingContentCategory({ content: '公路骑行' })).toBe('骑行');
    expect(trainingContentCategory({ content: '水上划桨' })).toBe('水上');
  });
  it('显式活动优先于旧文字推断，恢复类别不被专项覆盖', () => {
    expect(trainingContentCategory({ activityCode: 'cycling', content: '赛艇交叉训练' })).toBe('骑行');
    expect(trainingLoadCategory({ trainingCategory: 'recovery', content: '专项训练' })).toBe('recovery');
    expect(trainingLoadCategory({ trainingCategory: 'physical', content: '专项训练' })).toBe('physical');
  });
});
