import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadDate(now) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const context = { module: { exports: {} }, Date: FixedDate };
  vm.runInNewContext(readFileSync(new URL('./date.js', import.meta.url), 'utf8'), context);
  return context.module.exports;
}

describe('小程序北京时间日期', () => {
  it('UTC 日期边界按北京时间计算今天和周范围', () => {
    const date = loadDate('2026-09-23T16:30:00Z');
    expect(date.todayBeijing()).toBe('2026-09-24');
    expect(date.periodFor('week')).toEqual({ from: '2026-09-18', to: '2026-09-24' });
  });
});
