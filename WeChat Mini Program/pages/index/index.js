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
const { morningCheckView, trainingSituationView } = require('../../utils/morning-check');

const { metricValue, sectionRequest } = require('../../utils/training-empty');

const emptyTeamView = () => ({ athletes: [], teamPager: paginateList([], 0, PAGE_SIZE) });
const emptyMorningView = () => morningCheckView([], 'all', 0);
const emptyTrainingSituation = () => trainingSituationView([]);

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
  const valueOrDash = (value, divisor = 1) => typeof value === 'number' && Number.isFinite(value) ? metricValue(value / divisor) : '--';
  // 核心指标 2×2：累计/专项/体能时长与训练负荷；恢复时长与损伤情况为次级行（规格 §三.2）。
  const metrics = [
    { label: '累计训练量', value: valueOrDash(summary.totalDurationMin, 60), unit: '小时', note: '当前周期', tone: '' },
    { label: '专项训练', value: valueOrDash(summary.specialDurationMin, 60), unit: '小时', note: '训练时长', tone: 'tone-blue' },
    { label: '体能训练', value: valueOrDash(summary.physicalDurationMin, 60), unit: '小时', note: '训练时长', tone: 'tone-teal' },
    { label: '训练负荷', value: metricValue(loadRatio.totalLoad, 0), unit: 'AU', note: '专项 + 体能 + 恢复 sRPE', tone: 'tone-orange' },
    { label: '恢复训练', value: valueOrDash(summary.recoveryDurationMin, 60), unit: '小时', note: '训练时长', tone: 'tone-green' },
    overview.injuries ? injuryMetricView(overview.injuries, meta.scope === 'individual') : { label: '损伤情况', value: '--', unit: '人', note: '暂无伤病数据', tone: '' }
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
      duration: item.physicalDurationMin == null && item.specialDurationMin == null ? null : Number(item.physicalDurationMin || 0) + Number(item.specialDurationMin || 0),
      load,
      teamLoad,
      ariaLabel: `${item.date}，${load == null ? '暂无专项或体能负荷记录' : `专项与体能负荷 ${number(load, 0)} AU`}${teamLoad == null ? '' : `，团队日均 ${number(teamLoad, 0)} AU`}`,
      loadHeight: load == null ? 0 : Math.max(load > 0 ? 2 : 0, Math.round(load / maxLoad * 100)),
      teamLoadHeight: teamLoad == null ? 0 : Math.max(teamLoad > 0 ? 2 : 0, Math.round(teamLoad / maxLoad * 100))
    };
  });
  const trendHasData = trend.some((item) => item.load !== null);

  // 专项/体能训练时长并列柱状图：同日期、同单位（小时），与负荷图分列不混轴（规格 §三.3）。
  const maxDurationMin = Math.max(1,
    ...dailyRows.map((item) => Math.max(Number(item.specialDurationMin || 0), Number(item.physicalDurationMin || 0))));
  const durationTrend = dailyRows.map((item) => {
    const specialMin = item.specialDurationMin == null ? null : Number(item.specialDurationMin);
    const physicalMin = item.physicalDurationMin == null ? null : Number(item.physicalDurationMin);
    const specialHours = specialMin == null ? null : specialMin / 60;
    const physicalHours = physicalMin == null ? null : physicalMin / 60;
    return {
      date: item.date,
      label: shortDate(item.date),
      specialHours,
      physicalHours,
      ariaLabel: `${item.date}，${specialHours == null ? '暂无专项训练时长' : `专项 ${number(specialHours, 1)} 小时`}，${physicalHours == null ? '暂无体能训练时长' : `体能 ${number(physicalHours, 1)} 小时`}`,
      specialHeight: specialMin == null ? 0 : Math.max(specialMin > 0 ? 2 : 0, Math.round(specialMin / maxDurationMin * 100)),
      physicalHeight: physicalMin == null ? 0 : Math.max(physicalMin > 0 ? 2 : 0, Math.round(physicalMin / maxDurationMin * 100))
    };
  });
  const durationHasData = durationTrend.some((item) => item.specialHours !== null || item.physicalHours !== null);

  const structure = [
    { key: 'special', name: '专项', load: loadRatio.specialLoad, percentage: loadRatio.specialPercentage, color: 'special' },
    { key: 'physical', name: '体能', load: loadRatio.physicalLoad, percentage: loadRatio.physicalPercentage, color: 'physical' },
    { key: 'recovery', name: '恢复', load: loadRatio.recoveryLoad, percentage: loadRatio.recoveryPercentage, color: 'recovery' }
  ].map((item) => ({ ...item, loadText: metricValue(item.load), percentageText: metricValue(item.percentage, 0), width: Number.isFinite(item.percentage) ? Math.max(0, Math.min(100, item.percentage)) : 0 }));
  const hasStructure = structure.some((item) => Number.isFinite(item.load));

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
      meanHeight: mean == null ? 0 : Math.max(0, Math.round(Math.min(10, Math.max(0, mean)) * 10)),
      lowerHeight: bandDay.lowerRpe == null ? 0 : Math.round(Math.min(10, Math.max(0, bandDay.lowerRpe)) * 10),
      rangeHeight: bandDay.lowerRpe == null || bandDay.upperRpe == null ? 0 : Math.round((Math.min(10, bandDay.upperRpe) - Math.max(0, bandDay.lowerRpe)) * 10),
      teamMean,
      teamRpeCount: teamDay ? teamDay.rpeCount || 0 : 0,
      teamMeanHeight: teamMean == null ? 0 : Math.max(0, Math.round(Math.min(10, Math.max(0, teamMean)) * 10)),
      ariaLabel: `${item.date}，${mean == null ? '暂无RPE记录' : `RPE均值 ${number(mean)}，有效人数 ${item.rpeCount || 0}`}${teamMean == null ? '' : `，团队均值 ${number(teamMean)}`}`
    };
  });
  const hasRpe = rpeDays.some((item) => item.mean !== null && item.mean !== undefined);
  return {
    metrics,
    trend,
    trendPlaceholder: !trendHasData,
    durationTrend,
    durationPlaceholder: !durationHasData,
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
    canSelfReport: false,
    canViewTodos: false,
    todos: null,
    todosLoading: false,
    todosError: '',
    todoPagerPages: { team: 0, focus: 0, morning: 0 },
    todayLoading: false,
    todayError: '',
    todayView: null,
    wellnessView: null,
    teamOverview: null,
    teamLoading: false,
    teamError: '',
    teamView: emptyTeamView(),
    morningView: emptyMorningView(),
    morningTraining: emptyTrainingSituation(),
    morningFilter: 'all',
    teams: [],
    teamId: 0,
    showTeam: false,
    showAthlete: false,
    athleteKeyword: '',
    focusRows: [],
    focusPager: paginateList([], 0, PAGE_SIZE),
    ...buildView({}, null, '', ''), overviewError: '', comparisonError: ''
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
      ...buildView({}, null, this.data.from, this.data.to), overviewError: '', comparisonError: '',
      todos: null, focusRows: [], focusPager: paginateList([], 0, PAGE_SIZE), todosError: '',
      todayView: null, wellnessView: null, todayError: '', todayLoading: false,
      teamOverview: null, teamError: '', teamLoading: false, teamView: emptyTeamView(),
      morningView: emptyMorningView(), morningTraining: emptyTrainingSituation(), morningFilter: 'all',
    });
    return runPageLoad(this, {
      refreshUser,
      error: '训练总览加载失败。',
      scope: { range: this.data.range, showAthlete: true },
      prepare: (page, scope) => {
        const canSelfReport = scope.user.role === 'ATL';
        const canViewTodos = ['SCC', 'REG', 'TD', 'DMD'].includes(scope.user.role);
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
    this.setData({ ...buildView({}, null, scope.from, scope.to), overviewError: '', comparisonError: '' });
    let teamsError = '';
    const isManager = this.data.canViewTodos;
    let teams = this.data.teams || [];
    if (isManager && this._teamsProject !== scope.project) {
      const result = await sectionRequest(() => api.overviewTeams(scope.project), '队伍加载失败');
      if (!isLatest()) return null;
      teams = (result.value || {}).teams || [];
      teamsError = result.error;
      if (!result.error) this._teamsProject = scope.project;
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
      ? sectionRequest(() => api.overview(scope.from, scope.to, 0, scope.project, teamId), '团队参照加载失败')
      : Promise.resolve(null);
    const [personalResult, comparisonResult] = await Promise.all([
      sectionRequest(() => athleteId
        ? api.personalOverview(athleteId, scope.from, scope.to, scope.project)
        : api.overview(scope.from, scope.to, 0, scope.project, teamId), '训练总览加载失败'),
      teamPromise
    ]);
    if (!isLatest()) return null;
    const view = {
      ...buildView((personalResult.value || {}).overview || {}, athleteId && comparisonResult && comparisonResult.value ? comparisonResult.value.overview : null, scope.from, scope.to),
      overviewError: personalResult.error || teamsError, comparisonError: comparisonResult ? comparisonResult.error : ''
    };
    const focus = this.buildFocusRows(this.data.todos, this.data.todoPagerPages.focus, teams, teamId);
    const filteredRoster = this.buildTeamView(this.data.teamOverview, teams, teamId);
    Object.assign(view, { focusRows: focus.items, focusPager: focus, teamView: filteredRoster, ...this.buildMorningViews(this.data.teamOverview, teams, teamId) });
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
    // 训练记录缺失只表述为“暂无训练记录”，“未填报”保留给晨检，两者口径彻底分开。
    (todos.missing || []).forEach((item) => add(item, '暂无训练记录', '今日暂无有效训练记录'));
    (todos.attention || []).forEach((item) => add(item, '状态关注', item.reason || '存在待关注状态'));
    (todos.reviewDue || []).forEach((item) => add(item, '复查提醒', `${item.dueLabel} · ${item.injuryName}`));
    (todos.incompleteTime || []).forEach((item) => add(item, '时间待补', '训练记录缺少有效开训时间'));
    return paginateList([...rows.values()], page || 0, PAGE_SIZE);
  },

  async loadTodos(project) {
    if (!this.data.canViewTodos) return;
    this._todoGuard = this._todoGuard || createRequestGuard();
    const id = this._todoGuard.next();
    this.setData({ todosLoading: true, todosError: '', todos: null, focusRows: [], focusPager: paginateList([], 0, PAGE_SIZE) });
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
      const teamView = this.buildTeamView(teamOverview, this.data.teams, this.data.teamId);
      this.setData({ teamLoading: false, teamOverview, teamView, ...this.buildMorningViews(teamOverview, this.data.teams, this.data.teamId) });
    } catch (error) {
      if (this._teamGuard.isLatest(id)) {
        this.setData({ teamLoading: false, teamOverview: null, teamView: emptyTeamView(), morningView: emptyMorningView(), morningTraining: emptyTrainingSituation(), teamError: error.message || '队伍总览加载失败，请重试。' });
      }
    }
  },

  // 队伍筛选后的运动员行：晨检概览、今日训练情况与人员列表共用同一过滤结果。
  teamAthletes(overview, teams, teamId) {
    if (!overview) return [];
    const selectedTeam = (teams || this.data.teams || []).find((item) => Number(item.id) === Number(teamId === undefined ? this.data.teamId : teamId));
    return (overview.athletes || []).filter((item) => !selectedTeam || item.team === selectedTeam.name);
  },

  // 队伍运动员归一化为 athlete-selector 条目；搜索与 5 人分页由组件承担。
  buildTeamView(overview, teams, teamId) {
    if (!overview) return emptyTeamView();
    const athletes = this.teamAthletes(overview, teams, teamId).map((athlete) => ({
      id: athlete.athleteId,
      name: athlete.athleteName,
      meta: athlete.team || '未分队',
      tags: [
        { text: athlete.hasTraining ? '有训练记录' : '暂无训练记录', tone: athlete.hasTraining ? 'ok' : 'warn' },
        { text: athlete.wellnessReported ? '晨检已填' : '晨检未填', tone: athlete.wellnessReported ? 'ok' : 'warn' }
      ],
      value: `${metricValue(athlete.load24h)} AU`,
      searchText: `${athlete.athleteName || ''} ${athlete.team || ''}`,
    }));
    return { athletes, teamPager: paginateList(athletes, 0, PAGE_SIZE) };
  },

  // 晨检概览与今日训练情况：人数、名单同源于 readTeamOverview 当日晨检标记，与训练记录分开统计。
  // filter/page 显式传入，避免与 setData 同批更新时读到旧的筛选与页码。
  buildMorningViews(overview, teams, teamId, page, filter) {
    const rows = this.teamAthletes(overview, teams, teamId);
    const morningPage = Number.isInteger(page) ? page : this.data.todoPagerPages.morning;
    const morningFilter = filter === undefined ? this.data.morningFilter : filter;
    return {
      morningView: morningCheckView(rows, morningFilter, morningPage),
      morningTraining: trainingSituationView(rows),
    };
  },

  retryTeam() {
    return this.loadTeamOverview(this.data.project);
  },

  // pager-nav 统一回调：状态监测与晨检人员分页；队伍运动员分页由 athlete-selector 组件内承担。
  onPagerChange(event) {
    const key = event.currentTarget.dataset.key;
    const page = Number(event.detail && event.detail.page);
    const pages = this.data.todoPagerPages;
    if (!key || !(key in pages) || !Number.isInteger(page) || page === pages[key]) return;
    const nextPages = { ...pages, [key]: page };
    const patch = { todoPagerPages: nextPages };
    if (key === 'focus') {
      const model = this.buildFocusRows(this.data.todos, page, this.data.teams, this.data.teamId);
      patch.focusRows = model.items;
      patch.focusPager = model;
    }
    if (key === 'morning') {
      Object.assign(patch, this.buildMorningViews(this.data.teamOverview, this.data.teams, this.data.teamId, page));
    }
    this.setData(patch);
  },

  // 晨检名单筛选：全部 / 仅看未填报；切换后回到第一页，人数与名单口径不变。
  onMorningFilterChange(event) {
    const filter = event.currentTarget.dataset.filter;
    if (filter !== 'all' && filter !== 'missing') return;
    if (filter === this.data.morningFilter) return;
    this.setData({
      morningFilter: filter,
      todoPagerPages: { ...this.data.todoPagerPages, morning: 0 },
      ...this.buildMorningViews(this.data.teamOverview, this.data.teams, this.data.teamId, 0, filter),
    });
  },

  // 筛选/搜索变化后所有人员列表回到第一页（spec §6）。
  resetPagerPages() {
    return { team: 0, focus: 0, morning: 0 };
  },

  retryOverview() {
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, isLatest), '训练总览加载失败。');
  },

  onOverviewTeamChange(event) {
    const teamId = Number(event.detail && event.detail.value) || 0;
    if (!this.data.teams.some((item) => Number(item.id) === teamId) && teamId !== 0) return Promise.resolve();
    const todoPagerPages = { ...this.data.todoPagerPages, focus: 0, team: 0, morning: 0 };
    this.setData({
      teamId, todoPagerPages, athleteKeyword: '', focusRows: [], focusPager: paginateList([], 0, PAGE_SIZE),
      teamView: this.buildTeamView(this.data.teamOverview, this.data.teams, teamId),
      // 队伍筛选变化后晨检人数与名单同步更新，保持同一口径。
      ...this.buildMorningViews(this.data.teamOverview, this.data.teams, teamId, 0),
    });
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, isLatest), '训练总览加载失败。');
  },

  // 个人周期视图下钻/返回团队：scope-filter 运动员选择与队伍运动员卡片共用同一入口。
  selectOverviewAthlete(athleteId) {
    const valid = athleteId === 0 || this.data.scopeAthletes.some((item) => Number(item.id) === athleteId && (!item.project || item.project === this.data.project));
    if (!valid || !this.data.canViewTodos) return Promise.resolve();
    if (athleteId === (Number(this.data.selectedAthleteId) || 0)) return Promise.resolve();
    this.setData({ selectedAthleteId: athleteId });
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, isLatest), '训练总览加载失败。');
  },

  onOverviewAthleteChange(event) {
    return this.selectOverviewAthlete(Number(event.detail && event.detail.value) || 0);
  },

  onTeamAthleteSelect(event) {
    return this.selectOverviewAthlete(Number(event.detail && event.detail.id) || 0);
  },

  onBackToTeam() {
    return this.selectOverviewAthlete(0);
  },

  onTeamAthleteDetail(event) {
    navigateToAthlete(this, { currentTarget: { dataset: { athleteId: event.detail && event.detail.id } } }, this.data.athletes);
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
      this.setData({ ...buildView({}, null, this.data.from, this.data.to), todos: null, focusRows: [], focusPager: paginateList([], 0, PAGE_SIZE), teamId: 0, teams: [], selectedAthleteId: 0, athleteKeyword: '', todoPagerPages: this.resetPagerPages(), todosError: '', todosLoading: true, morningView: emptyMorningView(), morningTraining: emptyTrainingSituation(), morningFilter: 'all' });
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
        this.setData({ teamOverview: null, teamError: '', teamLoading: false, teamView: emptyTeamView(), morningView: emptyMorningView(), morningTraining: emptyTrainingSituation() });
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

  showDurationDetail(event) {
    const item = this.data.durationTrend[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    const lines = [
      item.specialHours == null ? '专项训练时长：待采集' : `专项训练时长：${number(item.specialHours, 1)} 小时`,
      item.physicalHours == null ? '体能训练时长：待采集' : `体能训练时长：${number(item.physicalHours, 1)} 小时`
    ];
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
