import { describe, expect, it } from 'vitest';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { teamWeeklyCharts, weeklyTimetable } from '../../shared/team-weekly-charts.ts';

describe('周总结图表与七天课表', () => {
  it('保留缺失和真实零，并按动作、测试条件分组，不跨指标连接', () => {
    const db = createTeamWeeklyFixture();
    try {
      const r = readTeamWeeklyReport(db, { project: 'ROWING', teamId: 1, date: '2026-10-05' }, [1]);
      r.strength = [
        { athleteId: 1, athleteName: '甲', exercise: '深蹲', sets: 3, reps: 15, volumeKg: 900 },
        { athleteId: 1, athleteName: '甲', exercise: '卧推', sets: 3, reps: 15, volumeKg: 600 },
      ];
      const charts = teamWeeklyCharts(r);
      expect(charts.find((c) => c.id === 'duration')?.points[1].value).toBeNull();
      expect(charts.find((c) => c.id === 'duration')?.points[2].value).toBe(0);
      expect(charts.filter((c) => c.id.startsWith('strength:'))).toHaveLength(2);
      expect(charts.filter((c) => c.id.startsWith('test:'))).toHaveLength(
        r.athletes.flatMap((a) => a.data.tests).length
      );
      const incomparable = charts.filter(
        (c) => c.id.startsWith('test:') && c.note.includes('不足')
      );
      expect(incomparable.length).toBeGreaterThan(0);
      expect(incomparable.every((c) => c.kind === 'bar')).toBe(true);
      for (const key of ['sleep', 'pulse', 'fatigue'])
        expect(charts.find((c) => c.id === key)?.points).toHaveLength(7);
      expect(weeklyTimetable(r)).toHaveLength(7);
      expect(weeklyTimetable(r, true)[0].date).toBe('2026-10-12');
      expect(weeklyTimetable(r).flatMap((d) => d.sessions)).toHaveLength(r.plans.length);
    } finally {
      db.close();
    }
  });
});
