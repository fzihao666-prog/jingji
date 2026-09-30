import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./training-entry.js', import.meta.url), 'utf8');

function emptyTrainingForm() {
  return JSON.parse(JSON.stringify({
    date: '2026-01-01', startTime: '', trainingType: '专项训练', intensityZone: 'U2', content: '',
    duration: '', distance: '', rpe: '5', averageHeartRate: '', maxHeartRate: '', averagePowerW: '', strokeRateSpm: '',
  }));
}
const templateSource = readFileSync(new URL('./training-entry.wxml', import.meta.url), 'utf8');

// 复用真实 form-draft，草稿键与暂存行为和线上一致。
const formDraft = (() => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../utils/form-draft.js', import.meta.url), 'utf8'), {
    module,
    exports: module.exports,
    require() { throw new Error('未预期的依赖'); },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    JSON,
  });
  return module.exports;
})();

function createDraftStorage() {
  const map = new Map();
  return {
    map,
    getStorageSync(key) { return map.has(key) ? map.get(key) : ''; },
    setStorageSync(key, value) { map.set(key, value); },
    removeStorageSync(key) { map.delete(key); },
  };
}

describe('训练填报页', () => {
  it('加载失败后提供明确重试按钮，不自动重放写操作', () => {
    expect(pageSource).toContain('retryLoad()');
    expect(pageSource).toContain('this.loadPage()');
    expect(templateSource).toContain('bindtap="retryLoad"');
    // 重试只重发读请求，不自动重放 save/delete
    expect(pageSource).not.toContain('retrySave');
    expect(pageSource).not.toContain('retryDelete');
  });

  it('删除期间禁用目标删除按钮并忽略相同 ID 的后续请求', () => {
    expect(pageSource).toContain('deletingId');
    expect(pageSource).toContain('if (this.data.deletingId === id) return;');
    expect(templateSource).toContain('disabled="{{deletingId === item.id}}"');
  });

  it('重复点击删除只派发一次请求', () => {
    let definition;
    const calls = [];
    const wx = {
      ...createDraftStorage(),
      showModal({ success }) { success({ confirm: true }); },
      showToast() {},
      pageScrollTo() {},
    };
    const api = {
      deleteMyTrainingSession(id) {
        calls.push(id);
        return Promise.resolve({ message: '已删除' });
      },
      myTrainingSessions() { return Promise.resolve({ sessions: [] }); },
    };
    vm.runInNewContext(pageSource, {
      Page(value) { definition = value; },
      wx,
      require(path) {
        if (path.includes('services/api')) return api;
        if (path.includes('utils/context')) return { loadContext: () => Promise.resolve({ user: { role: 'ATL' } }) };
        if (path.includes('utils/date')) return { todayBeijing: () => '2026-01-01' };
        if (path.includes('utils/form-draft')) return formDraft;
        return {};
      },
      getApp() { return { globalData: {} }; },
    });
    const page = {
      ...definition,
      data: { ...definition.data, deletingId: 0, sessions: [{ id: 1, editable: true }], editId: 0 },
      setData(values) { Object.assign(this.data, values); },
      loadPage() { return Promise.resolve(); },
      cancelEdit() {},
    };
    // 同时触发两次删除（模拟重复点击）
    page.deleteSession({ currentTarget: { dataset: { id: 1 } } });
    page.deleteSession({ currentTarget: { dataset: { id: 1 } } });
    // 等待微任务完成后检查
    return Promise.resolve().then(() => {
      expect(calls.length).toBeLessThanOrEqual(1);
    });
  });

  it('教练代填走运动员级接口，本人填报仍走 me 接口', async () => {
    const calls = [];
    let definition;
    const api = {
      myTrainingSessions() { calls.push('my:list'); return Promise.resolve({ sessions: [] }); },
      athleteTrainingSessions(id) { calls.push(`athlete:list:${id}`); return Promise.resolve({ sessions: [] }); },
      createMyTrainingSession() { calls.push('my:create'); return Promise.resolve({ session: { id: 1 } }); },
      createAthleteTrainingSession(id) { calls.push(`athlete:create:${id}`); return Promise.resolve({ session: { id: 2 } }); },
    };
    vm.runInNewContext(pageSource, {
      Page(value) { definition = value; },
      wx: { ...createDraftStorage(), showToast() {}, pageScrollTo() {}, showModal({ success }) { success({ confirm: true }); } },
      require(path) {
        if (path.includes('services/api')) return api;
        if (path.includes('utils/form-draft')) return formDraft;
        if (path.includes('utils/context')) {
          return {
            loadContext: () => Promise.resolve({
              user: { role: 'SCC' },
              projectAthletes: [{ id: 7, name: '测试' }, { id: 8, name: '测试二' }],
              selectedAthleteId: 7,
            }),
          };
        }
        if (path.includes('utils/date')) return { todayBeijing: () => '2026-01-01' };
        return {};
      },
      getApp() { return { globalData: {} }; },
    });
    const page = {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(values) { Object.assign(this.data, values); },
    };
    await page.loadPage();
    expect(calls).toContain('athlete:list:7');
    expect(page.data.isCoach).toBe(true);
    expect(page.data.athleteId).toBe(7);
    page.setData({ form: { ...page.data.form, content: '水上', duration: '90', rpe: '5' } });
    await page.save();
    expect(calls).toContain('athlete:create:7');
    expect(calls).not.toContain('my:create');
    expect(page.data.athleteOptions).toEqual(['测试', '测试二']);
  });

  it('进入页面发现未提交草稿时提示恢复，取消则丢弃草稿', async () => {
    const setup = ({ draft }) => {
      let definition;
      const modals = [];
      const storage = createDraftStorage();
      if (draft) {
        storage.setStorageSync(formDraft.draftKey('training-entry', 'me'), { savedAt: 1, data: draft });
      }
      const wx = {
        ...storage,
        showModal(options) { modals.push(options); },
        showToast() {},
        pageScrollTo() {},
      };
      vm.runInNewContext(pageSource, {
        Page(value) { definition = value; },
        wx,
        require(path) {
          if (path.includes('services/api')) return { myTrainingSessions: () => Promise.resolve({ sessions: [] }) };
          if (path.includes('utils/context')) return { loadContext: () => Promise.resolve({ user: { role: 'ATL' } }) };
          if (path.includes('utils/date')) return { todayBeijing: () => '2026-01-01' };
          if (path.includes('utils/form-draft')) return formDraft;
          return {};
        },
        getApp() { return { globalData: {} }; },
      });
      const page = {
        ...definition,
        data: JSON.parse(JSON.stringify(definition.data)),
        setData(values) { Object.assign(this.data, values); },
      };
      return { page, modals, storage };
    };

    const restored = setup({ draft: { ...emptyTrainingForm(), content: '草稿内容', duration: '60' } });
    await restored.page.loadPage();
    expect(restored.modals.length).toBe(1);
    restored.modals[0].success({ confirm: true });
    expect(restored.page.data.form.content).toBe('草稿内容');
    expect(restored.page.data.form.duration).toBe('60');

    const discarded = setup({ draft: { ...emptyTrainingForm(), content: '不要我', duration: '30' } });
    await discarded.page.loadPage();
    expect(discarded.modals.length).toBe(1);
    discarded.modals[0].success({ confirm: false });
    expect(discarded.page.data.form.content).toBe('');
    expect(formDraft.loadFormDraft(discarded.storage, 'training-entry', 'me')).toBe(null);
  });

  it('教练代填模板提供运动员选择器，本人模式不显示', () => {
    expect(templateSource).toContain('wx:if="{{isCoach}}"');
    expect(templateSource).toContain('bindchange="onAthleteChange"');
    expect(templateSource).toContain('bindtap="retryLoad"');
  });
});
