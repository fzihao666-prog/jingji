import { describe, expect, it } from 'vitest';
import { buildPainTrend, painTrendWindow, type PainTrendRow } from '../core/pain-trend.ts';

const NOW = new Date('2026-09-30T04:00:00Z'); // 北京时间 2026-09-30 12:00
const row = (overrides: Partial<PainTrendRow>): PainTrendRow => ({
  bodyPart: '肩部',
  painScore: 3,
  recordType: 'feedback',
  status: 'observation',
  createdAt: '2026-09-29 20:00:00',
  ...overrides,
});

describe('painTrendWindow', () => {
  it('窗口按北京日计算，起点换算为 UTC 文本', () => {
    const window = painTrendWindow(NOW, 7);
    expect(window.startDate).toBe('2026-09-24');
    expect(window.endDate).toBe('2026-09-30');
    expect(window.startUtcText).toBe('2026-09-23 16:00:00');
  });
});

describe('buildPainTrend', () => {
  it('同部位同日多条只保留最新一条评分', () => {
    const trend = buildPainTrend({
      athleteId: 1,
      days: 7,
      now: NOW,
      rows: [
        row({ createdAt: '2026-09-29 18:00:00', painScore: 3 }),
        row({ createdAt: '2026-09-29 20:00:00', painScore: 5 }),
      ],
    });
    expect(trend.parts).toHaveLength(1);
    expect(trend.parts[0].series).toHaveLength(1);
    expect(trend.parts[0].series[0]).toEqual({ date: '2026-09-30', painScore: 5, recordType: 'feedback' });
    expect(trend.parts[0].latestPainScore).toBe(5);
  });

  it('UTC 时刻换算北京日跨日归属', () => {
    const trend = buildPainTrend({
      athleteId: 1,
      days: 7,
      now: NOW,
      rows: [
        // UTC 29 日 16:30 → 北京 30 日 00:30
        row({ createdAt: '2026-09-29 16:30:00' }),
        // UTC 23 日 20:00 → 北京 24 日 04:00，恰在窗口起点当天
        row({ bodyPart: '膝部', createdAt: '2026-09-23 20:00:00' }),
      ],
    });
    const shoulder = trend.parts.find((part) => part.bodyPart === '肩部');
    expect(shoulder?.series[0].date).toBe('2026-09-30');
  });

  it('窗口之前的记录被过滤，空数据返回空 parts', () => {
    const trend = buildPainTrend({
      athleteId: 1,
      days: 7,
      now: NOW,
      // UTC 23 日 15:00 → 北京 23 日 23:00，早于窗口起点 2026-09-24
      rows: [row({ bodyPart: '膝部', createdAt: '2026-09-23 15:00:00' })],
    });
    expect(trend.parts).toHaveLength(0);
    expect(buildPainTrend({ athleteId: 1, days: 7, now: NOW, rows: [] }).parts).toEqual([]);
  });

  it('parts 按最近记录倒序，latest 字段指向最新一条', () => {
    const trend = buildPainTrend({
      athleteId: 1,
      days: 30,
      now: NOW,
      rows: [
        row({ bodyPart: '膝部', status: 'rehab', painScore: 2, createdAt: '2026-09-25 06:00:00' }),
        row({ status: 'restricted', painScore: 4, createdAt: '2026-09-28 12:00:00' }),
      ],
    });
    expect(trend.parts[0].bodyPart).toBe('肩部');
    expect(trend.parts[0].latestStatus).toBe('restricted');
    expect(trend.parts[1].bodyPart).toBe('膝部');
    expect(trend.startDate).toBe('2026-09-01');
    expect(trend.endDate).toBe('2026-09-30');
  });
});

describe('buildPainTrend 混合时间格式', () => {
  it('兼容 ISO 带时区的历史 created_at 格式', () => {
    const trend = buildPainTrend({
      athleteId: 1,
      days: 7,
      now: NOW,
      rows: [
        // 演示种子使用 ISO 毫秒 + Z 格式（北京时间 9-29 20:00 → 北京日 2026-09-29）
        row({ createdAt: '2026-09-29T12:00:00.000Z', painScore: 4 }),
        row({ createdAt: '2026-09-29 08:00:00', painScore: 6 }),
      ],
    });
    expect(trend.parts).toHaveLength(1);
    // 两条都落在 2026-09-29，同日取最新：ISO 20:00 晚于 UTC 08:00（北京 16:00）
    expect(trend.parts[0].series).toEqual([
      { date: '2026-09-29', painScore: 4, recordType: 'feedback' },
    ]);
  });
});
