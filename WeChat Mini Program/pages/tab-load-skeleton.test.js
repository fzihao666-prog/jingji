import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadCjs(url, mocks, globals = {}) {
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
    ...globals,
  });
  return module.exports;
}

const dateModule = loadCjs(new URL('../utils/date.js', import.meta.url), {});
const formatModule = loadCjs(new URL('../utils/format.js', import.meta.url), {
  '../data/format-data': loadCjs(new URL('../data/format-data.js', import.meta.url), {}),
});
const requestGuard = loadCjs(new URL('../utils/request-guard.js', import.meta.url), {});
const chartPlaceholder = loadCjs(new URL('../utils/chart-placeholder.js', import.meta.url), {});
const paginationModule = loadCjs(new URL('../utils/pagination.js', import.meta.url), {});
const dailyTodosModule = loadCjs(new URL('../utils/daily-todos.js', import.meta.url), {
  './format': formatModule,
  './pagination': paginationModule,
});

const modals = [];
const toasts = [];
const tabs = [];
const wxStub = {
  showModal: (options) => modals.push(options),
  showToast: (options) => toasts.push(options.title),
  switchTab: (options) => tabs.push(options.url),
  navigateTo: () => {},
};
// 页面与 page-scope 都直接跑真实实现，只替换网络与小程序全局对象。
let activeApp = null;
const pageActions = loadCjs(
  new URL('../utils/page-actions.js', import.meta.url),
  { './format': formatModule },
  { wx: wxStub, getApp: () => activeApp }
);

const athlete = {
  id: 1,
  name: '样例队员',
  project: 'ROWING',
  team: '一队',
  birthDate: '2004-05-01',
};
const contextData = {
  user: { role: 'SCC', athleteId: 0 },
  project: 'ROWING',
  projects: ['ROWING'],
  athletes: [athlete],
  projectAthletes: [athlete],
  selectedAthleteId: 0,
};

// 页面与 page-scope 都直接跑真实实现，只替换网络与小程序全局对象。
const pageScope = loadCjs(
  new URL('../utils/page-scope.js', import.meta.url),
  {
    './date': dateModule,
    './request-guard': requestGuard,
    './project-label': { projectLabel: (project) => project === 'ROWING' ? '赛艇' : project },
    './context': {
      loadContext: async () => contextData,
      projectAthletes: (list) => list || [],
    },
  },
  { getApp: () => activeApp }
);

function createPageModule(url, api, extraMocks = {}) {
  let definition;
  const app = { globalData: { currentProject: 'ROWING', selectedAthleteId: 0, dataVersion: 0 } };
  activeApp = app;
  const mocks = {
    '../../services/api': api,
    '../../utils/page-scope': pageScope,
    '../../utils/request-guard': requestGuard,
    '../../utils/page-actions': pageActions,
    '../../utils/format': formatModule,
    '../../utils/project-label': { projectLabel: (project) => project === 'ROWING' ? '赛艇' : project },
    '../../utils/date': dateModule,
    '../../utils/chart-placeholder': chartPlaceholder,
    '../../utils/daily-todos': dailyTodosModule,
    ...extraMocks,
  };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    Page(value) {
      definition = value;
    },
    require(path) {
      if (Object.prototype.hasOwnProperty.call(mocks, path)) return mocks[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    getApp: () => app,
    wx: wxStub,
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
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) {
      Object.assign(this.data, values);
    },
  };
  return { page, app };
}

const profileApi = () => {
  const calls = { injuryRecords: 0 };
  return {
    calls,
    assetUrl: (value) => value || '',
    injuryRecords: async () => {
      calls.injuryRecords += 1;
      return { records: [] };
    },
    personalOverview: async () => ({
      overview: {
        strengthTests: [],
        meta: { sessionCount: 0, coverage: 100, testCount: 0, wellnessDays: 0 },
      },
    }),
    championBenchmark: async () => ({ benchmark: null }),
    saveCurrentProject: async () => {},
  };
};

const strengthApi = () => {
  const calls = { strengthTests: 0 };
  return {
    calls,
    strengthTests: async () => {
      calls.strengthTests += 1;
      return { tests: [] };
    },
    strengthTrainingResults: async () => ({ sessions: [] }),
    trainingPlans: async () => ({ plans: [] }),
    saveCurrentProject: async () => {},
  };
};

const specialApi = () => {
  const calls = { specialTrainingOverview: 0 };
  return {
    calls,
    overviewTeams: async () => ({ teams: [{ id: 10, name: '一队' }] }),
    specialChampionModels: async () => ({
      events: [{ eventCode: 'RM1x', eventName: '单人双桨', bestPerformance: '待核实' }],
    }),
    specialTrainingOverview: async () => {
      calls.specialTrainingOverview += 1;
      return {
        training: {
          summary: { durationMin: 120, distanceKm: 8, sessionCount: 2, load: 480 },
          days: [],
          intensity: [],
          content: [],
        },
        athletes: [],
      };
    },
    saveCurrentProject: async () => {},
  };
};

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('三个 Tab 共用统一加载骨架', () => {
  it('档案页完成作用域、视图与缓存标记，二次显示不重拉', async () => {
    const api = profileApi();
    const { page, app } = createPageModule(new URL('./profile/profile.js', import.meta.url), api);
    await page.loadPage();
    expect(page.data.error).toBe('');
    expect(page.data.loading).toBe(false);
    expect(page.data.project).toBe('ROWING');
    expect(page.data.athleteName).toBe('样例队员');
    expect(page.data.canReportRole).toBe(true);
    expect(page._cacheAt).toBeDefined();
    const first = api.calls.injuryRecords;
    page.onShow();
    await flushAsync();
    expect(api.calls.injuryRecords).toBe(first);
    app.globalData.dataVersion += 1;
    page.onShow();
    await flushAsync();
    expect(api.calls.injuryRecords).toBeGreaterThan(first);
  });

  it('体能页完成作用域、视图与缓存标记，二次显示不重拉', async () => {
    const api = strengthApi();
    const { page, app } = createPageModule(new URL('./strength/strength.js', import.meta.url), api);
    await page.loadPage();
    expect(page.data.error).toBe('');
    expect(page.data.athleteName).toBe('样例队员');
    expect(page.data.summaryCards.length).toBe(4);
    expect(page._cacheAthleteId).toBe(1);
    const first = api.calls.strengthTests;
    page.onShow();
    await flushAsync();
    expect(api.calls.strengthTests).toBe(first);
    app.globalData.dataVersion += 1;
    page.onShow();
    await flushAsync();
    expect(api.calls.strengthTests).toBeGreaterThan(first);
  });

  it('专项训练页完成作用域、视图与缓存标记，二次显示不重拉', async () => {
    const api = specialApi();
    const { page, app } = createPageModule(new URL('./special/special.js', import.meta.url), api);
    await page.loadPage();
    expect(page.data.error).toBe('');
    expect(page.data.showAthlete).toBe(false);
    expect(page.data.teamId).toBe(0);
    expect(page.data.teamItems.length).toBe(2);
    expect(page.data.championEvents[0].code).toBe('RM1x');
    const first = api.calls.specialTrainingOverview;
    page.onShow();
    await flushAsync();
    expect(api.calls.specialTrainingOverview).toBe(first);
    app.globalData.dataVersion += 1;
    page.onShow();
    await flushAsync();
    expect(api.calls.specialTrainingOverview).toBeGreaterThan(first);
  });
});

describe('共用的下钻与趋势明细工具', () => {
  it('趋势明细按字段生成弹窗文案', () => {
    modals.length = 0;
    const page = {
      data: { trend: [{ date: '2026-09-26', duration: 60, load: 300, distance: 8 }] },
    };
    pageActions.showTrendModal(
      page,
      { currentTarget: { dataset: { index: 0 } } },
      pageActions.durationLoadLines
    );
    expect(modals).toEqual([
      { title: '2026-09-26', content: '训练时长：60 分钟\n训练负荷：300 AU', showCancel: false },
    ]);
    expect(pageActions.durationDistanceLines(page.data.trend[0])).toEqual([
      '训练时长：60 分钟',
      '训练距离：8 km',
    ]);
    pageActions.showTrendModal(
      page,
      { currentTarget: { dataset: { index: 7 } } },
      pageActions.durationLoadLines
    );
    expect(modals).toHaveLength(1);
  });

  it('下钻只允许候选名单内的运动员', () => {
    toasts.length = 0;
    tabs.length = 0;
    activeApp = { globalData: { selectedAthleteId: 0 } };
    const page = { data: { athletes: [{ id: 1 }] } };
    pageActions.goToAthlete(
      page,
      { currentTarget: { dataset: { athleteId: 9 } } },
      page.data.athletes
    );
    expect(toasts).toEqual(['该运动员不在当前权限范围']);
    expect(activeApp.globalData.selectedAthleteId).toBe(0);
    expect(tabs).toEqual([]);
    pageActions.goToAthlete(
      page,
      { currentTarget: { dataset: { athleteId: 1 } } },
      page.data.athletes
    );
    expect(activeApp.globalData.selectedAthleteId).toBe(1);
    expect(tabs).toEqual(['/pages/profile/profile']);
  });
});
