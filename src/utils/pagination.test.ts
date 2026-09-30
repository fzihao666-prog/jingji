import { describe, expect, it } from 'vitest';
import { buildPagerItems, clampPage, pageRange } from './pagination';

describe('clampPage', () => {
  it('收敛到 1 与总页数之间，非法输入回到第 1 页', () => {
    expect(clampPage(3, 10)).toBe(3);
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-1, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(Number.NaN, 10)).toBe(1);
  });
});

describe('pageRange', () => {
  it('给出当前页、边界与展示区间', () => {
    const range = pageRange(2, 6, 14);
    expect(range).toEqual({ pageCount: 3, current: 2, hasPrev: true, hasNext: true, start: 7, end: 12 });
    const first = pageRange(1, 6, 14);
    expect(first).toMatchObject({ current: 1, hasPrev: false, hasNext: true, start: 1, end: 6 });
    const last = pageRange(9, 6, 14);
    expect(last).toMatchObject({ current: 3, hasPrev: true, hasNext: false, start: 13, end: 14 });
  });

  it('空数据与零页时区间为 0–0', () => {
    expect(pageRange(1, 6, 0)).toMatchObject({ pageCount: 1, current: 1, start: 0, end: 0 });
  });
});

describe('buildPagerItems', () => {
  it('页数不超过 7 时全部平铺并标注当前页', () => {
    expect(buildPagerItems(2, 5)).toEqual([
      { type: 'page', page: 1, current: false },
      { type: 'page', page: 2, current: true },
      { type: 'page', page: 3, current: false },
      { type: 'page', page: 4, current: false },
      { type: 'page', page: 5, current: false },
    ]);
  });

  it('页数多时首尾保留、当前页前后各 1 页、间隔用省略号', () => {
    expect(buildPagerItems(4, 20)).toEqual([
      { type: 'page', page: 1, current: false },
      { type: 'ellipsis' },
      { type: 'page', page: 3, current: false },
      { type: 'page', page: 4, current: true },
      { type: 'page', page: 5, current: false },
      { type: 'ellipsis' },
      { type: 'page', page: 20, current: false },
    ]);
    expect(buildPagerItems(1, 20).map((item) => (item.type === 'page' ? item.page : '…'))).toEqual([
      1, 2, 3, '…', 20,
    ]);
    expect(buildPagerItems(20, 20).map((item) => (item.type === 'page' ? item.page : '…'))).toEqual([
      1, '…', 18, 19, 20,
    ]);
  });

  it('越界页码收敛后生成模型，不会出现重复或越界页码', () => {
    const items = buildPagerItems(99, 20);
    const pages = items.filter((item) => item.type === 'page').map((item) => (item.type === 'page' ? item.page : 0));
    expect(pages).toEqual([...new Set(pages)]);
    expect(Math.max(...pages)).toBeLessThanOrEqual(20);
  });
});
