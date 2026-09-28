import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./training-entry.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('./training-entry.wxml', import.meta.url), 'utf8');

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
});
