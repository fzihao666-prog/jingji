const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { loadWithGuard } = require('../../utils/request-guard');
const { durationDistanceLines, showTrendModal, goToAthlete: navigateToAthlete } = require('../../utils/page-actions');
const { shortDate, ageAt } = require('../../utils/date');
const { number, raceTime, raceDelta } = require('../../utils/format');
const { displaySeries, trendPlaceholder, completeRatioRows, INTENSITY_FILL, CONTENT_FILL } = require('../../utils/chart-placeholder');
const { paginateList, PAGE_SIZE } = require('../../utils/pagination');
const { injuryMetricView } = require('../../utils/injury-metric');

// 与服务端管理角色口径一致；仅这些角色可现场录入测试成绩。
const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

function buildTrainingView(result, to) {
  const training = result.training || {};
  const athletes = result.athletes || [];
  const summary = training.summary || {};
  const metrics = [
    { label: '专项训练时长', value: summary.durationMin == null ? '—' : number(summary.durationMin / 60), unit: summary.durationMin == null ? '' : 'h', note: '同队共同课次去重' },
    { label: '专项训练距离', value: number(summary.distanceKm), unit: 'km', note: '只统计已填报距离' },
    { label: '专项训练课次', value: number(summary.sessionCount, 0), unit: '课次', note: '当前筛选时间范围' },
    { label: '专项训练负荷', value: number(summary.load), unit: 'AU', note: '使用既有SRPE' },
    injuryMetricView(result.injuries || [], Boolean(result.injuryIndividual))
  ];

  const days = (training.days || []).slice(-14);
  const maxDuration = Math.max(1, ...days.map((item) => Number(item.durationMin || 0)));
  const maxDistance = Math.max(1, ...days.map((item) => Number(item.distanceKm || 0)));
  const trend = days.map((item) => ({
    date: item.date,
    label: shortDate(item.date),
    duration: Number(item.durationMin || 0),
    distance: Number(item.distanceKm || 0),
    ariaLabel: `${item.date}，训练时长${Number(item.durationMin || 0)}分钟，训练距离${Number(item.distanceKm || 0)}公里`,
    durationHeight: Math.max(2, Math.round(Number(item.durationMin || 0) / maxDuration * 100)),
    distanceHeight: Math.max(2, Math.round(Number(item.distanceKm || 0) / maxDistance * 100))
  }));

  // 强度/课次占比的缺失分类用演示补全表补齐后按真实数据展示（临时约定，见 utils/chart-placeholder.js）。
  const intensity = completeRatioRows(
    training.intensity || [],
    INTENSITY_FILL,
    (item) => item.durationMin,
    (value) => `${number(value)} min`
  );
  const content = completeRatioRows(
    training.content || [],
    CONTENT_FILL,
    (item) => item.count,
    (value) => `${number(value, 0)} 课次`
  );
  const trendDisplay = displaySeries(trend, trendPlaceholder('special'), trend.some((item) => item.duration > 0 || item.distance > 0));
  const athleteRows = athletes.slice(0, 30).map((athlete) => {
    const age = ageAt(athlete.birthDate, to);
    return {
      id: athlete.id,
      name: athlete.name,
      meta: `${athlete.gender || '性别未录入'} · ${age == null ? '年龄未录入' : `${age}岁`} · ${athlete.team || '未分队'}`,
      body: athlete.weightKg == null ? '体重未录入' : `${number(athlete.weightKg)} kg`,
      sessionCount: athlete.summary.sessionCount,
      duration: athlete.summary.durationMin == null ? '—' : `${number(athlete.summary.durationMin / 60)} h`,
      distance: athlete.summary.distanceKm == null ? '—' : `${number(athlete.summary.distanceKm)} km`,
      load: athlete.summary.load == null ? '—' : `${number(athlete.summary.load)} AU`
    };
  });
  return { metrics, trend: trendDisplay.data, trendPlaceholder: trendDisplay.isPlaceholder,
    intensity, content,
    athleteRows, athleteRowsAll: athleteRows, athleteTotal: athletes.length };
}

Page({
  data: {
    loading: true,
    error: '',
    user: null,
    canEnterTest: false,
    projects: [],
    project: '',
    range: 'month',
    from: '',
    to: '',
    teamItems: [{ id: 0, name: '全部队伍' }],
    teamIndex: 0,
    teamId: 0,
    championEvents: [],
    metrics: [],
    trend: [],
    intensity: [],
    content: [],
    athleteRows: [],
    athleteTotal: 0,
    athletePager: null
  },

  onShow() { if (!isPageCacheFresh(this)) this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  loadPage() {
    return runPageLoad(this, {
      error: '专项训练数据加载失败。',
      scope: { range: this.data.range, showAthlete: false },
      prepare: (page, scope) => page.setData({ ...scope, teamId: 0, teamIndex: 0, canEnterTest: MANAGER_ROLES.includes(scope.user.role) }),
      load: (page, scope, isLatest) => page.loadPageData({ ...scope, teamId: 0 }, true, isLatest)
    });
  },

  async loadPageData(scope, full, isLatest) {
    if (!full) {
      const result = await api.specialTrainingOverview(scope.from, scope.to, scope.project, scope.teamId);
      return this.applyAthletePager(buildTrainingView(result, scope.to));
    }
    const [teamResult, modelResult, trainingResult] = await Promise.all([
      api.overviewTeams(scope.project),
      api.specialChampionModels(scope.project),
      api.specialTrainingOverview(scope.from, scope.to, scope.project, scope.teamId)
    ]);
    let specialTestsData;
    try {
      const st = await api.specialTests(scope.from, scope.to, scope.project);
      // WXML 不能调用数组方法，标题、成绩与差值都在 JS 侧预先组装成展示字符串。
      specialTestsData = (st.events || []).map((ev) => {
        const titleParts = [
          ev.distanceM ? `${ev.distanceM} 米` : '',
          ev.boatClass || '',
          ev.genderGroup || '',
          ev.session || ''
        ].filter(Boolean);
        return {
          id: ev.id,
          title: titleParts.join(' · ') || '专项测试',
          testDate: ev.testDate || '',
          meta: [ev.windConditions, ev.location].filter(Boolean).join(' · '),
          results: (ev.results || []).map((r, index) => ({
            key: `${ev.id}-${index}`,
            rank: r.rank || index + 1,
            crewName: r.crewName || '单人',
            memberText: Array.isArray(r.memberNames) ? r.memberNames.filter(Boolean).join(' · ') : '',
            attemptsText: Array.isArray(r.attemptsMs) && r.attemptsMs.length
              ? r.attemptsMs.map(raceTime).filter(Boolean).join(' / ') || '无成绩'
              : '无成绩',
            bestText: r.bestMs != null ? raceTime(r.bestMs) : '',
            deltaText: r.deltaPreviousMs == null ? '' : raceDelta(r.deltaPreviousMs),
            deltaTone: r.deltaPreviousMs == null || Number(r.deltaPreviousMs) === 0
              ? 'flat'
              : Number(r.deltaPreviousMs) < 0 ? 'faster' : 'slower'
          }))
        };
      });
    } catch {
      specialTestsData = [];
    }
    const teamItems = [{ id: 0, name: '全部队伍' }].concat(teamResult.teams || []);
    const championEvents = (modelResult.events || []).slice(0, 12).map((item) => ({
      code: item.eventCode,
      name: item.eventName,
      performance: item.bestPerformance || '待核实',
      meta: [item.country, item.competition, item.location].filter(Boolean).join(' · ') || '赛事来源待配置',
      pace: item.pace || ''
    }));
    if (isLatest && isLatest()) this._loadedProject = scope.project;
    const view = { teamItems, championEvents, specialTests: specialTestsData, ...buildTrainingView(trainingResult, scope.to) };
    return this.applyAthletePager(view);
  },

  // 运动员汇总列表统一分页：每页 5 人；队伍/项目筛选变化后回到第一页。
  applyAthletePager(view) {
    const teamChanged = this._pagedTeamId !== undefined && this._pagedTeamId !== this.data.teamId;
    this._pagedTeamId = this.data.teamId;
    const page = teamChanged ? 0 : this.data.athletePager && this.data.athletePager.page || 0;
    const model = paginateList(view.athleteRowsAll, page, PAGE_SIZE);
    view.athleteRows = model.items;
    view.athletePager = model;
    return view;
  },

  onAthletePagerChange(event) {
    const page = Number(event.detail && event.detail.page);
    if (!Number.isInteger(page)) return;
    const model = paginateList(this.data.athleteRowsAll, page, PAGE_SIZE);
    this.setData({ athleteRows: model.items, athletePager: model });
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') {
      this._loadedProject = '';
      this.setData({ teamId: 0, teamIndex: 0, teamItems: [{ id: 0, name: '全部队伍' }], championEvents: [], metrics: [], trend: [], intensity: [], content: [], athleteRows: [], athleteRowsAll: [], athletePager: null, athleteTotal: 0 });
    }
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      return this.loadPageData(this.data, this._loadedProject !== this.data.project, isLatest);
    }, '专项训练数据加载失败。');
  },

  onTeamChange(event) {
    const teamIndex = Number(event.detail.value);
    const team = this.data.teamItems[teamIndex] || this.data.teamItems[0];
    const teamId = Number(team.id) || 0;
    this.setData({ teamIndex, teamId });
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, this._loadedProject !== this.data.project, isLatest), '队伍数据加载失败。');
  },

  showTrendDetail(event) {
    showTrendModal(this, event, durationDistanceLines);
  },

  goTestEntry() {
    if (!this.data.canEnterTest) return;
    const athleteId = Number(this.data.selectedAthleteId) || 0;
    wx.navigateTo({ url: `/pages/test-entry/test-entry?mode=special&athleteId=${athleteId}` });
  },

  goToAthlete(event) {
    navigateToAthlete(this, event, this.data.athleteRows);
  }
});
