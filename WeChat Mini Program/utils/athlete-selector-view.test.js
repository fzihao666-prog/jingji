import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const paginationContext = { module: { exports: {} } };
vm.runInNewContext(
  readFileSync(new URL('./pagination.js', import.meta.url), 'utf8'),
  paginationContext
);
const context = {
  module: { exports: {} },
  require: () => paginationContext.module.exports,
};
vm.runInNewContext(
  readFileSync(new URL('./athlete-selector-view.js', import.meta.url), 'utf8'),
  context
);
const { normalizeAthleteItems, buildAthleteSelectorView } = context.module.exports;

const athletes = [
  { id: 1, name: '张三', meta: '男 · 18 岁 · 一队' },
  { id: 2, name: '李四', meta: '女 · 19 岁 · 二队' },
  { id: 3, name: '王五', meta: '男 · 20 岁 · 一队' },
  { id: 4, name: '赵六', meta: '男 · 18 岁 · 二队' },
  { id: 5, name: '钱七', meta: '女 · 17 岁 · 一队' },
  { id: 6, name: '孙八', meta: '男 · 21 岁 · 三队' },
  { id: 7, name: '周九', meta: '女 · 18 岁 · 三队' },
  { id: null, name: '无效行' },
];

describe('normalizeAthleteItems', () => {
  it('返回全部有效条目并丢弃无 id 行', () => {
    expect(normalizeAthleteItems(athletes).map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(normalizeAthleteItems(null)).toEqual([]);
  });
});

describe('buildAthleteSelectorView', () => {
  it('超过 5 人分页且末页不补假数据', () => {
    const first = buildAthleteSelectorView(athletes, 0);
    expect(first.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(first.pager).toEqual({ page: 0, pageCount: 2, total: 7 });
    const last = buildAthleteSelectorView(athletes, 1);
    expect(last.items.map((item) => item.id)).toEqual([6, 7]);
    expect(last.pager).toEqual({ page: 1, pageCount: 2, total: 7 });
  });
  it('空名单保留空态结构', () => {
    const view = buildAthleteSelectorView([], 0);
    expect(view.isEmpty).toBe(true);
    expect(view.items).toEqual([]);
    expect(view.pager).toEqual({ page: 0, pageCount: 1, total: 0 });
  });
});
