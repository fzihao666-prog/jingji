import { expect, it } from 'vitest';
import { parseTrainingYears, trainingYearsFromDate } from './training-years.js';
it.each([[2, 2], ['2年', 2], ['2年8个月', 2 + 8 / 12], ['8个月', 8 / 12],
  ['2.5', 2.5], ['０年', 0], ['2年整', 2], ['2.5年8个月', null], ['-1', null],
  ['', null], ['2026-01-01', null], ['未知', null]])('解析 %s', (input, expected) => {
  expect(parseTrainingYears(input)).toBe(expected);
});
it('自然月计算尊重筛选日期及缺失、未来和无效日期', () => {
  expect(trainingYearsFromDate('2020-11-18', '2026-11-17')).toBe(71 / 12);
  expect(trainingYearsFromDate('2020-11-18', '2026-11-18')).toBe(6);
  expect(trainingYearsFromDate('2027-01-01', '2026-11-18')).toBeNull();
  expect(trainingYearsFromDate('2020-02-30', '2026-11-18')).toBeNull();
  expect(trainingYearsFromDate(null, '2026-11-18')).toBeNull();
});
