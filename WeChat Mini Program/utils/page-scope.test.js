import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 8, 24, 12])); }
}
const dateContext = { module: { exports: {} }, Date: FixedDate };
vm.runInNewContext(readFileSync(new URL('./date.js', import.meta.url), 'utf8'), dateContext);
const guardContext = { module: { exports: {} }, Date: FixedDate, Error };
vm.runInNewContext(readFileSync(new URL('./request-guard.js', import.meta.url), 'utf8'), guardContext);
const miniApp = { globalData: { pendingProject: 'C', currentProject: '赛艇', selectedAthleteId: 1, dataVersion: 0 } };
const contextCalls = [];
let nextContext;
const scopeContext = {
  module: { exports: {} },
  getApp: () => miniApp,
  Error,
  require: (path) => {
    if (path === './date') return dateContext.module.exports;
    if (path === './request-guard') return guardContext.module.exports;
    if (path === './project-label') return { projectLabel: (project) => project };
    if (path === './context') {
      return {
        loadContext: async (options) => {
          contextCalls.push(options || {});
          return nextContext;
        },
        projectAthletes: (list, project) => (list || []).filter((item) => !item.project || item.project === project),
      };
    }
    throw new Error(`未预期依赖：${path}`);
  },
};
vm.runInNewContext(readFileSync(new URL('./page-scope.js', import.meta.url), 'utf8'), scopeContext);
const scopeModule = scopeContext.module.exports;

const { createInitialScope, changeScope, resolveAthlete, resolveDateRange, saveProjectInOrder, isPageCacheFresh, markPageCacheLoaded } = scopeModule;
const athletes = [{ id: 1, project: '赛艇' }, { id: 2, project: '皮划艇' }];
const context = (user) => ({ user, projects: ['赛艇', '皮划艇'], project: '赛艇', athletes, selectedAthleteId: 2 });

describe('page scope', () => {
  it('短时间切回同一项目和运动员时复用数据', () => {
    const page = { data: { project: '赛艇', selectedAthleteId: 1, error: '' } };
    markPageCacheLoaded(page);
    expect(isPageCacheFresh(page)).toBe(true);
    miniApp.globalData.dataVersion = 1;
    expect(isPageCacheFresh(page)).toBe(false);
    miniApp.globalData.dataVersion = 0;
  });
  it('ATL 默认且始终锁定本人', () => {
    const scope = createInitialScope(context({ role: 'ATL', athleteId: 1 }), { selectedAthleteId: 2 });
    expect(scope.selectedAthleteId).toBe(1);
    expect(scope.showAthlete).toBe(false);
    expect(changeScope(scope, athletes, 'athleteId', 2).selectedAthleteId).toBe(1);
  });
  it('管理角色允许选择有效运动员，非法 ID 回落', () => {
    const scope = createInitialScope(context({ role: 'SCC' }));
    expect(scope.selectedAthleteId).toBe(1);
    expect(scope.showAthlete).toBe(true);
    expect(resolveAthlete(scope.user, scope.athletes, 999)).toBe(1);
  });
  it('切换项目后旧运动员无效时重新选择', () => {
    const scope = createInitialScope(context({ role: 'SCC' }));
    expect(changeScope(scope, athletes, 'project', '皮划艇').selectedAthleteId).toBe(2);
  });
  it('日周月分别覆盖 1、7、30 天', () => {
    expect(resolveDateRange('day')).toEqual({ range: 'day', from: '2026-09-24', to: '2026-09-24' });
    expect(resolveDateRange('week')).toEqual({ range: 'week', from: '2026-09-18', to: '2026-09-24' });
    expect(resolveDateRange('month')).toEqual({ range: 'month', from: '2026-08-26', to: '2026-09-24' });
  });
  it('连续项目保存按选择顺序执行', async () => {
    const page = {};
    const saved = [];
    const save = async (project) => { saved.push(project); };
    await Promise.all([
      saveProjectInOrder(page, 'A', save),
      saveProjectInOrder(page, 'B', save),
      saveProjectInOrder(page, 'C', save)
    ]);
    expect(saved).toEqual(['A', 'B', 'C']);
  });

  function createLoadPage(extra = {}) {
    const page = {
      data: { loading: false, error: '旧错误', range: 'month' },
      setData(values) { Object.assign(this.data, values); },
      ...extra,
    };
    return page;
  }

  it('统一加载骨架依次完成上下文、作用域、数据与缓存标记', async () => {
    nextContext = context({ role: 'SCC' });
    const page = createLoadPage({
      loadPageData: async (scope) => ({ athleteName: scope.project }),
    });
    await scopeModule.loadPage(page, {
      error: '加载失败',
      scope: { range: 'week' },
      refreshUser: true,
    });
    expect(contextCalls[contextCalls.length - 1]).toEqual({ refreshUser: true });
    expect(page.data.project).toBe('赛艇');
    expect(page.data.range).toBe('week');
    expect(page.data.athleteName).toBe('赛艇');
    expect(page.data.loading).toBe(false);
    expect(page.data.error).toBe('');
    expect(isPageCacheFresh(page)).toBe(true);
  });

  it('加载失败时回填错误且不标记缓存', async () => {
    nextContext = context({ role: 'SCC' });
    const page = createLoadPage({
      loadPageData: async () => { throw new Error('网络异常'); },
    });
    await scopeModule.loadPage(page, { error: '兜底错误' });
    expect(page.data.error).toBe('网络异常');
    expect(page.data.loading).toBe(false);
    expect(page._cacheAt).toBeUndefined();
  });

  it('prepare 与自定义 load 支持页面自带数据块', async () => {
    nextContext = context({ role: 'SCC' });
    const calls = [];
    const page = createLoadPage();
    await scopeModule.loadPage(page, {
      error: '加载失败',
      prepare: (target, scope) => { target.setData({ ...scope, extra: 1 }); calls.push('prepare'); },
      load: async (target, scope, isLatest) => {
        calls.push(`load:${scope.project}:${isLatest()}`);
        return { athleteName: '自定义' };
      },
    });
    expect(calls).toEqual(['prepare', 'load:赛艇:true']);
    expect(page.data.extra).toBe(1);
    expect(page.data.athleteName).toBe('自定义');
    expect(isPageCacheFresh(page)).toBe(true);
  });
});
