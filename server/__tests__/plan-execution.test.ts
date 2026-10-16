import { describe, expect, it } from 'vitest';
import { buildPlanExecution } from '../core/plan-execution.ts';

const now = new Date('2026-09-28T02:00:00Z');
const athletes = [{ athleteId: 1, athleteName: '样例甲', team: '一队' }];

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
    const sessions = [session({ date: '2026-09-22' }), session({ date: '2026-09-24' })];
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
    const plans = [plan({ startDate: '2026-08-01', endDate: '2026-08-31' })];
    const result = buildPlanExecution({ athletes, plans, sessions: [], now });
    expect(result.athletes[0].hasPlan).toBe(false);
    expect(result.summary.withoutPlan).toBe(1);
  });

  it('空数据返回空结果', () => {
    const result = buildPlanExecution({ athletes: [], plans: [], sessions: [], now });
    expect(result.summary.total).toBe(0);
    expect(result.today.summary.planned).toBe(0);
    expect(result.today.plan.hasPlan).toBe(false);
  });

  it('今日计划与执行事实分开统计，训练前不判定未完成', () => {
    // 今天是周一，计划里有周一课表；实际有一条正式课次（含 RPE）。
    const plans = [plan()];
    const sessions = [
      session({
        durationMin: 90,
        durationReported: 1,
        distanceKm: 12,
        distanceReported: 1,
        rpe: 6,
      }),
    ];
    const result = buildPlanExecution({ athletes, plans, sessions, now });
    const row = result.athletes[0];
    expect(row.hasPlanToday).toBe(true);
    expect(row.todayStatus).toBe('recorded');
    expect(row.todayDurationMin).toBe(90);
    expect(row.todayDistanceKm).toBe(12);
    expect(row.todayRpeReported).toBe(true);
    expect(result.today.summary).toMatchObject({
      planned: 1,
      recorded: 1,
      confirmed: 1,
      pending: 0,
      rpeReported: 1,
      actualDurationMin: 90,
      actualDistanceKm: 12,
    });
    expect(result.today.plan.focus).toEqual(['有氧']);
    expect(result.today.plan.physicalItems).toContain('跑步');
  });

  it('今日有计划无记录只记待确认，未报量不计 0', () => {
    const result = buildPlanExecution({ athletes, plans: [plan()], sessions: [], now });
    expect(result.athletes[0].todayStatus).toBe('pending');
    expect(result.athletes[0].todayDurationMin).toBeNull();
    expect(result.athletes[0].todayDistanceKm).toBeNull();
    expect(result.today.summary).toMatchObject({
      planned: 1,
      recorded: 0,
      confirmed: 0,
      pending: 1,
    });
    expect(result.today.summary.actualDurationMin).toBeNull();
    expect(result.today.summary.actualDistanceKm).toBeNull();
  });

  it('无今日计划但有训练记录时计入已记录，不算计划内完成', () => {
    const result = buildPlanExecution({
      athletes,
      plans: [],
      sessions: [session({ durationMin: 60, durationReported: 1, rpe: null })],
      now,
    });
    expect(result.athletes[0].todayStatus).toBe('recorded');
    expect(result.athletes[0].hasPlanToday).toBe(false);
    expect(result.today.summary).toMatchObject({
      planned: 0,
      recorded: 1,
      confirmed: 0,
      rpeReported: 0,
      actualDurationMin: 60,
    });
  });
});

describe('队伍计划逐课执行与版本快照', () => {
  const lesson = {
    id: 'am',
    date: '2026-09-28',
    category: 'special' as const,
    period: '上午',
    content: '水上',
    durationMin: 60,
    distanceKm: 10,
    intensity: 'U2',
    sets: null,
    reps: null,
    load: null,
    notes: '',
  };
  const teamPlan = () => ({
    ...plan(),
    teamPlanId: 10,
    rootId: 10,
    publishedAt: '2026-09-27T01:00:00Z',
    targetSessions: [
      lesson,
      { ...lesson, id: 'pm', category: 'physical' as const, distanceKm: null },
    ],
  });
  it('上午与下午独立计算，未关联实际记录不会猜测完成，缺记录待确认', () => {
    const result = buildPlanExecution({
      athletes,
      plans: [teamPlan()],
      sessions: [
        session({
          teamPlanId: 10,
          planSessionId: 'am',
          target: lesson,
          durationReported: 1,
          distanceReported: 1,
          distanceKm: 10,
          durationMin: 60,
        }),
      ],
      now,
    });
    expect(result.athletes[0].lessonExecution.map((row) => row.status)).toEqual([
      'complete',
      'pending',
    ]);
    expect(result.athletes[0].pendingSessions).toBe(1);
    const unrelated = buildPlanExecution({
      athletes,
      plans: [teamPlan()],
      sessions: [session()],
      now,
    });
    expect(unrelated.athletes[0].completionRate).toBeNull();
    expect(unrelated.athletes[0].status).toBe('pending');
  });
  it('修订保留原个人目标快照且缺失测量不当作真实0', () => {
    const revised = {
      ...teamPlan(),
      teamPlanId: 11,
      publishedAt: '2026-09-28T01:00:00Z',
      targetSessions: [{ ...lesson, durationMin: 120 }],
    };
    const result = buildPlanExecution({
      athletes,
      plans: [teamPlan(), revised],
      sessions: [
        session({
          teamPlanId: 10,
          planSessionId: 'am',
          target: lesson,
          durationReported: 1,
          distanceReported: 1,
          distanceKm: 10,
          durationMin: 60,
        }),
      ],
      now,
    });
    expect(
      result.athletes[0].lessonExecution.find((row) => row.sessionId === 'am')?.target.durationMin
    ).toBe(60);
    expect(
      result.athletes[0].lessonExecution.find((row) => row.sessionId === 'am')?.completionRate
    ).toBe(1);
  });
});
