const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { draftIdentity, loadFormDraft, saveFormDraft, clearFormDraft, sameForm } = require('../../utils/form-draft');
const {
  METRICS,
  STATUS_OPTIONS,
  COACH_STATUS_OPTIONS,
  QUICK_SELECT,
  wellnessDates,
  defaultWellnessForm,
  wellnessPayload,
  wellnessFormFromRecord,
  wellnessRecordView
} = require('../../utils/wellness-form');
const {
  TREND_METRICS,
  statusMetricCards,
  buildStatusTrend,
  buildStatusHistory,
  buildTeamStatusView
} = require('../../utils/status-detection');

const MANAGER_ROLES = ['SCC', 'REG', 'TD', 'DMD'];

Page({
  data: {
    loading: true,
    saving: false,
    error: '',
    isCoach: false,
    athleteId: 0,
    athleteName: '',
    athleteOptions: [],
    athleteIndex: 0,
    min: '',
    max: '',
    form: defaultWellnessForm(),
    fieldDefs: METRICS,
    statusOptions: STATUS_OPTIONS,
    quickSelect: QUICK_SELECT,
    record: null,
    recordView: null,
    // 状态检测：指标卡、单指标趋势、历史记录与教练队伍概览。
    todayDate: '',
    statusCards: statusMetricCards(null, null),
    trendMetrics: TREND_METRICS,
    activeTrendKey: TREND_METRICS[0].key,
    statusTrend: buildStatusTrend([], TREND_METRICS[0].key),
    statusHistory: [],
    trendLoading: false,
    trendError: '',
    teamStatus: null,
    teamStatusLoading: false,
    teamStatusError: ''
  },

  onLoad(options) {
    // 教练代填入口可携带目标运动员；本人填报忽略该参数。
    this._targetAthleteId = Number(options && options.athleteId) || 0;
    this.loadPage();
  },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },
  retryLoad() { this.loadPage(); },

  statusOptionsFor(isCoach) {
    return isCoach ? COACH_STATUS_OPTIONS : STATUS_OPTIONS;
  },

  loadPage() {
    const dates = wellnessDates();
    this.setData({ min: dates.min, max: dates.max, todayDate: dates.max });
    this._guard = this._guard || createRequestGuard();
    return loadWithGuard(this, this._guard, async () => {
      const context = await loadContext({ refreshUser: true });
      const isCoach = MANAGER_ROLES.includes(context.user.role);
      if (!isCoach && context.user.role !== 'ATL') throw new Error('只有运动员本人或教练可以填写恢复日报。');
      this._project = context.project;
      if (isCoach) {
        const athletes = context.projectAthletes || [];
        if (!athletes.length) throw new Error('当前项目暂无可代填的运动员。');
        let index = athletes.findIndex((item) => Number(item.id) === this._targetAthleteId);
        if (index < 0) index = athletes.findIndex((item) => Number(item.id) === Number(context.selectedAthleteId));
        if (index < 0) index = 0;
        const target = athletes[index];
        this._targetAthleteId = Number(target.id);
        this._athletes = athletes;
        this.setData({
          isCoach: true,
          athleteId: Number(target.id),
          athleteName: target.name || '',
          athleteOptions: athletes.map((item) => item.name || `运动员${item.id}`),
          athleteIndex: index,
          statusOptions: this.statusOptionsFor(true)
        });
      } else {
        this._targetAthleteId = Number(context.user.athleteId) || 0;
        this.setData({ isCoach: false, athleteId: this._targetAthleteId, statusOptions: this.statusOptionsFor(false) });
      }
      const recordPromise = this.loadRecord(this.data.form.date);
      await Promise.all([recordPromise, this.loadStatusTrends(), this.loadTeamStatus()]);
      return recordPromise;
    }, '恢复日报加载失败。');
  },

  // 近期趋势与历史记录：本人/代填对象的 wellness-trends（含疲劳项），一次只画一个指标。
  async loadStatusTrends() {
    const athleteId = this._targetAthleteId;
    const project = this._project;
    if (!athleteId || !project) return;
    this._trendGuard = this._trendGuard || createRequestGuard();
    const id = this._trendGuard.next();
    this.setData({ trendLoading: true, trendError: '' });
    try {
      const dates = wellnessDates();
      const fromDate = new Date(`${dates.max}T00:00:00Z`);
      fromDate.setUTCDate(fromDate.getUTCDate() - 13);
      const from = fromDate.toISOString().slice(0, 10);
      const result = await api.wellnessTrends(athleteId, from, dates.max, project);
      if (!this._trendGuard.isLatest(id)) return;
      const trends = (result && result.trends) || [];
      this._trends = trends;
      this.applyStatusViews(this.data.record);
    } catch (error) {
      if (this._trendGuard.isLatest(id)) {
        this._trends = [];
        this.setData({
          trendLoading: false,
          trendError: error.message || '恢复趋势加载失败，请重试。',
          statusTrend: buildStatusTrend([], this.data.activeTrendKey),
          statusHistory: []
        });
        this.applyStatusViews(this.data.record);
      }
      return;
    }
    if (this._trendGuard.isLatest(id)) this.setData({ trendLoading: false });
  },

  // 教练队伍概览：应填/已填/未填与需要关注名单（自评异常或 24 小时高负荷）。
  async loadTeamStatus() {
    if (!this.data.isCoach || !this._project) return;
    this._teamStatusGuard = this._teamStatusGuard || createRequestGuard();
    const id = this._teamStatusGuard.next();
    this.setData({ teamStatusLoading: true, teamStatusError: '' });
    try {
      const result = await api.teamOverview(this._project);
      if (!this._teamStatusGuard.isLatest(id)) return;
      this.setData({ teamStatusLoading: false, teamStatus: buildTeamStatusView(result) });
    } catch (error) {
      if (this._teamStatusGuard.isLatest(id)) {
        this.setData({ teamStatusLoading: false, teamStatus: null, teamStatusError: error.message || '队伍状态加载失败，请重试。' });
      }
    }
  },

  applyStatusViews(record) {
    const trends = this._trends || [];
    const rpeSeries = trends.find((item) => item.key === 'rpe');
    const rpePoint = ((rpeSeries && rpeSeries.points) || []).find((point) => point.date === this.data.form.date);
    this.setData({
      statusCards: statusMetricCards(record, rpePoint ? rpePoint.personalValue : null),
      statusTrend: buildStatusTrend(trends, this.data.activeTrendKey),
      statusHistory: buildStatusHistory(trends, 7)
    });
  },

  onTrendMetricChange(event) {
    const key = event.currentTarget.dataset.key;
    if (!TREND_METRICS.some((item) => item.key === key) || key === this.data.activeTrendKey) return;
    this.setData({
      activeTrendKey: key,
      statusTrend: buildStatusTrend(this._trends || [], key)
    });
  },

  retryTrends() {
    return this.loadStatusTrends();
  },

  retryTeamStatus() {
    return this.loadTeamStatus();
  },

  scrollToForm() {
    wx.pageScrollTo({ selector: '#wellness-form', duration: 200 });
  },

  onAthleteChange(event) {
    const index = Number(event.detail.value) || 0;
    const candidate = (this._athletes || [])[index];
    if (!candidate || Number(candidate.id) === Number(this.data.athleteId)) return;
    this._targetAthleteId = Number(candidate.id);
    this.setData({ athleteIndex: index, form: defaultWellnessForm() });
    this.loadPage();
  },

  async loadRecord(date) {
    this.setData({ loading: true, error: '' });
    try {
      const options = this.statusOptionsFor(this.data.isCoach);
      const result = this.data.isCoach
        ? await api.athleteWellness(this.data.athleteId, date)
        : await api.myWellness(date);
      const record = (result && result.record) || null;
      this.setData({
        loading: false,
        record,
        recordView: wellnessRecordView(record, options),
        form: wellnessFormFromRecord(record, date, options)
      });
      this.applyStatusViews(record);
      this.restoreDraft(date);
    } catch (error) {
      this.setData({ loading: false, error: error.message || '恢复日报加载失败。' });
    }
  },

  // 弱网草稿按日期区分：换日期时不串稿，只暂存表单内容本身。
  draftKeyFor(date) {
    return `${draftIdentity(this.data.isCoach, this.data.athleteId)}:${date || this.data.form.date}`;
  },

  persistDraft() {
    const defaults = { ...defaultWellnessForm(), date: this.data.form.date };
    saveFormDraft(wx, 'wellness-entry', this.draftKeyFor(this.data.form.date), this.data.form, defaults);
  },

  clearDraft() {
    clearFormDraft(wx, 'wellness-entry', this.draftKeyFor(this.data.form.date));
  },

  restoreDraft(date) {
    const key = this.draftKeyFor(date);
    this._draftPrompted = this._draftPrompted || {};
    if (this._draftPrompted[key]) return;
    this._draftPrompted[key] = true;
    const draft = loadFormDraft(wx, 'wellness-entry', key);
    if (!draft) return;
    if (sameForm(draft, this.data.form)) {
      // 草稿与服务端回填一致时无需提示，顺手清掉避免下次误提示。
      clearFormDraft(wx, 'wellness-entry', key);
      return;
    }
    wx.showModal({
      title: '恢复未保存的内容',
      content: '检测到该日期恢复日报有未保存的填写内容，是否恢复继续填写？',
      confirmText: '恢复',
      cancelText: '重新填写',
      success: (result) => {
        if (result.confirm) {
          this.setData({ form: { ...defaultWellnessForm(), ...draft } });
        } else {
          clearFormDraft(wx, 'wellness-entry', key);
        }
      }
    });
  },

  onInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
    this.persistDraft();
  },

  onQuickSelect(event) {
    const { field, value } = event.currentTarget.dataset;
    if (!field || value === undefined) return;
    this.setData({ [`form.${field}`]: String(value) });
    this.persistDraft();
  },

  onDateChange(event) {
    const date = event.detail.value;
    this.setData({ 'form.date': date });
    return this.loadRecord(date);
  },

  onStatusChange(event) {
    this.setData({ 'form.statusIndex': Number(event.detail.value) || 0 });
    this.persistDraft();
  },

  async save() {
    if (this.data.saving) return;
    let payload;
    try {
      payload = wellnessPayload(this.data.form, this.statusOptionsFor(this.data.isCoach));
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      const options = this.statusOptionsFor(this.data.isCoach);
      const result = this.data.isCoach
        ? await api.saveAthleteWellness(this.data.athleteId, payload)
        : await api.saveWellness(payload);
      getApp().globalData.homeNeedsRefresh = true;
      getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
      const record = (result && result.record) || null;
      this.clearDraft();
      this.setData({
        saving: false,
        record,
        recordView: wellnessRecordView(record, options),
        form: wellnessFormFromRecord(record, payload.date, options)
      });
      this.applyStatusViews(record);
      wx.showToast({ title: '恢复日报已保存', icon: 'success' });
    } catch (error) {
      this.setData({ saving: false, error: error.message || '恢复日报保存失败。' });
    }
  }
});
