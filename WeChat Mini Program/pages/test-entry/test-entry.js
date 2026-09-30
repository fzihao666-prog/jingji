const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { projectLabel } = require('../../utils/project-label');
const { draftIdentity, loadFormDraft, saveFormDraft, clearFormDraft } = require('../../utils/form-draft');
const {
  STRENGTH_FIELDS,
  SPECIAL_ATTEMPT_COUNT,
  defaultStrengthForm,
  strengthPayload,
  defaultSpecialForm,
  specialPayload
} = require('../../utils/test-entry-form');

const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

Page({
  data: {
    loading: true,
    saving: false,
    error: '',
    mode: 'strength',
    athleteId: 0,
    athleteName: '',
    athleteMeta: '',
    project: '',
    projectLabel: '',
    athleteOptions: [],
    athleteIndex: 0,
    members: [],
    memberIds: [],
    strengthFields: STRENGTH_FIELDS,
    attemptIndexes: Array.from({ length: SPECIAL_ATTEMPT_COUNT }, (_, index) => index),
    form: defaultStrengthForm()
  },

  onLoad(options) {
    this._mode = options && options.mode === 'special' ? 'special' : 'strength';
    this._targetAthleteId = Number(options && options.athleteId) || 0;
    this.loadPage();
  },

  retryLoad() { this.loadPage(); },

  loadPage() {
    this._guard = this._guard || createRequestGuard();
    return loadWithGuard(this, this._guard, async () => {
      const context = await loadContext();
      if (!MANAGER_ROLES.includes(context.user.role)) {
        throw new Error('只有教练等管理角色可以现场录入测试成绩。');
      }
      const athletes = context.projectAthletes || [];
      if (!athletes.length) throw new Error('当前项目暂无可录入的运动员。');
      let index = athletes.findIndex((item) => Number(item.id) === this._targetAthleteId);
      if (index < 0) index = athletes.findIndex((item) => Number(item.id) === Number(context.selectedAthleteId));
      if (index < 0) index = 0;
      const target = athletes[index];
      this._targetAthleteId = Number(target.id);
      this._athletes = athletes;
      this.restoreDraft();
      return {
        mode: this._mode,
        athleteId: Number(target.id),
        athleteName: target.name || '',
        athleteMeta: `${projectLabel(target.project || context.project)} · ${target.team || '未分队'}`,
        project: target.project || context.project,
        projectLabel: projectLabel(target.project || context.project),
        athleteOptions: athletes.map((item) => item.name || `运动员${item.id}`),
        athleteIndex: index,
        members: athletes.map((item) => ({ id: Number(item.id), name: item.name || `运动员${item.id}` })),
        loading: false
      };
    }, '测试录入页面加载失败。');
  },

  onAthleteChange(event) {
    const index = Number(event.detail.value) || 0;
    const candidate = (this._athletes || [])[index];
    if (!candidate || Number(candidate.id) === Number(this.data.athleteId)) return;
    this._targetAthleteId = Number(candidate.id);
    this.setData({ athleteIndex: index, memberIds: [] });
    this.loadPage();
  },

  onFieldInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
    this.persistDraft();
  },

  onDateChange(event) {
    this.setData({ 'form.testDate': event.detail.value });
    this.persistDraft();
  },

  onMemberToggle(event) {
    const id = Number(event.currentTarget.dataset.id);
    const memberIds = this.data.memberIds.includes(id)
      ? this.data.memberIds.filter((item) => item !== id)
      : this.data.memberIds.concat(id);
    this.setData({ memberIds });
    this.persistDraft();
  },

  onAttemptInput(event) {
    const index = Number(event.currentTarget.dataset.index) || 0;
    this.setData({ [`form.attempts[${index}]`]: event.detail.value });
    this.persistDraft();
  },

  // 弱网草稿：按模式与目标运动员区分，保存内容含成绩与组合成员。
  defaultFormFor() {
    return this._mode === 'special' ? defaultSpecialForm() : defaultStrengthForm();
  },

  draftKeyFor() {
    return `${this._mode}:${draftIdentity(true, this._targetAthleteId)}`;
  },

  persistDraft() {
    saveFormDraft(
      wx,
      'test-entry',
      this.draftKeyFor(),
      { form: this.data.form, memberIds: this.data.memberIds },
      { form: this.defaultFormFor(), memberIds: [] }
    );
  },

  clearDraft() {
    clearFormDraft(wx, 'test-entry', this.draftKeyFor());
  },

  restoreDraft() {
    const identity = this.draftKeyFor();
    if (this._draftPromptedFor === identity) return;
    this._draftPromptedFor = identity;
    const draft = loadFormDraft(wx, 'test-entry', identity);
    if (!draft || !draft.form) return;
    wx.showModal({
      title: '恢复未保存的内容',
      content: '检测到上次未提交的测试成绩，是否恢复继续填写？',
      confirmText: '恢复',
      cancelText: '重新填写',
      success: (result) => {
        if (result.confirm) {
          this.setData({
            form: { ...this.defaultFormFor(), ...draft.form },
            memberIds: Array.isArray(draft.memberIds) ? draft.memberIds : []
          });
        } else {
          clearFormDraft(wx, 'test-entry', identity);
        }
      }
    });
  },

  buildPayload() {
    const form = { ...this.data.form, memberIds: this.data.memberIds };
    if (this.data.mode === 'special') return specialPayload({ ...form, project: this.data.project });
    return strengthPayload(form);
  },

  async save() {
    if (this.data.saving) return;
    let payload;
    try {
      payload = this.buildPayload();
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      if (this.data.mode === 'special') await api.createSpecialTest(payload);
      else await api.createStrengthTest({ ...payload, athleteId: this.data.athleteId });
      getApp().globalData.homeNeedsRefresh = true;
      getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
      wx.showToast({ title: '成绩已保存', icon: 'success' });
      // 保存后保留日期与项目，清空成绩，便于连续录入。
      const reset = this.data.mode === 'special'
        ? { ...defaultSpecialForm(), testDate: payload.testDate, project: this.data.project }
        : { ...defaultStrengthForm(), testDate: payload.testDate };
      this.clearDraft();
      this.setData({ form: reset, memberIds: [] });
    } catch (error) {
      this.setData({ error: error.message || '测试成绩保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
