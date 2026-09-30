import { describe, expect, it } from 'vitest';
import { beijingDate, buildTodayStatus } from '../core/coach-daily-todos.ts';
import {
  WELLNESS_BACKFILL_DAYS,
  coachWellnessWriteSchema,
  firstIssueMessage,
  wellnessQuerySchema,
  wellnessWindow,
  wellnessWriteSchema,
} from '../athlete/self-daily-service.ts';

// 北京时间 2026-09-23 10:00，当天为 2026-09-23。
const now = new Date('2026-09-23T02:00:00Z');
const session = (overrides = {}) => ({
  athleteId: 7,
  date: '2026-09-23',
  startTime: '08:00',
  srpe: 468,
  trainingType: '专项训练',
  structureType: '专项训练',
  content: '水上',
  source: 'manual',
  quality: 'valid',
  isDemo: 0,
  ...overrides,
});

describe('运动员今日状态', () => {
  it('当天正式课次计为已填报，并给出该课次来源', () => {
    const result = buildTodayStatus({ athleteId: 7, sessions: [session()], now });
    expect(result).toMatchObject({
      date: '2026-09-23',
      timezone: 'Asia/Shanghai',
      submitted: true,
      timeIncomplete: false,
      load24h: 468,
      source: 'manual',
    });
    expect(beijingDate(now)).toBe('2026-09-23');
  });

  it('无课次或仅演示、低质量、seed 来源课次都不算已填报', () => {
    expect(buildTodayStatus({ athleteId: 7, sessions: [], now })).toMatchObject({
      submitted: false,
      timeIncomplete: false,
      load24h: 0,
      source: null,
    });
    for (const overrides of [
      { isDemo: 1 },
      { quality: 'estimated' },
      { source: 'initial_seed' },
      { source: 'demo_import' },
    ]) {
      expect(buildTodayStatus({ athleteId: 7, sessions: [session(overrides)], now })).toMatchObject({
        submitted: false,
        load24h: 0,
        source: null,
      });
    }
  });

  it('开训时间缺失标记为待补时间，并且不计入24小时负荷', () => {
    const result = buildTodayStatus({
      athleteId: 7,
      sessions: [session({ startTime: 'TBD' }), session({ srpe: 120 })],
      now,
    });
    expect(result.timeIncomplete).toBe(true);
    expect(result.submitted).toBe(true);
    expect(result.load24h).toBe(120);
  });

  it('24小时负荷只累计窗口内课次，其他运动员与窗口外课次不计入', () => {
    const result = buildTodayStatus({
      athleteId: 7,
      sessions: [
        session(),
        // 昨天 11:00（北京）距今 23 小时，仍在窗口内。
        session({ date: '2026-09-22', startTime: '11:00', srpe: 300 }),
        // 昨天 09:00 已超过 24 小时。
        session({ date: '2026-09-22', startTime: '09:00', srpe: 500 }),
        // 前天课次超出查询范围。
        session({ date: '2026-09-21', startTime: '11:00', srpe: 900 }),
        // 其他运动员的课次不计入。
        session({ athleteId: 8, srpe: 700 }),
      ],
      now,
    });
    expect(result.load24h).toBe(768);
    expect(result.submitted).toBe(true);
  });
});

describe('恢复日报校验', () => {
  it('按北京时间给出最近7天回填窗口', () => {
    expect(WELLNESS_BACKFILL_DAYS).toBe(7);
    expect(wellnessWindow(now)).toEqual({ today: '2026-09-23', earliest: '2026-09-17' });
    expect(beijingDate(new Date('2026-09-22T16:00:00Z'))).toBe('2026-09-23');
  });

  it('拒绝未来日期、超窗日期与非法日期格式', () => {
    const schema = wellnessWriteSchema(now);
    expect(schema.safeParse({ date: '2026-09-23', sleepHours: 7 }).success).toBe(true);
    expect(schema.safeParse({ date: '2026-09-17', sleepHours: 7 }).success).toBe(true);
    for (const date of ['2026-09-24', '2026-09-16', '2026-02-30', '2026-09-3', '']) {
      expect(schema.safeParse({ date, sleepHours: 7 }).success).toBe(false);
    }
    expect(wellnessQuerySchema(now).safeParse({ date: '2026-09-30' }).success).toBe(false);
    expect(wellnessQuerySchema(now).safeParse({}).success).toBe(true);
  });

  it('拒绝空提交、越界数值、未知字段与非自评状态', () => {
    const schema = wellnessWriteSchema(now);
    const empty = schema.safeParse({ date: '2026-09-23' });
    expect(empty.success).toBe(false);
    expect(firstIssueMessage(empty.error!, '')).toBe('至少填写一项恢复数据。');
    expect(schema.safeParse({ sleepHours: 30 }).success).toBe(false);
    expect(schema.safeParse({ morningPulse: 20 }).success).toBe(false);
    expect(schema.safeParse({ weightKg: 400 }).success).toBe(false);
    expect(schema.safeParse({ fatigueIndex: 11 }).success).toBe(false);
    expect(schema.safeParse({ sleepQuality: 'good' }).success).toBe(false);
    expect(schema.safeParse({ sleepHours: 7, unknownField: 1 }).success).toBe(false);
    expect(schema.safeParse({ sleepHours: 7, status: 'alert' }).success).toBe(false);
    expect(schema.safeParse({ sleepHours: 7, status: 'rest' }).success).toBe(true);
    expect(schema.safeParse({ sleepHours: 7, status: 'missing' }).success).toBe(false);
  });

  it('空字符串按未填写处理，正常数值可整表提交', () => {
    const parsed = wellnessWriteSchema(now).safeParse({
      date: '2026-09-23',
      sleepHours: '',
      morningPulse: '72',
      weightKg: 61.5,
      fatigueIndex: 4,
      status: 'normal',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      date: '2026-09-23',
      sleepHours: null,
      sleepQuality: null,
      morningPulse: 72,
      weightKg: 61.5,
      fatigueIndex: 4,
      sorenessIndex: null,
      moodIndex: null,
      status: 'normal',
    });
  });

  it('教练代填允许关注/警示状态，仍拒绝 missing 与未知状态', () => {
    const schema = coachWellnessWriteSchema(now);
    expect(schema.safeParse({ sleepHours: 7, status: 'attention' }).success).toBe(true);
    expect(schema.safeParse({ sleepHours: 7, status: 'alert' }).success).toBe(true);
    expect(schema.safeParse({ sleepHours: 7, status: 'missing' }).success).toBe(false);
    expect(schema.safeParse({ sleepHours: 7, status: 'unknown' }).success).toBe(false);
    // 日期窗口与本人自评一致：只允许最近7天。
    expect(schema.safeParse({ date: '2026-09-16', sleepHours: 7 }).success).toBe(false);
  });
});
