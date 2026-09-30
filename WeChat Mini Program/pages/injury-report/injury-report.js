const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { projectLabel } = require('../../utils/project-label');
const { draftIdentity, loadFormDraft, saveFormDraft, clearFormDraft } = require('../../utils/form-draft');
const {
  STATUS_OPTIONS,
  SIDE_OPTIONS,
  BODY_PART_OPTIONS,
  PAIN_OPTIONS,
  buildInjuryPayload,
  defaultInjuryForm,
} = require('../../utils/injury-form');

const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

Page({
  data: {
    loading: true,
    saving: false,
    error: '',
    athleteId: 0,
    athleteName: '',
    athleteMeta: '',
    isSelfFeedback: false,
    notice: '',
    bodyPartOptions: BODY_PART_OPTIONS,
    sideOptions: SIDE_OPTIONS.map((option) => option.label),
    statusOptions: STATUS_OPTIONS.map((option) => option.label),
    painOptions: PAIN_OPTIONS,
    ...defaultInjuryForm(),
  },

  onLoad(options) {
    this._targetAthleteId = Number(options && options.athleteId) || 0;
    this.loadPage();
  },

  retryLoad() { this.loadPage(); },

  loadPage() {
    this._guard = this._guard || createRequestGuard();
    return loadWithGuard(this, this._guard, async () => {
      const context = await loadContext();
      const isSelfFeedback = context.user.role === 'ATL';
      // 角色文案要先落地：权限失败时页面仍需按身份显示对应提示。
      this.setData({ isSelfFeedback });
      if (!isSelfFeedback && !MANAGER_ROLES.includes(context.user.role)) {
        throw new Error('当前角色不能在小程序提交伤病记录。');
      }
      const athlete = (context.projectAthletes || []).find(
        (item) => Number(item.id) === this._targetAthleteId
      );
      if (!athlete) throw new Error('该运动员不在当前项目权限范围内。');
      if (isSelfFeedback && Number(context.user.athleteId) !== this._targetAthleteId) {
        throw new Error('运动员只能提交本人的疼痛反馈。');
      }
      this.restoreDraft();
      return {
        athleteId: this._targetAthleteId,
        athleteName: athlete.name || '',
        athleteMeta: `${projectLabel(athlete.project)} · ${athlete.team || '未分队'}`,
        isSelfFeedback,
        notice: isSelfFeedback
          ? '运动员提交的是疼痛反馈，提交后状态记为“观察”，由教练确认正式伤病状态。'
          : '记录将写入该运动员档案，并按最新状态进入教练每日待办关注名单。',
      };
    }, '伤病上报页面加载失败。');
  },

  onFieldInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
    this.persistDraft();
  },

  onBodyPartChange(event) {
    this.setData({ bodyPartIndex: Number(event.detail.value) || 0 });
    this.persistDraft();
  },

  onSideChange(event) {
    this.setData({ sideIndex: Number(event.detail.value) || 0 });
    this.persistDraft();
  },

  onStatusChange(event) {
    this.setData({ statusIndex: Number(event.detail.value) || 0 });
    this.persistDraft();
  },

  onPainChange(event) {
    this.setData({ painIndex: Number(event.detail.value) || 0 });
    this.persistDraft();
  },

  onDateChange(event) {
    const field = event.currentTarget.dataset.field;
    const patch = { [field]: event.detail.value };
    if (field === 'reviewDate') patch.reviewSet = true;
    this.setData(patch);
    this.persistDraft();
  },

  clearReviewDate() {
    this.setData({ reviewDate: '', reviewSet: false });
    this.persistDraft();
  },

  // 本页表单字段直接铺在 data 顶层，草稿按字段集合存取。
  draftKeyFor() {
    return draftIdentity(true, this._targetAthleteId);
  },

  draftFields() {
    const fields = {};
    Object.keys(defaultInjuryForm()).forEach((key) => { fields[key] = this.data[key]; });
    return fields;
  },

  persistDraft() {
    saveFormDraft(wx, 'injury-report', this.draftKeyFor(), this.draftFields(), defaultInjuryForm());
  },

  clearDraft() {
    clearFormDraft(wx, 'injury-report', this.draftKeyFor());
  },

  restoreDraft() {
    const identity = this.draftKeyFor();
    if (this._draftPromptedFor === identity) return;
    this._draftPromptedFor = identity;
    const draft = loadFormDraft(wx, 'injury-report', identity);
    if (!draft) return;
    wx.showModal({
      title: '恢复未保存的内容',
      content: '检测到上次未提交的伤病记录，是否恢复继续填写？',
      confirmText: '恢复',
      cancelText: '重新填写',
      success: (result) => {
        if (result.confirm) {
          this.setData({ ...defaultInjuryForm(), ...draft });
        } else {
          clearFormDraft(wx, 'injury-report', identity);
        }
      }
    });
  },

  payloadInput() {
    const data = this.data;
    return {
      isSelfFeedback: data.isSelfFeedback,
      bodyPart: BODY_PART_OPTIONS[data.bodyPartIndex],
      bodyPartCustom: data.bodyPartCustom,
      injuryName: data.injuryName,
      side: SIDE_OPTIONS[data.sideIndex] ? SIDE_OPTIONS[data.sideIndex].value : '',
      painScore: Number(PAIN_OPTIONS[data.painIndex]),
      onsetDate: data.onsetDate,
      reviewDate: data.reviewSet ? data.reviewDate : '',
      status: STATUS_OPTIONS[data.statusIndex] ? STATUS_OPTIONS[data.statusIndex].value : '',
      restrictions: data.restrictions,
      rehabPlan: data.rehabPlan,
      note: data.note,
    };
  },

  async save() {
    if (this.data.saving || !this.data.athleteId) return;
    let payload;
    try {
      payload = buildInjuryPayload(this.payloadInput());
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      await api.createInjuryRecord(this.data.athleteId, payload);
      const app = getApp();
      app.globalData.homeNeedsRefresh = true;
      app.globalData.dataVersion = (app.globalData.dataVersion || 0) + 1;
      this.clearDraft();
      wx.showToast({ title: '已记录，网页端同步可见', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (error) {
      this.setData({ error: error.message || '伤病记录保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
