import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./status-detection.js', import.meta.url), 'utf8'), context);
const {
  TREND_METRICS,
  statusMetricCards,
  buildStatusTrend,
  buildStatusHistory,
  buildTeamStatusView,
} = context.module.exports;

describe('statusMetricCards', () => {
  it('缺失显 --、真实 0 显 0，RPE 与晨间疲劳分列', () => {
    const cards = statusMetricCards({ sleepHours: 0, morningPulse: null, fatigueIndex: 4 }, 7);
    expect(cards.map((card) => card.value)).toEqual(['0', '--', '--', '4', '--', '7']);
    expect(cards.find((card) => card.key === 'fatigueIndex').label).toBe('主观疲劳');
    expect(cards.find((card) => card.key === 'rpe').note).toContain('训练课次');
    expect(statusMetricCards(null, null).every((card) => card.value === '--')).toBe(true);
  });
});

describe('buildStatusTrend', () => {
  const trends = [
    { key: 'sleepHours', points: [
      { date: '2026-10-01', personalValue: 7 },
      { date: '2026-10-02', personalValue: null },
      { date: '2026-10-03', personalValue: 8 },
    ] },
    { key: 'weightKg', points: [
      { date: '2026-10-01', personalValue: 61.2 },
      { date: '2026-10-03', personalValue: 61.8 },
    ] },
  ];
  it('单指标序列剔除缺失点，零基指标从 0 起画', () => {
    const view = buildStatusTrend(trends, 'sleepHours');
    expect(view.empty).toBe(false);
    expect(view.points).toHaveLength(2);
    expect(view.unit).toBe('小时');
    expect(view.points[1].height).toBeGreaterThan(view.points[0].height);
    expect(view.scaleNote).toBe('');
  });
  it('区间缩放指标标注缩放说明，无数据指标保持空态', () => {
    const weight = buildStatusTrend(trends, 'weightKg');
    expect(weight.scaleNote).toContain('区间缩放');
    expect(weight.points[0].height).toBeGreaterThanOrEqual(4);
    expect(buildStatusTrend(trends, 'fatigue').empty).toBe(true);
    expect(buildStatusTrend([], 'sleepHours').empty).toBe(true);
    expect(TREND_METRICS.map((item) => item.key)).toEqual(['sleepHours', 'morningPulse', 'weightKg', 'fatigue']);
  });
});

describe('buildStatusHistory', () => {
  it('按日期合并指标并按新到旧截取', () => {
    const trends = [
      { key: 'sleepHours', points: [{ date: '2026-10-01', personalValue: 7 }, { date: '2026-10-02', personalValue: 6 }] },
      { key: 'fatigue', points: [{ date: '2026-10-02', personalValue: 3 }] },
      { key: 'rpe', points: [{ date: '2026-10-02', personalValue: 5 }] },
    ];
    const rows = buildStatusHistory(trends, 7);
    expect(rows.map((row) => row.date)).toEqual(['2026-10-02', '2026-10-01']);
    expect(rows[0].values).toEqual({ sleepHours: '6', fatigueIndex: '3', rpe: '5' });
  });
});

describe('buildTeamStatusView', () => {
  it('统计应填/已填/未填并列出自评异常与高负荷人员', () => {
    const view = buildTeamStatusView({
      summary: { total: 4, wellnessReported: 2 },
      athletes: [
        { athleteId: 1, athleteName: '甲', team: '一队', wellnessReported: true, wellnessStatus: 'rest', highLoad: false },
        { athleteId: 2, athleteName: '乙', team: '一队', wellnessReported: true, wellnessStatus: 'normal', highLoad: true },
        { athleteId: 3, athleteName: '丙', team: '二队', wellnessReported: false, wellnessStatus: null, highLoad: false },
        { athleteId: 4, athleteName: '丁', team: '二队', wellnessReported: true, wellnessStatus: 'normal', highLoad: false },
      ],
    });
    expect(view).toMatchObject({ total: 4, reported: 2, missing: 2 });
    expect(view.attentionRows.map((row) => row.name)).toEqual(['甲', '乙']);
    expect(view.attentionRows[0].reasons).toEqual(['自评需要休息']);
    expect(view.attentionRows[1].reasons).toEqual(['24 小时高负荷']);
    expect(buildTeamStatusView(null)).toMatchObject({ total: 0, reported: 0, missing: 0, attentionRows: [] });
  });
});
