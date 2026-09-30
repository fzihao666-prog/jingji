const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { todayBeijing } = require('../../utils/date');
const { draftIdentity, loadFormDraft, saveFormDraft, clearFormDraft } = require('../../utils/form-draft');

const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

function today() {
  return todayBeijing();
}

function emptyForm() {
  return { date: today(), startTime: '', trainingType: '专项训练', intensityZone: 'U2', content: '', duration: '', distance: '', rpe: '5', averageHeartRate: '', maxHeartRate: '', averagePowerW: '', strokeRateSpm: '' };
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
    showAdvanced: false
  },

  onLoad(options) {
    // 教练代填入口可携带目标运动员；本人填报忽略该参数。
    this._targetAthleteId = Number(options && options.athleteId) || 0;
    this.loadPage();
  },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },
  retryLoad() { this.loadPage(); },

  async loadPage() {
    try {
      const context = await loadContext({ refreshUser: true });
      const isCoach = MANAGER_ROLES.includes(context.user.role);
      if (!isCoach && context.user.role !== 'ATL') throw new Error('只有运动员本人或教练可以填写训练记录。');
      if (isCoach) {
        const athletes = context.projectAthletes || [];
        if (!athletes.length) throw new Error('当前项目暂无可代填的运动员。');
        let index = athletes.findIndex((item) => Number(item.id) === this._targetAthleteId);
        if (index < 0) index = athletes.findIndex((item) => Number(item.id) === Number(context.selectedAthleteId));
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
          error: ''
        });
        this.restoreDraft();
        return;
      }
      const result = await api.myTrainingSessions();
      this.setData({ isCoach: false, sessions: result.sessions || [], loading: false, error: '' });
      this.restoreDraft();
    } catch (error) {
      this.setData({ loading: false, error: error.message || '训练记录加载失败。' });
    }
  },

  onAthleteChange(event) {
    const index = Number(event.detail.value) || 0;
    // 选项列表与权限内运动员同序，切换后按 id 重新加载该运动员记录。
    const candidate = (this._athletes || [])[index];
    if (!candidate) return;
    if (Number(candidate.id) === Number(this.data.athleteId)) return;
    this._targetAthleteId = Number(candidate.id);
    this.setData({ athleteIndex: index, editId: 0, form: emptyForm(), typeIndex: 0, intensityIndex: 1, showAdvanced: false });
    this.loadPage();
  },

  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); this.persistDraft(); },
  onDateChange(event) { this.setData({ 'form.date': event.detail.value }); this.persistDraft(); },
  onTimeChange(event) { this.setData({ 'form.startTime': event.detail.value }); this.persistDraft(); },
  onTypeChange(event) {
    const typeIndex = Number(event.detail.value) || 0;
    this.setData({ typeIndex, 'form.trainingType': this.data.typeOptions[typeIndex] });
    this.persistDraft();
  },
  onIntensityChange(event) {
    const intensityIndex = Number(event.detail.value) || 0;
    this.setData({ intensityIndex, 'form.intensityZone': this.data.intensityOptions[intensityIndex] });
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
    wx.showModal({
      title: '恢复未保存的内容',
      content: '检测到上次未提交的训练记录，是否恢复继续填写？',
      confirmText: '恢复',
      cancelText: '重新填写',
      success: (result) => {
        if (result.confirm) {
          this.setData({
            form: { ...emptyForm(), ...draft },
            typeIndex: Math.max(0, this.data.typeOptions.indexOf(draft.trainingType)),
            intensityIndex: Math.max(0, this.data.intensityOptions.indexOf(draft.intensityZone))
          });
        } else {
          clearFormDraft(wx, 'training-entry', identity);
        }
      }
    });
  },
  toggleAdvanced() { this.setData({ showAdvanced: !this.data.showAdvanced }); },

  editSession(event) {
    const session = this.data.sessions.find((item) => Number(item.id) === Number(event.currentTarget.dataset.id));
    if (!session) return;
    const form = {};
    Object.keys(emptyForm()).forEach((key) => { form[key] = session[key] === null || session[key] === undefined ? '' : String(session[key]); });
    this.setData({
      editId: session.id,
      form,
      typeIndex: Math.max(0, this.data.typeOptions.indexOf(session.trainingType)),
      intensityIndex: Math.max(0, this.data.intensityOptions.indexOf(session.intensityZone)),
      showAdvanced: Boolean(session.averageHeartRate || session.maxHeartRate || session.averagePowerW || session.strokeRateSpm)
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 250 });
  },

  cancelEdit() { this.clearDraft(); this.setData({ editId: 0, form: emptyForm(), typeIndex: 0, intensityIndex: 1, showAdvanced: false }); },

  saveAction(form) {
    if (this.data.isCoach) {
      return this.data.editId
        ? api.updateAthleteTrainingSession(this.data.athleteId, this.data.editId, form)
        : api.createAthleteTrainingSession(this.data.athleteId, form);
    }
    return this.data.editId
      ? api.updateMyTrainingSession(this.data.editId, form)
      : api.createMyTrainingSession(form);
  },

  async save() {
    if (this.data.saving) return;
    const form = this.data.form;
    if (!form.content || !form.duration || !form.rpe) {
      wx.showToast({ title: '请填写内容、时长和 RPE', icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      const result = await this.saveAction(form);
      getApp().globalData.homeNeedsRefresh = true;
      getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
      wx.showToast({ title: this.data.editId ? '记录已更新' : '记录已同步', icon: 'success' });
      this.clearDraft();
      this.setData({ editId: 0, form: emptyForm(), typeIndex: 0, intensityIndex: 1, showAdvanced: false });
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
      }
    });
  }
});
