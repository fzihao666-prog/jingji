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

const dateContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./date.js', import.meta.url), 'utf8'), dateContext);
const wellnessForm = load(new URL('./wellness-form.js', import.meta.url), {
  // 固定“今天”，让回填窗口与表单默认值不依赖真实日期。
  './date': {
    todayBeijing: () => '2026-09-27',
    toDateString: dateContext.module.exports.toDateString,
  },
});
const {
  METRICS,
  STATUS_OPTIONS,
  wellnessDates,
  defaultWellnessForm,
  wellnessPayload,
  wellnessFormFromRecord,
  wellnessRecordView,
} = wellnessForm;

describe('恢复日报回填窗口与表单默认值', () => {
  it('按北京时间给出最近7天窗口', () => {
    expect(wellnessDates()).toEqual({ min: '2026-09-21', max: '2026-09-27', today: '2026-09-27' });
    expect(defaultWellnessForm().date).toBe('2026-09-27');
    expect(defaultWellnessForm().statusIndex).toBe(0);
    METRICS.forEach((metric) => expect(defaultWellnessForm()[metric.key]).toBe(''));
  });

  it('字段与服务端量纲一一对应，状态只保留自评口径', () => {
    expect(METRICS.map((metric) => metric.key)).toEqual([
      'sleepHours',
      'sleepQuality',
      'morningPulse',
      'weightKg',
      'fatigueIndex',
      'sorenessIndex',
      'moodIndex',
    ]);
    expect(STATUS_OPTIONS.map((option) => option.value)).toEqual(['normal', 'rest']);
  });
});

describe('恢复日报提交校验', () => {
  it('空提交与越界数值拒绝，并给出与服务端一致的提示', () => {
    expect(() => wellnessPayload(defaultWellnessForm())).toThrow('至少填写一项恢复数据。');
    expect(() => wellnessPayload({ ...defaultWellnessForm(), sleepHours: '30' })).toThrow(
      '睡眠时长应为0至24小时。'
    );
    expect(() => wellnessPayload({ ...defaultWellnessForm(), morningPulse: '20' })).toThrow(
      '晨脉应为25至250bpm。'
    );
    expect(() => wellnessPayload({ ...defaultWellnessForm(), fatigueIndex: '11' })).toThrow(
      '疲劳程度应为0至10分。'
    );
    expect(() => wellnessPayload({ ...defaultWellnessForm(), sleepQuality: 'good' })).toThrow(
      '睡眠质量应为0至10分。'
    );
  });

  it('拒绝窗口外日期，只允许最近7天至今天', () => {
    expect(() => wellnessPayload({ ...defaultWellnessForm(), date: '2026-09-28' })).toThrow(
      '恢复日报只能填写最近7天（含今天）的数据。'
    );
    expect(() => wellnessPayload({ ...defaultWellnessForm(), date: '2026-09-20' })).toThrow(
      '恢复日报只能填写最近7天（含今天）的数据。'
    );
    expect(() => wellnessPayload({ ...defaultWellnessForm(), date: '2026-09-99' })).toThrow();
  });

  it('已填写项转成数字，未填写项显式清空为 null', () => {
    const payload = wellnessPayload({
      ...defaultWellnessForm(),
      sleepHours: '7.5',
      morningPulse: ' 72 ',
      weightKg: '',
      fatigueIndex: '4',
      statusIndex: 1,
    });
    expect(payload).toEqual({
      date: '2026-09-27',
      sleepHours: 7.5,
      sleepQuality: null,
      morningPulse: 72,
      weightKg: null,
      fatigueIndex: 4,
      sorenessIndex: null,
      moodIndex: null,
      status: 'rest',
    });
  });
});

describe('恢复日报回填与摘要', () => {
  const record = {
    date: '2026-09-27',
    sleepHours: 7,
    sleepQuality: 8,
    morningPulse: 58,
    weightKg: 61.5,
    fatigueIndex: 4,
    sorenessIndex: 3,
    moodIndex: 7,
    status: 'normal',
    source: 'athlete_self_report',
  };

  it('已有记录回填表单，未填写日期保持默认值', () => {
    const form = wellnessFormFromRecord(record, '2026-09-27');
    expect(form.sleepHours).toBe('7');
    expect(form.weightKg).toBe('61.5');
    expect(form.statusIndex).toBe(0);
    expect(wellnessFormFromRecord(record, '2026-09-26').sleepHours).toBe('');
    expect(wellnessFormFromRecord(null, '2026-09-27').date).toBe('2026-09-27');
  });

  it('摘要只汇总原始数值，不生成评分', () => {
    expect(wellnessRecordView(record)).toMatchObject({
      filled: true,
      filledLabel: '已填写',
      statusLabel: '正常训练',
    });
    expect(wellnessRecordView(record).summary).toContain('睡眠时长 7h');
    expect(wellnessRecordView(record).summary).toContain('晨脉 58bpm');
    expect(wellnessRecordView(null)).toMatchObject({
      filled: false,
      filledLabel: '未填写',
      summary: '',
    });
  });
});
