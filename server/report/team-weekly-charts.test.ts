import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { teamWeeklyCharts, weeklyTimetable } from '../../shared/team-weekly-charts.ts';
import { teamWeeklySections } from '../../shared/team-weekly-sections.ts';
import { renderTeamWeeklyPdf } from './team-weekly-pdf.ts';

const query = { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'physical' } as const;
describe('周总结图表与七天课表', () => {
  it('保留缺失与真实零，按动作分组，省略空图', () => {
    const db = createTeamWeeklyFixture();
    try {
      const r = readTeamWeeklyReport(db, query, [1]);
      r.daily[0].duration = 10;
      r.daily[1].duration = null;
      r.daily[2].duration = 0;
      r.strength = [
        { athleteId: 1, athleteName: '甲', exercise: '深蹲', sets: 3, reps: 15, volumeKg: 900 },
        { athleteId: 1, athleteName: '甲', exercise: '卧推', sets: 3, reps: 15, volumeKg: 600 },
      ];
      const charts = teamWeeklyCharts(r);
      expect(charts.find((c) => c.id === 'duration')?.points[1].value).toBeNull();
      expect(charts.find((c) => c.id === 'duration')?.points[2].value).toBe(0);
      expect(charts.filter((c) => c.id.startsWith('strength:'))).toHaveLength(2);
      expect(charts.every((c) => c.points.some((p) => p.value !== null))).toBe(true);
      expect(weeklyTimetable(r)).toHaveLength(7);
      expect(weeklyTimetable(r, true)[0].date).toBe('2026-10-12');
      expect(weeklyTimetable(r).flatMap((d) => d.sessions)).toHaveLength(r.plans.length);
    } finally {
      db.close();
    }
  });
  it('多人同动作合图并续组，不遗漏或截断姓名，PDF可生成', () => {
    const db = createTeamWeeklyFixture();
    try {
      const r = readTeamWeeklyReport(db, query, [1]);
      r.strength = Array.from({ length: 35 }, (_, i) => ({
        athleteId: i + 1,
        athleteName: `合成运动员完整姓名第${i + 1}位`,
        exercise: '深蹲',
        sets: 3,
        reps: 15,
        volumeKg: i * 30,
      }));
      const charts = teamWeeklyCharts(r).filter((c) => c.id.startsWith('strength:'));
      expect(charts).toHaveLength(3);
      expect(charts.every((c) => c.domain?.min === 0 && c.domain.max === 1020)).toBe(true);
      expect(charts.flatMap((c) => c.points.map((p) => p.label))).toEqual(
        r.strength.map((s) => s.athleteName)
      );
      expect(renderTeamWeeklyPdf(r).subarray(0, 4).toString()).toBe('%PDF');
    } finally {
      db.close();
    }
  });
  it('全员同指标合图但不同协议分别展示', () => {
    const db = createTeamWeeklyFixture();
    try {
      const r = readTeamWeeklyReport(db, { ...query, reportType: 'special' }, [1]);
      const athlete = r.athletes[0];
      const test = athlete.data.tests[0];
      expect(test).toBeDefined();
      r.athletes = Array.from({ length: 30 }, (_, i) => ({
        ...athlete,
        id: i + 1,
        name: `合成队员${i + 1}`,
        data: { ...athlete.data, tests: [{ ...test, change: null }] },
      }));
      r.athletes[0].data.tests.push({ ...test, key: `${test.key}:other`, protocol: '其他协议' });
      const charts = teamWeeklyCharts(r).filter((c) => c.id.startsWith('test:'));
      expect(charts).toHaveLength(4);
      expect(charts.flatMap((c) => c.points)).toHaveLength(31);
      expect(charts.every((c) => c.kind === 'bar')).toBe(true);
    } finally {
      db.close();
    }
  });
  it('稀疏数据不产生空图或独立空章节', () => {
    const db = createTeamWeeklyFixture();
    try {
      const r = readTeamWeeklyReport(db, { ...query, date: '2026-11-02' }, [1]);
      expect(teamWeeklyCharts(r)).toEqual([]);
      const sections = teamWeeklySections(r);
      expect(sections.some((s) => s.title === '力量训练个人与动作对比')).toBe(false);
      expect(sections.some((s) => s.title === '每日恢复趋势')).toBe(false);
      expect(sections.some((s) => s.title === '数据情况与口径')).toBe(true);
    } finally {
      db.close();
    }
  });
  it('照片按四张一页追加且无附件时不产生照片页', async () => {
    const db = createTeamWeeklyFixture();
    try {
      const r = readTeamWeeklyReport(db, { ...query, date: '2026-11-02' }, [1]);
      const data = await sharp({
        create: { width: 400, height: 200, channels: 3, background: '#176f7f' },
      })
        .jpeg()
        .toBuffer();
      const pages = (pdf: Buffer) =>
        (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
      const base = renderTeamWeeklyPdf(r);
      const attached = renderTeamWeeklyPdf(
        r,
        undefined,
        Array.from({ length: 5 }, () => ({ data, width: 400, height: 200 }))
      );
      expect(pages(attached)).toBe(pages(base) + 2);
    } finally {
      db.close();
    }
  });
});
