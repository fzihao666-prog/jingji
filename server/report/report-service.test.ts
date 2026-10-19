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
} from '../../shared/training-report.ts';
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
      expect(data.tests).toHaveLength(2);
      expect(data.tests[0].change).toBe(20);
      expect(data.tests[1].change).toBeNull();
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
      const data = readReport(db, 1, 'CANOE', range);
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
  it('无协议的两次测试不计算变化', () => {
    const db = createReportFixture();
    try {
      db.exec("UPDATE test_sessions SET protocol = '' WHERE id IN (1,2)");
      expect(readReport(db, 1, 'ROWING', range).tests[0].change).toBeNull();
    } finally {
      db.close();
    }
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
