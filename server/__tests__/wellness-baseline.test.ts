import { describe, expect, it } from 'vitest';
import { buildWellnessBaseline } from '../core/wellness-baseline.ts';

const now = new Date('2026-09-28T02:00:00Z');
const athletes = [
  { athleteId: 1, athleteName: '样例甲', team: '一队' },
];

type WellnessRow = {
  athleteId: number;
  date: string;
  sleepHours: number | null;
  morningPulse: number | null;
  weightKg: number | null;
  fatigueIndex: number | null;
  sorenessIndex: number | null;
  moodIndex: number | null;
};

function wellnessRow(overrides: Partial<WellnessRow> = {}): WellnessRow {
  return {
    athleteId: 1,
    date: '2026-09-28',
    sleepHours: 7.5,
    morningPulse: 55,
    weightKg: 70,
    fatigueIndex: 3,
    sorenessIndex: 2,
    moodIndex: 7,
    ...overrides,
  };
}

// 生成 28 天基线数据
function baselineRows(): WellnessRow[] {
  return Array.from({ length: 28 }, (_, i) => {
    const day = 28 - i;
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    return wellnessRow({ date, morningPulse: 55, fatigueIndex: 3, sleepHours: 7.5 });
  });
}

describe('恢复状态基线偏离预警', () => {
  it('近3天偏离超过1σ时触发预警', () => {
    const rows = [
      ...baselineRows(),
      // 近3天晨脉显著升高
      wellnessRow({ date: '2026-09-26', morningPulse: 65 }),
      wellnessRow({ date: '2026-09-27', morningPulse: 68 }),
      wellnessRow({ date: '2026-09-28', morningPulse: 70 }),
    ];
    const result = buildWellnessBaseline({ athletes, wellness: rows, now });
    const pulseAlert = result.alerts.find((a) => a.metric === 'morningPulse');
    expect(pulseAlert).toBeDefined();
    expect(pulseAlert!.direction).toBe('up');
    expect(pulseAlert!.severity).toBeDefined();
  });

  it('无偏离时不触发预警', () => {
    const rows = baselineRows();
    const result = buildWellnessBaseline({ athletes, wellness: rows, now });
    expect(result.alerts).toHaveLength(0);
  });

  it('基线数据不足时不预警', () => {
    const rows = [
      wellnessRow({ date: '2026-09-26', morningPulse: 65 }),
      wellnessRow({ date: '2026-09-27', morningPulse: 68 }),
    ];
    const result = buildWellnessBaseline({ athletes, wellness: rows, now });
    expect(result.alerts).toHaveLength(0);
  });

  it('疲劳程度升高为恶化方向', () => {
    const rows = [
      ...baselineRows(),
      wellnessRow({ date: '2026-09-26', fatigueIndex: 8 }),
      wellnessRow({ date: '2026-09-27', fatigueIndex: 9 }),
      wellnessRow({ date: '2026-09-28', fatigueIndex: 9 }),
    ];
    const result = buildWellnessBaseline({ athletes, wellness: rows, now });
    const fatigueAlert = result.alerts.find((a) => a.metric === 'fatigueIndex');
    expect(fatigueAlert).toBeDefined();
    expect(fatigueAlert!.direction).toBe('up');
  });

  it('空数据返回空结果', () => {
    const result = buildWellnessBaseline({ athletes: [], wellness: [], now });
    expect(result.summary.total).toBe(0);
    expect(result.alerts).toHaveLength(0);
  });
});
