import { describe, expect, it } from 'vitest';

import { aggregateSpecialTraining, buildSpecialTestComparison, type SpecialSession } from './special-training.js';

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

  it('仅展示实际存在的分区，不给任意项目补水上分区', () => {
    expect(aggregateSpecialTraining([row]).intensity).toEqual([{name:'UT2',durationMin:60,percentage:100}]);
    expect(aggregateSpecialTraining([]).intensity).toEqual([]);
  });
  it('未知分区保留原文，缺失时长不记为0',()=>{
    const result=aggregateSpecialTraining([{...row,intensityZone:'X5'},{...row,id:2,intensityZone:'AN',durationReported:false}]);
    expect(result.intensity.map(item=>item.name)).toEqual(['AN','X5']);
    expect(result.intensity.find(item=>item.name==='AN')?.durationMin).toBeNull();
  });
  it('按原始分区汇总，体系缺失不影响展示', () => {
    const result = aggregateSpecialTraining([
      { ...row, intensityZone: 'AT', intensitySystem: 'U_SYSTEM' },
      { ...row, id: 2, intensityZone: 'AT', intensitySystem: 'UT_SYSTEM', durationMin: 30 },
      { ...row, id: 3, intensityZone: 'AT', intensitySystem: null, durationMin: 15 },
    ]);
    expect(result.intensity).toEqual([{ name: 'AT', durationMin: 105, percentage: 100 }]);
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
