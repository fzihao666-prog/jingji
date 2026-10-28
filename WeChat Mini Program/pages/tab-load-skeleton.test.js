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
    Intl: undefined,
    ...globals,
  });
  return module.exports;
}

const dateModule = loadCjs(new URL('../utils/date.js', import.meta.url), {});
const formatModule = loadCjs(new URL('../utils/format.js', import.meta.url), {
  '../data/format-data': loadCjs(new URL('../data/format-data.js', import.meta.url), {}),
});
const requestGuard = loadCjs(new URL('../utils/request-guard.js', import.meta.url), {});
const strengthView = loadCjs(new URL('../utils/strength-view.js', import.meta.url), {
  './format': formatModule,
  './date': dateModule,
});
const chartPlaceholder = loadCjs(new URL('../utils/chart-placeholder.js', import.meta.url), {});
const paginationModule = loadCjs(new URL('../utils/pagination.js', import.meta.url), {});
// 专项测试成绩展示视图与线上共用真实实现。
const specialTestView = loadCjs(new URL('../utils/special-test-view.js', import.meta.url), {
  './format': formatModule,
});
const dailyTodosModule = loadCjs(new URL('../utils/daily-todos.js', import.meta.url), {
  './format': formatModule,
  './pagination': paginationModule,
});
// 损伤情况卡片与线上共用真实视图模型。
const injuryMetricModule = loadCjs(new URL('../utils/injury-metric.js', import.meta.url), {
  './injury-form': loadCjs(new URL('../utils/injury-form.js', import.meta.url), { './date': dateModule }),
});
// 档案页图表模块与线上共用真实视图模型与雷达绘制工具。
const profileViews = loadCjs(new URL('../utils/profile-views.js', import.meta.url), {
  './format': formatModule,
}, { Map });
const radarChartModule = loadCjs(new URL('../utils/radar-chart.js', import.meta.url), {});

const modals = [];
const toasts = [];
const tabs = [];
const wxStub = {
  showModal: (options) => modals.push(options),
  showToast: (options) => toasts.push(options.title),
  switchTab: (options) => tabs.push(options.url),
  navigateTo: () => {},
  nextTick: (fn) => fn(),
  createSelectorQuery: () => {
    const query = { in: () => query, select: () => query, fields: () => query, exec: (callback) => callback([]) };
    return query;
  },
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
    '../../data/register-data': loadCjs(new URL('../data/register-data.js', import.meta.url), {}),
    '../../utils/page-scope': pageScope,
    '../../utils/request-guard': requestGuard,
    '../../utils/page-actions': pageActions,
    '../../utils/format': formatModule,
    '../../utils/strength-view': strengthView,
    '../../utils/training-empty': loadCjs(new URL('../utils/training-empty.js', import.meta.url), { './format': formatModule, './strength-view': strengthView, './pagination': paginationModule }),
    '../../utils/project-label': { projectLabel: (project) => project === 'ROWING' ? '赛艇' : project },
    '../../utils/date': dateModule,
    '../../utils/chart-placeholder': chartPlaceholder,
    '../../utils/daily-todos': dailyTodosModule,
    '../../utils/pagination': paginationModule,
    '../../utils/injury-metric': injuryMetricModule,
    '../../utils/profile-views': profileViews,
    '../../utils/body-composition-groups': loadCjs(new URL('../utils/body-composition-groups.js', import.meta.url), {
      './format': formatModule,
    }),
    '../../utils/training-comparison-groups': loadCjs(new URL('../utils/training-comparison-groups.js', import.meta.url), {
      './format': formatModule,
    }),
    '../../utils/radar-chart': radarChartModule,
    '../../utils/special-test-view': specialTestView,
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
    Intl: undefined,
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
    athleteCreateOptions: async () => ({ teams: [] }),
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
    physicalChampion: async () => ({ groups: [], measurements: [], pendingReason: '当前项目参考待配置' }),
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

  it('体能页历史筛选可跨越当前周期，清除后回到周期记录', async () => {
    const api = strengthApi();
    api.strengthTrainingResults = async () => ({ sessions: [
      { id: 1, trainingDate: '2000-01-01', sets: [{ id: 11, exerciseName: '深蹲', actualReps: 8, completed: true }] }
    ] });
    api.strengthTests = async () => ({ tests: [{ id: 1, testDate: '2000-01-01', metrics: { squatKg: 80 } }] });
    const { page } = createPageModule(new URL('./strength/strength.js', import.meta.url), api);
    await page.loadPage();
    expect(page.data.records).toEqual([]);
    page.onRecordDate({ detail: { value: '2000-01-01' } });
    expect(page.data.records).toHaveLength(1);
    page.toggleRecord({ currentTarget: { dataset: { id: '1' } } });
    expect(page.data.records[0].sets[0].name).toBe('深蹲');
    page.clearRecordDate();
    expect(page.data.records).toEqual([]);
    expect(page.data.metricHistory).toEqual([]);
    page.onMetricRange({ detail: { value: '1' } });
    expect(page.data.metricHistory[0].value).toBe('80');
    page.onMetricRange({ detail: { value: '0' } });
    expect(page.data.metricHistory).toEqual([]);
  });

  it('体能页丢弃过期响应，不把上一运动员的缓存源带入详情', async () => {
    const api = strengthApi();
    const { page } = createPageModule(new URL('./strength/strength.js', import.meta.url), api);
    await page.loadPage();
    const currentSource = page._source;
    expect(await page.loadPageData(page.data, () => false)).toBeNull();
    expect(page._source).toBe(currentSource);
    api.strengthTrainingResults = async () => { throw new Error('网络不可用'); };
    await page.loadPage();
    expect(page._source.sessions).toEqual([]);
    expect(page.data.trainingError).toBe('网络不可用');
    expect(page.data.error).toBe('');
    expect(page.data.records).toEqual([]);
    expect(page.data.summaryCards.every((row) => row.value === '--')).toBe(true);
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

it.each(['CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])('%s专项页保留公共训练量，跳过水上专属请求并保留不同强度体系', async project => {
  const api = specialApi();
  let waterCalls = 0;
  api.specialTests = async () => { waterCalls += 1; return {}; };
  api.specialChampionModels = async () => { waterCalls += 1; return {}; };
  api.specialTrainingOverview = async () => ({ training: { summary: { durationMin: 90, sessionCount: 3 }, intensity: [
    { name: 'U_SYSTEM · AT', durationMin: 30 }, { name: 'UT_SYSTEM · AT', durationMin: 45 }, { name: '未知体系 · AT', durationMin: 15 }, { name: '未知体系 · Z9', durationMin: null },
  ] }, athletes: [] });
  const { page } = createPageModule(new URL('./special/special.js', import.meta.url), api);
  const view = await page.loadPageData({ project, from: '2026-10-01', to: '2026-10-10', teamId: 0 }, true, () => true);
  expect(view.hasWaterSpecial).toBe(false);
  expect(waterCalls).toBe(0);
  expect(view.specialTests).toEqual([]);
  expect(view.championEvents).toEqual([]);
  expect(view.metrics[0].value).toBe('1.5');
  expect(view.intensity.map(row => row.name)).toEqual(['U_SYSTEM · AT', 'UT_SYSTEM · AT', '未知体系 · AT', '未知体系 · Z9']);
  expect(view.intensity[3].value).toBe('-- min');
  expect(view.intensity[1].percentage).toBe(50);
});

it('档案页展示当前运动员实测与队内参考来源版本，过滤他人，不生成综合分', async () => {
  const api = profileApi();
  let args;
  api.physicalChampion = async (...values) => { args = values; return { project: 'ROWING', pendingReason: '无已审核综合方法', groups: [{ id: 'team', references: [], athletes: [{ athleteId: 1, dimensions: [{ key: 'jump', value: 0, achievedPercent: 0, referenceVersion: 3, testDate: '2026-10-05', factMeasurementId: 11, appliedReference: { label: '纵跳', value: 45, unit: 'cm', sourceNature: 'team', sourceNote: '队内实测标准', version: 3, dimensionVersion: 'jump-v2', protocol: 'CMJ' } }] }, { athleteId: 2, dimensions: [{ key: 'private', value: 99 }] }] }], measurements: [{ athleteId: 1, measurementId: 11, code: 'jump', value: 0, unit: 'cm' }, { athleteId: 2, measurementId: 22, code: 'private', value: 99 } ] }; };
  const { page } = createPageModule(new URL('./profile/profile.js', import.meta.url), api);
  const scope = { selectedAthleteId: 1, athletes: [athlete], project: 'ROWING', from: '2026-10-01', to: '2026-10-10' };
  const view = await page.loadPageData(scope, () => true);
  expect(args).toEqual(['ROWING', scope.from, scope.to]);
  expect(view.physicalReferenceRows).toHaveLength(1);
  expect(view.physicalReferenceRows[0]).toMatchObject({ value: '0', achieved: '0', source: '队内参考 · 队内实测标准', version: '参考v3 · 维度jump-v2' });
  expect(view.physicalReferenceNote).toBe('无已审核综合方法');
  expect(await page.loadPageData(scope, () => false)).toBeNull();
});

it('档案项目参考失败保持其他模块可用，无标准时保留原始实测与待配置原因', async () => {
  const api = profileApi();
  api.physicalChampion = async () => { throw new Error('参考服务暂不可用'); };
  const { page } = createPageModule(new URL('./profile/profile.js', import.meta.url), api);
  const scope = { selectedAthleteId: 1, athletes: [athlete], project: 'VOLLEYBALL', from: '2026-10-01', to: '2026-10-10' };
  const failed = await page.loadPageData(scope, () => true);
  expect(failed.athleteName).toBe(athlete.name);
  expect(failed.physicalReferenceError).toBe('参考服务暂不可用');
  api.physicalChampion = async () => ({ athletePendingReasons: [{ athleteId: 1, reason: '项目参考维度待配置' }], measurements: [{ athleteId: 1, measurementId: 1, code: 'vertical_jump_cm', value: 40, unit: 'cm', date: '2026-10-05', protocol: 'CMJ' }], groups: [] });
  const pending = await page.loadPageData(scope, () => true);
  expect(pending.physicalReferenceNote).toBe('项目参考维度待配置');
  expect(pending.physicalReferenceRows[0]).toMatchObject({ value: '40', source: '待配置', reference: '--', achieved: '--' });
});
