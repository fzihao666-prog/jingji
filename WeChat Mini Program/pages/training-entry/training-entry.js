const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { todayBeijing } = require('../../utils/date');

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
    error: '',
    editId: 0,
    form: emptyForm(),
    sessions: [],
    typeOptions: ['专项训练', '体能训练', '恢复训练'],
    typeIndex: 0,
    intensityOptions: ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'],
    intensityIndex: 1,
    showAdvanced: false
  },

  onLoad() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  async loadPage() {
    try {
      const context = await loadContext({ refreshUser: true });
      if (context.user.role !== 'ATL') throw new Error('只有运动员本人可以填写训练记录。');
      const result = await api.myTrainingSessions();
      this.setData({ sessions: result.sessions || [], loading: false, error: '' });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '训练记录加载失败。' });
    }
  },

  onInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  onDateChange(event) { this.setData({ 'form.date': event.detail.value }); },
  onTimeChange(event) { this.setData({ 'form.startTime': event.detail.value }); },
  onTypeChange(event) {
    const typeIndex = Number(event.detail.value) || 0;
    this.setData({ typeIndex, 'form.trainingType': this.data.typeOptions[typeIndex] });
  },
  onIntensityChange(event) {
    const intensityIndex = Number(event.detail.value) || 0;
    this.setData({ intensityIndex, 'form.intensityZone': this.data.intensityOptions[intensityIndex] });
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

  cancelEdit() { this.setData({ editId: 0, form: emptyForm(), typeIndex: 0, intensityIndex: 1, showAdvanced: false }); },

  async save() {
    if (this.data.saving) return;
    const form = this.data.form;
    if (!form.content || !form.duration || !form.rpe) {
      wx.showToast({ title: '请填写内容、时长和 RPE', icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      const action = this.data.editId
        ? api.updateMyTrainingSession(this.data.editId, form)
        : api.createMyTrainingSession(form);
      const result = await action;
      getApp().globalData.homeNeedsRefresh = true;
      getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
      wx.showToast({ title: this.data.editId ? '记录已更新' : '记录已同步', icon: 'success' });
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
    wx.showModal({
      title: '删除训练记录',
      content: '确认删除这条本人填写的训练记录吗？',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await api.deleteMyTrainingSession(id);
          getApp().globalData.homeNeedsRefresh = true;
          getApp().globalData.dataVersion = (getApp().globalData.dataVersion || 0) + 1;
          if (this.data.editId === id) this.cancelEdit();
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.loadPage();
        } catch (error) {
          this.setData({ error: error.message || '训练记录删除失败。' });
        }
      }
    });
  }
});
