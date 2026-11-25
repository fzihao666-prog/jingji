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

// 字典模块直接加载真实文件，保证指标 key 与小程序字典一致。
const formatData = load(new URL('../data/format-data.js', import.meta.url));
const testEntryForm = load(new URL('./test-entry-form.js', import.meta.url), {
  '../data/format-data': formatData,
});
const {
  STRENGTH_FIELDS,
  SPECIAL_ATTEMPT_COUNT,
  defaultStrengthForm,
  strengthPayload,
  defaultSpecialForm,
  specialPayload,
  pickSpecialEventFields,
  recentValues,
  resolveCrewName,
} = testEntryForm;

describe('体能测试录入表单', () => {
  it('指标字段与字典一一对应，默认值全部留空', () => {
    expect(STRENGTH_FIELDS.map((field) => field.key)).toEqual(Object.keys(formatData.strengthMetrics));
    STRENGTH_FIELDS.forEach((field) => {
      expect(field.label).toBe(formatData.strengthMetrics[field.key][0]);
      expect(field.unit).toBe(formatData.strengthMetrics[field.key][1]);
    });
    const form = defaultStrengthForm();
    expect(form.testDate).toBe('');
    expect(form.notes).toBe('');
    STRENGTH_FIELDS.forEach((field) => expect(form[field.key]).toBe(''));
  });

  it('缺日期或无任何实测数据时拒绝提交', () => {
    expect(() => strengthPayload({ ...defaultStrengthForm(), squatKg: '100' })).toThrow('请选择测试日期。');
    expect(() => strengthPayload({ ...defaultStrengthForm(), testDate: '2026-09-27' })).toThrow('至少填写一项实测数据。');
  });

  it('空串跳过、非法数字报错、数值保留一位小数', () => {
    const payload = strengthPayload({
      ...defaultStrengthForm(),
      testDate: '2026-09-27',
      squatKg: ' 100.26 ',
      benchPressKg: '',
      notes: ' 早晨状态良好 ',
    });
    expect(payload.metrics).toEqual({ squatKg: 100.3 });
    expect(payload.notes).toBe('早晨状态良好');
    expect(() => strengthPayload({ ...defaultStrengthForm(), testDate: '2026-09-27', squatKg: 'abc' })).toThrow('深蹲应为非负数字。');
    expect(() => strengthPayload({ ...defaultStrengthForm(), testDate: '2026-09-27', squatKg: '-5' })).toThrow('深蹲应为非负数字。');
  });
});

describe('专项测试录入表单', () => {
  it('默认值覆盖全部请求字段，成绩共三轮', () => {
    const form = defaultSpecialForm();
    expect(SPECIAL_ATTEMPT_COUNT).toBe(3);
    expect(form.attempts).toHaveLength(3);
    expect(form).toMatchObject({
      testDate: '',
      distanceM: '',
      boatClass: '',
      genderGroup: '',
      session: '',
      windConditions: '',
      location: '',
      note: '',
      crewName: '',
      memberIds: [],
      previousBestText: '',
    });
  });

  it('校验日期、距离、组合与成员后组装请求体', () => {
    const payload = specialPayload({
      ...defaultSpecialForm(),
      project: '赛艇',
      testDate: '2026-09-27',
      distanceM: '2000',
      crewName: ' 测试组 ',
      memberIds: [7, '8', 0, 'x'],
      attempts: ['0:55.15', '', '56.2'],
      previousBestText: '0:54.90',
      windConditions: ' 顺风 ',
    });
    expect(payload).toEqual({
      project: '赛艇',
      testDate: '2026-09-27',
      distanceM: 2000,
      boatClass: '未分组',
      genderGroup: '未分组',
      session: '',
      windConditions: '顺风',
      location: '',
      note: '',
      crewName: '测试组',
      memberAthleteIds: [7, 8],
      previousBestText: '0:54.90',
      attemptsText: ['0:55.15', '56.2'],
    });

    expect(() => specialPayload({ ...defaultSpecialForm(), testDate: '2026/09/27' })).toThrow('请选择测试日期。');
    expect(() => specialPayload({ ...defaultSpecialForm(), testDate: '2026-09-27', distanceM: '2.5' })).toThrow('测试距离应为1—100000米的整数。');
    expect(() => specialPayload({ ...defaultSpecialForm(), testDate: '2026-09-27', distanceM: '2000', crewName: '' })).toThrow('请填写运动员或组合名称。');
    expect(() => specialPayload({ ...defaultSpecialForm(), testDate: '2026-09-27', distanceM: '2000', crewName: 'x', memberIds: [] })).toThrow('请选择至少一名成员运动员。');
    expect(() => specialPayload({
      ...defaultSpecialForm(),
      testDate: '2026-09-27',
      distanceM: '2000',
      crewName: 'x',
      memberIds: [7],
      attempts: ['', '', ''],
    })).toThrow('至少填写一轮成绩。');
  });

  it('成绩格式仅接受 0:55.15 / 55.15 风格，历史最好可留空', () => {
    const base = {
      ...defaultSpecialForm(),
      testDate: '2026-09-27',
      distanceM: '2000',
      crewName: 'x',
      memberIds: [7],
      attempts: ['1:02:03.5', '', ''],
    };
    expect(specialPayload(base).attemptsText).toEqual(['1:02:03.5']);
    expect(specialPayload(base).previousBestText).toBe('');
    expect(() => specialPayload({ ...base, attempts: ['五十五秒', '', ''] })).toThrow('成绩格式应为 0:55.15 或 55.15。');
    expect(() => specialPayload({ ...base, previousBestText: 'abc' })).toThrow('成绩格式应为 0:55.15 或 55.15。');
  });
});

describe('专项录入便捷逻辑', () => {
  it('赛事级条件只取事件 upsert 维度字段并统一为字符串', () => {
    const fields = pickSpecialEventFields({
      ...defaultSpecialForm(),
      project: '赛艇',
      testDate: '2026-09-27',
      distanceM: 2000,
      boatClass: '八人单桨',
      genderGroup: '男子公开',
      session: '上午',
      windConditions: '顺风',
      location: '千岛湖',
      note: '水温合适',
      crewName: '测试组',
      attempts: ['0:55.15', '', ''],
      previousBestText: '0:54.90',
    });
    expect(fields).toEqual({
      testDate: '2026-09-27',
      distanceM: '2000',
      boatClass: '八人单桨',
      genderGroup: '男子公开',
      session: '上午',
      windConditions: '顺风',
      location: '千岛湖',
      note: '水温合适',
    });
  });

  it('常用距离新值去重置顶并限制条数', () => {
    expect(recentValues(['2000', '500'], '1000')).toEqual(['1000', '2000', '500']);
    expect(recentValues(['2000', '500'], '2000')).toEqual(['2000', '500']);
    expect(recentValues(null, '')).toEqual([]);
    expect(recentValues(['1', '2', '3', '4'], '5', 3)).toEqual(['5', '1', '2']);
    expect(recentValues(undefined, 2000)).toEqual(['2000']);
  });

  it('组合名仅在空白或仍是上一个自动名时跟随新运动员', () => {
    expect(resolveCrewName('', '张三', '李四')).toBe('李四');
    expect(resolveCrewName('张三', '张三', '李四')).toBe('李四');
    expect(resolveCrewName('测试组', '张三', '李四')).toBe('测试组');
    expect(resolveCrewName('', '', '李四')).toBe('李四');
    expect(resolveCrewName('测试组', '', '')).toBe('测试组');
  });
});
