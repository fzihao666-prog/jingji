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

const formatData = loadCjs(new URL('../data/format-data.js', import.meta.url), {});
const { raceTime, raceDelta } = loadCjs(new URL('./format.js', import.meta.url), {
  '../data/format-data': formatData,
});

describe('专项测试成绩时间与差值格式', () => {
  it('毫秒按 m:ss.xx 显示，与录入端 0:55.15 口径对称', () => {
    expect(raceTime(55150)).toBe('0:55.15');
    expect(raceTime(62350)).toBe('1:02.35');
    expect(raceTime(390740)).toBe('6:30.74');
    expect(raceTime(0)).toBe('0:00.00');
  });

  it('超过一小时补足分钟两位，非法输入不伪造数值', () => {
    expect(raceTime(3723500)).toBe('1:02:03.50');
    expect(raceTime(null)).toBe('');
    expect(raceTime(Number.NaN)).toBe('');
    expect(raceTime(-5)).toBe('');
  });

  it('差值按绝对秒数展示，快慢语义由文案直接表达', () => {
    expect(raceDelta(-1200)).toBe('较上次快 1.20s');
    expect(raceDelta(850)).toBe('较上次慢 0.85s');
    expect(raceDelta(0)).toBe('与上次持平');
    expect(raceDelta(null)).toBe('');
  });
});
