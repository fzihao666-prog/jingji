import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./pagination.js', import.meta.url), 'utf8'), context);
const { clampPage, buildPagerState, paginateList } = context.module.exports;

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

describe('paginateList', () => {
  const people = (count) => Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `队员${i + 1}` }));

  it('每页最多 5 人，末页不足正常展示不补假数据', () => {
    const model = paginateList(people(12), 0);
    expect(model.items).toHaveLength(5);
    expect(model).toMatchObject({ page: 0, pageCount: 3, total: 12, hasPrev: false, hasNext: true });
    const last = paginateList(people(12), 2);
    expect(last.items).toHaveLength(2);
    expect(last.items[0].name).toBe('队员11');
    expect(last).toMatchObject({ page: 2, hasPrev: true, hasNext: false });
  });

  it('不超过 5 人时直接全部展示，不出现翻页控件数据', () => {
    expect(paginateList(people(5), 0)).toMatchObject({ pageCount: 1, hasPrev: false, hasNext: false });
    expect(paginateList(people(5), 9).items).toHaveLength(5);
  });

  it('空名单与非数组输入返回空切片', () => {
    expect(paginateList([], 0).items).toEqual([]);
    expect(paginateList(undefined, 0)).toMatchObject({ items: [], total: 0, pageCount: 1 });
  });

  it('页码越界收敛到最后一页，非法页码回到第一页', () => {
    expect(paginateList(people(6), 9).page).toBe(1);
    expect(paginateList(people(6), -1).page).toBe(0);
    expect(paginateList(people(6), 'x').page).toBe(0);
  });
});
