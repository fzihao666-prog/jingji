const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { loadWithGuard } = require('../../utils/request-guard');
const { durationLoadLines, showTrendModal } = require('../../utils/page-actions');
const { shortDate } = require('../../utils/date');
const { number, strengthMetricRows } = require('../../utils/format');
const { displaySeries, trendPlaceholder } = require('../../utils/chart-placeholder');

// 与服务端管理角色口径一致；仅这些角色可现场录入测试成绩。
const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

function planRows(plan) {
  if (!plan || !plan.data) return [];
  return (plan.data.exercises || []).slice(0, 12).map((exercise) => {
    const weekEntries = (exercise.lines || []).flatMap((line) => Object.keys(line.weeks || {}).map((key) => line.weeks[key]));
    const arrangements = weekEntries.filter((entry) => entry && (entry.sets || entry.reps || entry.percentage != null));
    return {
      id: exercise.id,
      name: exercise.name,
      max: exercise.maxWeight == null ? 'MAX未录入' : `MAX ${number(exercise.maxWeight)} kg`,
      arrangement: arrangements.length ? `${arrangements.length} 项周安排` : '训练安排待补充',
      category: exercise.category || '训练项目'
    };
  });
}

function buildStrengthView(athlete, tests, sessions, plans, period) {
  const periodSessions = (sessions || []).filter((item) => item.trainingDate >= period.from && item.trainingDate <= period.to);
  const periodTests = (tests || []).filter((item) => item.testDate >= period.from && item.testDate <= period.to);
  const latestTest = [...periodTests].sort((a, b) => b.testDate.localeCompare(a.testDate))[0]
    || [...(tests || [])].sort((a, b) => b.testDate.localeCompare(a.testDate))[0]
    || null;
  const latestPlan = [...(plans || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  const totalDuration = periodSessions.reduce((sum, item) => sum + Number(item.durationMin || 0), 0);
  const totalLoad = periodSessions.reduce((sum, item) => sum + Number(item.srpe || 0), 0);
  const completedSets = periodSessions.reduce((sum, item) => sum + (item.sets || []).filter((set) => set.completed).length, 0);
  const metrics = strengthMetricRows(latestTest).slice(0, 10);
  const summaryCards = [
    { label: '体能训练次数', value: number(periodSessions.length, 0), unit: '场', note: `${period.from} 至 ${period.to}` },
    { label: '总训练时长', value: number(totalDuration / 60), unit: 'h', note: '按已记录训练时长汇总' },
    { label: '体能训练负荷', value: number(totalLoad, 0), unit: 'AU', note: '使用已有SRPE' },
    { label: '完成训练组', value: number(completedSets, 0), unit: '组', note: '按已确认训练结果统计' }
  ];

  const dates = [...new Set(periodSessions.map((item) => item.trainingDate))].sort();
  const dayRows = dates.map((date) => {
    const rows = periodSessions.filter((item) => item.trainingDate === date);
    return {
      date,
      duration: rows.reduce((sum, item) => sum + Number(item.durationMin || 0), 0),
      load: rows.reduce((sum, item) => sum + Number(item.srpe || 0), 0)
    };
  }).slice(-14);
  const maxDuration = Math.max(1, ...dayRows.map((item) => item.duration));
  const maxLoad = Math.max(1, ...dayRows.map((item) => item.load));
  const trend = dayRows.map((item) => ({
    date: item.date,
    label: shortDate(item.date),
    duration: item.duration,
    load: item.load,
    ariaLabel: `${item.date}，训练时长${item.duration}分钟，训练负荷${item.load}AU`,
    durationHeight: Math.max(2, Math.round(item.duration / maxDuration * 100)),
    loadHeight: Math.max(2, Math.round(item.load / maxLoad * 100))
  }));
  const trendDisplay = displaySeries(trend, trendPlaceholder('strength'), trend.some((item) => item.duration > 0 || item.load > 0));

  const recentSessions = [...periodSessions].sort((a, b) => b.trainingDate.localeCompare(a.trainingDate) || b.sessionOrder - a.sessionOrder).slice(0, 12).map((item) => ({
    id: item.id,
    title: item.sessionLabel || item.trainingType || '体能训练',
    date: item.trainingDate,
    meta: `${item.durationMin || 0} min · RPE ${item.rpe == null ? '—' : number(item.rpe)} · ${(item.sets || []).length} 组记录`,
    load: `${number(item.srpe, 0)} AU`,
    source: item.source || '手工记录'
  }));

  return {
    athleteName: athlete ? athlete.name : '',
    summaryCards,
    metrics,
    championMetrics: metrics.slice(0, 4),
    latestTestDate: latestTest ? latestTest.testDate : '',
    latestPlan: latestPlan ? {
      title: latestPlan.data.title || '四周体能训练计划',
      period: `${latestPlan.data.startDate || '—'} 至 ${latestPlan.data.endDate || '—'}`,
      summary: latestPlan.data.summary || latestPlan.data.scheduleLabel || '由教练维护',
      updated: latestPlan.updatedAt,
      updatedBy: latestPlan.updatedBy
    } : null,
    planExercises: planRows(latestPlan),
    trend: trendDisplay.data,
    trendPlaceholder: trendDisplay.isPlaceholder,
    recentSessions
  };
}

Page({
  data: {
    loading: true,
    error: '',
    user: null,
    canEnterTest: false,
    projects: [],
    project: '',
    athletes: [],
    selectedAthleteId: 0,
    showAthlete: true,
    range: 'month',
    from: '',
    to: '',
    athleteName: '',
    summaryCards: [],
    metrics: [],
    championMetrics: [],
    latestTestDate: '',
    latestPlan: null,
    planExercises: [],
    trend: [],
    recentSessions: []
  },

  onShow() { if (!isPageCacheFresh(this)) this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  loadPage() {
    return runPageLoad(this, {
      error: '体能训练数据加载失败。',
      scope: { range: this.data.range },
      prepare: (page, scope) => {
        getApp().globalData.selectedAthleteId = scope.selectedAthleteId;
        page.setData({ ...scope, canEnterTest: MANAGER_ROLES.includes(scope.user.role) });
      }
    });
  },

  async loadPageData(scope) {
    const athleteId = scope.selectedAthleteId;
    if (!athleteId) return { athleteName: '', summaryCards: [], metrics: [], championMetrics: [], latestPlan: null, planExercises: [], trend: [], recentSessions: [] };
    const athlete = scope.athletes.find((item) => Number(item.id) === Number(athleteId));
    const [testResult, sessionResult, planResult] = await Promise.all([
      api.strengthTests(athleteId),
      api.strengthTrainingResults(athleteId),
      api.trainingPlans(athleteId)
    ]);
    return buildStrengthView(athlete, testResult.tests, sessionResult.sessions, planResult.plans, scope);
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') this.setData({ athleteName: '', summaryCards: [], metrics: [], championMetrics: [], latestTestDate: '', latestPlan: null, planExercises: [], trend: [], recentSessions: [] });
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      return this.loadPageData(this.data);
    }, '体能训练数据加载失败。');
  },

  showTrendDetail(event) {
    showTrendModal(this, event, durationLoadLines);
  },

  goTestEntry() {
    if (!this.data.canEnterTest) return;
    const athleteId = Number(this.data.selectedAthleteId) || 0;
    wx.navigateTo({ url: `/pages/test-entry/test-entry?mode=strength&athleteId=${athleteId}` });
  }
});
