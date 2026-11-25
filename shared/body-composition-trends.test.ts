import { describe, expect, it } from 'vitest';

import { buildBodyCompositionTrends } from './body-composition-trends.js';

describe('buildBodyCompositionTrends', () => {
  it('按测量日期排序，并计算最新一次相对上一次的变化', () => {
    const trends = buildBodyCompositionTrends([
      {
        measurementDate: '2026-03-20',
        skeletalMuscleKg: 34.2,
        bodyFatPct: 15.8,
        totalBodyWaterKg: 42.6,
      },
      {
        measurementDate: '2026-01-20',
        skeletalMuscleKg: 33.5,
        bodyFatPct: 16.4,
        totalBodyWaterKg: 41.8,
      },
    ]);

    expect(trends[0]).toMatchObject({
      key: 'skeletalMuscleKg',
      latestValue: 34.2,
      deltaFromPrevious: 0.7,
      points: [
        { measurementDate: '2026-01-20', value: 33.5 },
        { measurementDate: '2026-03-20', value: 34.2 },
      ],
    });
  });

  it('跳过缺失值，并在不足两次实测时不提供变化值', () => {
    const trends = buildBodyCompositionTrends([
      {
        measurementDate: '2026-01-20',
        skeletalMuscleKg: null,
        bodyFatPct: 16.4,
        totalBodyWaterKg: null,
      },
      {
        measurementDate: '2026-03-20',
        skeletalMuscleKg: 34.2,
        bodyFatPct: 15.8,
        totalBodyWaterKg: null,
      },
    ]);

    expect(trends[0]).toMatchObject({
      latestValue: 34.2,
      deltaFromPrevious: null,
      points: [{ measurementDate: '2026-03-20', value: 34.2 }],
    });
  });
});
