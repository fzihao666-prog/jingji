const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { loadWithGuard } = require('../../utils/request-guard');
const { STRENGTH_METRICS } = require('../../utils/format');
const { planView, recordView, metricView, overviewView } = require('../../utils/strength-view');

const { emptyStrengthView, completeStrengthMetrics, athleteListView, sectionRequest } = require('../../utils/training-empty');
const { goToAthlete: navigateToAthlete } = require('../../utils/page-actions');

const MANAGER_ROLES = ['SCC', 'REG', 'TD', 'DMD'];

// 运动员条目归一化为 athlete-selector 形状（姓名/队伍/可检索文本）。
function athleteItems(athletes) {
  return (athletes || []).map((athlete) => ({
    id: athlete.id,
    name: athlete.name,
    meta: athlete.team || '未分队',
    searchText: `${athlete.name || ''} ${athlete.team || ''} ${athlete.project || ''}`,
  }));
}

Page({
  data: {
    ...emptyStrengthView(), ...athleteListView([]), athleteItems: [],
    loading: true, error: '', user: null, canEnterTest: false,
    projects: [], project: '', athletes: [], selectedAthleteId: 0, showAthlete: true,
    range: 'month', from: '', to: '', athleteName: '',
    activeSection: 'overview',
    sections: [{ key: 'overview', label: '概览' }, { key: 'plan', label: '训练安排' }, { key: 'records', label: '训练记录' }]
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
        page.setData({ ...emptyStrengthView(), ...athleteListView(scope.athletes), athleteItems: athleteItems(scope.athletes), ...scope, canEnterTest: MANAGER_ROLES.includes(scope.user.role) });
      },
      load: (page, scope, isLatest) => page.loadPageData(scope, isLatest)
    });
  },

  async loadPageData(scope, isLatest) {
    const athleteId = scope.selectedAthleteId;
    if (!athleteId) {
      this._source = null;
      return { ...emptyStrengthView(), ...athleteListView(scope.athletes), athleteItems: athleteItems(scope.athletes) };
    }
    const [testResult, sessionResult, planResult] = await Promise.all([
      sectionRequest(() => api.strengthTests(athleteId), '体能测试加载失败'),
      sectionRequest(() => api.strengthTrainingResults(athleteId), '体能训练加载失败'),
      sectionRequest(() => api.trainingPlans(athleteId), '训练计划加载失败')
    ]);
    if (!isLatest()) return null;
    const tests = (testResult.value || {}).tests || [];
    const sessions = [...((sessionResult.value || {}).sessions || [])]
      .sort((a, b) => String(b.trainingDate || '').localeCompare(String(a.trainingDate || '')) || b.sessionOrder - a.sessionOrder);
    const periodSessions = sessions.filter((item) => item.trainingDate >= scope.from && item.trainingDate <= scope.to);
    const plans = [...((planResult.value || {}).plans || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const metricKeys = Object.keys(STRENGTH_METRICS).filter((key) => tests.some((test) => test.metrics && typeof test.metrics[key] === 'number' && Number.isFinite(test.metrics[key])));
    this._source = { tests, sessions, periodSessions, plans, metricKeys, scope: { from: scope.from, to: scope.to } };
    const athlete = scope.athletes.find((item) => Number(item.id) === Number(athleteId));
    const overview = overviewView(tests, periodSessions, scope);
    return {
      ...athleteListView(scope.athletes),
      athleteItems: athleteItems(scope.athletes),
      trainingError: sessionResult.error, testError: testResult.error, planError: planResult.error,
      athleteName: athlete ? athlete.name : '',
      ...overview,
      summaryCards: sessionResult.error ? overview.summaryCards.map((row) => ({ ...row, value: '--' })) : overview.summaryCards,
      metrics: completeStrengthMetrics(overview.metrics),
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
    this.setData({ ...emptyStrengthView(), ...athleteListView(this.data.athletes), athleteItems: athleteItems(this.data.athletes) });
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      return this.loadPageData(this.data, isLatest);
    }, '体能训练数据加载失败。');
  },

  // 运动员模块由 athlete-selector 承担搜索与 5 人分页；点选切换本页体能分析。
  onAthleteSelect(event) {
    const id = Number(event.detail && event.detail.id) || 0;
    if (!id || !(this.data.athletes || []).some((item) => Number(item.id) === id)) return Promise.resolve();
    if (id === (Number(this.data.selectedAthleteId) || 0)) return Promise.resolve();
    this._source = null;
    getApp().globalData.selectedAthleteId = id;
    this.setData({ ...emptyStrengthView(), selectedAthleteId: id });
    return loadWithGuard(this, this._guard, (isLatest) => this.loadPageData(this.data, isLatest), '体能训练数据加载失败。');
  },

  onAthleteDetail(event) {
    navigateToAthlete(this, { currentTarget: { dataset: { athleteId: event.detail && event.detail.id } } }, this.data.athletes);
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
