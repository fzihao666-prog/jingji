const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { todayBeijing } = require('../../utils/date');
const {
  draftIdentity,
  loadFormDraft,
  saveFormDraft,
  clearFormDraft,
} = require('../../utils/form-draft');
const {
  submissionKey,
  completeSubmission,
  isCompletedSubmission,
} = require('../../utils/submission-key');
const {
  sportRules = {},
  activityLabels = {},
  intensitySystems = [],
} = require('../../data/register-data');

const MANAGER_ROLES = ['SCC', 'REG', 'TD', 'DMD'];

function today() {
  return todayBeijing();
}

function emptyForm() {
  return {
    date: today(),
    startTime: '',
    trainingType: '专项训练',
    intensityZone: '',
    content: '',
    duration: '',
    distance: '',
    rpe: '',
    averageHeartRate: '',
    maxHeartRate: '',
    averagePowerW: '',
    strokeRateSpm: '',
  };
}

function intensityView(project, activity, system = '', zone = '') {
  const codes =
    ((sportRules[project] || {}).activityIntensitySystems || {})[activity || 'unknown'] || [];
  const options = [
    { code: '', label: '未指定体系（只记录原文）' },
    ...intensitySystems.filter((item) => codes.includes(item.code)),
  ];
  const index = Math.max(
    0,
    options.findIndex((item) => item.code === system)
  );
  const zones = index > 0 ? ['', ...options[index].zones] : [''];
  return {
    intensitySystemCodes: options.map((item) => item.code),
    intensitySystemOptions: options.map((item) => item.label),
    intensitySystemIndex: index,
    intensityOptions: zones,
    intensityIndex: Math.max(0, zones.indexOf(zone)),
  };
}
function quantityRule(project, activity) {
  const rules = sportRules[project];
  const allowDistance =
    activity === 'cycling' ||
    ((!activity || activity === 'unknown') &&
      (rules
        ? (rules.requiredSessionFields || []).includes('duration|distance')
        : ['CYCLING_ROAD', 'CYCLING_TRACK'].includes(project)));
  return {
    allowDistance,
    quantityHint: allowDistance
      ? '时长或距离至少填一项；RPE可选。'
      : '此活动必须填写时长；RPE可选。',
  };
}
Page({
  data: {
    loading: true,
    saving: false,
    deletingId: 0,
    error: '',
    isCoach: false,
    athleteId: 0,
    athleteName: '',
    athleteOptions: [],
    athleteIndex: 0,
    editId: 0,
    form: emptyForm(),
    sessions: [],
    typeOptions: ['专项训练', '体能训练', '恢复训练'],
    typeIndex: 0,
    intensityOptions: ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'],
    intensityIndex: 1,
    activityCodes: ['unknown'],
    activityOptions: ['未分类'],
    activityIndex: 0,
    showAdvanced: false,
  },

  onLoad(options) {
    // 教练代填入口可携带目标运动员；本人填报忽略该参数。
    this._targetAthleteId = Number(options && options.athleteId) || 0;
    this._planRequest =
      options && options.teamPlanId && options.planSessionId
        ? { teamPlanId: Number(options.teamPlanId), planSessionId: options.planSessionId }
        : null;
    this.loadPage();
  },
  onPullDownRefresh() {
    this.loadPage().finally(() => wx.stopPullDownRefresh());
  },
  retryLoad() {
    this.loadPage();
  },

  configureProject(project) {
    if (!project || this._trainingProject === project) return;
    this._trainingProject = project;
    const rules = sportRules[project];
    const codes = rules ? rules.activities : ['unknown'];
    this.setData({
      ...quantityRule(project, 'unknown'),
      ...intensityView(project, 'unknown'),
      activityCodes: codes,
      activityOptions: codes.map((code) => activityLabels[code] || '未分类'),
      activityIndex: 0,
      form: {
        ...emptyForm(),
        activityCode: 'unknown',
        rulesVersion: rules ? rules.version : undefined,
        intensityZone: '',
        rpe: '',
        cadenceRpm: '',
      },
    });
  },

  onActivityChange(event) {
    const index = Number(event.detail.value);
    const code = this.data.activityCodes[index];
    if (!code) return;
    const water = code === 'on_water' || code === 'ergometer';
    this.setData({
      ...quantityRule(this._trainingProject, code),
      ...intensityView(this._trainingProject, code),
      activityIndex: index,
      form: {
        ...this.data.form,
        activityCode: code,
        rulesVersion: sportRules[this._trainingProject]?.version,
        intensitySystem: '',
        intensityZone: '',
        averagePowerW: ['cycling', 'on_water', 'ergometer'].includes(code)
          ? this.data.form.averagePowerW
          : '',
        strokeRateSpm: water ? this.data.form.strokeRateSpm : '',
        cadenceRpm: code === 'cycling' ? this.data.form.cadenceRpm : '',
      },
    });
    this.persistDraft();
  },

  async loadPage() {
    try {
      const context = await loadContext({ refreshUser: true });
      this.configureProject(context.project);
      const isCoach = MANAGER_ROLES.includes(context.user.role);
      if (!isCoach && context.user.role !== 'ATL')
        throw new Error('只有运动员本人或教练可以填写训练记录。');
      if (isCoach) {
        const athletes = context.projectAthletes || [];
        if (!athletes.length) throw new Error('当前项目暂无可代填的运动员。');
        let index = athletes.findIndex((item) => Number(item.id) === this._targetAthleteId);
        if (index < 0)
          index = athletes.findIndex(
            (item) => Number(item.id) === Number(context.selectedAthleteId)
          );
        if (index < 0) index = 0;
        const target = athletes[index];
        this._targetAthleteId = Number(target.id);
        this._athletes = athletes;
        const result = await api.athleteTrainingSessions(target.id);
        this.setData({
          isCoach: true,
          athleteId: Number(target.id),
          athleteName: target.name || '',
          athleteOptions: athletes.map((item) => item.name || `运动员${item.id}`),
          athleteIndex: index,
          sessions: result.sessions || [],
          loading: false,
          error: '',
        });
        await this.applyRequestedPlan();
        this.restoreDraft();
        return;
      }
      const result = await api.myTrainingSessions();
      this.setData({ isCoach: false, sessions: result.sessions || [], loading: false, error: '' });
      await this.applyRequestedPlan();
      this.restoreDraft();
    } catch (error) {
      this.setData({ loading: false, error: error.message || '训练记录加载失败。' });
    }
  },

  async applyRequestedPlan() {
    if (!this._planRequest) return;
    const request = this._planRequest;
    const result = await api.teamPlans(this.data.isCoach ? { athleteId: this.data.athleteId } : {});
    const plan = result.plans.find(
      (row) => row.id === request.teamPlanId && ['published', 'archived'].includes(row.status)
    );
    const base = plan && plan.data.sessions.find((row) => row.id === request.planSessionId);
    if (!base) throw new Error('训练课已变更，请返回队伍计划重新选择。');
    const user = getApp().globalData.user;
    const athleteId = this.data.isCoach ? this.data.athleteId : user.athleteId;
    const override = plan.data.overrides.find(
      (row) => row.sessionId === base.id && row.athleteId === athleteId
    );
    const target = { ...base, ...(override ? override.changes : {}) };
    const trainingType = { special: '专项训练', physical: '体能训练', recovery: '恢复训练' }[
      target.category
    ];
    // 只带入任务信息；实际时长、距离与RPE由填报人确认。
    this.setData({
      ...intensityView(this._trainingProject, target.activityCode, target.intensitySystem),
      ...quantityRule(this._trainingProject, target.activityCode),
      activityIndex: Math.max(0, this.data.activityCodes.indexOf(target.activityCode || 'unknown')),
      form: {
        ...emptyForm(),
        ...request,
        date: target.date,
        trainingType,
        content: target.content,
        activityCode: target.activityCode || 'unknown',
        intensitySystem: target.intensitySystem || '',
        rulesVersion: sportRules[this._trainingProject]?.version,
        rpe: '',
      },
      typeIndex: this.data.typeOptions.indexOf(trainingType),
      planLabel: `${plan.title} V${plan.version} · ${target.period || target.date}`,
    });
    this._planRequest = null;
    this._draftPromptedFor = this.draftKeyFor();
  },

  onAthleteChange(event) {
    const index = Number(event.detail.value) || 0;
    // 选项列表与权限内运动员同序，切换后按 id 重新加载该运动员记录。
    const candidate = (this._athletes || [])[index];
    if (!candidate) return;
    if (Number(candidate.id) === Number(this.data.athleteId)) return;
    this._targetAthleteId = Number(candidate.id);
    this.setData({
      athleteIndex: index,
      editId: 0,
      planLabel: '',
      form: emptyForm(),
      typeIndex: 0,
      intensityIndex: 1,
      showAdvanced: false,
    });
    this.loadPage();
  },

  onInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
    this.persistDraft();
  },
  onDateChange(event) {
    this.setData({ 'form.date': event.detail.value });
    this.persistDraft();
  },
  onTimeChange(event) {
    this.setData({ 'form.startTime': event.detail.value });
    this.persistDraft();
  },
  onTypeChange(event) {
    const typeIndex = Number(event.detail.value) || 0;
    this.setData({ typeIndex, 'form.trainingType': this.data.typeOptions[typeIndex] });
    this.persistDraft();
  },
  onIntensitySystemChange(event) {
    const index = Number(event.detail.value) || 0;
    const system = this.data.intensitySystemCodes[index] || '';
    this.setData({
      ...intensityView(this._trainingProject, this.data.form.activityCode, system),
      form: { ...this.data.form, intensitySystem: system, intensityZone: '' },
    });
    this.persistDraft();
  },
  onIntensityChange(event) {
    const intensityIndex = Number(event.detail.value) || 0;
    this.setData({
      intensityIndex,
      'form.intensityZone': this.data.intensityOptions[intensityIndex],
    });
    this.persistDraft();
  },

  // 弱网草稿：编辑既有记录不暂存，避免恢复后误建新记录。
  draftKeyFor() {
    return draftIdentity(this.data.isCoach, this.data.athleteId);
  },

  persistDraft() {
    if (this.data.editId) return;
    saveFormDraft(wx, 'training-entry', this.draftKeyFor(), this.data.form, emptyForm());
  },

  clearDraft() {
    clearFormDraft(wx, 'training-entry', this.draftKeyFor());
  },

  restoreDraft() {
    const identity = this.draftKeyFor();
    if (this._draftPromptedFor === identity) return;
    this._draftPromptedFor = identity;
    const draft = loadFormDraft(wx, 'training-entry', identity);
    if (!draft) return;
    const user = getApp().globalData.user;
    // 保存已成功但草稿清理失败时，不把旧内容再次恢复成一份新填报。
    if (!this.data.isCoach && user && isCompletedSubmission(wx, user.id, draft)) {
      clearFormDraft(wx, 'training-entry', identity);
      return;
    }
    wx.showModal({
      title: '恢复未保存的内容',
      content: '检测到上次未提交的训练记录，是否恢复继续填写？',
      confirmText: '恢复',
      cancelText: '重新填写',
      success: (result) => {
        if (result.confirm) {
          this.setData({
            ...quantityRule(this._trainingProject, draft.activityCode),
            ...intensityView(
              this._trainingProject,
              draft.activityCode,
              draft.intensitySystem,
              draft.intensityZone
            ),
            form: { ...emptyForm(), ...draft },
            typeIndex: Math.max(0, this.data.typeOptions.indexOf(draft.trainingType)),
            intensityIndex: Math.max(0, this.data.intensityOptions.indexOf(draft.intensityZone)),
            activityIndex: Math.max(0, this.data.activityCodes.indexOf(draft.activityCode)),
          });
        } else {
          clearFormDraft(wx, 'training-entry', identity);
        }
      },
    });
  },
  toggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced });
  },

  editSession(event) {
    const session = this.data.sessions.find(
      (item) => Number(item.id) === Number(event.currentTarget.dataset.id)
    );
    if (!session) return;
    const form = {};
    Object.keys(emptyForm()).forEach((key) => {
      form[key] = session[key] === null || session[key] === undefined ? '' : String(session[key]);
    });
    this.setData({
      ...quantityRule(this._trainingProject, session.activityCode),
      ...intensityView(
        this._trainingProject,
        session.activityCode,
        session.intensitySystem,
        session.intensityZone
      ),
      editId: session.id,
      activityIndex: Math.max(0, this.data.activityCodes.indexOf(session.activityCode)),
      form: {
        ...form,
        ...(session.activityCode
          ? {
              activityCode: session.activityCode,
              rulesVersion: sportRules[this._trainingProject]?.version,
              cadenceRpm: session.cadenceRpm == null ? '' : String(session.cadenceRpm),
              intensitySystem: session.intensitySystem || undefined,
            }
          : {}),
        ...(session.teamPlanId
          ? { teamPlanId: session.teamPlanId, planSessionId: session.planSessionId }
          : {}),
      },
      planLabel: session.teamPlanId
        ? `关联计划版本 #${session.teamPlanId} · ${session.planSessionId}`
        : '',
      typeIndex: Math.max(0, this.data.typeOptions.indexOf(session.trainingType)),
      intensityIndex: Math.max(0, this.data.intensityOptions.indexOf(session.intensityZone)),
      showAdvanced: Boolean(
        session.averageHeartRate ||
        session.maxHeartRate ||
        session.averagePowerW ||
        session.strokeRateSpm
      ),
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 250 });
  },

  cancelEdit() {
    this.clearDraft();
    this.setData({
      editId: 0,
      planLabel: '',
      form: emptyForm(),
      typeIndex: 0,
      intensityIndex: 1,
      showAdvanced: false,
    });
  },

  saveAction(form) {
    if (this.data.isCoach) {
      return this.data.editId
        ? api.updateAthleteTrainingSession(this.data.athleteId, this.data.editId, form)
        : api.createAthleteTrainingSession(this.data.athleteId, form);
    }
    if (this.data.editId) return api.updateMyTrainingSession(this.data.editId, form);
    const user = getApp().globalData.user;
    this._submissionUserId = user && user.id;
    this._submissionKey = submissionKey(wx, this._submissionUserId, form);
    return api.createMyTrainingSession(form, this._submissionKey);
  },

  async save() {
    if (this.data.saving) return;
    const form = this.data.form;
    const requirement = quantityRule(this._trainingProject || this.data.project, form.activityCode);
    if (
      !form.content ||
      (!(Number(form.duration) > 0) && (!requirement.allowDistance || !(Number(form.distance) > 0)))
    ) {
      wx.showToast({
        title: !form.content
          ? '请填写训练内容'
          : requirement.allowDistance
            ? '请填写时长或有效距离'
            : '请填写有效训练时长',
        icon: 'none',
      });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      this.persistDraft();
      const result = await this.saveAction(form);
      if (!this.data.isCoach && !this.data.editId) {
        completeSubmission(wx, this._submissionUserId, this._submissionKey);
      }
      getApp().globalData.homeNeedsRefresh = true;
      getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
      wx.showToast({ title: this.data.editId ? '记录已更新' : '记录已同步', icon: 'success' });
      this.clearDraft();
      this.setData({
        editId: 0,
        planLabel: '',
        form: emptyForm(),
        typeIndex: 0,
        intensityIndex: 1,
        showAdvanced: false,
      });
      this._trainingProject = null;
      await this.loadPage();
      if (result && result.message) this.setData({ error: '' });
    } catch (error) {
      this.setData({ error: error.message || '训练记录保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  },

  deleteSession(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (this.data.deletingId === id) return;
    wx.showModal({
      title: '删除训练记录',
      content: '确认删除这条训练记录吗？',
      success: async (result) => {
        if (!result.confirm) return;
        if (this.data.deletingId === id) return;
        this.setData({ deletingId: id });
        try {
          if (this.data.isCoach) await api.deleteAthleteTrainingSession(this.data.athleteId, id);
          else await api.deleteMyTrainingSession(id);
          getApp().globalData.homeNeedsRefresh = true;
          getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
          if (this.data.editId === id) this.cancelEdit();
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.loadPage();
        } catch (error) {
          this.setData({ error: error.message || '训练记录删除失败。' });
        } finally {
          this.setData({ deletingId: 0 });
        }
      },
    });
  },
});
