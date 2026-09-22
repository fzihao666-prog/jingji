import { describe, expect, it } from 'vitest';

import { buildSpecialTestComparison } from './special-training.js';

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
