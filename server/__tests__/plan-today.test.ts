import { describe, expect, it } from 'vitest';
import { extractTodayPlanDay, summarizeTodayPlans } from '../core/plan-today.ts';

// 2026-09-28 是周一（北京时间）。
const today = '2026-09-28';

function planData(weeklyPlans: unknown[]) {
  return JSON.stringify({ weeklyPlans });
}

describe('今日计划提取', () => {
  it('按精确日期提取训练重点、专项与体能内容及计划量', () => {
    const day = extractTodayPlanDay(
      planData([
        {
          weekNumber: 1,
          focus: '有氧基础',
          days: [
            {
              date: '2026-09-28',
              focus: '水上技术',
              items: [
                { name: '水上技术划', distance: '12', duration: '90', notes: '低桨频' },
                { name: '深蹲', sets: '4', reps: '8', percentage: 75 },
              ],
            },
            { date: '2026-09-29', items: [{ name: '跑步' }] },
          ],
        },
      ]),
      today,
      { startDate: '2026-09-28', endDate: '2026-10-25', title: '基础期' }
    );
    expect(day).not.toBeNull();
    expect(day?.title).toBe('基础期');
    expect(day?.focus).toBe('水上技术');
    expect(day?.specialItems).toEqual(['水上技术划']);
    expect(day?.physicalItems).toEqual(['深蹲']);
    expect(day?.plannedDurationMin).toBe(90);
    expect(day?.plannedDistanceKm).toBe(12);
    expect(day?.items[0].detail).toContain('时长 90');
    expect(day?.items[1].detail).toContain('4×8');
    expect(day?.items[1].detail).toContain('75%');
  });

  it('AI 周次计划按当周星期匹配，多周时不用其他周冒充今天', () => {
    const weeks = [
      {
        weekNumber: 1,
        days: [{ dayOfWeek: '周二', exercises: [{ name: '卧拉' }] }],
      },
      {
        weekNumber: 2,
        days: [{ dayOfWeek: '周一', exercises: [{ name: '深蹲' }] }],
      },
    ];
    // 今天周一落在第 1 周（09-28 起），第 1 周只有周二 → 今日无计划。
    expect(extractTodayPlanDay(planData(weeks), today, { startDate: '2026-09-28', endDate: '2026-10-11' })).toBeNull();
    // 第 2 周的周一（10-05）取第 2 周课表。
    const secondWeek = extractTodayPlanDay(planData(weeks), '2026-10-05', { startDate: '2026-09-28', endDate: '2026-10-11' });
    expect(secondWeek?.physicalItems).toEqual(['深蹲']);
  });

  it('单周计划按星期匹配；计划未覆盖今天或无内容不提取', () => {
    const week = [{ days: [{ dayOfWeek: '周一', focus: '力量', exercises: [{ name: '硬拉' }] }] }];
    expect(extractTodayPlanDay(planData(week), today, { startDate: '2026-09-22', endDate: '2026-09-28' })?.physicalItems).toEqual(['硬拉']);
    expect(extractTodayPlanDay(planData(week), '2026-10-28', { startDate: '2026-09-22', endDate: '2026-09-28' })).toBeNull();
    expect(extractTodayPlanDay(planData([{ days: [{ dayOfWeek: '周一' }] }]), today)).toBeNull();
    expect(extractTodayPlanDay('not-json', today)).toBeNull();
    expect(extractTodayPlanDay('{}', today)).toBeNull();
  });

  it('无计划量字段时保持 null，有 0 值时保留 0', () => {
    const day = extractTodayPlanDay(
      planData([{ days: [{ date: today, items: [{ name: '拉伸', duration: '0', distance: '0' }, { name: '划船机' }] }] }]),
      today
    );
    expect(day?.plannedDurationMin).toBe(0);
    expect(day?.plannedDistanceKm).toBe(0);
    const noVolume = extractTodayPlanDay(
      planData([{ days: [{ date: today, items: [{ name: '划船机' }] }] }]),
      today
    );
    expect(noVolume?.plannedDurationMin).toBeNull();
    expect(noVolume?.plannedDistanceKm).toBeNull();
  });
});

describe('队伍今日计划汇总', () => {
  it('重点与条目去重，计划量只在有数据时汇总', () => {
    const summary = summarizeTodayPlans([
      extractTodayPlanDay(planData([{ days: [{ date: today, focus: '有氧', items: [{ name: '跑步', duration: '60' }] }] }]), today),
      extractTodayPlanDay(planData([{ days: [{ date: today, focus: '有氧', items: [{ name: '跑步' }, { name: '深蹲', distance: '3' }] }] }]), today),
      null,
    ]);
    expect(summary).toEqual({
      hasPlan: true,
      focus: ['有氧'],
      specialItems: [],
      physicalItems: ['跑步', '深蹲'],
      items: [
        { name: '跑步', detail: '时长 60' },
        { name: '跑步', detail: '' },
        { name: '深蹲', detail: '距离 3' },
      ],
      plannedDurationMin: 60,
      plannedDistanceKm: 3,
    });
  });

  it('全员无计划时 hasPlan 为 false，量为 null', () => {
    expect(summarizeTodayPlans([null, null])).toEqual({
      hasPlan: false,
      focus: [],
      specialItems: [],
      physicalItems: [],
      items: [],
      plannedDurationMin: null,
      plannedDistanceKm: null,
    });
  });
});
