import { expect, it } from 'vitest';
import type { DailyTrainingRecord } from '../../shared/daily-training';
import { recentDailyTrainingSeries, testSeriesSummary } from './recent-test-performance';

const record: DailyTrainingRecord = {
  id: 1, setGroupId: null, date: '2026-11-02', projectName: '深蹲',
  durationMin: null, distanceKm: null, rpe: null, intensity: 40,
  intensityUnit: 'kg', repetitions: null, sets: null, pre: null,
};

it('按项目、单位与导入指标条件分开，不混算不同训练记录', () => {
  const series = recentDailyTrainingSeries([
    record, { ...record, id: 2, projectName: '卧推' },
    { ...record, id: 3, intensityUnit: 'lb' },
    { ...record, id: 4, fields: [{ source: '强度', name: '重量', unit: 'kg', protocol: '协议A', version: '2' }] },
  ]);
  expect(series).toHaveLength(4);
  expect(new Set(series.map(item => item.key)).size).toBe(4);
});

it('同日多条按课次顺序展示，保留真实零值、不判定周期最好', () => {
  const [series] = recentDailyTrainingSeries([
    { ...record, id: 3, intensity: 0 }, record,
    { ...record, id: 2, date: '2026-11-01', intensity: 30 },
    { ...record, id: 4, intensity: null },
  ]);
  expect(series.points.map(point => point.value)).toEqual([30, 40, 0]);
  expect(testSeriesSummary(series)).toMatchObject({ latest: { value: 0 }, difference: -40, best: null });
});

it('无数据和非有限值不生成虚构成绩', () => {
  expect(recentDailyTrainingSeries([])).toEqual([]);
  expect(recentDailyTrainingSeries([{ ...record, intensity: NaN }])).toEqual([]);
});
