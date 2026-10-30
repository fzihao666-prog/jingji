import { describe, expect, it } from 'vitest';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { teamWeeklyQuerySchema, teamWeeklyReportSchema } from '../../shared/team-weekly-report.ts';
import { teamWeeklyCharts } from '../../shared/team-weekly-charts.ts';
import { teamWeeklySections } from '../../shared/team-weekly-sections.ts';
const query = { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'combined' } as const;
describe('综合周总结事实快照', () => {
  it('缺省综合、严格新旧版本判别', () => {
    expect(
      teamWeeklyQuerySchema.parse({ ...query, teamId: '1', reportType: undefined }).reportType
    ).toBe('combined');
    const db = createTeamWeeklyFixture();
    try {
      const report = readTeamWeeklyReport(db, query, [1, 3]);
      expect(teamWeeklyReportSchema.safeParse(report).success).toBe(true);
      expect(
        teamWeeklyReportSchema.safeParse({ ...report, templateVersion: 'weekly-v2' }).success
      ).toBe(false);
      expect(teamWeeklyReportSchema.safeParse({ ...report, reportType: 'physical' }).success).toBe(
        false
      );
      expect(
        teamWeeklyReportSchema.safeParse(
          readTeamWeeklyReport(db, { ...query, reportType: 'special' }, [1, 3])
        ).success
      ).toBe(true);
    } finally {
      db.close();
    }
  });
  it('整体不重复，未知保留；固定四动作全员缺失不填零，变式仅附录', () => {
    const db = createTeamWeeklyFixture();
    try {
      db.exec(`UPDATE training_sessions SET training_type='',structure_type='',content='',activity_code='unknown',training_category=NULL WHERE id=1;
        INSERT INTO strength_result_sets VALUES(2,'卧推',10,20,1,'manual'),(2,'卧推变式',8,20,1,'manual');`);
      const r = readTeamWeeklyReport(db, query, [1, 3]);
      if (r.templateVersion !== 'weekly-v3') throw new Error('应为新版');
      expect(r.totals.participations).toBe(4);
      expect(r.breakdown.special.totals.participations).toBe(1);
      expect(r.breakdown.physical.totals.participations).toBe(1);
      expect(r.breakdown.unclassified.totals.participations).toBe(2);
      const charts = teamWeeklyCharts(r);
      expect(
        charts.find((c) => c.id.startsWith('strength:卧推:'))?.points.map((p) => p.value)
      ).toEqual([200, null]);
      expect(charts.find((c) => c.id.startsWith('strength:卧推变式:'))?.section).toBe(
        '附录 · 其他力量动作'
      );
      expect(charts.every((c) => c.points.some((p) => p.value !== null))).toBe(true);
      expect(teamWeeklySections(r).find((s) => s.title === '2.1 周训练安排')?.rows).toHaveLength(7);
      const sections = teamWeeklySections(r);
      expect(sections.filter((s) => /^0[1-5]｜/.test(s.title))).toHaveLength(5);
      expect(
        sections
          .find((s) => s.title === '3.2 关键力量训练统计')
          ?.rows?.find((row) => row[0] === '硬拉')?.[1]
      ).toBe('未记录');
      expect(
        sections
          .find((s) => s.title === '1.1 本周核心指标')
          ?.rows?.find((row) => row[0] === '恢复训练时长')?.[1]
      ).toBe('未记录');
      expect(sections.find((s) => s.title === '1.2 本周训练目标及完成评价')?.commentaryKey).toBe(
        'summary'
      );
      expect(charts.find((c) => c.id === 'composition')?.points[2]?.label).toBe('恢复及未分类');
    } finally {
      db.close();
    }
  });
  it('同日同序号不同正式课不误并；计划处方保留而不计入完成，部分权限不读整队计划', () => {
    const db = createTeamWeeklyFixture();
    try {
      db.exec(`INSERT INTO training_plan_execution_links VALUES(1,10,'a','{}'),(20,10,'b','{}');`);
      const data = {
        goal: '目标',
        focus: '体能',
        overrides: [],
        sessions: [
          {
            id: 'a',
            date: '2026-10-05',
            category: 'physical',
            period: '上午',
            content: '卧推',
            durationMin: 60,
            distanceKm: null,
            intensity: 'AN',
            sets: 3,
            reps: 8,
            load: 20,
            notes: '间歇2分钟',
            items: [{ id: 'x', title: '卧推', description: '3组×8次，20kg，间歇2分钟' }],
          },
        ],
      };
      db.prepare(
        `INSERT INTO training_plans VALUES(10,10,1,1,'published',1,'team','本周','2026-10-05','2026-10-11',?,NULL,NULL)`
      ).run(JSON.stringify(data));
      const r = readTeamWeeklyReport(db, query, [1, 3]);
      expect(r.totals.sessions).toBe(4);
      expect(r.plans[0]).toMatchObject({
        category: 'physical',
        sets: 3,
        reps: 8,
        load: 20,
        status: 'pending',
        notes: '间歇2分钟',
      });
      expect(r.plans[0].items[0].description).toContain('间歇2分钟');
      expect(r.totals.participations).toBe(4);
      const scoped = readTeamWeeklyReport(db, query, [1]);
      expect(scoped.plansAvailable).toBe(false);
      expect(scoped.plans).toEqual([]);
    } finally {
      db.close();
    }
  });
  it('同动作共享坐标域并完整分组，缺失不强补；上周不可比不出系列', () => {
    const db = createTeamWeeklyFixture();
    try {
      for (let id = 10; id < 24; id++)
        db.prepare(
          `INSERT INTO athletes(id,project,active,name,team_id) VALUES(?,'ROWING',1,?,1)`
        ).run(id, `队员${id}`);
      db.exec(`INSERT INTO strength_result_sets VALUES(2,'卧推',10,20,1,'manual');`);
      const r = readTeamWeeklyReport(db, query, [
        1,
        3,
        ...Array.from({ length: 14 }, (_, i) => i + 10),
      ]);
      const charts = teamWeeklyCharts(r).filter((c) => c.id.startsWith('strength:卧推:'));
      expect(charts).toHaveLength(2);
      expect(charts.flatMap((c) => c.points)).toHaveLength(16);
      expect(charts[0].domain).toEqual(charts[1].domain);
      expect(charts.every((c) => c.series?.length === 1)).toBe(true);
    } finally {
      db.close();
    }
  });
  it('混合目的不重复归入专项或体能，也不强分时长', () => {
    const db = createTeamWeeklyFixture();
    try {
      db.exec(
        "UPDATE training_sessions SET training_type='专项训练与体能训练',structure_type='',training_category=NULL WHERE id=1"
      );
      const r = readTeamWeeklyReport(db, query, [1, 3]);
      expect(r.totals.duration).toBe(120);
      expect(r.breakdown.special.totals.duration).toBe(60);
      expect(r.breakdown.physical.totals.participations).toBe(1);
      expect(r.breakdown.unclassified.totals.duration).toBe(60);
    } finally {
      db.close();
    }
  });
  it('同动作同人员有效上周自动并列；按时长记录不强折公斤容量', () => {
    const db = createTeamWeeklyFixture();
    try {
      db.exec(`ALTER TABLE strength_result_sets ADD COLUMN duration_min REAL;
        INSERT INTO strength_result_sets(training_session_id,exercise_name,actual_reps,actual_weight_kg,completed,source,duration_min)
        VALUES(2,'卧推',10,20,1,'manual',0),(8,'卧推',8,20,1,'manual',0),(2,'平板支撑',0,0,1,'manual',3);`);
      const r = readTeamWeeklyReport(db, query, [1]);
      const charts = teamWeeklyCharts(r);
      expect(
        charts.find((c) => c.id.startsWith('strength:卧推:'))?.series?.map((s) => s.values)
      ).toEqual([[200], [160]]);
      expect(charts.some((c) => c.id.startsWith('strength:平板支撑:'))).toBe(false);
      expect(r.strengthDetails.find((s) => s.exercise === '平板支撑')?.durationMin).toBe(3);
    } finally {
      db.close();
    }
  });
});
