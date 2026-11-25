import { describe, expect, it } from 'vitest';
import type { TeamPlanSession } from '../../shared/team-plan';
import {
  addPlanDays,
  planWeekDays,
  summarizePlanWeek,
  weekStart,
  explicitRestLabel,
} from './training-plan-week';

const session = (patch: Partial<TeamPlanSession> = {}): TeamPlanSession => ({
  id: 's1',
  date: '2026-10-19',
  category: 'special',
  period: '上午',
  content: '水上',
  durationMin: null,
  distanceKm: null,
  intensity: '',
  sets: null,
  reps: null,
  load: null,
  notes: '',
  ...patch,
});

describe('训练计划周日期', () => {
  it('周日归入此前周一，跨年和闰日不受本地时区影响', () => {
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(addPlanDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addPlanDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('生成七个连续日期', () => {
    expect(planWeekDays('2026-10-19')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });
});

describe('周计划摘要', () => {
  it('无目标保持缺失，训练课数量包括恢复课', () => {
    expect(summarizePlanWeek([session(), session({ category: 'recovery' })], '2026-10-19')).toEqual(
      {
        sessionCount: 2,
        specialDurationMin: null,
        physicalDurationMin: null,
        specialDistanceKm: null,
      }
    );
  });
  it('只累计本周对应类别有效非负目标，保留真实零', () => {
    expect(
      summarizePlanWeek(
        [
          session({ durationMin: 90, distanceKm: 16 }),
          session({ durationMin: 0, distanceKm: 0 }),
          session({ durationMin: -2, distanceKm: NaN }),
          session({ category: 'physical', durationMin: 60, distanceKm: 20 }),
          session({ category: 'physical', durationMin: Infinity }),
          session({ category: 'recovery', durationMin: 30, distanceKm: 5 }),
          session({ date: '2026-10-26', durationMin: 99, distanceKm: 99 }),
        ],
        '2026-10-19'
      )
    ).toEqual({
      sessionCount: 6,
      specialDurationMin: 90,
      physicalDurationMin: 60,
      specialDistanceKm: 16,
    });
    expect(
      summarizePlanWeek([session({ durationMin: 0, distanceKm: 0 })], '2026-10-19')
        .specialDurationMin
    ).toBe(0);
  });
});

describe('明确休息安排', () => {
  it('不把缺失、组间休息或一般恢复推断为休息日', () => {
    expect(explicitRestLabel([])).toBeNull();
    expect(explicitRestLabel([session({ content: '组间休息' })])).toBeNull();
    expect(explicitRestLabel([session({ category: 'recovery', content: '主动恢复' })])).toBeNull();
    const rest = session({ category: 'recovery', content: '全天休息' });
    expect(explicitRestLabel([rest])).toBe('休息日');
    expect(explicitRestLabel([rest, session()])).toBe('含休息安排');
  });
});
