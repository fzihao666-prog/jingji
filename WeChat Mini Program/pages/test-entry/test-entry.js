const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { projectLabel } = require('../../utils/project-label');
const { todayBeijing } = require('../../utils/date');
const { draftIdentity, loadFormDraft, saveFormDraft, clearFormDraft } = require('../../utils/form-draft');
const {
  STRENGTH_FIELDS,
  SPECIAL_ATTEMPT_COUNT,
  defaultStrengthForm,
  strengthPayload,
  defaultSpecialForm,
  specialPayload,
  pickSpecialEventFields,
  recentValues,
  resolveCrewName
} = require('../../utils/test-entry-form');

const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

// 赛事条件记忆：按项目保存上次成功提交的赛事级字段与常用距离，本地可清、不存身份信息。
function testEventKey(project) {
  return `jingji-mini-test-event:${project || 'default'}`;
}

function testDistanceKey(project) {
  return `jingji-mini-test-distance:${project || 'default'}`;
}

function loadLocal(key) {
  try {
    const raw = wx.getStorageSync(key);
    return raw && raw.data !== undefined ? raw.data : null;
  } catch {
    return null;
  }
}

function saveLocal(key, data) {
  try {
    wx.setStorageSync(key, { savedAt: Date.now(), data });
  } catch {
    // 本地存储失败不影响正常填写与提交。
  }
}

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
    // 专项模式：常用距离快捷选择与「更多条件」（风况/地点/历史最好/备注）折叠。
    distanceChips: [],
    showMoreFields: false,
    form: defaultStrengthForm()
  },

  onLoad(options) {
    this._mode = options && options.mode === 'special' ? 'special' : 'strength';
    this._targetAthleteId = Number(options && options.athleteId) || 0;
    this.loadPage();
  },

  retryLoad() { this.loadPage(); },

  // 专项首次进入的预填视图：上次赛事条件 + 今日日期 + 主测默认组合 + 常用距离。
  buildSeedView(project, target) {
    const defaults = loadLocal(testEventKey(project)) || {};
    const chips = loadLocal(testDistanceKey(project));
    return {
      form: {
        ...this.defaultFormFor(),
        ...pickSpecialEventFields(defaults),
        testDate: defaults.testDate || todayBeijing(),
        crewName: target.name || ''
      },
      memberIds: [Number(target.id)],
      distanceChips: Array.isArray(chips) ? chips : []
    };
  },

  onAthleteChange(event) {
    const index = Number(event.detail.value) || 0;
    const candidate = (this._athletes || [])[index];
    if (!candidate || Number(candidate.id) === Number(this.data.athleteId)) return;
    const previousName = this.data.athleteName;
    this._targetAthleteId = Number(candidate.id);
    // 主测默认进成员：成员仍是纯自动态时跟随切换重置，已手动加人时只补进新主测。
    const memberId = Number(candidate.id);
    const currentMembers = this.data.memberIds;
    const autoState = !currentMembers.length
      || (currentMembers.length === 1 && currentMembers[0] === Number(this.data.athleteId));
    const memberIds = autoState
      ? [memberId]
      : (currentMembers.includes(memberId) ? currentMembers : currentMembers.concat(memberId));
    const form = this.data.form || {};
    this.setData({
      athleteIndex: index,
      memberIds,
      form: { ...form, crewName: resolveCrewName(form.crewName, previousName, candidate.name || `运动员${candidate.id}`) }
    });
    this.loadPage();
  },

  onToggleMoreFields() {
    this.setData({ showMoreFields: !this.data.showMoreFields });
  },

  onDistanceChip(event) {
    const value = String(event.currentTarget.dataset.value || '').trim();
    if (!value) return;
    this.setData({ form: { ...this.data.form, distanceM: value } });
    this.persistDraft();
  },

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
      const project = target.project || context.project;
      // 首次进入专项录入预填上次赛事条件与主测默认组合；切换运动员不重填，保留现场已填内容。
      const seed = this._mode === 'special' && !this._formSeeded;
      this._formSeeded = true;
      const seedView = seed ? this.buildSeedView(project, target) : {};
      return {
        mode: this._mode,
        athleteId: Number(target.id),
        athleteName: target.name || '',
        athleteMeta: `${projectLabel(project)} · ${target.team || '未分队'}`,
        project,
        projectLabel: projectLabel(project),
        athleteOptions: athletes.map((item) => item.name || `运动员${item.id}`),
        athleteIndex: index,
        members: athletes.map((item) => ({ id: Number(item.id), name: item.name || `运动员${item.id}` })),
        ...seedView,
        loading: false
      };
    }, '测试录入页面加载失败。');
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
      this.clearDraft();
      if (this.data.mode === 'special') {
        // 保留赛事条件只清成绩：同一场测试连续录入多个组合不用重填；条件按项目记住供下次预填。
        const eventFields = pickSpecialEventFields(this.data.form);
        saveLocal(testEventKey(this.data.project), eventFields);
        saveLocal(testDistanceKey(this.data.project), recentValues(loadLocal(testDistanceKey(this.data.project)), eventFields.distanceM));
        this.setData({
          form: { ...this.defaultFormFor(), ...eventFields, crewName: this.data.athleteName || '' },
          memberIds: this.data.athleteId ? [Number(this.data.athleteId)] : [],
          distanceChips: loadLocal(testDistanceKey(this.data.project)) || []
        });
      } else {
        // 体能测试：保存后保留日期，清空指标，便于连续录入。
        this.setData({ form: { ...defaultStrengthForm(), testDate: payload.testDate }, memberIds: [] });
      }
    } catch (error) {
      this.setData({ error: error.message || '测试成绩保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
