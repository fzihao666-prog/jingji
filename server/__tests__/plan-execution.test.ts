import { describe, expect, it } from 'vitest';
import { buildPlanExecution } from '../core/plan-execution.ts';

const now = new Date('2026-09-28T02:00:00Z');
const athletes = [
  { athleteId: 1, athleteName: '样例甲', team: '一队' },
];

function plan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    athleteId: 1,
    startDate: '2026-09-22',
    endDate: '2026-09-28',
    title: '本周训练计划',
    planData: JSON.stringify({
      weeklyPlans: [
        {
          days: [
            { dayOfWeek: '周一', focus: '有氧', exercises: [{ name: '跑步' }] },
            { dayOfWeek: '周三', focus: '力量', exercises: [{ name: '深蹲' }] },
            { dayOfWeek: '周五', focus: '专项', exercises: [{ name: '划船' }] },
          ],
        },
      ],
    }),
    ...overrides,
  };
}

function session(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    athleteId: 1,
    date: '2026-09-28',
    durationMin: 90,
    srpe: 450,
    source: 'manual',
    quality: 'valid',
    isDemo: 0,
    ...overrides,
  };
}

describe('训练计划执行率', () => {
  it('对比计划天数与实际天数计算执行率', () => {
    const plans = [plan()];
    const sessions = [
      session({ date: '2026-09-22' }),
      session({ date: '2026-09-24' }),
    ];
    const result = buildPlanExecution({ athletes, plans, sessions, now });
    expect(result.athletes[0].hasPlan).toBe(true);
    expect(result.athletes[0].plannedDays).toBeGreaterThan(0);
    expect(result.athletes[0].actualDays).toBe(2);
    expect(result.athletes[0].completionRate).not.toBeNull();
    expect(result.summary.withPlan).toBe(1);
  });

  it('无计划时状态为 no-plan', () => {
    const result = buildPlanExecution({ athletes, plans: [], sessions: [session()], now });
    expect(result.athletes[0].hasPlan).toBe(false);
    expect(result.athletes[0].status).toBe('no-plan');
    expect(result.summary.withoutPlan).toBe(1);
  });

  it('排除演示与低质量训练记录', () => {
    const plans = [plan()];
    const sessions = [
      session({ isDemo: 1 }),
      session({ quality: 'estimated' }),
      session({ source: 'demo_seed' }),
    ];
    const result = buildPlanExecution({ athletes, plans, sessions, now });
    expect(result.athletes[0].actualDays).toBe(0);
    expect(result.athletes[0].status).toBe('missed');
  });

  it('计划超出统计窗口时不计入', () => {
    const plans = [
      plan({ startDate: '2026-08-01', endDate: '2026-08-31' }),
    ];
    const result = buildPlanExecution({ athletes, plans, sessions: [], now });
    expect(result.athletes[0].hasPlan).toBe(false);
    expect(result.summary.withoutPlan).toBe(1);
  });

  it('空数据返回空结果', () => {
    const result = buildPlanExecution({ athletes: [], plans: [], sessions: [], now });
    expect(result.summary.total).toBe(0);
  });
});
