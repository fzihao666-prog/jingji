import { describe, expect, it } from 'vitest';
import { trainingRecordScope } from './training-record-scope';

describe('页面训练记录请求范围', () => {
  it.each([
    'overview',
    'special-overview',
    'strength-overview',
    'strength-records',
    'training-plans',
    'physiology-biochemistry',
    'athletes',
    'coaches',
    'teams',
    'accounts',
    'reports',
  ] as const)('%s 不加载全局训练记录', (page) => {
    expect(trainingRecordScope(page, 7)).toBeUndefined();
  });
  it('个人档案只加载当前运动员，尚未选择时不请求', () => {
    expect(trainingRecordScope('personal', 7)).toEqual({ athleteId: 7 });
    expect(trainingRecordScope('personal', null)).toBeUndefined();
  });
  it.each(['special-volume', 'special-distance', 'special-records'] as const)(
    '%s 保留项目范围记录，切换运动员不改变范围',
    (page) => {
      expect(trainingRecordScope(page, 7)).toEqual({ athleteId: null });
      expect(trainingRecordScope(page, 8)).toEqual({ athleteId: null });
    }
  );
});
