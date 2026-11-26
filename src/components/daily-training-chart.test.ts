import { expect, it } from 'vitest';
import type { DailyTrainingRecord } from '../../shared/daily-training';
import { dailyTrainingSeries, dailyTrainingTrendOption } from './daily-training-chart';

const record: DailyTrainingRecord = {
  id: 1, setGroupId: null, date: '2025-11-25', projectName: '杠铃深蹲',
  distanceKm: null, rpe: null,
  intensity: 0, intensityUnit: 'kg', repetitions: null, sets: null, durationMin: null, pre: null,
};

it('强度按原始单位分组，保留真实零值和同日多条记录', () => {
  const series = dailyTrainingSeries([
    record, { ...record, id: 2, intensity: 40 }, { ...record, id: 3, intensity: 90, intensityUnit: 'lb' },
    { ...record, id: 4, date: '2025-11-28', intensity: null, intensityUnit: null },
  ]);
  expect(series.map(({ label, points }) => [label, points.map(point => point.value)]))
    .toEqual([['强度（kg）', [0, 40]], ['强度（lb）', [90]]]);
  expect(dailyTrainingTrendOption(series[0], '2025-11-24', '2025-11-29')).toMatchObject({
    xAxis: { type: 'time', min: Date.parse('2025-11-24'), max: Date.parse('2025-11-29') },
    series: [{ type: 'scatter', data: [[Date.parse(record.date), 0], [Date.parse(record.date), 40]] }],
  });
});

it('跨缺测日期断线，按日期排序', () => {
  const [series] = dailyTrainingSeries([{ ...record, id: 2, date: '2025-11-27', intensity: 42 }, record]);
  expect(dailyTrainingTrendOption(series, '2025-11-25', '2025-11-27')).toMatchObject({
    series: [{ type: 'line', connectNulls: false, data: [
      [Date.parse('2025-11-25'), 0], [Date.parse('2025-11-26'), null], [Date.parse('2025-11-27'), 42],
    ] }],
  });
});
