import { describe, it, expect } from 'vitest';
import {
  readReport,
  reportFingerprint,
  reportAiInput,
  initializeTrainingReports,
} from './report-service.ts';
import { createReportFixture } from './report-fixture.ts';
import {
  reportRangeSchema,
  reportPeriod,
  reportCommentarySchema,
  reportPreviewSchema,
  reportDataSchema,
} from '../../shared/training-report.ts';
import { renderReportPdf } from './report-pdf.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { ReportData } from '../../shared/training-report.ts';
const miniModule = { exports: {} };
vm.runInNewContext(
  readFileSync(
    new URL('../../WeChat Mini Program/utils/training-report.js', import.meta.url),
    'utf8'
  ),
  { module: miniModule }
);
const mini = miniModule.exports as {
  reportPeriod: typeof reportPeriod;
  reportView: (data: ReportData) => {
    daily: { durationText: string }[];
    kpis: { value: string }[];
  };
};
const range = { from: '2026-10-05', to: '2026-10-11', kind: 'week' as const };
describe('训练报告统计与跨端契约', () => {
  it('历史模拟即使标记有效且非演示，也不作为真实训练或测试', () => {
    const db = createReportFixture();
    try {
      db.exec("UPDATE training_sessions SET source='synthetic_30d_current_v1'; UPDATE test_sessions SET source='user_requested_simulation'");
      const data = readReport(db, 1, 'ROWING', range);
      expect(data.totals.sessions).toBe(0);
      expect(data.tests).toEqual([]);
    } finally { db.close(); }
  });
  it('区分缺失和零，排除演示与其他运动员，按等长前期对比', () => {
    const db = createReportFixture();
    try {
      const data = readReport(db, 1, 'ROWING', range);
      expect(data.totals).toEqual({
        sessions: 3,
        duration: 60,
        distance: 10,
        srpe: 300,
        durationCount: 2,
        distanceCount: 2,
        srpeCount: 2,
      });
      expect(data.previous.duration).toBe(30);
      expect(data.daily[1].duration).toBeNull();
      expect(data.daily[2].duration).toBe(0);
      expect(data.daily[3].srpe).toBeNull();
      expect(data.wellness[0].days).toBe(1);
      expect(data.wellness[2].average).toBeNull();
      expect(data.version).toBe(2);
      expect(data.tests).toHaveLength(2);
      expect(data.tests[0].change).toBe(20);
      expect(data.tests[0].protocol).toBe('标准协议');
      expect(
        reportPreviewSchema.safeParse({ data, fingerprint: reportFingerprint(data) }).success
      ).toBe(true);
      const view = mini.reportView(data);
      expect(view.daily[1].durationText).toBe('—');
      expect(view.daily[2].durationText).toBe('0');
      expect(view.kpis[1].value).toBe('60');
    } finally {
      db.close();
    }
  });
  it('按项目隔离，空报告不伪造趋势和数据；迁移可重复', () => {
    const db = createReportFixture();
    try {
      initializeTrainingReports(db);
      const data = readReport(db, 1, 'CANOE_SPRINT', range);
      expect(data.totals.sessions).toBe(0);
      expect(data.totals.srpe).toBeNull();
      expect(data.tests).toEqual([]);
      expect(data.wellnessDays).toBe(0);
      expect(data.daily).toHaveLength(7);
    } finally {
      db.close();
    }
  });
  it('模型输入不含身份、自由文本、日期、测试协议及恢复健康数据', () => {
    const db = createReportFixture();
    try {
      const input = reportAiInput(readReport(db, 1, 'ROWING', range));
      expect(Object.keys(input)).toEqual([
        'days',
        'totals',
        'previous',
        'categories',
        'trainingDays',
        'daily',
      ]);
      expect(JSON.stringify(input)).not.toMatch(/ROWING|2026|标准协议|sleep|pulse|athlete|水上/);
    } finally {
      db.close();
    }
  });
  it('未知协议仅展示原始值，不计算变化', () => {
    const db = createReportFixture();
    try {
      db.exec("UPDATE test_sessions SET protocol = ''; UPDATE test_measurements SET value_num=50 WHERE id=1; UPDATE test_measurements SET value_num=30 WHERE id=3");
      expect(readReport(db, 1, 'ROWING', range).tests[0].change).toBeNull();
      db.exec("UPDATE test_measurements SET value_num=50 WHERE id=3");
      expect(readReport(db, 1, 'ROWING', range).tests[0].change).toBeNull();
    } finally {
      db.close();
    }
  });
  it('不同指标、单位和侧别仍分组，单次记录不计算变化', () => {
    const db = createReportFixture();
    try {
      db.exec("UPDATE test_measurements SET unit='kW' WHERE id=2; UPDATE test_measurements SET side='left' WHERE id=3; INSERT INTO metric_definitions VALUES('other','另一指标'); INSERT INTO test_measurements VALUES(4,1,'other','W','center',10,0,'manual','valid')");
      const tests = readReport(db, 1, 'ROWING', range).tests;
      expect(tests).toHaveLength(4);
      expect(tests.map((test) => test.change)).toEqual([null, null, null, null]);
    } finally {
      db.close();
    }
  });
  it('协议版本、上下文、项目归属及确认状态均影响可比事实', () => {
    const db = createReportFixture();
    try {
      db.exec("UPDATE test_sessions SET protocol_code='power', protocol_version='v1'; UPDATE test_sessions SET protocol_version='v2' WHERE id=2; UPDATE test_sessions SET context_key='distance:2000' WHERE id=3;");
      expect(readReport(db, 1, 'ROWING', range).tests.map(t => t.change)).toEqual([null, null, null]);
      db.exec("UPDATE training_sessions SET project_status='pending_verification' WHERE id=1; UPDATE test_sessions SET project_code='VOLLEYBALL' WHERE id=2;");
      const data = readReport(db, 1, 'ROWING', range);
      expect(data.totals.sessions).toBe(2);
      expect(data.tests).toHaveLength(2);
      expect(data.tests.flatMap(t => t.points.map(p => p.value))).toEqual([200, 600]);
    } finally { db.close(); }
  });
  it.each(['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM', 'CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])('只生成 %s 当前项目专项章节且公共报告可用', project => {
    const db = createReportFixture();
    try {
      db.prepare('UPDATE athletes SET project=? WHERE id=1').run(project);
      db.prepare('UPDATE training_sessions SET project_code=? WHERE athlete_id=1').run(project);
      db.prepare('UPDATE test_sessions SET project_code=? WHERE athlete_id=1').run(project);
      const data = readReport(db, 1, project, range);
      expect(data.version).toBe(2);
      if (data.version !== 2) throw new Error('expected v2');
      expect(data.specialty.project).toBe(project);
      expect(data.specialty.sessions).toBe(1);
      expect(data.specialty.duration).toBe(60);
      expect(data.totals.sessions).toBe(3);
      expect(data.referenceVersion).toBeNull();
      expect(Object.keys(data.specialty)).toEqual(['project', 'label', 'status', 'reason', 'sessions', 'duration']);
      expect(reportDataSchema.safeParse(data).success).toBe(true);
    } finally { db.close(); }
  });
  it('版本1快照按原值读取和导出，不按新协议规则重算', () => {
    const db = createReportFixture();
    try {
      const current = readReport(db, 1, 'ROWING', range);
      const legacy = { version: 1, range: current.range, project: current.project, totals: current.totals,
        previous: current.previous, daily: current.daily, categories: current.categories,
        tests: [{ ...current.tests[0], protocol: '多种协议', change: 400 }], wellness: current.wellness,
        days: current.days, trainingDays: current.trainingDays, wellnessDays: current.wellnessDays };
      const data = reportDataSchema.parse(legacy);
      db.exec('DELETE FROM test_measurements; DELETE FROM training_sessions;');
      expect(data.version).toBe(1);
      expect(data.tests[0].change).toBe(400);
      expect(mini.reportView(data).kpis[1].value).toBe('60');
      const pdf = renderReportPdf({ id: 'legacy', createdAt: '2026-10-11', data,
        commentary: { highlights: [], concerns: [], suggestions: [] } }, 1);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(data.tests[0].change).toBe(400);
    } finally { db.close(); }
  });
  it('限制日期、自然周月、未知字段和点评长度', () => {
    expect(reportRangeSchema.safeParse({ ...range, to: '2026-10-04' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ ...range, to: '2027-10-11' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ ...range, from: '2026-02-30' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ ...range, kind: 'month' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ ...range, sql: 'unsafe' }).success).toBe(false);
    expect(
      reportCommentarySchema.safeParse({ highlights: ['  '], concerns: [], suggestions: [] })
        .success
    ).toBe(false);
    expect(
      reportCommentarySchema.safeParse({
        highlights: ['a'.repeat(101)],
        concerns: [],
        suggestions: [],
      }).success
    ).toBe(false);
  });
  it('网页和小程序自然周、闰年月口径一致', () => {
    expect(reportPeriod('week', '2026-10-11')).toEqual(range);
    expect(mini.reportPeriod('week', '2026-10-11')).toEqual(range);
    expect(reportPeriod('month', '2024-02-15')).toEqual({
      kind: 'month',
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(mini.reportPeriod('month', '2024-02-15')).toEqual(reportPeriod('month', '2024-02-15'));
  });
});
