import { expect, it } from 'vitest';
import { trainingPeriodSummary } from './training-period-summary.js';
it('公共档案汇总保留填报和RPE缺失语义', () => {
  expect(trainingPeriodSummary([
    { durationMin: 40, distanceKm: 0, distanceReported: false, srpe: 200, rpe: 5, status: 'normal' },
    { durationMin: 20, distanceKm: 2, distanceReported: true, srpe: 999, rpe: null, status: 'normal' },
  ])).toEqual({ totalSrpe: 200, totalDistanceKm: 2, sessions: 2 });
});
