import assert from 'node:assert/strict';
import { TRAINING_CONTENT_CATEGORIES, trainingContentCategory } from '../shared/training-content-category.ts';

assert.equal(TRAINING_CONTENT_CATEGORIES.length, 9, '训练课比值必须固定展示九类');
assert.deepEqual(TRAINING_CONTENT_CATEGORIES, ['水上', '测功仪', '功能', '拉伸再生', '力量耐力', '最大力量', '速度力量', '跑步', '其它']);

const cases = [
  [{ trainingType: '专项训练', content: '水上专项划行' }, '水上'],
  [{ structureType: '体能训练', content: '划船测功仪间歇' }, '测功仪'],
  [{ structureType: '功能训练', content: '核心稳定与协调' }, '功能'],
  [{ trainingType: '恢复训练', content: '拉伸、泡沫轴与再生恢复' }, '拉伸再生'],
  [{ structureType: '力量耐力', content: '循环力量耐力' }, '力量耐力'],
  [{ structureType: '最大力量', content: '深蹲训练' }, '最大力量'],
  [{ structureType: '速度力量', content: '高拉爆发训练' }, '速度力量'],
  [{ content: '跑步间歇' }, '跑步'],
  [{ trainingType: '', structureType: '', content: '' }, '其它'],
  [{ content: '未知课次内容' }, '其它']
] as const;

for (const [input, expected] of cases) assert.equal(trainingContentCategory(input), expected);

console.log('training-content-ratio-check passed');
