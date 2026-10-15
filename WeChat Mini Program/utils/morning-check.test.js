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
vm.runInNewContext(readFileSync(new URL('./morning-check.js', import.meta.url), 'utf8'), context);
const { morningCheckView, trainingSituationView } = context.module.exports;

const athlete = (overrides) => ({
  athleteId: 1,
  athleteName: '运动员A',
  team: '一队',
  hasTraining: false,
  wellnessReported: false,
  sleepHours: null,
  morningPulse: null,
  fatigueIndex: null,
  ...overrides,
});

describe('晨检概览人数与名单同口径', () => {
  it('未填报来自晨检标记而非训练记录，训练有无不影响晨检计数', () => {
    const rows = [
      athlete({ athleteId: 1, wellnessReported: true, sleepHours: 7.5, morningPulse: 54, fatigueIndex: 3, hasTraining: true }),
      athlete({ athleteId: 2, wellnessReported: true, sleepHours: null, morningPulse: 0, fatigueIndex: 0, hasTraining: false }),
      athlete({ athleteId: 3, hasTraining: true }),
    ];
    const view = morningCheckView(rows, 'all', 0);
    expect(view.counts).toEqual({ total: 3, reported: 2, missing: 1 });
    expect(view.cards.map((card) => [card.label, card.value])).toEqual([
      ['应填报', 3], ['已填报', 2], ['未填报', 1],
    ]);
    expect(view.rows.items.map((row) => row.athleteId)).toEqual([1, 2, 3]);
  });

  it('已填报展示实际指标，0 保留，缺失显示 --，未填报整行不冒充历史数值', () => {
    const rows = [
      athlete({ athleteId: 1, wellnessReported: true, sleepHours: 7.5, morningPulse: 54, fatigueIndex: 3 }),
      athlete({ athleteId: 2, wellnessReported: true, sleepHours: 0, morningPulse: 0, fatigueIndex: 0 }),
      athlete({ athleteId: 3, wellnessReported: true, sleepHours: null, morningPulse: 61, fatigueIndex: null }),
      athlete({ athleteId: 4 }),
    ];
    const items = morningCheckView(rows, 'all', 0).rows.items;
    expect(items[0]).toMatchObject({ reported: true, sleepText: '7.5h', pulseText: '54', fatigueText: '3' });
    expect(items[1]).toMatchObject({ reported: true, sleepText: '0h', pulseText: '0', fatigueText: '0' });
    expect(items[2]).toMatchObject({ reported: true, sleepText: '--', pulseText: '61', fatigueText: '--' });
    expect(items[3]).toMatchObject({ reported: false, sleepText: '--', pulseText: '--', fatigueText: '--' });
  });

  it('仅看未填报筛选后名单与顶部人数同口径，非法筛选回落全部', () => {
    const rows = [
      athlete({ athleteId: 1, wellnessReported: true }),
      athlete({ athleteId: 2 }),
      athlete({ athleteId: 3 }),
    ];
    const view = morningCheckView(rows, 'missing', 0);
    expect(view.filter).toBe('missing');
    expect(view.rows.items.map((row) => row.athleteId)).toEqual([2, 3]);
    expect(view.counts.missing).toBe(2);
    expect(morningCheckView(rows, 'bad', 0).filter).toBe('all');
    expect(morningCheckView(rows, 'missing', 0).filters).toEqual([
      { key: 'all', label: '全部', count: 3, active: false },
      { key: 'missing', label: '未填报', count: 2, active: true },
    ]);
  });

  it('人员列表每页最多 5 人并支持翻页，空数据保留完整模块', () => {
    const rows = Array.from({ length: 6 }, (_, index) => athlete({ athleteId: index + 1 }));
    const first = morningCheckView(rows, 'all', 0);
    expect(first.rows.items).toHaveLength(5);
    expect(first.rows).toMatchObject({ page: 0, pageCount: 2, total: 6, hasPrev: false, hasNext: true });
    expect(morningCheckView(rows, 'all', 1).rows.items).toHaveLength(1);
    const empty = morningCheckView([], 'all', 0);
    expect(empty.counts).toEqual({ total: 0, reported: 0, missing: 0 });
    expect(empty.rows).toMatchObject({ total: 0, hasNext: false });
    expect(empty.isEmpty).toBe(true);
    expect(empty.listEmpty).toBe(true);
  });
});

describe('今日训练情况按训练记录单独统计', () => {
  it('已记录与暂无训练记录人数互补，不表述为未完成训练', () => {
    const rows = [
      athlete({ athleteId: 1, hasTraining: true }),
      athlete({ athleteId: 2, hasTraining: true }),
      athlete({ athleteId: 3, hasTraining: false }),
    ];
    expect(trainingSituationView(rows)).toEqual({ total: 3, trained: 2, noTraining: 1 });
    expect(trainingSituationView([])).toEqual({ total: 0, trained: 0, noTraining: 0 });
  });
});
