const { sportRules = {} } = require('../../data/register-data');
const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { loadWithGuard } = require('../../utils/request-guard');
const { showTrendModal, goToAthlete: navigateToAthlete } = require('../../utils/page-actions');
const { shortDate, ageAt } = require('../../utils/date');
const { number } = require('../../utils/format');
const { completeRatioRows, INTENSITY_ZONE_NAMES } = require('../../utils/chart-placeholder');
const { paginateList, PAGE_SIZE } = require('../../utils/pagination');
const { injuryMetricView } = require('../../utils/injury-metric');
const { buildSpecialTestView, EVENT_PREVIEW_COUNT } = require('../../utils/special-test-view');

const { metricValue, sectionRequest } = require('../../utils/training-empty');

// 与服务端管理角色口径一致；仅这些角色可现场录入测试成绩。
const MANAGER_ROLES = ['SCC', 'REG', 'TD', 'DMD'];

// 占比构成条与明细圆点的分类配色（与页面蓝绿主色协调，按分类顺序循环取用）。
const RATIO_COLORS = ['#176f7f', '#32846b', '#6c9e4f', '#c97925', '#b34a42', '#67528e', '#2f708a', '#a8843c', '#70858c'];
const withRatioColors = (rows) =>
  rows.map((row, index) => ({ ...row, color: RATIO_COLORS[index % RATIO_COLORS.length] }));

function buildTrainingView(result, to, project) {
  const training = result.training || {};
  const athletes = result.athletes || [];
  const summary = training.summary || {};
  const metrics = [
    { label: '专项训练时长', value: metricValue(summary.durationMin == null ? null : summary.durationMin / 60), unit: 'h', note: '同队共同课次去重' },
    { label: '专项训练距离', value: metricValue(summary.distanceKm), unit: 'km', note: '只统计已填报距离' },
    { label: '专项训练课次', value: metricValue(summary.sessionCount, 0), unit: '课次', note: '当前筛选时间范围' },
    { label: '专项训练负荷', value: metricValue(summary.load), unit: 'AU', note: summary.loadSampleCount == null ? '使用既有SRPE' : `有效时长与RPE ${summary.loadSampleCount}/${summary.sessionCount}课次` },
    result.injuries ? injuryMetricView(result.injuries, Boolean(result.injuryIndividual)) : { label: '损伤情况', value: '--', unit: '人', note: '暂无伤病数据' }
  ];

  const days = (training.days || []).slice(-14);
  const chartValue = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const maxDuration = Math.max(1, ...days.map((item) => chartValue(item.durationMin)));
  const maxDistance = Math.max(1, ...days.map((item) => chartValue(item.distanceKm)));
  const trend = days.map((item) => ({
    date: item.date,
    label: shortDate(item.date),
    duration: item.durationMin,
    distance: item.distanceKm,
    ariaLabel: `${item.date}，训练时长${metricValue(item.durationMin)}分钟，训练距离${metricValue(item.distanceKm)}公里`,
    durationHeight: Math.max(0, Math.round(chartValue(item.durationMin) / maxDuration * 100)),
    distanceHeight: Math.max(0, Math.round(chartValue(item.distanceKm) / maxDistance * 100))
  }));

  // 强度保留服务端体系与分区标签；未填时长保持缺失，真实0保留。
  const intensityRows = training.intensity || [];
  const intensityTotal = intensityRows.reduce((sum, row) => sum + (Number.isFinite(row.durationMin) ? row.durationMin : 0), 0);
  const intensity = withRatioColors((intensityRows.length ? intensityRows : INTENSITY_ZONE_NAMES.map(name => ({ name, durationMin: null }))).map((row, index) => {
    const percentage = intensityTotal > 0 && Number.isFinite(row.durationMin) ? row.durationMin / intensityTotal * 100 : 0;
    return { ...row, key: `${row.name || 'unknown'}:${index}`, name: row.name || '未知体系 · 未填分区', value: row.durationMin == null ? '-- min' : `${number(row.durationMin)} min`, percentage: row.durationMin == null ? '--' : Math.round(percentage * 10) / 10, width: Math.max(0, Math.min(100, percentage)) };
  }));
  const content = withRatioColors(completeRatioRows(
    training.content || [],
    (training.content || []).length ? (training.content || []).map(row => row.name) : ((sportRules[project] || {}).contentCategories || []),
    (item) => item.count,
    (value) => `${number(value, 0)} 课次`
  ));
  // 运动员条目归一化为 athlete-selector 形状；汇总字段保留供明细展示。
  const athleteItems = athletes.map((athlete) => {
    const age = ageAt(athlete.birthDate, to);
    const athleteSummary = athlete.summary || {};
    const meta = `${athlete.gender || '性别未录入'} · ${age == null ? '年龄未录入' : `${age}岁`} · ${athlete.team || '未分队'}`;
    const body = athlete.weightKg == null ? '体重未录入' : `${number(athlete.weightKg)} kg`;
    const sessionCount = metricValue(athleteSummary.sessionCount, 0);
    const duration = athleteSummary.durationMin == null ? '--' : `${number(athleteSummary.durationMin / 60)} h`;
    const distance = athleteSummary.distanceKm == null ? '--' : `${number(athleteSummary.distanceKm)} km`;
    const load = athleteSummary.load == null ? '--' : `${number(athleteSummary.load)} AU`;
    return {
      id: athlete.id,
      name: athlete.name,
      meta,
      body,
      sessionCount,
      duration,
      distance,
      load,
      value: load,
      summary: [`课次 ${sessionCount}`, `时长 ${duration}`, `距离 ${distance}`],
    };
  });
  return { metrics, trend: trend.filter((item) => Number.isFinite(item.duration) || Number.isFinite(item.distance)),
    intensity: intensity.map((row) => (training.intensity || []).length ? row : { ...row, value: '-- min', percentage: '--' }),
    content: content.map((row) => (training.content || []).length ? row : { ...row, value: '-- 课次', percentage: '--' }),
    hasIntensity: intensityRows.some(row => Number.isFinite(row.durationMin)), hasContent: (training.content || []).length > 0,
    athleteItems, athleteTotal: athletes.length, athletePager: paginateList(athleteItems, 0, PAGE_SIZE) };
}

Page({
  data: {
    loading: true,
    error: '',
    user: null,
    canEnterTest: false, hasWaterSpecial: false,
    projects: [],
    project: '',
    range: 'month',
    from: '',
    to: '',
    teamItems: [{ id: 0, name: '全部队伍' }],
    teamIndex: 0,
    teamId: 0,
    championEvents: [],
    ...buildTrainingView({}, ''),
    viewAthleteId: 0, viewAthleteName: '', trainingError: '', testError: '', championError: '',
    athleteTotal: 0,
    // 专项测试成绩：默认少列多展开，specialTests 只保存当前可见场次。
    specialTests: [],
    specialTestsTotal: 0,
    specialTestsResultTotal: 0,
    specialTestsMoreCount: 0
  },

  onShow() { if (!isPageCacheFresh(this)) this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  loadPage() {
    this.setData({ ...buildTrainingView({}, '', this.data.project), hasWaterSpecial: false, canEnterTest: false, viewAthleteId: 0, trainingError: '', testError: '', championError: '' });
    return runPageLoad(this, {
      error: '专项训练数据加载失败。',
      scope: { range: this.data.range, showAthlete: false },
      prepare: (page, scope) => page.setData({ ...scope, teamId: 0, teamIndex: 0, hasWaterSpecial: Boolean(sportRules[scope.project]?.activities.includes('on_water')), canEnterTest: MANAGER_ROLES.includes(scope.user.role) && Boolean(sportRules[scope.project]?.activities.includes('on_water')) }),
      load: (page, scope, isLatest) => page.loadPageData({ ...scope, teamId: 0 }, true, isLatest)
    });
  },

  async loadPageData(scope, full, isLatest, withTests = full) {
    const hasWaterSpecial = Boolean(sportRules[scope.project]?.activities.includes('on_water'));
    const testsTask = withTests && hasWaterSpecial
      ? sectionRequest(() => api.specialTests(scope.from, scope.to, scope.project), '专项测试加载失败')
      : Promise.resolve(null);
    const [teams, model, training, tests] = await Promise.all([
      full ? sectionRequest(() => api.overviewTeams(scope.project), '队伍加载失败') : Promise.resolve(null),
      full && hasWaterSpecial ? sectionRequest(() => api.specialChampionModels(scope.project), '冠军模型加载失败') : Promise.resolve(null),
      sectionRequest(() => api.specialTrainingOverview(scope.from, scope.to, scope.project, scope.teamId, scope.viewAthleteId || 0), '专项训练加载失败'),
      testsTask
    ]);
    if (isLatest && !isLatest()) return null;
    const view = { ...buildTrainingView(training.value || {}, scope.to, scope.project), hasWaterSpecial, canEnterTest: hasWaterSpecial && MANAGER_ROLES.includes((scope.user || this.data.user || {}).role), trainingError: training.error };
    if (!hasWaterSpecial) { this.applyTestView(view, buildSpecialTestView(null)); view.testError = ''; view.championEvents = []; view.championError = ''; }
    if (full) {
      view.teamItems = [{ id: 0, name: '全部队伍' }].concat((teams.value || {}).teams || []);
      view.championEvents = ((model?.value || {}).events || []).slice(0, 12).map((item) => ({
        code: item.eventCode, name: item.eventName, performance: item.bestPerformance || '待核实',
        meta: [item.country, item.competition, item.location].filter(Boolean).join(' · ') || '赛事来源待配置', pace: item.pace || ''
      }));
      view.championError = model?.error || '';
      view.trainingError = training.error || teams.error;
      if (!model?.error && !teams.error) this._loadedProject = scope.project;
    }
    if (tests) {
      view.testError = tests.error;
      this.applyTestView(view, buildSpecialTestView(tests.value));
    }
    return view;
  },

  // 专项测试默认只显示最近 3 场：完整列表留在 _specialTestsAll，按需逐批追加。
  applyTestView(view, testsView) {
    this._specialTestsAll = testsView.events;
    const visible = testsView.events.slice(0, EVENT_PREVIEW_COUNT);
    view.specialTests = visible;
    view.specialTestsTotal = testsView.eventCount;
    view.specialTestsResultTotal = testsView.resultCount;
    view.specialTestsMoreCount = Math.max(0, testsView.eventCount - visible.length);
    return view;
  },

  onShowMoreTests() {
    const all = this._specialTestsAll || [];
    const visible = all.slice(0, this.data.specialTests.length + EVENT_PREVIEW_COUNT);
    this.setData({
      specialTests: visible,
      specialTestsMoreCount: Math.max(0, all.length - visible.length)
    });
  },

  // 单场成绩展开/收起：展开后显示每轮成绩与其余组合。
  onToggleTestEvent(event) {
    const index = Number(event.currentTarget.dataset.index);
    const all = this._specialTestsAll || [];
    if (!Number.isInteger(index) || !all[index]) return;
    all[index] = { ...all[index], expanded: !all[index].expanded };
    this.setData({ specialTests: all.slice(0, this.data.specialTests.length) });
  },

  // 运动员模块由 athlete-selector 承担每页 5 人分页；选中切换本页个人专项视图。
  onAthleteSelect(event) {
    const id = Number(event.detail && event.detail.id) || 0;
    const item = (this.data.athleteItems || []).find((row) => Number(row.id) === id);
    if (id && !item) return Promise.resolve();
    if (id === (Number(this.data.viewAthleteId) || 0)) return Promise.resolve();
    this.setData({ viewAthleteId: id, viewAthleteName: id ? (item.name || '') : '' });
    this.resetTrainingView(false);
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, this._loadedProject !== this.data.project, isLatest), '专项训练数据加载失败。');
  },

  onBackToTeam() {
    return this.onAthleteSelect({ detail: { id: 0 } });
  },

  onAthleteDetail(event) {
    navigateToAthlete(this, { currentTarget: { dataset: { athleteId: event.detail && event.detail.id } } }, this.data.athleteItems);
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') {
      this._loadedProject = '';
      this.setData({ teamId: 0, teamIndex: 0, teamItems: [{ id: 0, name: '全部队伍' }], championEvents: [], championError: '' });
    }
    this.resetTrainingView();
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      // 项目/时间范围变化后测试范围随之变化，需同步重拉专项测试。
      return this.loadPageData(this.data, this._loadedProject !== this.data.project, isLatest, true);
    }, '专项训练数据加载失败。');
  },

  onTeamChange(event) {
    const teamIndex = Number(event.detail.value);
    const team = this.data.teamItems[teamIndex] || this.data.teamItems[0];
    const teamId = Number(team.id) || 0;
    this.setData({ teamIndex, teamId });
    this.resetTrainingView(false);
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, this._loadedProject !== this.data.project, isLatest), '队伍数据加载失败。');
  },

  resetTrainingView(resetTests = true) {
    const tests = resetTests ? this.applyTestView({}, buildSpecialTestView(null)) : {};
    const hasWaterSpecial = Boolean(sportRules[this.data.project]?.activities.includes('on_water'));
    this.setData({ ...buildTrainingView({}, '', this.data.project), hasWaterSpecial, canEnterTest: hasWaterSpecial && MANAGER_ROLES.includes((this.data.user || {}).role), trainingError: '', ...(resetTests ? { testError: '' } : {}), ...tests });
  },

  showTrendDetail(event) {
    showTrendModal(this, event, (item) => [`训练时长：${metricValue(item.duration)} 分钟`, `训练距离：${metricValue(item.distance)} km`]);
  },

  goTestEntry() {
    if (!this.data.canEnterTest) return;
    const athleteId = Number(this.data.viewAthleteId) || Number(this.data.selectedAthleteId) || 0;
    wx.navigateTo({ url: `/pages/test-entry/test-entry?mode=special&athleteId=${athleteId}` });
  }
});
