import { describe, expect, it } from 'vitest';
import { buildLoadManagement, ACWR_ZONES } from '../core/load-management.ts';

const now = new Date('2026-09-28T02:00:00Z');
const athletes = [
  { athleteId: 1, athleteName: '样例甲', team: '一队' },
  { athleteId: 2, athleteName: '样例乙', team: '一队' },
];

function session(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    athleteId: 1,
    date: '2026-09-28',
    startTime: '08:00',
    srpe: 400,
    source: 'manual',
    quality: 'valid',
    isDemo: 0,
    ...overrides,
  };
}

describe('ACWR 负荷管理', () => {
  it('计算 ACWR 并标记风险区间', () => {
    // 急性负荷：近7天 = 400*5 = 2000
    // 慢性负荷：近28天日均 = 2000/28 ≈ 71.4，周负荷 = 71.4*7 ≈ 500
    // ACWR = 2000/500 = 4.0 (danger)
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({ date: `2026-09-${24 + i}` })
    );
    const result = buildLoadManagement({ athletes: [athletes[0]], sessions, now });
    expect(result.summary.total).toBe(1);
    expect(result.athletes[0].zone).toBe('danger');
    expect(result.athletes[0].acwr).toBeGreaterThan(ACWR_ZONES.optimal);
  });

  it('单次训练也能计算 ACWR', () => {
    const result = buildLoadManagement({
      athletes: [athletes[0]],
      sessions: [session({ srpe: 700 })],
      now,
    });
    // 急性=700，慢性=700/28*7=175，ACWR=700/175=4.0
    expect(result.athletes[0].acuteLoad).toBe(700);
    expect(result.athletes[0].acwr).toBeGreaterThan(0);
    expect(result.athletes[0].zone).toBe('danger');
  });

  it('无训练时 ACWR 为 0', () => {
    const result = buildLoadManagement({ athletes: [athletes[0]], sessions: [], now });
    expect(result.athletes[0].acwr).toBe(0);
    expect(result.athletes[0].zone).toBe('under');
  });

  it('排除演示与低质量记录', () => {
    const sessions = [
      session({ isDemo: 1, srpe: 10000 }),
      session({ quality: 'estimated', srpe: 10000 }),
      session({ source: 'demo_seed', srpe: 10000 }),
    ];
    const result = buildLoadManagement({ athletes: [athletes[0]], sessions, now });
    expect(result.athletes[0].acuteLoad).toBe(0);
    expect(result.athletes[0].acwr).toBe(0);
  });

  it('团队汇总包含各区间人数', () => {
    const sessions = [
      session({ athleteId: 1, srpe: 100 }),
      session({ athleteId: 2, srpe: 2000 }),
    ];
    const result = buildLoadManagement({ athletes, sessions, now });
    expect(result.summary.total).toBe(2);
    expect(result.summary.under + result.summary.optimal + result.summary.danger).toBe(2);
  });
});
