const api = require('../../services/api');
const { loadContext, projectAthletes } = require('../../utils/context');
const { periodFor, shortDate } = require('../../utils/date');
const { number, strengthMetricRows } = require('../../utils/format');

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
    durationHeight: Math.max(2, Math.round(item.duration / maxDuration * 100)),
    loadHeight: Math.max(2, Math.round(item.load / maxLoad * 100))
  }));

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
    trend,
    recentSessions
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

  onShow() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const context = await loadContext();
      const athletes = projectAthletes(context.athletes, context.project);
      const selectedAthleteId = context.user.athleteId || context.selectedAthleteId || (athletes[0] && athletes[0].id) || 0;
      const period = periodFor(this.data.range);
      getApp().globalData.selectedAthleteId = selectedAthleteId;
      this.setData({ user: context.user, projects: context.projects, project: context.project, athletes, selectedAthleteId, showAthlete: context.user.role !== 'ATL', from: period.from, to: period.to });
      await this.loadAthlete(selectedAthleteId, period);
    } catch (error) {
      if (error.message !== '未登录') this.setData({ error: error.message || '体能训练数据加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadAthlete(athleteId, period) {
    if (!athleteId) {
      this.setData({ athleteName: '', summaryCards: [], metrics: [], championMetrics: [], latestPlan: null, planExercises: [], trend: [], recentSessions: [] });
      return;
    }
    const athlete = this.data.athletes.find((item) => Number(item.id) === Number(athleteId));
    const [testResult, sessionResult, planResult] = await Promise.all([
      api.strengthTests(athleteId),
      api.strengthTrainingResults(athleteId),
      api.trainingPlans(athleteId)
    ]);
    this.setData(buildStrengthView(athlete, testResult.tests, sessionResult.sessions, planResult.plans, period));
  },

  async onProjectChange(event) {
    const project = event.detail.value;
    const app = getApp();
    const athletes = projectAthletes(app.globalData.athletes, project);
    const selectedAthleteId = app.globalData.user.athleteId || (athletes[0] && athletes[0].id) || 0;
    const period = periodFor(this.data.range);
    app.setProject(project);
    app.globalData.selectedAthleteId = selectedAthleteId;
    this.setData({ project, athletes, selectedAthleteId, from: period.from, to: period.to, loading: true, error: '' });
    try {
      await api.saveCurrentProject(project);
      await this.loadAthlete(selectedAthleteId, period);
    } catch (error) {
      this.setData({ error: error.message || '项目切换失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onAthleteChange(event) {
    const selectedAthleteId = Number(event.detail.value) || 0;
    getApp().globalData.selectedAthleteId = selectedAthleteId;
    this.setData({ selectedAthleteId, loading: true, error: '' });
    try {
      await this.loadAthlete(selectedAthleteId, { from: this.data.from, to: this.data.to });
    } catch (error) {
      this.setData({ error: error.message || '运动员体能数据加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onRangeChange(event) {
    const range = event.detail.value;
    const period = periodFor(range);
    this.setData({ range, from: period.from, to: period.to, loading: true, error: '' });
    try {
      await this.loadAthlete(this.data.selectedAthleteId, period);
    } catch (error) {
      this.setData({ error: error.message || '时间范围加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  showTrendDetail(event) {
    const item = this.data.trend[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    wx.showModal({
      title: item.date,
      content: `训练时长：${number(item.duration)} 分钟\n训练负荷：${number(item.load, 0)} AU`,
      showCancel: false
    });
  }
});
