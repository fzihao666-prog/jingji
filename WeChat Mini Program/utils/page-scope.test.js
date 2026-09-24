import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 8, 24, 12])); }
}
const dateContext = { module: { exports: {} }, Date: FixedDate };
vm.runInNewContext(readFileSync(new URL('./date.js', import.meta.url), 'utf8'), dateContext);
const scopeContext = {
  module: { exports: {} },
  getApp: () => ({ globalData: { pendingProject: 'C' } }),
  require: (path) => path === './date' ? dateContext.module.exports : {
    projectAthletes: (list, project) => (list || []).filter((item) => !item.project || item.project === project)
  }
};
vm.runInNewContext(readFileSync(new URL('./page-scope.js', import.meta.url), 'utf8'), scopeContext);
const scopeModule = scopeContext.module.exports;

const { createInitialScope, changeScope, resolveAthlete, resolveDateRange, saveProjectInOrder } = scopeModule;
const athletes = [{ id: 1, project: '赛艇' }, { id: 2, project: '皮划艇' }];
const context = (user) => ({ user, projects: ['赛艇', '皮划艇'], project: '赛艇', athletes, selectedAthleteId: 2 });

describe('page scope', () => {
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
});
