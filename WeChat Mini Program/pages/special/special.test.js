import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./special.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('./special.wxml', import.meta.url), 'utf8');

function loadModule(url, mocks = {}) {
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
    JSON,
  });
  return module.exports;
}

const formatData = loadModule(new URL('../../data/format-data.js', import.meta.url));
const format = loadModule(new URL('../../utils/format.js', import.meta.url), { '../data/format-data': formatData });
const specialTestView = loadModule(new URL('../../utils/special-test-view.js', import.meta.url), { './format': format });

function makeEvents(count, resultsPerEvent) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    testDate: '2026-09-27',
    distanceM: 2000,
    results: Array.from({ length: resultsPerEvent }, (__, row) => ({
      crewName: `组合${row + 1}`,
      memberNames: [],
      attemptsMs: [55150],
      bestMs: 55150,
    })),
  }));
}

function loadPage() {
  let definition;
  vm.runInNewContext(pageSource, {
    Page(value) { definition = value; },
    wx: {},
    require(path) {
      if (path.includes('utils/special-test-view')) return specialTestView;
      return {};
    },
    getApp: () => ({ globalData: {} }),
    Date,
    Number,
    String,
    Array,
    Object,
    Error,
    Promise,
    JSON,
    Math,
  });
  return {
    page: {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(values) { Object.assign(this.data, values); },
    },
  };
}

describe('专项训练页测试成绩展示', () => {
  it('模板默认折叠：展开按钮与更早场次按需出现', () => {
    expect(templateSource).toContain('bindtap="onToggleTestEvent"');
    expect(templateSource).toContain('bindtap="onShowMoreTests"');
    expect(templateSource).toContain('item.expandLabel');
    expect(templateSource).toContain('specialTestsMoreCount');
    expect(templateSource).toContain('共 {{specialTestsTotal}} 场');
  });

  it('默认只显示最近 3 场，展开更早场次逐批追加', () => {
    const { page } = loadPage();
    // applyTestView 返回待 setData 的视图，与 loadWithGuard 的提交方式一致。
    page.setData(page.applyTestView({}, specialTestView.buildSpecialTestView({ events: makeEvents(8, 1) })));
    expect(page.data.specialTestsTotal).toBe(8);
    expect(page.data.specialTestsResultTotal).toBe(8);
    expect(page.data.specialTests).toHaveLength(3);
    expect(page.data.specialTestsMoreCount).toBe(5);

    page.onShowMoreTests();
    expect(page.data.specialTests).toHaveLength(6);
    expect(page.data.specialTestsMoreCount).toBe(2);

    page.onShowMoreTests();
    expect(page.data.specialTests).toHaveLength(8);
    expect(page.data.specialTestsMoreCount).toBe(0);
  });

  it('单场成绩可展开全部组合与每轮成绩后再收起', () => {
    const { page } = loadPage();
    page.setData(page.applyTestView({}, specialTestView.buildSpecialTestView({ events: makeEvents(1, 5) })));
    const event = page.data.specialTests[0];
    expect(event.results).toHaveLength(3);
    expect(event.moreResults).toHaveLength(2);
    expect(event.expanded).toBe(false);

    page.onToggleTestEvent({ currentTarget: { dataset: { index: 0 } } });
    expect(page.data.specialTests[0].expanded).toBe(true);

    page.onToggleTestEvent({ currentTarget: { dataset: { index: 0 } } });
    expect(page.data.specialTests[0].expanded).toBe(false);
  });
});
