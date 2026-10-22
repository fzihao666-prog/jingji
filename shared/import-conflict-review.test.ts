import { describe, expect, it } from 'vitest';
import {
  importFieldValues,
  isImportException,
  importReviewValuesEqual,
  reviewComparisonRecords,
  importReviewGroups,
  importReviewKey,
  selectImportReviewRecord,
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
it('异常同时包含错误和待复核，已排除和自动跳过的来源不计入', () => {
  const rows = [
    { ...item, quality: 'warning' },
    { ...item, id: 2, quality: 'warning' },
    { ...item, id: 3, quality: 'warning' },
    { ...item, id: 4, quality: 'valid' },
    { ...item, id: 5, resolution: 'skip' },
    { ...item, id: 6, quality: 'skipped', itemType: 'invalid_row' },
  ];
  expect(rows.filter(isImportException).map(row => row.id)).toEqual([1, 2, 3]);
  expect(isImportException(item)).toBe(true);
  expect(isImportException({ ...item, itemType: 'invalid_row', quality: 'valid' })).toBe(true);
});
it('机器浮点尾差相同，但真实精度差异、文本、空白和零保持区别', () => {
  expect(importReviewValuesEqual(61.3, 61.300000000000004)).toBe(true);
  expect(importReviewValuesEqual(85.94, 85.9)).toBe(false);
  expect(importReviewValuesEqual(0, 1e-20)).toBe(false);
  expect(importReviewValuesEqual(1e-20, 1.01e-20)).toBe(false);
  expect(importReviewValuesEqual(null, 0)).toBe(false);
  expect(importReviewValuesEqual('061.3', '61.3')).toBe(false);
  expect(importReviewValuesEqual(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)).toBe(false);
  expect(importFieldValues([{ ...item, payload: { weightKg: 61.3 } }, { ...item, payload: { weightKg: 61.300000000000004 } }], 'weightKg')).toEqual([61.3]);
});
it('档案与数据库不同直接按新导入更新，同一文件内不同值仍需选择', () => {
  const profile = { ...item, itemType: 'athlete_profile', payload: { bloodType: 'O' }, conflict: { exists: true, fields: [{ field: 'bloodType', oldValue: 'A', newValue: 'O', overwrites: true }] } };
  expect(importReviewGroups([profile])).toEqual([]);
  expect(importReviewGroups([profile, { ...profile, id: 2, payload: { bloodType: 'B' } }])).toHaveLength(1);
});
it('所有导入类型与数据库不同都不再产生审查卡片', () => {
  for (const itemType of ['body_measurement', 'wellness', 'test_measurement', 'training_session', 'training_set', 'injury_record', 'competitive_state', 'scoring_rule']) {
    expect(importReviewGroups([{ ...item, itemType, payload: { weightKg: 70 }, conflict: { exists: true, fields: [{ field: 'weightKg', oldValue: '60', newValue: '70', overwrites: true }] } }])).toEqual([]);
  }
});

it('65个指标仅展示与待选字段有关的来源，保留原序号和全部原始记录', () => {
  const records = Array.from({ length: 65 }, (_, index) => ({ ...item, id: index + 1, payload: index === 1 ? { weightKg: 61.3 } : { heightCm: 173 } }));
  const database = records.map(record => ({ ...record, id: -record.id, payload: { ...record.payload, reviewDatabase: true } }));
  const all = [...records, ...database];
  expect(reviewComparisonRecords(all, ['weightKg']).map(({ item, index }) => [item.id, index])).toEqual([[2, 1], [-2, 66]]);
  expect(all).toHaveLength(130);
  expect(reviewComparisonRecords(records, ['heightCm'])).toHaveLength(1);
});
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


describe('批量选择记录序号', () => {
  const group = (id: number) => [
    { ...item, id, payload: { weightKg: 80, bodyFatPct: 0 } },
    { ...item, id: id + 1, payload: { weightKg: 81, bodyFatPct: 20, skeletalMuscleKg: 30 } },
  ];
  it('处理全部组而非当前8组页，保留真实0与互补字段', () => {
    const updates = selectImportReviewRecord(Array.from({ length: 10 }, (_, index) => group(index * 2 + 1)), 0);
    expect(updates).toHaveLength(10);
    expect(updates.every(update => update.payload.valueReview.action === 'merge')).toBe(true);
    expect(updates[0].payload.valueReview).toMatchObject({ values: { weightKg: 80, bodyFatPct: 0, skeletalMuscleKg: 30 } });
  });
  it('记录2选择其对应值，已处理组及不存在该序号的组不改变', () => {
    expect(selectImportReviewRecord([group(1), [{ ...item, payload: { valueReviewDecision: {} } }], [item]], 1))
      .toEqual([expect.objectContaining({ id: 1, payload: { valueReview: expect.objectContaining({ values: { weightKg: 81, bodyFatPct: 20, skeletalMuscleKg: 30 } }) } })]);
  });
  it('所选记录缺少冲突字段时暂存已有选择，不猜测其余值', () => {
    const updates = selectImportReviewRecord([[{ ...item, payload: { weightKg: 80 } }, { ...item, id: 2, payload: { weightKg: 81, bodyFatPct: 10 } }, { ...item, id: 3, payload: { bodyFatPct: 20 } }]], 0);
    expect(updates[0].payload.valueReview).toEqual({ action: 'draft', choices: { weightKg: '80' }, manual: {} });
  });
  it('批量选择只采用文件记录，不再混入数据库旧值', () => {
    const row = { ...item, payload: { weightKg: 81 }, conflict: { exists: true, fields: [{ field: 'weightKg', oldValue: '80', newValue: '81', overwrites: true }] } };
    expect(selectImportReviewRecord([[row]], 0)[0].payload.valueReview).toMatchObject({ action: 'merge', values: { weightKg: 81 }, includeDatabase: false });
  });
});
