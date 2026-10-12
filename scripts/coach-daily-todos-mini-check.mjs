import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 在 API 检查中验证原生页面控制器的请求竞争和导航，不替代微信真机验收。
export async function checkMiniDailyTodoFlow(assert) {
  let definition;
  let resolveOld;
  let resolveNew;
  const navigation = [];
  const app = { globalData: { selectedAthleteId: 0 } };
  const modules = {};
  const formatData = { module: { exports: {} } };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/data/format-data.js', import.meta.url), 'utf8'),
    formatData
  );
  const format = { module: { exports: {} }, require: () => formatData.module.exports };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/format.js', import.meta.url), 'utf8'),
    format
  );
  modules['../../utils/format'] = format.module.exports;
  const paginationContext = { module: { exports: {} } };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/pagination.js', import.meta.url), 'utf8'),
    paginationContext
  );
  modules['../../utils/pagination'] = paginationContext.module.exports;
  const viewContext = {
    module: { exports: {} },
    require: (path) => (path === './pagination' ? paginationContext.module.exports : format.module.exports),
  };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/daily-todos.js', import.meta.url), 'utf8'),
    viewContext
  );
  modules['../../utils/daily-todos'] = viewContext.module.exports;
  const todayStatusContext = { module: { exports: {} }, require: () => format.module.exports };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/today-status.js', import.meta.url), 'utf8'),
    todayStatusContext
  );
  modules['../../utils/today-status'] = todayStatusContext.module.exports;
  const dateContext = { module: { exports: {} } };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/date.js', import.meta.url), 'utf8'),
    dateContext
  );
  // 首页新增缺测展示依赖，加载真实模块，避免测试桩遗漏新导出。
  const strengthViewContext = {
    module: { exports: {} },
    require: (path) => {
      if (path === './format') return format.module.exports;
      if (path === './date') return dateContext.module.exports;
      throw new Error(`未预期依赖：${path}`);
    },
  };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/strength-view.js', import.meta.url), 'utf8'),
    strengthViewContext
  );
  const trainingEmptyContext = {
    module: { exports: {} },
    require: (path) => {
      if (path === './format') return format.module.exports;
      if (path === './strength-view') return strengthViewContext.module.exports;
      if (path === './pagination') return paginationContext.module.exports;
      throw new Error(`未预期依赖：${path}`);
    },
  };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/training-empty.js', import.meta.url), 'utf8'),
    trainingEmptyContext
  );
  modules['../../utils/training-empty'] = trainingEmptyContext.module.exports;
  const wellnessFormContext = { module: { exports: {} }, require: () => dateContext.module.exports };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/wellness-form.js', import.meta.url), 'utf8'),
    wellnessFormContext
  );
  modules['../../utils/wellness-form'] = wellnessFormContext.module.exports;
  const requests = [];
  const api = {
    dailyTodos: (project) => {
      requests.push(project);
      return new Promise((resolve) => {
        if (project === 'ROWING') resolveOld = resolve;
        else resolveNew = resolve;
      });
    },
  };
  modules['../../services/api'] = api;
  // index.js 依赖的图表占位模块没有页面外副作用，直接加载真实实现。
  const chartPlaceholder = { module: { exports: {} } };
  vm.runInNewContext(
    readFileSync(
      new URL('../WeChat Mini Program/utils/chart-placeholder.js', import.meta.url),
      'utf8'
    ),
    chartPlaceholder
  );
  modules['../../utils/chart-placeholder'] = chartPlaceholder.module.exports;
  // index.js 依赖的伤情指标视图模块没有页面外副作用，直接加载真实实现。
  const injuryFormContext = {
    module: { exports: {} },
    require: (path) => (path === './date' ? dateContext.module.exports : undefined),
  };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/injury-form.js', import.meta.url), 'utf8'),
    injuryFormContext
  );
  const injuryMetricContext = {
    module: { exports: {} },
    require: (path) => (path === './injury-form' ? injuryFormContext.module.exports : undefined),
  };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/injury-metric.js', import.meta.url), 'utf8'),
    injuryMetricContext
  );
  modules['../../utils/injury-metric'] = injuryMetricContext.module.exports;
  const scopeContext = {
    user: { role: 'SCC', athleteId: 0 },
    projects: ['ROWING', 'CANOE_SPRINT'],
    project: 'ROWING',
    athletes: [{ id: 1, project: 'ROWING' }],
    selectedAthleteId: 0,
  };
  modules['../../utils/context'] = {
    loadContext: async () => scopeContext,
    projectAthletes: (list) => list || [],
  };
  modules['../../utils/date'] = dateContext.module.exports;
  const requestGuard = { module: { exports: {} } };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/request-guard.js', import.meta.url), 'utf8'),
    requestGuard
  );
  modules['../../utils/request-guard'] = requestGuard.module.exports;
  const wxApi = {
    switchTab: (options) => navigation.push(options.url),
    showToast: () => {},
    showModal: () => {},
  };
  const pageActions = {
    module: { exports: {} },
    require: () => format.module.exports,
    getApp: () => app,
    wx: wxApi,
  };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/page-actions.js', import.meta.url), 'utf8'),
    pageActions
  );
  modules['../../utils/page-actions'] = pageActions.module.exports;
  // 统一加载骨架直接跑真实实现，避免只测到页面里的分支。
  const pageScope = {
    module: { exports: {} },
    getApp: () => app,
    require: (path) => {
      if (path === './date') return dateContext.module.exports;
      if (path === './context') return modules['../../utils/context'];
      if (path === './request-guard') return requestGuard.module.exports;
      if (path === './project-label') return { projectLabel: (project) => project };
      throw new Error(`未预期依赖：${path}`);
    },
  };
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/utils/page-scope.js', import.meta.url), 'utf8'),
    pageScope
  );
  modules['../../utils/page-scope'] = pageScope.module.exports;
  vm.runInNewContext(
    readFileSync(new URL('../WeChat Mini Program/pages/index/index.js', import.meta.url), 'utf8'),
    {
      Page: (page) => {
        definition = page;
      },
      require: (path) => modules[path],
      getApp: () => app,
      wx: wxApi,
    }
  );
  const page = {
    ...definition,
    data: { ...definition.data, canViewTodos: true, project: 'ROWING', athletes: [{ id: 1 }] },
    setData(values) {
      Object.assign(this.data, values);
    },
  };
  const todos = (name) => ({
    date: '2026-09-23',
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-23T02:00:00Z',
    windowStart: '2026-09-22T02:00:00Z',
    highLoadThreshold: 600,
    counts: { total: 1, submitted: 0, missing: 1, attention: 0, incompleteTime: 0, reviewDue: 0 },
    missing: [{ athleteId: 1, athleteName: name, team: '一队', project: page.data.project }],
    attention: [],
    incompleteTime: [],
    reviewDue: [],
  });
  const oldRequest = page.loadTodos('ROWING');
  page.data.project = 'CANOE_SPRINT';
  const newRequest = page.loadTodos('CANOE_SPRINT');
  resolveNew({ todos: todos('当前项目') });
  await newRequest;
  resolveOld({ todos: todos('过期项目') });
  await oldRequest;
  assert(page.data.todos.missing[0].athleteName === '当前项目', '旧项目响应不得覆盖当前待办');
  assert(
    page.data.focusRows[0].athleteName === '当前项目' && page.data.focusPager.total === 1,
    '当前项目的关注名单和人数应同步更新'
  );
  assert(!page.data.todosLoading && !page.data.todosError, '成功加载应结束等待状态');

  api.dailyTodos = async () => {
    throw new Error('待办暂时不可用');
  };
  const failedRetry = page.retryTodos();
  assert(page.data.focusRows.length === 0 && page.data.focusPager.total === 0, '重新加载必须立即清空旧关注名单与分页');
  await failedRetry;
  assert(
    page.data.todos === null && page.data.todosError === '待办暂时不可用',
    '失败不得显示旧名单或全部完成'
  );
  assert(page.data.focusRows.length === 0 && page.data.focusPager.total === 0 && !page.data.todosLoading, '待办失败不得保留旧关注名单与分页');
  api.dailyTodos = async () => ({
    todos: {
      ...todos('刷新后'),
      counts: { total: 1, submitted: 1, missing: 0, attention: 0, incompleteTime: 0, reviewDue: 0 },
      missing: [],
    },
  });
  await page.retryTodos();
  assert(page.data.todos.counts.missing === 0, '刷新后应反映已经填报');
  page.goToAthlete({ currentTarget: { dataset: { athleteId: 999 } } });
  assert(navigation.length === 0, '无候选权限的编号不得从待办导航');
  page.goToAthlete({ currentTarget: { dataset: { athleteId: 1 } } });
  assert(
    app.globalData.selectedAthleteId === 1 && navigation[0] === '/pages/profile/profile',
    '待办入口必须选中正确档案'
  );
  let loaded = false;
  page.loadPage = () => {
    loaded = true;
  };
  page.onShow();
  assert(loaded, '档案返回首页必须刷新');
  loaded = false;
  page._cacheAt = Date.now();
  page._cacheProject = 'ROWING';
  page._cacheDate = dateContext.module.exports.todayBeijing();
  page._cacheAthleteId = app.globalData.selectedAthleteId;
  page._cacheVersion = app.globalData.dataVersion || 0;
  app.globalData.currentProject = 'ROWING';
  page.onShow();
  assert(!loaded, '短时间重复显示首页不应全量重拉');
  app.globalData.homeNeedsRefresh = true;
  page.onShow();
  assert(loaded, '训练或档案变更后必须刷新首页');

  // 首页按人员合并关注原因；已跟进状态来自服务端，不模拟已移除的标记按钮。
  const richTodos = () => ({
    date: '2026-09-23',
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-23T02:00:00Z',
    windowStart: '2026-09-22T02:00:00Z',
    highLoadThreshold: 600,
    counts: { total: 2, submitted: 0, missing: 2, attention: 1, incompleteTime: 0, reviewDue: 1 },
    missing: [
      { athleteId: 1, athleteName: '王休息', team: '一队', project: 'ROWING' },
      { athleteId: 2, athleteName: '李复查', team: '一队', project: 'ROWING' },
    ],
    attention: [
      {
        athleteId: 1,
        athleteName: '王休息',
        team: '一队',
        project: 'ROWING',
        load24h: 0,
        highLoad: false,
        timeIncomplete: false,
        injury: null,
        restRequested: true,
      },
    ],
    incompleteTime: [],
    reviewDue: [
      {
        athleteId: 2,
        athleteName: '李复查',
        team: '一队',
        project: 'ROWING',
        reviewDate: '2026-09-24',
        dueIn: 1,
        injuryName: '膝部旧伤',
        bodyPart: '膝部',
        status: 'rehab',
        painScore: 2,
      },
    ],
  });
  api.dailyTodos = async () => ({ todos: richTodos() });
  page.data.project = 'ROWING';
  await page.retryTodos();
  assert(page.data.focusPager.total === 2, '同一运动员的多个关注来源应合并为一行');
  assert(page.data.focusRows[0].focusLabel === '未填报、状态关注', '关注名单应合并来源标签');
  assert(page.data.focusRows[0].focusReason.includes('自评需要休息'), '休息自评应拼入关注原因');
  assert(page.data.focusRows[1].focusReason.includes('1 天后复查'), '复查提醒应给出倒计时文案');
  api.dailyTodos = async () => ({ todos: { ...richTodos(), followedUp: [2] } });
  await page.retryTodos();
  assert(page.data.focusPager.total === 1 && page.data.focusRows[0].athleteId === 1, '服务端已跟进人员应从关注名单隐藏');
  api.dailyTodos = async () => ({ todos: { ...richTodos(), followedUp: [] } });
  await page.retryTodos();
  assert(page.data.focusPager.total === 2, '服务端撤销跟进后应重新进入关注名单');
  const pagedTodos = {
    ...todos('分页'),
    counts: { total: 6, submitted: 0, missing: 6, attention: 0, incompleteTime: 0, reviewDue: 0 },
    missing: Array.from({ length: 6 }, (_, index) => ({ athleteId: index + 1, athleteName: `测试人员${index + 1}`, team: index === 5 ? '二队' : '一队', project: 'ROWING' })),
  };
  api.dailyTodos = async () => ({ todos: pagedTodos });
  await page.retryTodos();
  assert(page.data.focusRows.length === 5 && page.data.focusPager.total === 6 && page.data.focusPager.hasNext, '关注名单每页最多展示五人');
  page.onPagerChange({ currentTarget: { dataset: { key: 'focus' } }, detail: { page: 1 } });
  assert(page.data.focusRows.length === 1 && page.data.focusRows[0].athleteId === 6 && !page.data.focusPager.hasNext, '末页展示真实剩余人员');
  page.data.teams = [{ id: 10, name: '一队' }, { id: 20, name: '二队' }];
  page.data.teamId = 20;
  await page.retryTodos();
  assert(page.data.focusPager.total === 1 && page.data.focusPager.page === 0 && page.data.focusRows[0].athleteId === 6, '队伍筛选应只保留对应人员并收敛页码');
  page.data.teams = [];
  page.data.teamId = 0;
  page.data.todoPagerPages = { team: 0, focus: 0 };
  page.data.canViewTodos = false;
  let forbiddenTodoCalls = 0;
  api.dailyTodos = async () => {
    forbiddenTodoCalls += 1;
    throw new Error('不应为运动员发起请求');
  };
  await page.loadTodos('ROWING');
  assert(forbiddenTodoCalls === 0, '无待办权限时不得发起待办请求');
  assert(requests.length === 2, '请求竞争场景应仅发起两个项目请求');

  // 运动员今日状态卡：本人接口、结果播报与失败时不得保留过期数据。
  const todayPayload = {
    date: '2026-09-23',
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-23T02:00:00Z',
    submitted: false,
    timeIncomplete: false,
    load24h: 0,
    source: null,
  };
  page.data.canSelfReport = true;
  api.todayStatus = async () => todayPayload;
  api.myWellness = async () => ({ date: '2026-09-23', record: null });
  await page.loadToday();
  assert(
    page.data.todayView.submittedLabel === '未填报' && page.data.wellnessView.filledLabel === '未填写',
    '今日状态卡应同时显示训练填报与恢复日报状态'
  );
  api.todayStatus = async () => ({
    ...todayPayload,
    submitted: true,
    load24h: 468,
    source: 'athlete_self_report',
  });
  api.myWellness = async () => ({
    date: '2026-09-23',
    record: {
      date: '2026-09-23',
      sleepHours: 7,
      morningPulse: 58,
      fatigueIndex: 4,
      status: 'normal',
      source: 'athlete_self_report',
    },
  });
  await page.loadToday();
  assert(
    page.data.todayView.submittedLabel === '已填报' && page.data.todayView.loadText === '468',
    '已填报时今日状态卡应显示服务端计算的负荷'
  );
  assert(page.data.wellnessView.filled === true, '已填写恢复日报后应显示已填写');
  api.todayStatus = async () => {
    throw new Error('今日状态暂时不可用');
  };
  await page.loadToday();
  assert(
    page.data.todayView === null && page.data.todayError === '今日状态暂时不可用',
    '今日状态失败不得保留过期数据'
  );
  page.data.canSelfReport = false;
  page.data.todayError = '';
  api.todayStatus = async () => {
    throw new Error('不应为非运动员发起今日状态请求');
  };
  await page.loadToday();
  assert(page.data.todayError === '', '非运动员不应请求本人今日状态');

  // 统一加载骨架：作用域、并行数据块、缓存标记与数据版本失效。
  page.loadPage = definition.loadPage;
  let overviewCalls = 0;
  api.overview = async () => {
    overviewCalls += 1;
    return {
      overview: {
        records: [],
        trainingAnalytics: {
          summary: { totalDurationMin: 60, physicalDurationMin: 60, specialDurationMin: 0 },
          days: [{ date: '2026-09-23', physicalDurationMin: 60, physicalLoad: 300 }],
        },
        meta: {},
      },
    };
  };
  api.overviewTeams = async () => ({ teams: [] });
  api.teamOverview = async () => ({ athletes: [] });
  api.dailyTodos = async () => ({ todos: todos('统一骨架') });
  const fullLoad = page.loadPage();
  assert(page.data.focusRows.length === 0 && page.data.focusPager.total === 0, '全量重新加载必须立即清空旧关注名单与分页');
  await fullLoad;
  assert(page.data.error === '' && !page.data.loading, '统一骨架应正常完成首页加载');
  assert(overviewCalls === 1, '统一骨架只发起一次总览加载');
  assert(page.data.todos && page.data.todos.missing.length === 1, '待办应随首页骨架并行加载');
  assert(page.data.metrics.length > 0 && page.data.trend.length === 14, '总览视图应写回指标与趋势');
  page.onShow();
  assert(overviewCalls === 1, '缓存新鲜时二次显示首页不重拉');
  app.globalData.dataVersion = (app.globalData.dataVersion || 0) + 1;
  let reloaded;
  page.loadPage = (...args) => {
    reloaded = definition.loadPage.apply(page, args);
    return reloaded;
  };
  page.onShow();
  assert(reloaded && typeof reloaded.then === 'function', '缓存失效应触发真实首页加载');
  await reloaded;
  assert(overviewCalls === 2, '数据版本变化后必须重新加载首页');
}
