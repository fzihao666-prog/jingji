import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadCjs(url, mocks = {}) {
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

const dateMock = { todayBeijing: () => '2026-09-27' };
const injuryForm = loadCjs(new URL('./injury-form.js', import.meta.url), { './date': dateMock });
const serverSource = readFileSync(
  new URL('../../server/athlete/athlete-module.ts', import.meta.url),
  'utf8'
);

function serverSet(name) {
  const match = new RegExp(`${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(serverSource);
  if (!match) throw new Error(`服务端未找到 ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]).sort();
}

const coachInput = () => ({
  isSelfFeedback: false,
  bodyPart: '肩部',
  bodyPartCustom: '',
  injuryName: '右肩肩袖损伤',
  side: 'right',
  painScore: 4,
  onsetDate: '2026-09-20',
  reviewDate: '2026-10-05',
  status: 'restricted',
  restrictions: '暂停大重量卧拉',
  rehabPlan: '肩袖激活，每日2次',
  note: '训练中出现疼痛',
});

describe('伤病上报字典与服务端一致', () => {
  it('健康状态取值与服务端 injuryStatuses 完全一致', () => {
    expect(injuryForm.STATUS_OPTIONS.map((item) => item.value).sort()).toEqual(
      serverSet('injuryStatuses')
    );
  });
  it('身体侧别取值与服务端 injurySides 完全一致', () => {
    expect(injuryForm.SIDE_OPTIONS.map((item) => item.value).sort()).toEqual(
      serverSet('injurySides')
    );
  });
  it('状态文案与小程序 INJURY_LABELS 同源口径', () => {
    const labels = Object.fromEntries(
      injuryForm.STATUS_OPTIONS.map((item) => [item.value, item.label])
    );
    expect(labels).toEqual({
      healthy: '健康',
      observation: '观察',
      restricted: '受限',
      rehab: '康复',
      suspended: '停训',
    });
  });
});

describe('伤病上报载荷校验', () => {
  it('教练提交生成完整正式记录字段', () => {
    expect(injuryForm.buildInjuryPayload(coachInput())).toEqual({
      bodyPart: '肩部',
      injuryName: '右肩肩袖损伤',
      side: 'right',
      painScore: 4,
      onsetDate: '2026-09-20',
      reviewDate: '2026-10-05',
      note: '训练中出现疼痛',
      status: 'restricted',
      restrictions: '暂停大重量卧拉',
      rehabPlan: '肩袖激活，每日2次',
    });
  });

  it('运动员疼痛反馈不携带状态、限制与康复计划', () => {
    const payload = injuryForm.buildInjuryPayload({ ...coachInput(), isSelfFeedback: true });
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('restrictions');
    expect(payload).not.toHaveProperty('rehabPlan');
    expect(payload.injuryName).toBe('右肩肩袖损伤');
  });

  it('拒绝空白部位、非法疼痛值和非法日期', () => {
    expect(() =>
      injuryForm.buildInjuryPayload({ ...coachInput(), bodyPart: '其他', bodyPartCustom: '   ' })
    ).toThrow('请填写伤病部位。');
    expect(() => injuryForm.buildInjuryPayload({ ...coachInput(), painScore: 11 })).toThrow(
      '疼痛评分应为0至10的整数。'
    );
    expect(() => injuryForm.buildInjuryPayload({ ...coachInput(), painScore: 2.5 })).toThrow(
      '疼痛评分应为0至10的整数。'
    );
    expect(() => injuryForm.buildInjuryPayload({ ...coachInput(), onsetDate: '2026-9-3' })).toThrow(
      '请选择首次出现日期。'
    );
    expect(() =>
      injuryForm.buildInjuryPayload({ ...coachInput(), reviewDate: '2026-13-01' })
    ).toThrow('复查日期格式错误。');
  });

  it('按角色给出不同的必填提示并限制长度', () => {
    expect(() => injuryForm.buildInjuryPayload({ ...coachInput(), injuryName: '' })).toThrow(
      '请填写问题名称或诊断。'
    );
    expect(() =>
      injuryForm.buildInjuryPayload({ ...coachInput(), isSelfFeedback: true, injuryName: '' })
    ).toThrow('请填写不适情况。');
    expect(() =>
      injuryForm.buildInjuryPayload({ ...coachInput(), injuryName: 'x'.repeat(81) })
    ).toThrow('问题名称内容过长。');
    expect(() => injuryForm.buildInjuryPayload({ ...coachInput(), status: 'unknown' })).toThrow(
      '请选择有效的健康状态。'
    );
    expect(
      injuryForm.buildInjuryPayload({ ...coachInput(), reviewDate: '', note: '  ' }).reviewDate
    ).toBe('');
  });
});
