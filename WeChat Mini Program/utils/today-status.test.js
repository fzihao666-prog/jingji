import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function load(url, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    module,
    exports: module.exports,
    require(path) {
      if (Object.prototype.hasOwnProperty.call(mocks, path)) return mocks[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    RegExp,
    Math,
  });
  return module.exports;
}

const formatDataContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../data/format-data.js', import.meta.url), 'utf8'), formatDataContext);
const formatContext = { module: { exports: {} }, require: () => formatDataContext.module.exports };
vm.runInNewContext(readFileSync(new URL('./format.js', import.meta.url), 'utf8'), formatContext);
const { todayStatusView, todayStatusSummary } = load(new URL('./today-status.js', import.meta.url), {
  './format': formatContext.module.exports,
});

const payload = () => ({
  date: '2026-09-27',
  timezone: 'Asia/Shanghai',
  generatedAt: '2026-09-27T02:00:00Z',
  submitted: true,
  timeIncomplete: false,
  load24h: 468.4,
  source: 'manual',
});

const planPayload = () => ({
  title: '本周计划',
  focus: '有氧',
  specialItems: ['水上技术划'],
  physicalItems: ['深蹲'],
  plannedDurationMin: 90,
  plannedDistanceKm: 12,
  items: [{ name: '深蹲', detail: '4×8 · 75%' }],
});

const sessionPayload = () => ({
  id: 3,
  content: '水上技术划',
  trainingType: '专项训练',
  startTime: '08:00',
  durationMin: 90,
  distanceKm: 0,
  rpe: 6,
});

describe('今日状态响应与文案', () => {
  it('已记录显示状态、负荷与来源，负荷只取服务端结果', () => {
    const view = todayStatusSummary(todayStatusView(payload()));
    expect(view.submittedLabel).toBe('已记录');
    expect(view.loadText).toBe('468');
    expect(view.note).toContain('计入24小时负荷');
    expect(view.sourceText).toBe('来源 manual');
    expect(view.timeNote).toBe('');
  });

  it('暂无记录提示去记录训练，时间待补单独说明', () => {
    const view = todayStatusSummary(todayStatusView({ ...payload(), submitted: false, source: null }));
    expect(view.submittedLabel).toBe('暂无记录');
    expect(view.note).toBe('今日还没有有效训练记录。');

    const incomplete = todayStatusSummary(
      todayStatusView({ ...payload(), timeIncomplete: true, load24h: 0 })
    );
    expect(incomplete.timeNote).toContain('暂不计入24小时负荷');
    expect(incomplete.note).toContain('开训时间待补充');
  });

  it('今日安排与本人记录原样透传，缺省视为无计划无记录', () => {
    const view = todayStatusView({ ...payload(), plan: planPayload(), sessions: [sessionPayload()] });
    expect(view.plan).toEqual(planPayload());
    expect(view.sessions).toEqual([sessionPayload()]);
    const bare = todayStatusView(payload());
    expect(bare.plan).toBeNull();
    expect(bare.sessions).toEqual([]);
  });

  it('拒绝畸形响应，不能把异常数据当成已填报', () => {
    expect(() => todayStatusView({})).toThrow();
    expect(() => todayStatusView({ ...payload(), timezone: 'UTC' })).toThrow();
    expect(() => todayStatusView({ ...payload(), submitted: 'yes' })).toThrow();
    expect(() => todayStatusView({ ...payload(), load24h: -1 })).toThrow();
    expect(() => todayStatusView({ ...payload(), date: '2026-09-99' })).toThrow();
    expect(() => todayStatusView({ ...payload(), source: 'x'.repeat(101) })).toThrow();
    expect(() => todayStatusView({ ...payload(), source: 12 })).toThrow();
    expect(() => todayStatusView({ ...payload(), plan: { title: 1 } })).toThrow();
    expect(() => todayStatusView({ ...payload(), sessions: [{ id: 'x' }] })).toThrow();
    expect(() => todayStatusView({ ...payload(), plan: { ...planPayload(), plannedDurationMin: -1 } })).toThrow();
    expect(() => todayStatusView({ ...payload(), sessions: [{ ...sessionPayload(), rpe: 11 }] })).toThrow();
  });
});
