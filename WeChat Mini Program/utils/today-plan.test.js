import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const formatDataContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../data/format-data.js', import.meta.url), 'utf8'), formatDataContext);
const formatContext = { module: { exports: {} }, require: () => formatDataContext.module.exports };
vm.runInNewContext(readFileSync(new URL('./format.js', import.meta.url), 'utf8'), formatContext);
const paginationContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./pagination.js', import.meta.url), 'utf8'), paginationContext);
const context = {
  module: { exports: {} },
  require: (path) => (path === './pagination' ? paginationContext.module.exports : formatContext.module.exports),
};
vm.runInNewContext(readFileSync(new URL('./today-plan.js', import.meta.url), 'utf8'), context);
const { todayPlanView, todayExecutionView, todayTrainingCardView } = context.module.exports;

describe('今日训练计划卡片', () => {
  it('有计划展示重点、内容、计划量与安排详情，0 保留', () => {
    const view = todayPlanView({
      hasPlan: true,
      focus: ['有氧', '技术'],
      specialItems: ['水上技术划'],
      physicalItems: ['深蹲'],
      plannedDurationMin: 0,
      plannedDistanceKm: 12.5,
      items: [{ name: '深蹲', detail: '4×8 · 75%' }],
    });
    expect(view.hasPlan).toBe(true);
    expect(view.focusText).toBe('有氧、技术');
    expect(view.specialText).toBe('水上技术划');
    expect(view.physicalText).toBe('深蹲');
    expect(view.durationText).toBe('0 分钟');
    expect(view.distanceText).toBe('12.5 km');
    expect(view.items).toEqual([{ key: '深蹲|4×8 · 75%', name: '深蹲', detail: '4×8 · 75%' }]);
  });

  it('无计划或缺字段时显示 --，不伪造数值', () => {
    const empty = todayPlanView(null);
    expect(empty.hasPlan).toBe(false);
    expect(empty.focusText).toBe('--');
    expect(empty.durationText).toBe('--');
    expect(empty.distanceText).toBe('--');
    const athletePlan = todayPlanView({ focus: '技术', specialItems: [], physicalItems: ['跑步'], plannedDurationMin: null, plannedDistanceKm: null, items: [] });
    expect(athletePlan.hasPlan).toBe(true);
    expect(athletePlan.focusText).toBe('技术');
    expect(athletePlan.specialText).toBe('--');
    expect(athletePlan.durationText).toBe('--');
  });
});

describe('今日执行情况', () => {
  const row = (overrides) => ({
    athleteId: 1,
    athleteName: '运动员A',
    team: '一队',
    hasPlanToday: false,
    todayFocus: null,
    todayStatus: 'no-plan',
    todayDurationMin: null,
    todayDistanceKm: null,
    todayRpeReported: false,
    ...overrides,
  });

  it('训练前有计划无记录只记待确认，不显示未完成', () => {
    const view = todayExecutionView([row({ hasPlanToday: true, todayStatus: 'pending' })], { avgCompletion: null });
    const tiles = Object.fromEntries(view.tiles.map((tile) => [tile.key, tile]));
    expect(tiles.planned.value).toBe('1');
    expect(tiles.recorded.value).toBe('0');
    expect(tiles.confirmed.value).toBe('0');
    expect(tiles.pending.value).toBe('1');
    expect(tiles.rate.value).toBe('--');
    expect(view.rows.items).toHaveLength(1);
    expect(view.rows.items[0]).toMatchObject({ statusLabel: '待确认', focusText: '--' });
  });

  it('实际量与 RPE 按已报量汇总，未报量不计 0；执行率只用服务端结果', () => {
    const view = todayExecutionView(
      [
        row({ athleteId: 1, hasPlanToday: true, todayStatus: 'recorded', todayDurationMin: 90, todayDistanceKm: 0, todayRpeReported: true }),
        row({ athleteId: 2, todayStatus: 'recorded', todayDurationMin: 60, todayDistanceKm: 12.5 }),
        row({ athleteId: 3, todayStatus: 'recorded' }),
      ],
      { avgCompletion: 0.75 }
    );
    const tiles = Object.fromEntries(view.tiles.map((tile) => [tile.key, tile]));
    expect(tiles.recorded.value).toBe('3');
    expect(tiles.confirmed.value).toBe('1');
    expect(tiles.duration.value).toBe('150');
    expect(tiles.distance.value).toBe('12.5');
    expect(tiles.rpe.value).toBe('1');
    expect(tiles.rate.value).toBe('75%');
    expect(view.listEmpty).toBe(true);
  });

  it('待确认名单每页最多 5 人并支持翻页', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      row({ athleteId: index + 1, hasPlanToday: true, todayStatus: 'pending' })
    );
    const first = todayExecutionView(rows, { page: 0 });
    expect(first.rows.items).toHaveLength(5);
    expect(first.rows).toMatchObject({ page: 0, pageCount: 2, total: 6, hasNext: true });
    expect(todayExecutionView(rows, { page: 1 }).rows.items).toHaveLength(1);
  });
});

describe('运动员今日训练卡片', () => {
  it('汇总本人安排与实际记录，缺失指标显示 --', () => {
    const view = todayTrainingCardView(
      { title: '基础期', focus: '技术', specialItems: ['水上技术划'], physicalItems: [], plannedDurationMin: 80, plannedDistanceKm: null, items: [{ name: '水上技术划', detail: '时长 80' }] },
      [
        { id: 1, content: '水上技术划', trainingType: '专项训练', startTime: '08:00', durationMin: 90, distanceKm: null, rpe: 6 },
        { id: 2, content: '拉伸', trainingType: '恢复训练', startTime: '', durationMin: null, distanceKm: null, rpe: null },
      ]
    );
    expect(view.plan.hasPlan).toBe(true);
    expect(view.plan.durationText).toBe('80 分钟');
    expect(view.hasSessions).toBe(true);
    expect(view.sessions[0]).toMatchObject({ durationText: '90 分钟', distanceText: '--', rpeText: '6' });
    expect(view.sessions[1]).toMatchObject({ durationText: '--', rpeText: '--', startTime: '' });
  });
});
