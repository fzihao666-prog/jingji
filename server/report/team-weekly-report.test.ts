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

import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerTeamWeeklyRoutes } from './team-weekly-routes.ts';
import type { AuthUser } from '../core/shared-server.ts';
import { renderTeamWeeklyPdf } from './team-weekly-pdf.ts';
import { teamWeeklySections } from '../../shared/team-weekly-sections.js';

describe('周总结下载与权限', () => {
  it('拒绝匿名、运动员、越权队伍及非法查询，允许授权预览和PDF下载', async () => {
    const db = fixture();
    const app = express();
    const user: AuthUser = {
      id: 1,
      username: 'test',
      displayName: '合成',
      role: 'SCC',
      athleteId: null,
      sessionVersion: 1,
    };
    registerTeamWeeklyRoutes(app, {
      currentUser: () => user,
      generate: async () => ({}),
      db,
      accessibleIds: () => [1],
      requireAuth: (req, res, next) => {
        if (req.headers['x-deny']) {
          res.status(401).end();
          return;
        }
        req.authUser = { ...user, role: req.headers['x-athlete'] ? 'ATL' : 'SCC' };
        next();
      },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reports/weekly`;
    const qs = 'project=ROWING&teamId=1&date=2026-10-05&reportType=special';
    try {
      expect((await fetch(`${root}/preview?${qs}`, { headers: { 'x-deny': '1' } })).status).toBe(
        401
      );
      expect((await fetch(`${root}/pdf?${qs}`, { headers: { 'x-athlete': '1' } })).status).toBe(
        403
      );
      expect((await fetch(`${root}/pdf?${qs.replace('teamId=1', 'teamId=2')}`)).status).toBe(403);
      expect((await fetch(`${root}/preview?${qs}&extra=x`)).status).toBe(400);
      const preview = await fetch(`${root}/preview?${qs}`);
      expect(preview.status).toBe(200);
      expect(preview.headers.get('cache-control')).toBe('no-store');
      expect(teamWeeklyReportSchema.parse(await preview.json()).athletes).toHaveLength(1);
      const pdf = await fetch(`${root}/pdf?${qs}`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toContain('application/pdf');
      expect(pdf.headers.get('content-disposition')).toContain('attachment');
      expect(
        Buffer.from(await pdf.arrayBuffer())
          .subarray(0, 5)
          .toString()
      ).toBe('%PDF-');
      db.exec('DROP TABLE injury_records');
      const unavailable = await fetch(`${root}/preview?${qs}`);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ message: '周总结生成失败，请稍后重试。' });
      db.exec(
        'CREATE TABLE injury_records(athlete_id INTEGER,onset_date TEXT,injury_name TEXT,status TEXT,pain_score REAL)'
      );
      expect((await fetch(`${root}/preview?${qs}`)).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      db.close();
    }
  });
  it('计划实施和个人关联区分，测试/恢复附录与数据口径均进入报告', () => {
    const db = fixture();
    try {
      const data = JSON.stringify({
        sessions: [
          {
            id: 's1',
            category: 'special',
            date: '2026-10-05',
            content: '水上训练',
            durationMin: 60,
            distanceKm: 10,
            items: [{ id: 'i1' }, { id: 'i2' }],
          },
          {
            id: 's2',
            category: 'special',
            date: '2026-10-12',
            content: '下周训练',
            durationMin: 45,
            distanceKm: null,
          },
        ],
        overrides: [],
        goal: '',
        focus: '',
      });
      db.prepare(
        "INSERT INTO training_plans VALUES(1,1,1,0,'published',1,'team','本周计划','2026-10-05','2026-10-12',?,NULL,NULL)"
      ).run(data);
      db.exec(
        "INSERT INTO team_plan_item_checks VALUES(1,'s1','i1','executed'); INSERT INTO training_plan_execution_links VALUES(1,1,'s1','{}')"
      );
      const report = readTeamWeeklyReport(db, query, [1, 3]);
      const partial = readTeamWeeklyReport(db, query, [1]);
      expect(partial.plans).toEqual([]);
      expect(partial.nextPlans).toEqual([]);
      expect(partial.plansAvailable).toBe(false);
      expect(report.plans[0]).toMatchObject({ status: 'partial', linkedRecords: 1 });
      expect(report.nextPlans[0].content).toBe('下周训练');
      const sections = teamWeeklySections(report);
      expect(JSON.stringify(sections)).toContain('测试功率');
      expect(report.recovery?.[0].samples).toBe(1);
      const pdf = renderTeamWeeklyPdf(report);
      expect(pdf.length).toBeGreaterThan(1000);
    } finally {
      db.close();
    }
  });
});

describe('真实力量结果及恢复统计', () => {
  it('排除越权、模拟、未完成组；恢复缺失不补零', () => {
    const db = fixture();
    try {
      db.exec(`INSERT INTO strength_result_sets VALUES(1,'卧推',10,20,1,'manual'),(1,'卧推',5,30,1,'manual'),(1,'卧推',20,100,0,'manual'),(1,'卧推',20,100,1,'synthetic'),(20,'卧推',8,10,1,'manual'),(4,'卧推',20,100,1,'manual');
    UPDATE daily_wellness SET fatigue_index=0 WHERE wellness_date='2026-10-05';`);
      db.exec("UPDATE training_sessions SET training_category='physical' WHERE id=1");
      const report = readTeamWeeklyReport(db, { ...query, reportType: 'physical' }, [1]);
      expect(report.strength).toEqual([
        {
          athleteId: 1,
          athleteName: '示例队员',
          exercise: '卧推',
          sets: 2,
          reps: 15,
          volumeKg: 350,
        },
      ]);
      expect(report.recovery?.[0]).toMatchObject({ sleep: 8, pulse: 50, fatigue: 0, samples: 1 });
      expect(report.recovery?.[1]).toMatchObject({
        sleep: null,
        pulse: null,
        fatigue: null,
        samples: 0,
      });
      expect(report.recovery).toHaveLength(7);
    } finally {
      db.close();
    }
  });
});
