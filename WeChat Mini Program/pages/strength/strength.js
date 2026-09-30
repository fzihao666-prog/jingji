const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { loadWithGuard } = require('../../utils/request-guard');
const { STRENGTH_METRICS } = require('../../utils/format');
const { planView, recordView, metricView, overviewView } = require('../../utils/strength-view');

const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

Page({
  data: {
    loading: true, error: '', user: null, canEnterTest: false,
    projects: [], project: '', athletes: [], selectedAthleteId: 0, showAthlete: true,
    range: 'month', from: '', to: '', athleteName: '',
    activeSection: 'overview',
    sections: [{ key: 'overview', label: '概览' }, { key: 'plan', label: '训练安排' }, { key: 'records', label: '训练记录' }],
    summaryCards: [], metrics: [], championMetrics: [], trend: [], structure: [],
    planLabels: [], planExercises: [], weekLabels: [], categories: [],
    metricLabels: [], metricHistory: [], records: [], recordDate: '', expandedRecord: ''
  },

  onShow() { if (!isPageCacheFresh(this)) this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  loadPage() {
    return runPageLoad(this, {
      error: '体能训练数据加载失败。',
      scope: { range: this.data.range },
      prepare: (page, scope) => {
        this._source = null;
        getApp().globalData.selectedAthleteId = scope.selectedAthleteId;
        page.setData({ ...scope, canEnterTest: MANAGER_ROLES.includes(scope.user.role) });
      },
      load: (page, scope, isLatest) => page.loadPageData(scope, isLatest)
    });
  },

  async loadPageData(scope, isLatest) {
    const athleteId = scope.selectedAthleteId;
    if (!athleteId) { this._source = null; return {}; }
    const [testResult, sessionResult, planResult] = await Promise.all([
      api.strengthTests(athleteId), api.strengthTrainingResults(athleteId), api.trainingPlans(athleteId)
    ]);
    if (!isLatest()) return null;
    const tests = testResult.tests || [];
    const sessions = [...(sessionResult.sessions || [])]
      .sort((a, b) => b.trainingDate.localeCompare(a.trainingDate) || b.sessionOrder - a.sessionOrder);
    const periodSessions = sessions.filter((item) => item.trainingDate >= scope.from && item.trainingDate <= scope.to);
    const plans = [...(planResult.plans || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const metricKeys = Object.keys(STRENGTH_METRICS).filter((key) => tests.some((test) => test.metrics && typeof test.metrics[key] === 'number' && Number.isFinite(test.metrics[key])));
    this._source = { tests, sessions, periodSessions, plans, metricKeys, scope: { from: scope.from, to: scope.to } };
    const athlete = scope.athletes.find((item) => Number(item.id) === Number(athleteId));
    return {
      athleteName: athlete ? athlete.name : '',
      ...overviewView(tests, periodSessions, scope),
      planLabels: plans.map((plan) => `${plan.data.title || '体能训练计划'} · ${plan.data.startDate || '日期待补'}`),
      ...planView(plans), ...recordView(periodSessions),
      metricLabels: metricKeys.map((key) => STRENGTH_METRICS[key][0]), metricIndex: 0, metricRange: 0,
      metricRanges: ['当前周期', '全部历史'],
      ...metricView(tests, metricKeys[0], scope)
    };
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    this._source = null;
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      return this.loadPageData(this.data, isLatest);
    }, '体能训练数据加载失败。');
  },

  switchSection(event) {
    const activeSection = event.currentTarget.dataset.key;
    if (this.data.sections.some((section) => section.key === activeSection)) this.setData({ activeSection });
  },

  onPlanChange(event) {
    const index = Number(event.detail.value);
    if (!this._source || !Number.isInteger(index) || !this._source.plans[index]) return;
    this.setData(planView(this._source.plans, index));
  },

  onWeekChange(event) {
    const index = Number(event.detail.value);
    if (!this._source || !Number.isInteger(index) || !this.data.weekLabels[index]) return;
    this.setData(planView(this._source.plans, this.data.planIndex, index, this.data.categories[this.data.categoryIndex]));
  },

  onCategoryChange(event) {
    const category = this.data.categories[Number(event.detail.value)];
    if (!this._source || !category) return;
    this.setData(planView(this._source.plans, this.data.planIndex, this.data.weekIndex, category));
  },

  toggleExercise(event) {
    const id = String(event.currentTarget.dataset.id);
    this.setData({ expandedExercise: this.data.expandedExercise === id ? '' : id });
  },

  onRecordDate(event) {
    const date = event.detail.value;
    if (!this._source || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > this.data.to) return;
    this.setData(recordView(this._source.sessions, date));
  },

  clearRecordDate() {
    if (this._source) this.setData(recordView(this._source.periodSessions));
  },

  showMoreRecords() {
    if (this._source) this.setData(recordView(this.data.recordDate ? this._source.sessions : this._source.periodSessions, this.data.recordDate, this.data.recordLimit + 12, this.data.expandedRecord));
  },

  toggleRecord(event) {
    if (!this._source) return;
    const id = String(event.currentTarget.dataset.id);
    this.setData(recordView(this.data.recordDate ? this._source.sessions : this._source.periodSessions, this.data.recordDate, this.data.recordLimit, this.data.expandedRecord === id ? '' : id));
  },

  onMetricChange(event) {
    const index = Number(event.detail.value);
    if (!this._source || !Number.isInteger(index) || !this._source.metricKeys[index]) return;
    this.setData({ metricIndex: index, ...metricView(this._source.tests, this._source.metricKeys[index], this.data.metricRange === 1 ? { from: '', to: '9999-12-31' } : this._source.scope) });
  },

  onMetricRange(event) {
    const metricRange = Number(event.detail.value);
    if (!this._source || ![0, 1].includes(metricRange)) return;
    this.setData({ metricRange, ...metricView(this._source.tests, this._source.metricKeys[this.data.metricIndex], metricRange === 1 ? { from: '', to: '9999-12-31' } : this._source.scope) });
  },

  showTrendDetail(event) {
    const row = this.data.trend[Number(event.currentTarget.dataset.index)];
    if (!row) return;
    wx.showModal({ title: row.date, content: `训练时长：${row.durationText} 分钟\nSRPE负荷：${row.loadText} AU`, showCancel: false });
  },

  goTestEntry() {
    if (!this.data.canEnterTest) return;
    wx.navigateTo({ url: `/pages/test-entry/test-entry?mode=strength&athleteId=${Number(this.data.selectedAthleteId) || 0}` });
  }
});
