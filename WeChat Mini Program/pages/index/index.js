const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { shortDate } = require('../../utils/date');
const { number, INJURY_LABELS } = require('../../utils/format');
const { durationLoadLines, showTrendModal, goToAthlete: navigateToAthlete } = require('../../utils/page-actions');
const { dailyTodoView, filterDailyTodos } = require('../../utils/daily-todos');
const { paginateList, PAGE_SIZE } = require('../../utils/pagination');
const { todayStatusView, todayStatusSummary } = require('../../utils/today-status');
const { wellnessRecordView } = require('../../utils/wellness-form');
const { displaySeries, trendPlaceholder, ratioPlaceholder, physiologyPlaceholder } = require('../../utils/chart-placeholder');

// 待办卡内需要分页的四个分组（已跟进区单独处理）。
const TODO_PAGED_GROUPS = ['missing', 'attention', 'review', 'incompleteTime'];

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return valid.length ? sum(valid) / valid.length : null;
}

function buildView(overview) {
  const records = overview.records || [];
  const analytics = overview.trainingAnalytics || { summary: {}, days: [] };
  const summary = analytics.summary || {};
  const totalDuration = summary.totalDurationMin;
  const physicalDuration = summary.physicalDurationMin;
  const specialDuration = summary.specialDurationMin;
  const fatigue = average(records.map((item) => item.fatigueIndex));
  const highFatigue = new Set(records.filter((item) => Number(item.fatigueIndex) >= 7).map((item) => item.athleteId)).size;
  const totalSrpe = sum(records.map((item) => item.srpe));
  const loadRatio = overview.trainingLoadRatio || {};
  const injuries = overview.injuries || [];
  const activeInjuries = injuries.filter((item) => item.status !== 'healthy').map((item) => ({
    ...item,
    statusLabel: INJURY_LABELS[item.status] || item.status || '需关注'
  }));

  const metrics = [
    {
      label: '训练时长', value: totalDuration === null || totalDuration === undefined ? '—' : number(totalDuration / 60), unit: totalDuration == null ? '' : '小时',
      note: `体能 ${physicalDuration == null ? '—' : number(physicalDuration / 60)}h · 专项 ${specialDuration == null ? '—' : number(specialDuration / 60)}h`, tone: ''
    },
    {
      label: '训练负荷', value: number(loadRatio.totalLoad || totalSrpe, 0), unit: 'AU',
      note: `体能 ${number(loadRatio.physicalLoad || 0, 0)} · 专项 ${number(loadRatio.specialLoad || 0, 0)}`, tone: 'tone-orange'
    },
    {
      label: '疲劳指数', value: fatigue === null ? '—' : number(fatigue), unit: fatigue === null ? '' : '分',
      note: fatigue === null ? '暂无疲劳记录' : `疲劳偏高 ${highFatigue} 人`, tone: 'tone-teal'
    },
    {
      label: '损伤情况', value: number(activeInjuries.length, 0), unit: '人',
      note: activeInjuries.length ? `观察 ${activeInjuries.filter((item) => item.status === 'observation').length}人 · 受限/康复/停训 ${activeInjuries.filter((item) => ['restricted', 'rehab', 'suspended'].includes(item.status)).length}人` : '当前无活动性损伤', tone: 'tone-green'
    }
  ];

  const days = (analytics.days || []).slice(-14);
  const maxDuration = Math.max(1, ...days.map((item) => Number(item.physicalDurationMin || 0) + Number(item.specialDurationMin || 0)));
  const maxLoad = Math.max(1, ...days.map((item) => Number(item.physicalLoad || 0) + Number(item.specialLoad || 0)));
  const trend = days.map((item) => {
    const duration = Number(item.physicalDurationMin || 0) + Number(item.specialDurationMin || 0);
    const load = Number(item.physicalLoad || 0) + Number(item.specialLoad || 0);
    return {
      date: item.date,
      label: shortDate(item.date),
      duration,
      load,
      ariaLabel: `${item.date}，训练时长${duration}分钟，训练负荷${load}AU`,
      durationHeight: Math.max(2, Math.round(duration / maxDuration * 100)),
      loadHeight: Math.max(2, Math.round(load / maxLoad * 100))
    };
  });

  const intensity = (overview.intensityDistribution || []).filter((item) => Number(item.durationMin) > 0).map((item) => ({
    name: item.zone,
    value: `${number(item.durationMin, 0)} min`,
    percentage: number(item.percentage),
    width: Math.max(1, Math.min(100, Number(item.percentage) || 0))
  }));
  const trendDisplay = displaySeries(trend, trendPlaceholder('overview'), trend.some((item) => item.duration > 0 || item.load > 0));
  const intensityDisplay = displaySeries(intensity, ratioPlaceholder(['U3', 'U2', 'U1', 'AT'], 'min'));

  const physiologyHeatmap = overview.physiologyHeatmap
    ? {
        metrics: (overview.physiologyHeatmap.metrics || []).map(m => {
          const days = (m.days || []).map(d => ({
            date: d.date,
            dateLabel: String(d.date || '').slice(5).replace('-', '/'),
            status: d.status,
            statusClass: String(d.status || '').toLowerCase(),
            median: d.median,
            sampleCount: d.sampleCount,
            abnormalRateChange: d.abnormalRateChange,
            isEstimated: d.isEstimated
          }));
          const trend = (m.trend || []).map(p => ({
            date: p.date,
            dateLabel: String(p.date || '').slice(5).replace('-', '/'),
            value: p.value,
            status: p.status,
            statusClass: String(p.status || '').toLowerCase()
          }));
          // 计算迷你图的折线坐标（viewBox 100x30）
          let sparkPoints = '';
          if (trend.length >= 2) {
            const values = trend.map(p => p.value);
            const minV = Math.min(...values);
            const maxV = Math.max(...values);
            const rangeV = maxV - minV || 1;
            sparkPoints = trend.map((p, i) => {
              const x = (i / (trend.length - 1)) * 100;
              const y = 28 - ((p.value - minV) / rangeV) * 26 + 1;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
          }
          const summary = m.summary || {};
          const statusLabelMap = { NORMAL: '正常', FLUCTUATION: '波动', ATTENTION: '关注', ABNORMAL: '异常', MISSING: '未监测' };
          const latest = summary.latest;
          return {
            code: m.code,
            label: m.label,
            unit: m.unit,
            direction: m.direction || 'higher',
            days,
            trend,
            heatDates: days.map((d) => d.dateLabel),
            sparkPoints,
            hasSpark: trend.length >= 2,
            summary: {
              latestValue: latest ? latest.value : null,
              latestDate: latest ? String(latest.date).slice(5).replace('-', '/') : null,
              latestStatus: latest ? latest.status : 'MISSING',
              latestStatusClass: latest ? String(latest.status).toLowerCase() : 'missing',
              latestStatusLabel: latest ? (statusLabelMap[latest.status] || latest.status) : '无数据',
              trendDirection: summary.trendDirection || 'stable',
              trendArrow: summary.trendDirection === 'up' ? '↑' : summary.trendDirection === 'down' ? '↓' : '→',
              minValue: summary.minValue,
              maxValue: summary.maxValue,
              avgValue: summary.avgValue,
              dataDays: summary.dataDays || 0
            }
          };
        })
      }
    : null;

  const attention = {
    show: highFatigue > 0 || activeInjuries.length > 0,
    title: '需要关注',
    summary: `疲劳偏高 ${highFatigue} 人 · 伤病状态 ${activeInjuries.length} 人`
  };

  return { metrics, trend: trendDisplay.data, trendPlaceholder: trendDisplay.isPlaceholder,
    intensity: intensityDisplay.data, intensityPlaceholder: intensityDisplay.isPlaceholder,
    activeInjuries, attention, meta: overview.meta || {},
    physiologyHeatmap: physiologyHeatmap && physiologyHeatmap.metrics.some((m) => m.days.length) ? physiologyHeatmap : physiologyPlaceholder(),
    physiologyPlaceholder: !physiologyHeatmap || !physiologyHeatmap.metrics.some((m) => m.days.length),
    heatHasEstimated: Boolean(physiologyHeatmap && physiologyHeatmap.metrics.some((m) => m.days.some((d) => d.isEstimated))) };
}

Page({
  data: {
    loading: true,
    error: '',
    user: null,
    projects: [],
    project: '',
    athletes: [],
    selectedAthleteId: 0,
    showAthlete: true,
    range: 'month',
    from: '',
    to: '',
    metrics: [],
    trend: [],
    intensity: [],
    activeInjuries: [],
    attention: { show: false, title: '', summary: '' },
    meta: {},
    canSelfReport: false,
    canViewTodos: false,
    todos: null,
    todosLoading: false,
    todosError: '',
    todosStatus: '',
    todoFilter: 'all',
    todoKeyword: '',
    todoView: null,
    // 全部人员列表的翻页状态（0 基页码）：待办四组 + 已跟进 + 队伍总览 + 伤病关注。
    todoPagerPages: { missing: 0, attention: 0, review: 0, incompleteTime: 0, followed: 0, team: 0, injuries: 0 },
    todayLoading: false,
    todayError: '',
    todayView: null,
    wellnessView: null,
    todaySessions: [],
    sessionsLoading: false,
    sessionsError: '',
    teamOverview: null,
    teamLoading: false,
    teamError: '',
    teamKeyword: '',
    teamView: null,
    loadMgmt: null,
    loadMgmtLoading: false,
    loadMgmtError: '',
    baseline: null,
    baselineLoading: false,
    baselineError: '',
    planExec: null,
    planExecLoading: false,
    planExecError: ''
  },

  onShow() {
    const app = getApp();
    if (app.globalData.homeNeedsRefresh || !isPageCacheFresh(this)) this.loadPage();
  },
  onPullDownRefresh() { this.loadPage(true).finally(() => wx.stopPullDownRefresh()); },

  loadPage(refreshUser = false) {
    this._guard = this._guard || createRequestGuard();
    this._todoGuard = this._todoGuard || createRequestGuard();
    this._todayGuard = this._todayGuard || createRequestGuard();
    this._teamGuard = this._teamGuard || createRequestGuard();
    this._sessionsGuard = this._sessionsGuard || createRequestGuard();
    this._loadMgmtGuard = this._loadMgmtGuard || createRequestGuard();
    this._baselineGuard = this._baselineGuard || createRequestGuard();
    this._planExecGuard = this._planExecGuard || createRequestGuard();
    this._todoGuard.next();
    this._todayGuard.next();
    this._teamGuard.next();
    this._sessionsGuard.next();
    this._loadMgmtGuard.next();
    this._baselineGuard.next();
    this._planExecGuard.next();
    this.setData({
      todos: null, todoView: null, todosError: '', canViewTodos: false,
      todayView: null, wellnessView: null, todayError: '', todayLoading: false,
      todaySessions: [], sessionsError: '', sessionsLoading: false,
      teamOverview: null, teamError: '', teamLoading: false, teamView: null,
      loadMgmt: null, loadMgmtError: '', loadMgmtLoading: false,
      baseline: null, baselineError: '', baselineLoading: false,
      planExec: null, planExecError: '', planExecLoading: false
    });
    return runPageLoad(this, {
      refreshUser,
      error: '训练总览加载失败。',
      scope: { range: this.data.range, showAthlete: false },
      prepare: (page, scope) => {
        const canSelfReport = scope.user.role === 'ATL';
        const canViewTodos = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'].includes(scope.user.role);
        page.setData({ ...scope, canSelfReport, canViewTodos });
      },
      load: async (page, scope, isLatest) => {
        const [overview] = await Promise.all([
          page.loadPageData({ ...scope, canSelfReport: page.data.canSelfReport }),
          page.loadTodos(scope.project),
          page.loadToday(),
          page.loadTodaySessions(),
          page.loadTeamOverview(scope.project),
          page.loadLoadManagement(scope.project),
          page.loadBaseline(scope.project),
          page.loadPlanExecution(scope.project)
        ]);
        if (isLatest()) getApp().globalData.homeNeedsRefresh = false;
        return overview;
      }
    });
  },

  async loadPageData(scope) {
    const result = await api.overview(scope.from, scope.to, scope.canSelfReport ? scope.selectedAthleteId : 0, scope.project);
    const view = buildView(result.overview);
    // 伤病关注名单按统一分页展示：完整名单留存 activeInjuriesAll，翻页时重新切片。
    const injuriesModel = paginateList(view.activeInjuries, this.data.todoPagerPages.injuries, PAGE_SIZE);
    view.activeInjuriesAll = view.activeInjuries;
    view.activeInjuries = injuriesModel.items;
    view.injuriesPager = injuriesModel;
    return view;
  },

  async loadTodos(project) {
    if (!this.data.canViewTodos) return;
    this._todoGuard = this._todoGuard || createRequestGuard();
    const id = this._todoGuard.next();
    this.setData({ todosLoading: true, todosError: '', todos: null, todoView: null, todosStatus: '正在核对今日填报与关注状态…' });
    try {
      const result = await api.dailyTodos(project);
      if (!this._todoGuard.isLatest(id)) return;
      const todos = dailyTodoView(result.todos);
      const todosStatus = todos.counts.total
        ? `加载完成，未填报 ${todos.counts.missing} 人，需关注 ${todos.counts.attention} 人。`
        : '加载完成，当前项目暂无可访问的运动员。';
      this.setData({ todos, todosStatus, todoView: this.composeTodoView(todos) });
    } catch (error) {
      if (this._todoGuard.isLatest(id)) {
        const todosError = error.message || '每日待办加载失败，请重试。';
        this.setData({ todosError, todosStatus: todosError });
      }
    } finally {
      if (this._todoGuard.isLatest(id)) this.setData({ todosLoading: false });
    }
  },

  retryTodos() {
    return this.loadTodos(this.data.project);
  },

  // 运动员本人的今日状态与恢复日报：与教练待办并行加载，各自独立重试。
  async loadToday() {
    if (!this.data.canSelfReport) return;
    this._todayGuard = this._todayGuard || createRequestGuard();
    const id = this._todayGuard.next();
    this.setData({ todayLoading: true, todayError: '' });
    try {
      const [status, wellness] = await Promise.all([api.todayStatus(), api.myWellness()]);
      if (!this._todayGuard.isLatest(id)) return;
      this.setData({
        todayLoading: false,
        todayView: todayStatusSummary(todayStatusView(status)),
        wellnessView: wellnessRecordView(wellness && wellness.record)
      });
    } catch (error) {
      if (this._todayGuard.isLatest(id)) {
        // 失败时不保留过期的今日状态，避免把旧数据当成当前结果。
        this.setData({
          todayLoading: false,
          todayView: null,
          wellnessView: null,
          todayError: error.message || '今日状态加载失败，请重试。'
        });
      }
    }
  },

  retryToday() {
    return this.loadToday();
  },

  // 运动员今日训练明细：按课次展示当天已填报的训练记录。
  async loadTodaySessions() {
    if (!this.data.canSelfReport) return;
    this._sessionsGuard = this._sessionsGuard || createRequestGuard();
    const id = this._sessionsGuard.next();
    this.setData({ sessionsLoading: true, sessionsError: '' });
    try {
      const result = await api.todaySessions();
      if (!this._sessionsGuard.isLatest(id)) return;
      this.setData({ sessionsLoading: false, todaySessions: result.sessions || [] });
    } catch (error) {
      if (this._sessionsGuard.isLatest(id)) {
        this.setData({ sessionsLoading: false, todaySessions: [], sessionsError: error.message || '今日训练加载失败，请重试。' });
      }
    }
  },

  retrySessions() {
    return this.loadTodaySessions();
  },

  // 教练队伍总览：聚合全队当日训练完成与恢复日报填报情况。
  async loadTeamOverview(project) {
    if (!this.data.canViewTodos) return;
    this._teamGuard = this._teamGuard || createRequestGuard();
    const id = this._teamGuard.next();
    this.setData({ teamLoading: true, teamError: '' });
    try {
      const result = await api.teamOverview(project);
      if (!this._teamGuard.isLatest(id)) return;
      const teamOverview = result;
      const teamView = this.buildTeamView(teamOverview, this.data.teamKeyword);
      this.setData({ teamLoading: false, teamOverview, teamView });
    } catch (error) {
      if (this._teamGuard.isLatest(id)) {
        this.setData({ teamLoading: false, teamOverview: null, teamView: null, teamError: error.message || '队伍总览加载失败，请重试。' });
      }
    }
  },

  buildTeamView(overview, keyword, pagerPages) {
    if (!overview) return null;
    const kw = (keyword || '').toLowerCase();
    const filtered = kw
      ? overview.athletes.filter((item) =>
          (item.athleteName || '').toLowerCase().includes(kw) ||
          (item.team || '').toLowerCase().includes(kw)
        )
      : overview.athletes;
    const model = paginateList(filtered, (pagerPages || this.data.todoPagerPages).team, PAGE_SIZE);
    return { ...overview, athletes: model.items, teamPager: model };
  },

  retryTeam() {
    return this.loadTeamOverview(this.data.project);
  },

  onTeamKeyword(event) {
    const teamKeyword = event.detail.value;
    if (!this.data.teamOverview) return;
    const todoPagerPages = { ...this.data.todoPagerPages, team: 0 };
    this.setData({
      teamKeyword,
      todoPagerPages,
      teamView: this.buildTeamView(this.data.teamOverview, teamKeyword),
    });
  },

  // 训练负荷管理（ACWR）
  async loadLoadManagement(project) {
    if (!this.data.canViewTodos) return;
    this._loadMgmtGuard = this._loadMgmtGuard || createRequestGuard();
    const id = this._loadMgmtGuard.next();
    this.setData({ loadMgmtLoading: true, loadMgmtError: '' });
    try {
      const result = await api.loadManagement(project);
      if (!this._loadMgmtGuard.isLatest(id)) return;
      this.setData({ loadMgmtLoading: false, loadMgmt: result });
    } catch (error) {
      if (this._loadMgmtGuard.isLatest(id)) {
        this.setData({ loadMgmtLoading: false, loadMgmt: null, loadMgmtError: error.message || '负荷管理加载失败。' });
      }
    }
  },

  retryLoadMgmt() {
    return this.loadLoadManagement(this.data.project);
  },

  // 恢复状态基线偏离预警
  async loadBaseline(project) {
    if (!this.data.canViewTodos) return;
    this._baselineGuard = this._baselineGuard || createRequestGuard();
    const id = this._baselineGuard.next();
    this.setData({ baselineLoading: true, baselineError: '' });
    try {
      const result = await api.wellnessBaseline(project);
      if (!this._baselineGuard.isLatest(id)) return;
      this.setData({ baselineLoading: false, baseline: result });
    } catch (error) {
      if (this._baselineGuard.isLatest(id)) {
        this.setData({ baselineLoading: false, baseline: null, baselineError: error.message || '基线预警加载失败。' });
      }
    }
  },

  retryBaseline() {
    return this.loadBaseline(this.data.project);
  },

  // 训练计划执行率
  async loadPlanExecution(project) {
    if (!this.data.canViewTodos) return;
    this._planExecGuard = this._planExecGuard || createRequestGuard();
    const id = this._planExecGuard.next();
    this.setData({ planExecLoading: true, planExecError: '' });
    try {
      const result = await api.planExecution(project);
      if (!this._planExecGuard.isLatest(id)) return;
      this.setData({ planExecLoading: false, planExec: result });
    } catch (error) {
      if (this._planExecGuard.isLatest(id)) {
        this.setData({ planExecLoading: false, planExec: null, planExecError: error.message || '计划执行加载失败。' });
      }
    }
  },

  retryPlanExec() {
    return this.loadPlanExecution(this.data.project);
  },

  // 统一人员列表分页：先筛选/搜索得到完整名单，再按每页 5 人切片（spec §6）。
  // pagerPages 覆盖各列表的当前页码（0 基）；缺省沿用现有页码，越界由 paginateList 收敛。
  composeTodoView(todos, pagerPages) {
    const source = todos === undefined ? this.data.todos : todos;
    if (!source) return null;
    const view = filterDailyTodos(source, this.data.todoFilter, this.data.todoKeyword);
    const pages = pagerPages || this.data.todoPagerPages;
    for (const key of TODO_PAGED_GROUPS) {
      const model = paginateList(view[key], pages[key], PAGE_SIZE);
      view[key] = model.items;
      view[`${key}Pager`] = model;
    }
    const followed = paginateList(view.followedUpList, pages.followed, PAGE_SIZE);
    view.followedUpList = followed.items;
    view.followedPager = followed;
    return view;
  },

  // pager-nav 统一回调：data-key 标识列表，event.detail.page 为目标页（0 基）。
  onPagerChange(event) {
    const key = event.currentTarget.dataset.key;
    const page = Number(event.detail && event.detail.page);
    const pages = this.data.todoPagerPages;
    if (!key || !(key in pages) || !Number.isInteger(page) || page === pages[key]) return;
    const nextPages = { ...pages, [key]: page };
    const patch = { todoPagerPages: nextPages, todoView: this.composeTodoView(undefined, nextPages) };
    if (key === 'team') patch.teamView = this.buildTeamView(this.data.teamOverview, this.data.teamKeyword, nextPages);
    if (key === 'injuries' && this.data.activeInjuriesAll) {
      const model = paginateList(this.data.activeInjuriesAll, page, PAGE_SIZE);
      patch.activeInjuries = model.items;
      patch.injuriesPager = model;
    }
    this.setData(patch);
  },

  // 筛选/搜索变化后所有人员列表回到第一页（spec §6）。
  resetPagerPages() {
    return { missing: 0, attention: 0, review: 0, incompleteTime: 0, followed: 0, team: 0, injuries: 0 };
  },

  onTodoFilter(event) {
    const todoFilter = event.currentTarget.dataset.filter;
    if (!todoFilter || todoFilter === this.data.todoFilter || !this.data.todos) return;
    this.setData({ todoFilter, todoPagerPages: this.resetPagerPages(), todoView: this.composeTodoView(undefined, this.resetPagerPages()) });
  },

  onTodoKeyword(event) {
    const todoKeyword = event.detail.value;
    if (!this.data.todos) return;
    this.setData({ todoKeyword, todoPagerPages: this.resetPagerPages(), todoView: this.composeTodoView(undefined, this.resetPagerPages()) });
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') {
      this._todoGuard = this._todoGuard || createRequestGuard();
      this._todoGuard.next();
      this.setData({ metrics: [], trend: [], intensity: [], activeInjuries: [], meta: {}, todos: null, todoView: null, todoKeyword: '', todoPagerPages: { missing: 0, attention: 0, review: 0, incompleteTime: 0, followed: 0, team: 0, injuries: 0 }, todosError: '', todosLoading: true, todosStatus: '正在切换项目…' });
    }
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') {
        try {
          await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
        } catch (error) {
          if (isLatest()) this.setData({ todosLoading: false, todosError: '项目切换未完成，请刷新重试。', todosStatus: '项目切换未完成，请刷新重试。' });
          throw error;
        }
      }
      if (!isLatest()) return null;
      const scope = this.data;
      if (change.field === 'project') {
        const [overview] = await Promise.all([this.loadPageData(scope), this.loadTodos(scope.project)]);
        return overview;
      }
      return this.loadPageData(scope);
    }, '训练总览加载失败。');
  },

  showTrendDetail(event) {
    showTrendModal(this, event, durationLoadLines);
  },

  showPhysioDetail(event) {
    if (this.data.physiologyPlaceholder) {
      wx.showModal({ title: '示例数据', content: '示例数据，仅用于展示图表效果；当前无生理生化实测数据。', showCancel: false });
      return;
    }
    const { code, date } = event.currentTarget.dataset;
    const heatmap = this.data.physiologyHeatmap;
    if (!heatmap) return;
    const metric = (heatmap.metrics || []).find((m) => m.code === code);
    if (!metric) return;
    const day = (metric.days || []).find((d) => d.date === date);
    if (!day) return;
    const statusLabelMap = { NORMAL: '正常', FLUCTUATION: '波动', ATTENTION: '关注', ABNORMAL: '异常', MISSING: '未监测' };
    const lines = [
      `${metric.label} · ${String(date).slice(5).replace('-', '/')}`,
      `状态：${statusLabelMap[day.status] || day.status}`,
    ];
    if (day.median !== null) lines.push(`中位数：${day.median} ${metric.unit}`);
    if (day.sampleCount) lines.push(`样本数：${day.sampleCount}`);
    if (day.sampleCount) lines.push(`正常 ${day.normal} · 波动 ${day.fluctuation} · 关注 ${day.attention} · 异常 ${day.abnormal}`);
    if (day.abnormalRateChange !== null) lines.push(`异常率变化：${day.abnormalRateChange > 0 ? '+' : ''}${day.abnormalRateChange}%`);
    if (day.isEstimated) lines.push('数据来源：模拟（等待实测导入）');
    wx.showModal({ title: '指标详情', content: lines.join('\n'), showCancel: false, confirmText: '知道了' });
  },

  goToAthlete(event) {
    navigateToAthlete(this, event, this.data.athletes);
  },

  // 代填入口：候选列表即授权边界，服务端还会按访问范围再校验一次。
  fillTrainingForAthlete(event) {
    const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
    if (!(this.data.athletes || []).some((item) => Number(item.id) === athleteId)) {
      wx.showToast({ title: '该运动员不在当前权限范围', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/training-entry/training-entry?athleteId=${athleteId}` });
  },

  fillWellnessForAthlete(event) {
    const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
    if (!(this.data.athletes || []).some((item) => Number(item.id) === athleteId)) {
      wx.showToast({ title: '该运动员不在当前权限范围', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/wellness-entry/wellness-entry?athleteId=${athleteId}` });
  },

  // 待办行内伤病上报：候选列表仅作 UI 边界，服务端按访问范围再校验一次。
  reportInjuryForTodo(event) {
    const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
    if (!(this.data.athletes || []).some((item) => Number(item.id) === athleteId)) {
      wx.showToast({ title: '该运动员不在当前权限范围', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/injury-report/injury-report?athleteId=${athleteId}` });
  },

  // "今日已跟进"是教练个人工作流标记：只影响本人待办展示，不改变服务端统计口径。
  async markFollowedUp(event) {
    const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
    if (!athleteId || !this.data.todos) return;
    try {
      const result = await api.markTodoFollowups(this.data.project, [athleteId]);
      this.applyFollowedUp(result.followedUp, '已标记今日已跟进');
    } catch (error) {
      wx.showToast({ title: error.message || '标记失败，请重试', icon: 'none' });
    }
  },

  async unmarkFollowedUp(event) {
    const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
    if (!athleteId || !this.data.todos) return;
    try {
      const result = await api.unmarkTodoFollowups(this.data.project, [athleteId]);
      this.applyFollowedUp(result.followedUp, '已撤销跟进标记');
    } catch (error) {
      wx.showToast({ title: error.message || '撤销失败，请重试', icon: 'none' });
    }
  },

  applyFollowedUp(followedUp, toastTitle) {
    if (!Array.isArray(followedUp) || !this.data.todos) return;
    const todos = { ...this.data.todos, followedUp };
    this.setData({
      todos,
      // 标记/撤销后名单变短：沿用当前页码，越界由 paginateList 收敛到最后一页。
      todoView: this.composeTodoView(todos),
    });
    wx.showToast({ title: toastTitle, icon: 'none' });
  },

  openTrainingEntry() {
    wx.navigateTo({ url: '/pages/training-entry/training-entry' });
  },

  openWellnessEntry() {
    wx.navigateTo({ url: '/pages/wellness-entry/wellness-entry' });
  }
});
