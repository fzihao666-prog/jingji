import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function createFilter() {
  let definition;
  vm.runInNewContext(readFileSync(new URL('./index.js', import.meta.url), 'utf8'), {
    Component: (value) => { definition = value; },
    require: () => ({ projectOptions: () => [] }),
  });
  const events = [];
  const component = {
    ...definition.methods,
    data: { ...definition.data, athletes: [
      { id: 1, name: '张三', team: '一队' },
      { id: 2, name: '李四', team: '二队' },
      { id: 3, name: 'Alice', team: '一队' },
    ], athleteId: 1, allowAll: false, keyword: '' },
    setData(patch) {
      Object.assign(this.data, patch);
      if ('keyword' in patch) this.refresh();
    },
    refresh() {
      const { athletes, athleteId, allowAll, keyword } = this.data;
      definition.observers['athletes, athleteId, allowAll, keyword'].call(this, athletes, athleteId, allowAll, keyword);
    },
    triggerEvent: (type, detail) => events.push({ type, detail }),
  };
  component.refresh();
  return { component, events };
}

describe('运动员搜索无需父页面回写关键词', () => {
  it.each([['张', [1]], ['二队', [2]], [' ALICE ', [3]], ['', [1, 2, 3]]])('输入 %s 按姓名或队伍过滤', (keyword, expected) => {
    const { component, events } = createFilter();
    component.onKeywordInput({ detail: { value: keyword } });
    expect(component.data.athleteItems.map((item) => item.id)).toEqual(expected);
    expect(component.data.athleteId).toBe(1);
    expect(events).toEqual([{ type: 'keywordchange', detail: { value: keyword } }]);
  });

  it('无匹配不切换档案，清空后恢复名单，选择结果发出正确 ID', () => {
    const { component, events } = createFilter();
    component.onKeywordInput({ detail: { value: '不存在' } });
    expect(component.data.athleteItems).toEqual([]);
    component.onAthleteChange({ detail: { value: 0 } });
    expect(events.some((event) => event.type === 'athletechange')).toBe(false);
    component.onKeywordInput({ detail: { value: '' } });
    expect(component.data.athleteItems).toHaveLength(3);
    component.onKeywordInput({ detail: { value: '二队' } });
    component.onAthleteChange({ detail: { value: 0 } });
    expect(events.at(-1)).toEqual({ type: 'athletechange', detail: { value: 2 } });
  });
});


describe('搜索行添加入口', () => {
  it('只有启用添加入口时才发出添加事件', () => {
    const { component, events } = createFilter();
    component.onAddAthlete(); expect(events).toEqual([]);
    component.data.showAddAthlete = true;
    component.onAddAthlete(); expect(events).toEqual([{ type: 'addathlete', detail: undefined }]);
  });
});
