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

it('项目类别仅含适用项，越界历史类别进入待核实而非丢弃', async () => {
 const { trainingContentCategories, projectTrainingContentCategory } = await import('./training-content-category.js');
 expect(trainingContentCategories('VOLLEYBALL')).toContain('排球技术');
 expect(trainingContentCategories('VOLLEYBALL')).not.toContain('水上');
 expect(trainingContentCategories('CYCLING_ROAD')).not.toContain('排球技术');
 expect(trainingContentCategories('ROWING')).toContain('骑行');
 expect(projectTrainingContentCategory('VOLLEYBALL',{content:'水上训练'})).toBe('未分类');
});

it('明确力量活动不会被备注中的项目活动覆盖，活动本身不决定训练目的', () => {
  expect(trainingContentCategory({ activityCode: 'strength', content: '水上训练' })).toBe(
    '力量训练'
  );
  expect(trainingContentCategory({ activityCode: 'strength', content: '水上专项深蹲' })).toBe(
    '最大力量'
  );
  expect(trainingLoadCategory({ activityCode: 'cycling', content: '骑行' })).toBeNull();
  expect(
    trainingLoadCategory({ activityCode: 'cycling', trainingType: '体能训练', content: '骑行' })
  ).toBe('physical');
});

it('历史分类自动复用明确描述，不要求审核也不改写事实', async () => {
  const { projectTrainingContentCategory, trainingClassificationReason } =
    await import('./training-content-category.js');
  const legacy = { trainingType: '专项训练', content: '水上训练' };
  expect(projectTrainingContentCategory('ROWING', legacy)).toBe('水上');
  expect(trainingClassificationReason('ROWING', legacy)).toBe('训练活动未分类');
  expect(legacy).toEqual({ trainingType: '专项训练', content: '水上训练' });
  expect(projectTrainingContentCategory('ROWING', { ...legacy, activityCode: 'cycling' })).toBe(
    '骑行'
  );
  expect(
    projectTrainingContentCategory('VOLLEYBALL', {
      ...legacy,
      activityCode: 'volleyball_technique',
      intensitySystem: 'U_SYSTEM',
    })
  ).toBe('排球技术');
  expect(
    projectTrainingContentCategory('ROWING', { activityCode: 'strength', content: '水上' })
  ).toBe('力量训练');
});

it('无法识别的历史内容显示未分类，项目核实状态不阻断展示分类', async () => {
  const { projectTrainingContentCategory } = await import('./training-content-category.js');
  expect(projectTrainingContentCategory('ROWING', { content: '例行安排' })).toBe('未分类');
  expect(projectTrainingContentCategory('ROWING', { content: '水上划桨', projectStatus: 'pending_verification' })).toBe('水上');
});
