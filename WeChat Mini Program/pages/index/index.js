const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { shortDate } = require('../../utils/date');
const { number } = require('../../utils/format');
const { goToAthlete: navigateToAthlete } = require('../../utils/page-actions');
const { dailyTodoView } = require('../../utils/daily-todos');
const { paginateList, PAGE_SIZE } = require('../../utils/pagination');
const { todayStatusView, todayStatusSummary } = require('../../utils/today-status');
const { wellnessRecordView } = require('../../utils/wellness-form');
const { injuryMetricView } = require('../../utils/injury-metric');

function recentDates(from, to, limit = 14) {
  const first = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || first > last) return [];
  const dates = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates.slice(-limit);
}

function buildView(overview, comparison, from, to) {
  const analytics = overview.trainingAnalytics || { summary: {}, days: [] };
  const summary = analytics.summary || {};
  const loadRatio = overview.trainingLoadRatio || {};
  const meta = overview.meta || {};
  const valueOrDash = (value, divisor = 1) => value === null || value === undefined ? '—' : number(value / divisor);
  const metrics = [
    { label: '累计训练量', value: valueOrDash(summary.totalDurationMin, 60), unit: summary.totalDurationMin == null ? '' : '小时', note: '当前周期', tone: '' },
    { label: '专项训练', value: valueOrDash(summary.specialDurationMin, 60), unit: summary.specialDurationMin == null ? '' : '小时', note: '训练时长', tone: 'tone-purple' },
    { label: '体能训练', value: valueOrDash(summary.physicalDurationMin, 60), unit: summary.physicalDurationMin == null ? '' : '小时', note: '训练时长', tone: 'tone-teal' },
    { label: '恢复训练', value: valueOrDash(summary.recoveryDurationMin, 60), unit: summary.recoveryDurationMin == null ? '' : '小时', note: '训练时长', tone: 'tone-green' },
    { label: '训练负荷', value: loadRatio.totalLoad == null ? '—' : number(loadRatio.totalLoad, 0), unit: loadRatio.totalLoad == null ? '' : 'AU', note: '专项 + 体能 + 恢复 sRPE', tone: 'tone-orange' },
    injuryMetricView(overview.injuries || [], meta.scope === 'individual')
  ];

  const dates = recentDates(from, to);
  const sourceDays = analytics.days || [];
  const sourceByDate = new Map(sourceDays.map((item) => [item.date, item]));
  const teamDays = comparison && comparison.trainingAnalytics ? comparison.trainingAnalytics.days || [] : [];
  const teamByDate = new Map(teamDays.map((item) => [item.date, item]));
  const dailyRows = dates.map((date) => sourceByDate.get(date) || { date });
  const teamRangeDays = dates.map((date) => teamByDate.get(date) || null);
  const loadOf = (day) => day && (day.physicalLoad != null || day.specialLoad != null)
    ? Number(day.physicalLoad || 0) + Number(day.specialLoad || 0)
    : null;
  const maxLoad = Math.max(1,
    ...dailyRows.map((item) => loadOf(item) || 0),
    ...teamRangeDays.map((item) => loadOf(item) || 0));
  const trend = dailyRows.map((item, index) => {
    const load = loadOf(item);
    const teamDay = teamRangeDays[index];
    const teamLoad = loadOf(teamDay);
    return {
      date: item.date,
      label: shortDate(item.date),
      duration: Number(item.physicalDurationMin || 0) + Number(item.specialDurationMin || 0),
      load,
      teamLoad,
      ariaLabel: `${item.date}，${load == null ? '暂无专项或体能负荷记录' : `专项与体能负荷 ${number(load, 0)} AU`}${teamLoad == null ? '' : `，团队日均 ${number(teamLoad, 0)} AU`}`,
      loadHeight: load == null ? 0 : Math.max(load > 0 ? 2 : 0, Math.round(load / maxLoad * 100)),
      teamLoadHeight: teamLoad == null ? 0 : Math.max(teamLoad > 0 ? 2 : 0, Math.round(teamLoad / maxLoad * 100))
    };
  });
  const trendHasData = trend.some((item) => item.load !== null);

  const structure = [
    { key: 'special', name: '专项', load: Number(loadRatio.specialLoad || 0), percentage: Number(loadRatio.specialPercentage || 0), color: 'special' },
    { key: 'physical', name: '体能', load: Number(loadRatio.physicalLoad || 0), percentage: Number(loadRatio.physicalPercentage || 0), color: 'physical' },
    { key: 'recovery', name: '恢复', load: Number(loadRatio.recoveryLoad || 0), percentage: Number(loadRatio.recoveryPercentage || 0), color: 'recovery' }
  ].map((item) => ({ ...item, percentageText: number(item.percentage, 0), width: Math.max(0, Math.min(100, item.percentage)) }));
  const hasStructure = Number(loadRatio.totalLoad) > 0;

  const rpeDays = dailyRows.map((item) => {
    const mean = item.averageRpe;
    const teamDay = teamByDate.get(item.date);
    const teamMean = teamDay ? teamDay.averageRpe : null;
    const bandDay = comparison ? (teamDay || {}) : item;
    return {
      date: item.date,
      label: shortDate(item.date),
      mean,
      rpeCount: item.rpeCount || 0,
      stdRpe: bandDay.stdRpe,
      lowerRpe: bandDay.lowerRpe,
      upperRpe: bandDay.upperRpe,
      meanHeight: mean == null ? 0 : Math.max(2, Math.round(Math.min(10, Math.max(0, mean)) * 10)),
      lowerHeight: bandDay.lowerRpe == null ? 0 : Math.round(Math.min(10, Math.max(0, bandDay.lowerRpe)) * 10),
      rangeHeight: bandDay.lowerRpe == null || bandDay.upperRpe == null ? 0 : Math.round((Math.min(10, bandDay.upperRpe) - Math.max(0, bandDay.lowerRpe)) * 10),
      teamMean,
      teamRpeCount: teamDay ? teamDay.rpeCount || 0 : 0,
      teamMeanHeight: teamMean == null ? 0 : Math.max(2, Math.round(Math.min(10, Math.max(0, teamMean)) * 10)),
      ariaLabel: `${item.date}，${mean == null ? '暂无RPE记录' : `RPE均值 ${number(mean)}，有效人数 ${item.rpeCount || 0}`}${teamMean == null ? '' : `，团队均值 ${number(teamMean)}`}`
    };
  });
  const hasRpe = rpeDays.some((item) => item.mean !== null && item.mean !== undefined);
  return {
    metrics,
    trend,
    trendPlaceholder: !trendHasData,
    structure,
    structureHasData: hasStructure,
    rpeDays,
    rpePlaceholder: !hasRpe,
    meta
  };
}

Page({
  data: {
    loading: true,
    error: '',
    user: null,
    projects: [],
    project: '',
    athletes: [],
    scopeAthletes: [],
    selectedAthleteId: 0,
    range: 'month',
    from: '',
    to: '',
    metrics: [],
    trend: [],
    structure: [],
    structureHasData: false,
    rpeDays: [],
    rpePlaceholder: false,
    meta: {},
    canSelfReport: false,
    canViewTodos: false,
    todos: null,
    todosLoading: false,
    todosError: '',
    todoPagerPages: { team: 0, focus: 0 },
    todayLoading: false,
    todayError: '',
    todayView: null,
    wellnessView: null,
    teamOverview: null,
    teamLoading: false,
    teamError: '',
    teamKeyword: '',
    teamView: null,
    teams: [],
    teamId: 0,
    showTeam: false,
    showAthlete: false,
    athleteKeyword: '',
    focusRows: [],
    focusPager: null
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
    this._todoGuard.next();
    this._todayGuard.next();
    this._teamGuard.next();
    this.setData({
      todos: null, todosError: '', canViewTodos: false,
      todayView: null, wellnessView: null, todayError: '', todayLoading: false,
      teamOverview: null, teamError: '', teamLoading: false, teamView: null,
    });
    return runPageLoad(this, {
      refreshUser,
      error: '训练总览加载失败。',
      scope: { range: this.data.range, showAthlete: true },
      prepare: (page, scope) => {
        const canSelfReport = scope.user.role === 'ATL';
        const canViewTodos = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'].includes(scope.user.role);
        page.setData({ ...scope, selectedAthleteId: canSelfReport ? scope.selectedAthleteId : 0,
          canSelfReport, canViewTodos, showAthlete: canViewTodos, showTeam: canViewTodos });
      },
      load: async (page, scope, isLatest) => {
        const [overview] = await Promise.all([
          page.loadPageData({ ...scope, canSelfReport: page.data.canSelfReport }, isLatest),
          page.loadTodos(scope.project),
          page.loadToday(),
          page.loadTeamOverview(scope.project)
        ]);
        if (isLatest()) getApp().globalData.homeNeedsRefresh = false;
        return overview;
      }
    });
  },

  async loadPageData(scope, isLatest = () => true) {
    const isManager = this.data.canViewTodos;
    let teams = this.data.teams || [];
    if (isManager && this._teamsProject !== scope.project) {
      const result = await api.overviewTeams(scope.project);
      if (!isLatest()) return null;
      teams = result.teams || [];
      this._teamsProject = scope.project;
    }
    const teamExists = teams.some((item) => Number(item.id) === Number(this.data.teamId));
    const sameProject = this._selectedTeamProject === scope.project;
    const teamId = isManager
      ? (sameProject && (Number(this.data.teamId) === 0 || teamExists) ? Number(this.data.teamId) : Number((teams[0] || {}).id) || 0)
      : 0;
    this._selectedTeamProject = scope.project;
    const selectedTeam = teams.find((item) => Number(item.id) === teamId);
    const scopeAthletes = isManager && selectedTeam
      ? (scope.athletes || []).filter((item) => item.team === selectedTeam.name)
      : (scope.athletes || []);
    let athleteId = isManager ? Number(this.data.selectedAthleteId) || 0 : 0;
    if (athleteId && !scopeAthletes.some((item) => Number(item.id) === athleteId)) athleteId = 0;
    const teamPromise = isManager && athleteId
      ? api.overview(scope.from, scope.to, 0, scope.project, teamId)
      : Promise.resolve(null);
    const [personalResult, comparisonResult] = await Promise.all([
      athleteId
        ? api.personalOverview(athleteId, scope.from, scope.to, scope.project)
        : api.overview(scope.from, scope.to, 0, scope.project, teamId),
      teamPromise
    ]);
    if (!isLatest()) return null;
    const view = buildView(personalResult.overview, athleteId && comparisonResult ? comparisonResult.overview : null, scope.from, scope.to);
    const focus = this.buildFocusRows(this.data.todos, this.data.todoPagerPages.focus, teams, teamId);
    const filteredRoster = this.buildTeamView(this.data.teamOverview, this.data.teamKeyword, this.data.todoPagerPages, teams, teamId);
    Object.assign(view, { focusRows: focus.items, focusPager: focus, teamView: filteredRoster });
    const teamLabel = teamId ? ((teams.find((item) => Number(item.id) === teamId) || {}).name || '当前队伍') : '全部授权队伍';
    this.setData({ teams, teamId, teamLabel, scopeAthletes, selectedAthleteId: athleteId, ...view });
    return view;
  },

  buildFocusRows(todos, page, teams, teamId) {
    if (!todos) return paginateList([], page || 0, PAGE_SIZE);
    const selectedTeam = (teams || []).find((item) => Number(item.id) === Number(teamId));
    const rows = new Map();
    const followed = new Set(todos.followedUp || []);
    const add = (item, label, reason) => {
      if (followed.has(item.athleteId)) return;
      if (selectedTeam && item.team !== selectedTeam.name) return;
      const existing = rows.get(item.athleteId);
      if (existing) {
        if (!existing.focusLabels.includes(label)) existing.focusLabels.push(label);
        if (!existing.focusReasons.includes(reason)) existing.focusReasons.push(reason);
        existing.focusLabel = existing.focusLabels.join('、');
        existing.focusReason = existing.focusReasons.join('；');
        return;
      }
      rows.set(item.athleteId, { ...item, focusLabel: label, focusReason: reason, focusLabels: [label], focusReasons: [reason] });
    };
    (todos.missing || []).forEach((item) => add(item, '未填报', '今日暂无有效训练记录'));
    (todos.attention || []).forEach((item) => add(item, '状态关注', item.reason || '存在待关注状态'));
    (todos.reviewDue || []).forEach((item) => add(item, '复查提醒', `${item.dueLabel} · ${item.injuryName}`));
    (todos.incompleteTime || []).forEach((item) => add(item, '时间待补', '训练记录缺少有效开训时间'));
    return paginateList([...rows.values()], page || 0, PAGE_SIZE);
  },

  async loadTodos(project) {
    if (!this.data.canViewTodos) return;
    this._todoGuard = this._todoGuard || createRequestGuard();
    const id = this._todoGuard.next();
    this.setData({ todosLoading: true, todosError: '', todos: null });
    try {
      const result = await api.dailyTodos(project);
      if (!this._todoGuard.isLatest(id)) return;
      const todos = dailyTodoView(result.todos);
      const focus = this.buildFocusRows(todos, this.data.todoPagerPages.focus, this.data.teams, this.data.teamId);
      this.setData({ todos, focusRows: focus.items, focusPager: focus });
    } catch (error) {
      if (this._todoGuard.isLatest(id)) {
        const todosError = error.message || '每日待办加载失败，请重试。';
        this.setData({ todosError });
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
      const teamView = this.buildTeamView(teamOverview, this.data.teamKeyword, this.data.todoPagerPages, this.data.teams, this.data.teamId);
      this.setData({ teamLoading: false, teamOverview, teamView });
    } catch (error) {
      if (this._teamGuard.isLatest(id)) {
        this.setData({ teamLoading: false, teamOverview: null, teamView: null, teamError: error.message || '队伍总览加载失败，请重试。' });
      }
    }
  },

  buildTeamView(overview, keyword, pagerPages, teams, teamId) {
    if (!overview) return null;
    const kw = (keyword || '').toLowerCase();
    const selectedTeam = (teams || this.data.teams || []).find((item) => Number(item.id) === Number(teamId === undefined ? this.data.teamId : teamId));
    const inTeam = (overview.athletes || []).filter((item) => !selectedTeam || item.team === selectedTeam.name);
    const filtered = kw
      ? inTeam.filter((item) =>
          (item.athleteName || '').toLowerCase().includes(kw) ||
          (item.team || '').toLowerCase().includes(kw)
        )
      : inTeam;
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
      teamView: this.buildTeamView(this.data.teamOverview, teamKeyword, undefined, this.data.teams, this.data.teamId),
    });
  },

  // pager-nav 统一回调：data-key 标识列表，event.detail.page 为目标页（0 基）。
  onPagerChange(event) {
    const key = event.currentTarget.dataset.key;
    const page = Number(event.detail && event.detail.page);
    const pages = this.data.todoPagerPages;
    if (!key || !(key in pages) || !Number.isInteger(page) || page === pages[key]) return;
    const nextPages = { ...pages, [key]: page };
    const patch = { todoPagerPages: nextPages };
    if (key === 'team') patch.teamView = this.buildTeamView(this.data.teamOverview, this.data.teamKeyword, nextPages, this.data.teams, this.data.teamId);
    if (key === 'focus') {
      const model = this.buildFocusRows(this.data.todos, page, this.data.teams, this.data.teamId);
      patch.focusRows = model.items;
      patch.focusPager = model;
    }
    this.setData(patch);
  },

  // 筛选/搜索变化后所有人员列表回到第一页（spec §6）。
  resetPagerPages() {
    return { team: 0, focus: 0 };
  },

  retryOverview() {
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, isLatest), '训练总览加载失败。');
  },

  onOverviewTeamChange(event) {
    const teamId = Number(event.detail && event.detail.value) || 0;
    if (!this.data.teams.some((item) => Number(item.id) === teamId) && teamId !== 0) return Promise.resolve();
    const todoPagerPages = { ...this.data.todoPagerPages, focus: 0, team: 0 };
    this.setData({ teamId, todoPagerPages, teamKeyword: '', athleteKeyword: '', focusRows: [], focusPager: null, teamView: this.buildTeamView(this.data.teamOverview, '', todoPagerPages, this.data.teams, teamId) });
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, isLatest), '训练总览加载失败。');
  },

  onOverviewAthleteChange(event) {
    const athleteId = Number(event.detail && event.detail.value) || 0;
    const valid = athleteId === 0 || this.data.scopeAthletes.some((item) => Number(item.id) === athleteId && (!item.project || item.project === this.data.project));
    if (!valid || !this.data.canViewTodos) return Promise.resolve();
    this.setData({ selectedAthleteId: athleteId });
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, isLatest), '训练总览加载失败。');
  },

  onAthleteKeyword(event) {
    this.setData({ athleteKeyword: event.detail && event.detail.value || '' });
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') {
      this._todoGuard = this._todoGuard || createRequestGuard();
      this._todoGuard.next();
      this.setData({ metrics: [], trend: [], structure: [], rpeDays: [], meta: {}, todos: null, teamId: 0, teams: [], selectedAthleteId: 0, athleteKeyword: '', todoPagerPages: this.resetPagerPages(), todosError: '', todosLoading: true });
    }
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') {
        try {
          await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
        } catch (error) {
          if (isLatest()) this.setData({ todosLoading: false, todosError: '项目切换未完成，请刷新重试。' });
          throw error;
        }
      }
      if (!isLatest()) return null;
      const scope = this.data;
      if (change.field === 'project') {
        this._teamGuard = this._teamGuard || createRequestGuard();
        this._teamGuard.next();
        this.setData({ teamOverview: null, teamError: '', teamLoading: false, teamView: null });
        const [overview] = await Promise.all([this.loadPageData(scope, isLatest), this.loadTodos(scope.project), this.loadTeamOverview(scope.project)]);
        return overview;
      }
      return this.loadPageData(scope, isLatest);
    }, '训练总览加载失败。');
  },

  showTrendDetail(event) {
    const item = this.data.trend[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    const lines = [item.load == null ? '暂无有效专项或体能负荷记录' : `专项 + 体能 sRPE：${number(item.load, 0)} AU`];
    if (item.teamLoad !== null && item.teamLoad !== undefined) lines.push(`团队日均 sRPE：${number(item.teamLoad, 0)} AU`);
    wx.showModal({ title: item.date, content: lines.join('\n'), showCancel: false, confirmText: '知道了' });
  },

  showRpeDetail(event) {
    const item = this.data.rpeDays[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    const lines = [`日期：${item.date}`];
    if (item.mean === null || item.mean === undefined) lines.push('当前运动员暂无有效 RPE 记录');
    else {
      lines.push(`${this.data.selectedAthleteId ? '个人' : '队伍平均'} RPE：${number(item.mean)}`);
      lines.push(`有效人数：${item.rpeCount}`);
      if (item.lowerRpe != null && item.upperRpe != null) lines.push(`队伍均值 ±1 标准差：${number(item.lowerRpe)}–${number(item.upperRpe)}（标准差 ${number(item.stdRpe)}）`);
    }
    if (item.teamMean !== null && item.teamMean !== undefined) lines.push(`团队平均 RPE：${number(item.teamMean)} · ${item.teamRpeCount} 人`);
    wx.showModal({ title: 'RPE 日趋势', content: lines.join('\n'), showCancel: false, confirmText: '知道了' });
  },

  goToAthlete(event) {
    navigateToAthlete(this, event, this.data.athletes);
  },

  openTrainingEntry() {
    wx.navigateTo({ url: '/pages/training-entry/training-entry' });
  },

  openWellnessEntry() {
    wx.navigateTo({ url: '/pages/wellness-entry/wellness-entry' });
  }
});
