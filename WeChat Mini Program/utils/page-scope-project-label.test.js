import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadPageScope() {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./page-scope.js', import.meta.url), 'utf8'), {
    module,
    require(path) {
      const dependencies = {
        './date': { periodFor: () => ({ from: '2026-09-01', to: '2026-09-28' }), todayBeijing: () => '2026-09-28' },
        './context': { projectAthletes: () => [], loadContext: async () => ({}) },
        './request-guard': {},
        './project-label': {
          projectLabel: (project) => ({ ROWING: '赛艇' })[project] || project,
          projectOptions: (projects) => projects.map((code) => ({ code, label: code === 'ROWING' ? '赛艇' : code })),
        },
      };
      if (dependencies[path]) return dependencies[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    Number,
  });
  return module.exports;
}

describe('页面项目作用域', () => {
  it('为展示提供中文标签和带标签的选项，同时保留项目代码', () => {
    const { createInitialScope } = loadPageScope();

    const scope = createInitialScope({
      user: { role: 'SCC' },
      project: 'ROWING',
      projects: ['ROWING'],
      athletes: [],
      selectedAthleteId: 0,
    });

    expect(scope.project).toBe('ROWING');
    expect(scope.projectLabel).toBe('赛艇');
  });
});
