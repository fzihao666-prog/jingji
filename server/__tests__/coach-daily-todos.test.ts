import { describe, expect, it } from 'vitest';
import { buildDailyTodos, dailyTodoQuery, beijingDate } from '../core/coach-daily-todos.ts';

const now = new Date('2026-09-23T02:00:00Z');
const athletes = [
  { athleteId: 1, athleteName: '样例甲', project: 'ROWING', team: '一队' },
  { athleteId: 2, athleteName: '样例乙', project: 'ROWING', team: '一队' },
];
const session = (overrides = {}) => ({
  athleteId: 1,
  date: '2026-09-23',
  startTime: '08:00',
  srpe: 600,
  trainingType: '专项训练',
  structureType: '专项训练',
  content: '水上',
  source: 'manual',
  quality: 'valid',
  isDemo: 0,
  ...overrides,
});
const injury = (overrides = {}) => ({
  athleteId: 2,
  status: 'observation',
  injuryName: '肩部不适',
  bodyPart: '肩部',
  painScore: 3,
  createdAt: '2026-09-23 01:00:00',
  ...overrides,
});

describe('教练每日训练待办', () => {
  it('按北京时间跨日，并拒绝非当天、非法日期、数组及额外范围参数', () => {
    expect(beijingDate(new Date('2026-09-22T16:00:00Z'))).toBe('2026-09-23');
    const schema = dailyTodoQuery(now);
    expect(schema.safeParse({ project: 'ROWING' }).success).toBe(true);
    expect(schema.safeParse({ project: 'ROWING', date: '2026-09-23' }).success).toBe(true);
    for (const date of ['2026-02-30', '2026-09-22', '2026-09-24', ' ', ['2026-09-23']]) {
      expect(schema.safeParse({ project: 'ROWING', date }).success).toBe(false);
    }
    expect(schema.safeParse({ project: 'ROWING', athleteId: '999' }).success).toBe(false);
    expect(schema.safeParse({ project: ' ' }).success).toBe(false);
  });

  it('今日正式填报消除待办，高负荷按个人课次累计且600为包含边界', () => {
    const result = buildDailyTodos({
      athletes,
      sessions: [session({ srpe: 300 }), session({ srpe: 300 })],
      injuries: [],
      now,
    });
    expect(result.missing.map((row) => row.athleteId)).toEqual([2]);
    expect(result.attention).toMatchObject([{ athleteId: 1, load24h: 600, highLoad: true }]);
    expect(result.counts).toEqual({
      total: 2,
      submitted: 1,
      missing: 1,
      attention: 1,
      incompleteTime: 0,
    });
  });

  it('滚动24小时包含起点、排除更早及未来课次', () => {
    const sessions = [
      session({ date: '2026-09-22', startTime: '10:00' }),
      session({ date: '2026-09-22', startTime: '09:59', srpe: 900 }),
      session({ startTime: '10:01', srpe: 900 }),
    ];
    expect(buildDailyTodos({ athletes, sessions, injuries: [], now }).attention[0].load24h).toBe(
      600
    );
  });

  it('缺少开训时间的今日记录算已填报，但单列提示、不伪造24小时负荷', () => {
    const result = buildDailyTodos({
      athletes,
      sessions: [session({ startTime: '' })],
      injuries: [],
      now,
    });
    expect(result.missing.map((row) => row.athleteId)).toEqual([2]);
    expect(result.attention).toEqual([]);
    expect(result.incompleteTime.map((row) => row.athleteId)).toEqual([1]);
  });

  it('排除演示、估算、异常和无权限对象，不把低负荷列为高负荷', () => {
    const sessions = [
      session({ isDemo: 1 }),
      session({ source: 'initial_seed' }),
      session({ quality: 'estimated' }),
      session({ quality: 'outlier' }),
      session({ quality: 'insufficient' }),
      session({ athleteId: 999 }),
      session({ srpe: 599 }),
    ];
    const result = buildDailyTodos({
      athletes,
      sessions,
      injuries: [injury({ athleteId: 999 })],
      now,
    });
    expect(result.attention).toEqual([]);
    expect(result.counts.submitted).toBe(1);
  });

  it('最新伤病状态持续关注并标出近24小时变化，健康和未来记录不告警', () => {
    const recent = buildDailyTodos({ athletes, sessions: [], injuries: [injury()], now });
    expect(recent.attention[0].injury).toMatchObject({ recent: true, status: 'observation' });
    const old = buildDailyTodos({
      athletes,
      sessions: [],
      injuries: [injury({ createdAt: '2026-09-20 00:00:00' })],
      now,
    });
    expect(old.attention[0].injury?.recent).toBe(false);
    expect(
      buildDailyTodos({ athletes, sessions: [], injuries: [injury({ status: 'healthy' })], now })
        .attention
    ).toEqual([]);
    expect(
      buildDailyTodos({
        athletes,
        sessions: [],
        injuries: [injury({ createdAt: '2026-09-24 00:00:00' })],
        now,
      }).attention
    ).toEqual([]);
  });

  it('同一运动员同时高负荷和伤病时合并原因，空范围不返回其他人', () => {
    const result = buildDailyTodos({
      athletes,
      sessions: [session()],
      injuries: [injury({ athleteId: 1 })],
      now,
    });
    expect(result.attention).toHaveLength(1);
    expect(result.attention[0]).toMatchObject({
      highLoad: true,
      injury: { status: 'observation' },
    });
    expect(
      buildDailyTodos({ athletes: [], sessions: [session()], injuries: [injury()], now }).counts
        .total
    ).toBe(0);
  });
});
