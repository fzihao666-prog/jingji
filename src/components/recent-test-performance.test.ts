import { describe, expect, it } from 'vitest';
import type { SpecialTestEvent, StrengthTest } from '../types';
import { recentTestSeries, testSeriesSummary } from './recent-test-performance';
const strength = (id: number, value: number, extra: Partial<StrengthTest> = {}): StrengthTest => ({
  id,
  athleteId: 7,
  testDate: '2026-10-01',
  metrics: { benchPressKg: value },
  targets: {},
  notes: '',
  updatedAt: '',
  updatedBy: '',
  protocol: '1RM',
  protocolVersion: '1',
  contextKey: 'standard',
  ...extra,
});
const build = (tests: StrengthTest[], events: SpecialTestEvent[] = []) =>
  recentTestSeries(tests, events, 7, 'ROWING', '2026-10-01', '2026-10-31');
describe('近期测试表现', () => {
  it('保留同日多次、真实零值并按次数比较', () => {
    const [series] = build([strength(2, 0), strength(1, 50)]);
    expect(series.points.map((p) => p.value)).toEqual([50, 0]);
    expect(testSeriesSummary(series)).toMatchObject({ best: 50, difference: -50 });
  });
  it('排除身体字段、其他运动员及周期外数据', () => {
    expect(
      build([
        strength(1, 2, { metrics: { heightCm: 180, weightKg: 70 } }),
        strength(2, 90, { athleteId: 8 }),
        strength(3, 100, { testDate: '2026-09-30' }),
      ])
    ).toEqual([]);
  });
  it('同指标仅一个选项，比较条件内部保留，缺失条件展示原成绩', () => {
    const series = build([
      strength(1, 50),
      strength(2, 60, { protocolVersion: '2' }),
      strength(3, 70, { contextKey: undefined }),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].label).toBe('卧推');
    expect(series[0].points).toHaveLength(3);
    const unknown = series.find((item) => !item.comparable)!;
    expect(testSeriesSummary(unknown)).toMatchObject({
      best: null,
      difference: null,
      latest: { value: 70 },
    });
  });
  it('专项按距离、艇型和条件分组，保留每次计时，较低为最好', () => {
    const event: SpecialTestEvent = {
      id: 1,
      project: 'ROWING',
      testDate: '2026-10-01',
      distanceM: 2000,
      boatClass: '1x',
      genderGroup: '男',
      session: '上午',
      location: '基地',
      windConditions: '无风',
      note: '',
      results: [
        {
          id: 1,
          rank: 1,
          crewName: '',
          memberAthleteIds: [7],
          memberNames: ['A'],
          previousBestMs: null,
          attemptsMs: [400000, 390000, 0],
          averageMs: 395000,
          bestMs: 390000,
          deltaPreviousMs: null,
          gapLeaderMs: 0,
        },
      ],
    };
    const [series] = build([], [event]);
    expect(series.points.map((p) => p.value)).toEqual([400, 390, 0]);
    expect(series.label).not.toContain('7');
    expect(testSeriesSummary(series)).toMatchObject({ best: 0, difference: -390 });
    expect(build([], [event, { ...event, id: 2, distanceM: 1000 }])).toHaveLength(2);
  });
  it('心率与乳酸不臆造高低优劣', () => {
    const [series] = recentTestSeries(
      [strength(1, 0, { metrics: { anaerobicThresholdHr: 160 } })],
      [],
      7,
      'CANOE_SLALOM',
      '2026-10-01',
      '2026-10-31'
    );
    expect(testSeriesSummary(series).best).toBeNull();
  });
});
