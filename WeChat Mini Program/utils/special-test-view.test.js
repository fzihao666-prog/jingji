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

// 字典与格式化均加载真实文件，成绩展示口径与线上一致。
const formatData = load(new URL('../data/format-data.js', import.meta.url));
const format = load(new URL('./format.js', import.meta.url), {
  '../data/format-data': formatData,
});
const {
  EVENT_PREVIEW_COUNT,
  RESULT_PREVIEW_COUNT,
  buildTestEventView,
  buildSpecialTestView,
} = load(new URL('./special-test-view.js', import.meta.url), { './format': format });

function makeEvent(id, resultCount) {
  return {
    id,
    testDate: '2026-09-27',
    distanceM: 2000,
    boatClass: '八人单桨',
    genderGroup: '男子公开',
    session: '上午',
    windConditions: '顺风',
    location: '千岛湖',
    results: Array.from({ length: resultCount }, (_, index) => ({
      crewName: `组合${index + 1}`,
      memberNames: [`成员${index + 1}`],
      attemptsMs: [55150 + index * 100, 55300 + index * 100],
      bestMs: 55150 + index * 100,
      deltaPreviousMs: index === 0 ? -300 : index === 1 ? 200 : 0,
    })),
  };
}

describe('专项测试成绩展示视图', () => {
  it('标题、成绩与差值预先组装为字符串，差值带快慢语气', () => {
    const view = buildSpecialTestView({ events: [makeEvent(1, 1)] });
    expect(view.eventCount).toBe(1);
    expect(view.resultCount).toBe(1);
    const event = view.events[0];
    expect(event.title).toBe('2000 米 · 八人单桨 · 男子公开 · 上午');
    expect(event.testDate).toBe('2026-09-27');
    expect(event.meta).toBe('顺风 · 千岛湖');
    const row = event.results[0];
    expect(row.crewName).toBe('组合1');
    expect(row.memberText).toBe('成员1');
    expect(row.bestText).toBe('0:55.15');
    expect(row.attemptsText).toBe('0:55.15 / 0:55.30');
    expect(row.deltaText).toBe('较上次快 0.30s');
    expect(row.deltaTone).toBe('faster');
  });

  it('每场默认只预览最好 3 条，其余成绩进入折叠区', () => {
    const event = buildTestEventView(makeEvent(2, 5));
    expect(RESULT_PREVIEW_COUNT).toBe(3);
    expect(event.resultCount).toBe(5);
    expect(event.results).toHaveLength(3);
    expect(event.moreResults).toHaveLength(2);
    expect(event.moreCount).toBe(2);
    expect(event.expandLabel).toBe('展开其余 2 条成绩');
    expect(event.expanded).toBe(false);
  });

  it('成绩不超过预览条数时折叠区为空，展开用于查看每轮成绩', () => {
    const event = buildTestEventView(makeEvent(3, 2));
    expect(event.moreResults).toHaveLength(0);
    expect(event.moreCount).toBe(0);
    expect(event.expandLabel).toBe('查看每轮成绩');
  });

  it('空数据与缺字段事件安全降级', () => {
    expect(buildSpecialTestView(null)).toEqual({ events: [], eventCount: 0, resultCount: 0 });
    expect(buildSpecialTestView({})).toEqual({ events: [], eventCount: 0, resultCount: 0 });
    const event = buildTestEventView({ id: 9, results: null });
    expect(event.title).toBe('专项测试');
    expect(event.meta).toBe('');
    expect(event.resultCount).toBe(0);
  });

  it('事件列表保持接口返回顺序（最新在前）供页面截取默认场次', () => {
    expect(EVENT_PREVIEW_COUNT).toBe(3);
    const view = buildSpecialTestView({ events: [makeEvent(1, 1), makeEvent(2, 1), makeEvent(3, 1), makeEvent(4, 1)] });
    expect(view.events.map((event) => event.id)).toEqual([1, 2, 3, 4]);
  });
});
