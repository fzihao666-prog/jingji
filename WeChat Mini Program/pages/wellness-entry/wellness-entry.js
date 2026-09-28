const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const {
  METRICS,
  STATUS_OPTIONS,
  QUICK_SELECT,
  wellnessDates,
  defaultWellnessForm,
  wellnessPayload,
  wellnessFormFromRecord,
  wellnessRecordView
} = require('../../utils/wellness-form');

Page({
  data: {
    loading: true,
    saving: false,
    error: '',
    min: '',
    max: '',
    form: defaultWellnessForm(),
    fieldDefs: METRICS,
    statusOptions: STATUS_OPTIONS,
    quickSelect: QUICK_SELECT,
    record: null,
    recordView: null
  },

  onLoad() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },
  retryLoad() { this.loadPage(); },

  loadPage() {
    const dates = wellnessDates();
    this.setData({ min: dates.min, max: dates.max });
    this._guard = this._guard || createRequestGuard();
    return loadWithGuard(this, this._guard, async () => {
      const context = await loadContext({ refreshUser: true });
      if (context.user.role !== 'ATL') throw new Error('只有运动员本人可以填写恢复日报。');
      return this.loadRecord(this.data.form.date);
    }, '恢复日报加载失败。');
  },

  async loadRecord(date) {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.myWellness(date);
      const record = (result && result.record) || null;
      this.setData({
        loading: false,
        record,
        recordView: wellnessRecordView(record),
        form: wellnessFormFromRecord(record, date)
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '恢复日报加载失败。' });
    }
  },

  onInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
  },

  onQuickSelect(event) {
    const { field, value } = event.currentTarget.dataset;
    if (!field || value === undefined) return;
    this.setData({ [`form.${field}`]: String(value) });
  },

  onDateChange(event) {
    const date = event.detail.value;
    this.setData({ 'form.date': date });
    return this.loadRecord(date);
  },

  onStatusChange(event) {
    this.setData({ 'form.statusIndex': Number(event.detail.value) || 0 });
  },

  async save() {
    if (this.data.saving) return;
    let payload;
    try {
      payload = wellnessPayload(this.data.form);
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      const result = await api.saveWellness(payload);
      getApp().globalData.homeNeedsRefresh = true;
      getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
      const record = (result && result.record) || null;
      this.setData({
        saving: false,
        record,
        recordView: wellnessRecordView(record),
        form: wellnessFormFromRecord(record, payload.date)
      });
      wx.showToast({ title: '恢复日报已保存', icon: 'success' });
    } catch (error) {
      this.setData({ saving: false, error: error.message || '恢复日报保存失败。' });
    }
  }
});
