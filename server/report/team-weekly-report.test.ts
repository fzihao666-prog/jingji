import { describe, expect, it } from 'vitest';
import { createTeamWeeklyFixture as fixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { teamWeeklyReportSchema, teamWeeklyQuerySchema } from '../../shared/team-weekly-report.ts';

const query = { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'special' } as const;
describe('队伍周总结', () => {
  it('自然周校验拒绝非法日期、项目和额外字段', () => {
    expect(teamWeeklyQuerySchema.safeParse({ ...query, teamId: '1' }).success).toBe(true);
    for (const change of [
      { date: '2026-02-30' },
      { project: 'OTHER' },
      { teamId: '-1' },
      { extra: 'x' },
    ])
      expect(teamWeeklyQuerySchema.safeParse({ ...query, teamId: '1', ...change }).success).toBe(
        false
      );
  });
  it('按权限和项目过滤，队伍课次去重而个人累计量保留；缺失与真实零分开', () => {
    const db = fixture();
    try {
      const report = readTeamWeeklyReport(db, query, [1, 2, 3]);
      expect(report.range).toEqual({ from: '2026-10-05', to: '2026-10-11', kind: 'week' });
      expect(report.athletes).toHaveLength(2);
      expect(report.totals.sessions).toBe(1);
      expect(report.totals.participations).toBe(2);
      expect(report.totals.duration).toBe(120);
      expect(report.totals.srpe).toBe(600);
      expect(report.daily[1].duration).toBeNull();
      expect(report.daily[2].duration).toBeNull();
      expect(report.athletes[0].data.tests[0].change).toBe(20);
      const scoped = readTeamWeeklyReport(db, query, [3]);
      expect(scoped.athletes.map((a) => a.id)).toEqual([3]);
      expect(scoped.totals.duration).toBe(60);
      expect(() => readTeamWeeklyReport(db, query, [2])).toThrow('无权');
      expect(() => readTeamWeeklyReport(db, { ...query, project: 'CANOE_SPRINT' }, [1, 2])).toThrow(
        '无权'
      );
    } finally {
      db.close();
    }
  });
  it('无记录仍生成完整七天及空状态，不写入正式数据', () => {
    const db = fixture();
    try {
      const report = readTeamWeeklyReport(db, { ...query, date: '2026-11-02' }, [1]);
      expect(report.daily).toHaveLength(7);
      expect(report.totals.duration).toBeNull();
      expect(report.totals.sessions).toBe(0);
      expect(report.summary.join('')).toContain('暂无');
      expect(db.prepare('SELECT count(*) AS n FROM training_reports').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});
