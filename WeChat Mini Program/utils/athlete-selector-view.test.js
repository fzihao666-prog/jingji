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
const { filterAthleteItems, buildAthleteSelectorView } = context.module.exports;

const athletes = [
  { id: 1, name: '张三', meta: '男 · 18 岁 · 一队' },
  { id: 2, name: '李四', meta: '女 · 19 岁 · 二队', searchText: 'rowing' },
  { id: 3, name: '王五', meta: '男 · 20 岁 · 一队' },
  { id: 4, name: '赵六', meta: '男 · 18 岁 · 二队' },
  { id: 5, name: '钱七', meta: '女 · 17 岁 · 一队' },
  { id: 6, name: '孙八', meta: '男 · 21 岁 · 三队' },
  { id: 7, name: '周九', meta: '女 · 18 岁 · 三队' },
  { id: null, name: '无效行' },
];

describe('filterAthleteItems', () => {
  it('空关键词返回全部有效条目并丢弃无 id 行', () => {
    expect(filterAthleteItems(athletes, '').map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(filterAthleteItems(null, '')).toEqual([]);
  });
  it('按姓名与附加搜索文本模糊匹配', () => {
    expect(filterAthleteItems(athletes, '张').map((item) => item.id)).toEqual([1]);
    expect(filterAthleteItems(athletes, '一队').map((item) => item.id)).toEqual([1, 3, 5]);
    expect(filterAthleteItems(athletes, 'rowing').map((item) => item.id)).toEqual([2]);
    expect(filterAthleteItems(athletes, '不存在')).toEqual([]);
  });
});

describe('buildAthleteSelectorView', () => {
  it('超过 5 人分页且末页不补假数据', () => {
    const first = buildAthleteSelectorView(athletes, '', 0);
    expect(first.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(first.pager).toEqual({ page: 0, pageCount: 2, total: 7 });
    const last = buildAthleteSelectorView(athletes, '', 1);
    expect(last.items.map((item) => item.id)).toEqual([6, 7]);
    expect(last.pager).toEqual({ page: 1, pageCount: 2, total: 7 });
  });
  it('搜索后重新计算分页并可回到第 1 页', () => {
    const view = buildAthleteSelectorView(athletes, '一队', 1);
    expect(view.isEmpty).toBe(false);
    expect(view.pager).toEqual({ page: 0, pageCount: 1, total: 3 });
    expect(view.items.map((item) => item.id)).toEqual([1, 3, 5]);
  });
  it('无匹配时保留空态结构', () => {
    const view = buildAthleteSelectorView(athletes, '不存在', 0);
    expect(view.isEmpty).toBe(true);
    expect(view.items).toEqual([]);
    expect(view.pager).toEqual({ page: 0, pageCount: 1, total: 0 });
  });
});
