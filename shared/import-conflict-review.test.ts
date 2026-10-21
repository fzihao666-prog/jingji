import { describe, expect, it } from 'vitest';
import {
  importFieldValues,
  importReviewGroups,
  importReviewKey,
  type ImportReviewItem,
} from './import-conflict-review.js';
const item: ImportReviewItem = {
  id: 1,
  itemType: 'body_measurement',
  metricCode: 'body_composition',
  athleteId: 1,
  rawAthleteName: '示例',
  eventDate: '2026-09-03',
  payload: {},
  resolution: '',
  quality: 'error',
  sourceSheet: '身体测量',
  sourceAddress: 'B2',
};
describe('身体测量审查分组', () => {
  it('同一人员同一日期归组，不混用其他人员日期', () => {
    expect(
      importReviewGroups([
        item,
        { ...item, id: 2 },
        { ...item, id: 3, athleteId: 2 },
        { ...item, id: 4, eventDate: '2026-09-04' },
      ]).map((group) => group.map((row) => row.id))
    ).toEqual([[1, 2]]);
    expect(
      importReviewKey({ ...item, athleteId: null, payload: { personKey: 'person-a' } })
    ).not.toBe(importReviewKey({ ...item, athleteId: null, payload: { personKey: 'person-b' } }));
  });
  it('排除行不归组，合并来源保留在卡片追溯', () => {
    expect(importReviewGroups([item, { ...item, id: 2, resolution: 'skip' }])).toEqual([]);
    expect(
      importReviewGroups([
        { ...item, payload: { valueReviewDecision: {} } },
        { ...item, id: 2, resolution: 'skip', payload: { valueMergedInto: 1 } },
      ])[0]
    ).toHaveLength(2);
  });
  it('真实0参与比较，缺失不生成数值，精度不同不默认相同', () => {
    expect(importFieldValues([{ ...item, payload: { weightKg: 0 } }, item], 'weightKg')).toEqual([
      0,
    ]);
    expect(
      importFieldValues(
        [
          { ...item, payload: { weightKg: 85.94 } },
          { ...item, payload: { weightKg: 85.9 } },
        ],
        'weightKg'
      )
    ).toEqual([85.94, 85.9]);
  });
});

it('恢复、训练、力量、伤病、评估、档案和规则使用统一字段与唯一键', () => {
  for (const itemType of [
    'wellness',
    'training_session',
    'training_set',
    'injury_record',
    'competitive_state',
    'athlete_profile',
    'scoring_rule',
  ]) {
    const first = {
      ...item,
      itemType,
      payload: {
        project: '赛艇',
        gender: '男',
        score: 5,
        ruleVersion: 'v1',
        injuryName: '肩部不适',
      },
      exerciseName: '深蹲',
      sessionLabel: '力量课',
      setIndex: 1,
    };
    expect(importReviewGroups([first, { ...first, id: 2 }])).toHaveLength(1);
  }
  const strength = {
    ...item,
    itemType: 'training_set',
    exerciseName: '深蹲',
    sessionLabel: '力量课',
    setIndex: 1,
  };
  expect(importReviewGroups([strength, { ...strength, id: 2, setIndex: 2 }])).toEqual([]);
  const session = { ...item, itemType: 'training_session', payload: { sessionOrder: 1 } };
  expect(
    importReviewGroups([session, { ...session, id: 2, payload: { sessionOrder: 2 } }])
  ).toEqual([]);
});
