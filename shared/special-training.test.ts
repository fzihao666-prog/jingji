import { describe, expect, it } from 'vitest';

import { aggregateSpecialTraining, buildSpecialTestComparison, type SpecialSession } from './special-training.js';
import { SPECIAL_TRAINING_INTENSITY_ZONE_ORDER } from './training-intensity.js';

describe('aggregateSpecialTraining 强度分区', () => {
  const row: SpecialSession = {
    id: 1,
    date: '2026-09-01',
    athleteId: 1,
    athleteName: '测试运动员',
    project: 'ROWING',
    team: '测试队伍',
    trainingType: '专项训练',
    structureType: '',
    content: '水上技术',
    intensityZone: 'UT2',
    durationMin: 60,
    distanceKm: 12,
    durationReported: true,
    distanceReported: true,
    srpe: 360,
    rpe: 6,
    sessionDemo: 0,
    sessionSource: 'manual',
  };

  it('固定展示全部强度分区维度，未训练分区保留 0 值行', () => {
    const result = aggregateSpecialTraining([row]);
    expect(result.intensity.map((item) => item.name)).toEqual([...SPECIAL_TRAINING_INTENSITY_ZONE_ORDER]);
    expect(result.intensity.map((item) => item.durationMin)).toEqual([
      0, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(result.intensity.map((item) => item.percentage)).toEqual([
      0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('未知分区原样追加在标准顺序之后，缺失时长不记为 0', () => {
    const result = aggregateSpecialTraining([
      { ...row, intensityZone: 'X5' },
      { ...row, id: 2, intensityZone: 'AN', durationReported: false },
    ]);
    expect(result.intensity.map((item) => item.name)).toEqual([
      ...SPECIAL_TRAINING_INTENSITY_ZONE_ORDER,
      'X5',
    ]);
    const an = result.intensity.find((item) => item.name === 'AN');
    expect(an?.durationMin).toBeNull();
  });

  it('无记录时全部分区保留 0 值行，占比为 0', () => {
    const result = aggregateSpecialTraining([]);
    expect(result.intensity.map((item) => item.name)).toEqual([...SPECIAL_TRAINING_INTENSITY_ZONE_ORDER]);
    expect(result.intensity.every((item) => item.percentage === 0)).toBe(true);
  });
});

describe('buildSpecialTestComparison', () => {
  it('取最近成绩并计算同日期、距离、艇型的团队均值', () => {
    expect(
      buildSpecialTestComparison({
        athleteId: 7,
        tests: [
          {
            athleteId: 7,
            testDate: '2026-09-10',
            distanceM: 2000,
            boatClass: 'M1x',
            bestMs: 420000,
          },
          {
            athleteId: 7,
            testDate: '2026-09-18',
            distanceM: 2000,
            boatClass: 'M1x',
            bestMs: 415000,
          },
          {
            athleteId: 8,
            testDate: '2026-09-18',
            distanceM: 2000,
            boatClass: 'M1x',
            bestMs: 410000,
          },
        ],
      })
    ).toMatchObject({
      athlete: { bestMs: 415000 },
      teamAverage: 412500,
      deltaMs: 2500,
    });
  });

  it('无个人成绩时不零填充', () => {
    expect(buildSpecialTestComparison({ athleteId: 7, tests: [] })).toEqual({
      athlete: null,
      teamAverage: null,
      deltaMs: null,
    });
  });

  it('团队基准不重复计算同一运动员成绩', () => {
    expect(
      buildSpecialTestComparison({
        athleteId: 7,
        tests: [
          {
            athleteId: 7,
            testDate: '2026-09-18',
            distanceM: 2000,
            boatClass: 'M1x',
            bestMs: 415000,
          },
          {
            athleteId: 8,
            testDate: '2026-09-18',
            distanceM: 2000,
            boatClass: 'M1x',
            bestMs: 410000,
          },
          {
            athleteId: 8,
            testDate: '2026-09-18',
            distanceM: 2000,
            boatClass: 'M1x',
            bestMs: 412000,
          },
        ],
      }).teamAverage
    ).toBe(412500);
  });
});
