import { describe, expect, it } from 'vitest';
import {
  bodyFieldValues,
  bodyReviewGroups,
  bodyReviewKey,
  type BodyReviewItem,
} from './body-import-review.js';
const item: BodyReviewItem = {
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
      bodyReviewGroups([
        item,
        { ...item, id: 2 },
        { ...item, id: 3, athleteId: 2 },
        { ...item, id: 4, eventDate: '2026-09-04' },
      ]).map((group) => group.map((row) => row.id))
    ).toEqual([[1, 2]]);
    expect(
      bodyReviewKey({ ...item, athleteId: null, payload: { personKey: 'person-a' } })
    ).not.toBe(bodyReviewKey({ ...item, athleteId: null, payload: { personKey: 'person-b' } }));
  });
  it('排除行不归组，合并来源保留在卡片追溯', () => {
    expect(bodyReviewGroups([item, { ...item, id: 2, resolution: 'skip' }])).toEqual([]);
    expect(
      bodyReviewGroups([
        { ...item, payload: { bodyMergeDecision: {} } },
        { ...item, id: 2, resolution: 'skip', payload: { bodyMergedInto: 1 } },
      ])[0]
    ).toHaveLength(2);
  });
  it('真实0参与比较，缺失不生成数值，精度不同不默认相同', () => {
    expect(bodyFieldValues([{ ...item, payload: { weightKg: 0 } }, item], 'weightKg')).toEqual([0]);
    expect(
      bodyFieldValues(
        [
          { ...item, payload: { weightKg: 85.94 } },
          { ...item, payload: { weightKg: 85.9 } },
        ],
        'weightKg'
      )
    ).toEqual([85.94, 85.9]);
  });
});
