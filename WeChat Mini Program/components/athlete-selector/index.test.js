import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadModule(path, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    module,
    require: (name) => dependencies[name],
  });
  return module.exports;
}

function createSelector(items) {
  const pagination = loadModule('../../utils/pagination.js');
  const view = loadModule('../../utils/athlete-selector-view.js', { './pagination': pagination });
  let definition;
  vm.runInNewContext(readFileSync(new URL('./index.js', import.meta.url), 'utf8'), {
    Component(value) { definition = value; },
    require: () => view,
  });
  let updates = 0;
  const component = {
    ...definition.methods,
    properties: { items },
    data: { ...definition.data },
    setData(patch) {
      if (++updates > 10) throw new Error('数据监听循环触发');
      Object.assign(this.data, patch);
      for (const [fields, observer] of Object.entries(definition.observers)) {
        if (fields.split(',').some((field) => Object.hasOwn(patch, field.trim()))) {
          observer.call(this);
        }
      }
    },
  };
  component.setData({ items });
  return component;
}

describe('运动员组件数据监听', () => {
  it('空列表初始化后结束刷新，不循环写入监听字段', () => {
    const component = createSelector([]);
    expect(component.data.isEmpty).toBe(true);
    expect(component.data.pager.total).toBe(0);
  });

  it('分页后搜索回到第一页，更新列表保留搜索词', () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, name: `运动员${index + 1}` }));
    const component = createSelector(items);
    component.onPageChange({ detail: { page: 1 } });
    expect(component.data.pageItems.map((item) => item.id)).toEqual([6, 7]);
    component.onSearchInput({ detail: { value: '运动员1' } });
    expect(component.data.pager.page).toBe(0);
    expect(component.data.pageItems.map((item) => item.id)).toEqual([1]);
    component.properties.items = items.slice(1);
    component.setData({ items: component.properties.items });
    expect(component.data.keyword).toBe('运动员1');
    expect(component.data.isEmpty).toBe(true);
  });
});
