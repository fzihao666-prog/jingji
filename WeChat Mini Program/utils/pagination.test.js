import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./pagination.js', import.meta.url), 'utf8'), context);
const { clampPage, buildPagerState } = context.module.exports;

describe('clampPage', () => {
  it('收敛到 1 与总页数之间，非法输入回到第 1 页', () => {
    expect(clampPage(3, 10)).toBe(3);
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-1, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage('x', 10)).toBe(1);
  });
});

describe('buildPagerState', () => {
  it('给出当前页、总页数与前后可用性', () => {
    expect(buildPagerState(1, 5)).toEqual({ page: 1, pageCount: 5, hasPrev: false, hasNext: true });
    expect(buildPagerState(3, 5)).toEqual({ page: 3, pageCount: 5, hasPrev: true, hasNext: true });
    expect(buildPagerState(5, 5)).toEqual({ page: 5, pageCount: 5, hasPrev: true, hasNext: false });
  });

  it('总页数下限为 1，越界页码收敛', () => {
    expect(buildPagerState(9, 0)).toEqual({ page: 1, pageCount: 1, hasPrev: false, hasNext: false });
    expect(buildPagerState(9, 3).page).toBe(3);
  });
});
