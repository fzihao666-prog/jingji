const api = require('../../services/api');
const { emptySession, differences, effectiveSessions, revisionSummary, executionView, checkRows, diffRows } = require('./model');
const labels = { draft: '草稿', pending: '待审核', published: '已发布', archived: '已归档' };
function tomorrow() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
Page({
  data: { loading: false, saving: false, error: '', canManage: false, plans: [], teams: [], athletes: [], teamAthletes: [], selected: null, sessions: [], editor: null, lesson: null, lessonIndex: -1, overrideAthleteId: 0, overrideReason: '', categories: ['专项', '体能', '恢复'], statusLabels: labels, previewId: 0, aiOpen: false, aiDate: '', aiConstraints: '', aiInstruction: '', aiBusy: false, aiDiff: null, aiConversation: [], aiNotes: [], aiWarnings: [], checks: [], checkBusy: false, sessionFields: [{"key": "date", "label": "日期 YYYY-MM-DD"}, {"key": "period", "label": "上午 / 下午 / 具体时间"}, {"key": "content", "label": "训练内容"}, {"key": "durationMin", "label": "计划时长（分钟）"}, {"key": "distanceKm", "label": "计划距离（公里）"}, {"key": "intensity", "label": "目标强度"}, {"key": "sets", "label": "组数"}, {"key": "reps", "label": "次数"}, {"key": "load", "label": "负重（kg）"}, {"key": "notes", "label": "技术要求与备注"}] },
  reportError(message) { this.setData({ error: message }); wx.showToast({ title: message, icon: 'none', duration: 2500 }); },
  onShow() { this.load(); },
  async load() {
    if (!getApp().globalData.token) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const user = getApp().globalData.user;
      const result = await api.teamPlans({ project: getApp().globalData.currentProject });
      this.setData({ ...result, canManage: ['SCC', 'REG', 'TD', 'DMD'].includes(user.role), ownAthleteId: user.athleteId || 0 });
      if (this.data.selected) this.selectPlan(result.plans.find((plan) => plan.id === this.data.selected.id) || null);
    } catch (error) { this.reportError(error.message || '计划加载失败'); }
    finally { this.setData({ loading: false }); }
  },
  selectPlan(plan) {
    const baseline = plan && this.data.plans.find((row) => row.rootId === plan.rootId && row.version < plan.version && row.status !== 'draft' && row.status !== 'pending');
    const changeSummary = plan ? revisionSummary(baseline, plan) : '';
    const adjustmentRows = plan ? plan.data.overrides.map((row) => { const athlete = this.data.athletes.find((a) => Number(a.id) === Number(row.athleteId)); const session = plan.data.sessions.find((s) => s.id === row.sessionId) || {}; return { key: `${row.athleteId}-${row.sessionId}`, name: athlete ? athlete.name : '运动员', date: session.date, content: session.content, reason: row.reason, changes: JSON.stringify(row.changes) }; }) : [];
    const meta = plan && plan.aiMetadata ? plan.aiMetadata : null;
    this.setData({
      teamExecution: [], lessonExecution: [], executionError: '', executionLoading: false, changeSummary, adjustmentRows, previewName: '', selected: plan, editor: null, lesson: null, previewId: this.data.ownAthleteId || 0,
      teamAthletes: plan ? this.data.athletes.filter((a) => Number(a.teamId) === Number(plan.teamId)) : [],
      sessions: plan ? effectiveSessions(plan, this.data.ownAthleteId) : [],
      aiDiff: null, aiInstruction: '',
      aiConversation: meta && meta.conversation ? meta.conversation : [],
      aiNotes: meta && meta.dataNotes ? meta.dataNotes : [],
      aiWarnings: meta && meta.warnings ? meta.warnings : [],
      checks: [],
    });
    if (plan && (plan.status === 'published' || plan.status === 'archived')) this.loadChecks(plan);
    if (plan && this.data.canManage) this.loadExecution(plan);
  },
  async loadChecks(plan) {
    try {
      const result = await api.teamPlanChecks(plan.id);
      if (!this.data.selected || this.data.selected.id !== plan.id) return;
      this.setData({ checks: checkRows(plan, result.checks || []) });
    } catch (error) {
      // 确认状态加载失败不阻塞计划查看。
      this.setData({ checks: checkRows(plan, []) });
    }
  },
  async loadExecution(plan) {
    const requestId = (this._executionRequestId || 0) + 1;
    this._executionRequestId = requestId;
    this.setData({ executionLoading: true, executionError: '' });
    try {
      const result = await api.planExecution(plan.project);
      if (this._executionRequestId !== requestId || !this.data.selected || this.data.selected.id !== plan.id) return;
      this.setData(executionView(result, plan, this.data.athletes));
    } catch (error) {
      if (this._executionRequestId === requestId && this.data.selected && this.data.selected.id === plan.id) {
        this.setData({ executionError: error.message || '执行情况加载失败' });
        wx.showToast({ title: error.message || '执行情况加载失败', icon: 'none' });
      }
    } finally { if (this._executionRequestId === requestId) this.setData({ executionLoading: false }); }
  },
  select(event) { this.selectPlan(this.data.plans.find((plan) => plan.id === Number(event.currentTarget.dataset.id))); },
  create() {
    const team = this.data.teams[0];
    if (!team) { this.reportError('当前没有可管理的队伍'); return; }
    this.setData({ editor: { teamId: team.id, title: '', startDate: '', endDate: '', data: { goal: '', focus: '', sessions: [], overrides: [] } }, teamIndex: 0, lesson: null, selected: null });
  },
  edit() { this.setData({ editor: JSON.parse(JSON.stringify(this.data.selected)), lesson: null }); },
  cancel() { this.setData({ editor: null, lesson: null }); },
  input(event) { this.setData({ [`editor.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  teamChange(event) { const index = Number(event.detail.value); this.setData({ teamIndex: index, 'editor.teamId': this.data.teams[index].id }); },
  addLesson() { this.setData({ lesson: emptySession(), lessonIndex: -1, overrideAthleteId: 0 }); },
  editLesson(event) { const index = Number(event.currentTarget.dataset.index); this.setData({ lesson: { ...this.data.editor.data.sessions[index] }, lessonIndex: index, overrideAthleteId: 0 }); },
  lessonInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({ [`lesson.${field}`]: ['durationMin', 'distanceKm', 'sets', 'reps', 'load'].includes(field) ? (value === '' ? null : Number(value)) : value });
  },
  categoryChange(event) { this.setData({ 'lesson.category': ['special', 'physical', 'recovery'][Number(event.detail.value)] }); },
  saveLesson() {
    const { lesson, lessonIndex, overrideAthleteId } = this.data;
    if (['durationMin','distanceKm','sets','reps','load'].some(key => lesson[key] !== null && (!Number.isFinite(lesson[key]) || lesson[key] < 0))) {
      this.setData({ error: '计划数值必须为空或非负有效数字' }); wx.showToast({ title: '请检查计划数值', icon: 'none' }); return;
    }
    if (!lesson.date || !lesson.content) { this.reportError('请填写训练日期与内容'); return; }
    const data = JSON.parse(JSON.stringify(this.data.editor.data));
    if (overrideAthleteId) {
      if (!this.data.overrideReason.trim()) { this.reportError('请填写调整原因'); return; }
      const base = data.sessions[lessonIndex];
      const changes = differences(base, lesson);
      data.overrides = data.overrides.filter((row) => !(row.sessionId === base.id && Number(row.athleteId) === Number(overrideAthleteId)));
      if (Object.keys(changes).length) data.overrides.push({ athleteId: overrideAthleteId, sessionId: base.id, changes, reason: this.data.overrideReason.trim() });
    } else if (lessonIndex < 0) data.sessions.push(lesson);
    else data.sessions[lessonIndex] = lesson;
    this.setData({ 'editor.data': data, lesson: null, error: '' });
  },
  adjust(event) {
    const index = Number(event.currentTarget.dataset.index);
    const athletes = this.data.athletes.filter((a) => Number(a.teamId) === Number(this.data.editor.teamId));
    if (!athletes.length) return;
    wx.showActionSheet({ itemList: athletes.map((a) => a.name), success: ({ tapIndex }) => {
      const athleteId = athletes[tapIndex].id;
      const base = this.data.editor.data.sessions[index];
      const override = this.data.editor.data.overrides.find((row) => row.sessionId === base.id && Number(row.athleteId) === Number(athleteId));
      this.setData({ lesson: { ...base, ...(override ? override.changes : {}) }, lessonIndex: index, overrideAthleteId: athleteId, overrideName: athletes[tapIndex].name, overrideReason: override ? override.reason : '' });
    } });
  },
  reasonInput(event) { this.setData({ overrideReason: event.detail.value }); },
  revokeOverride() {
    const data = this.data.editor.data;
    this.setData({ 'editor.data.overrides': data.overrides.filter((row) => !(row.sessionId === this.data.lesson.id && Number(row.athleteId) === Number(this.data.overrideAthleteId))), lesson: null });
  },
  removeLesson(event) {
    const index = Number(event.currentTarget.dataset.index);
    const data = this.data.editor.data;
    const sessionId = data.sessions[index].id;
    this.setData({ 'editor.data.sessions': data.sessions.filter((row) => row.id !== sessionId), 'editor.data.overrides': data.overrides.filter((row) => row.sessionId !== sessionId), lesson: null });
  },
  preview(event) { const athlete = this.data.teamAthletes[Number(event.detail.value)]; this.setData({ previewId: athlete.id, sessions: effectiveSessions(this.data.selected, athlete.id), previewName: athlete.name }); },
  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try {
      const editor = this.data.editor;
      const result = editor.id ? await api.updateTeamPlan(editor.id, editor) : await api.createTeamPlan(editor);
      this.selectPlan(result.plan); await this.load(); wx.showToast({ title: '草稿已保存' });
    } catch (error) { this.reportError(error.message || '保存失败'); }
    finally { this.setData({ saving: false }); }
  },
  transition(event) {
    const action = event.currentTarget.dataset.action;
    const plan = this.data.selected;
    const content = action === 'publish' ? `${plan.team}｜${plan.startDate} 至 ${plan.endDate}\n${plan.data.sessions.length} 节训练课，${plan.data.overrides.length} 项个人调整。请检查下方每日安排及个人预览后确认发布。` : '确认执行此操作？修订会保留原发布版本。';
    wx.showModal({ title: action === 'publish' ? '确认发布计划' : '计划状态变更', content, success: async ({ confirm }) => {
      if (!confirm || this.data.saving) return;
      this.setData({ saving: true, error: '' });
      try { const result = await api.transitionTeamPlan(plan.id, { revision: plan.revision, action, confirmed: action === 'publish' }); this.selectPlan(result.plan); await this.load(); }
      catch (error) { this.reportError(error.message || '操作失败'); }
      finally { this.setData({ saving: false }); }
    } });
  },
  enterTraining(event) { wx.navigateTo({ url: `/pages/training-entry/training-entry?teamPlanId=${this.data.selected.id}&planSessionId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  // —— AI 生成与对话修改 ——
  toggleAi() { this.setData({ aiOpen: !this.data.aiOpen, aiDate: this.data.aiDate || tomorrow() }); },
  aiField(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  async generateAi() {
    if (this.data.aiBusy) return;
    const team = this.data.teams[0];
    if (!team) { this.reportError('当前没有可管理的队伍'); return; }
    const date = this.data.aiDate || tomorrow();
    this.setData({ aiBusy: true, error: '' });
    try {
      const result = await api.generateAiTeamPlan({ teamId: team.id, date, constraints: this.data.aiConstraints });
      await this.load();
      const plan = result.plan;
      this.selectPlan(plan);
      this.setData({
        aiDiff: result.diff ? diffRows(result.diff) : null,
        aiNotes: result.dataNotes || [],
        aiWarnings: result.warnings || [],
      });
      wx.showToast({ title: 'AI草稿已生成', icon: 'success' });
    } catch (error) { this.reportError(error.message || 'AI生成失败，可稍后手动重试'); }
    finally { this.setData({ aiBusy: false }); }
  },
  async reviseAi() {
    const plan = this.data.selected;
    if (!plan || this.data.aiBusy) return;
    if (!this.data.aiInstruction.trim()) { this.reportError('请填写调整要求'); return; }
    this.setData({ aiBusy: true, error: '' });
    try {
      const result = await api.reviseAiTeamPlan(plan.id, { instruction: this.data.aiInstruction.trim() });
      await this.load();
      this.selectPlan(result.plan);
      this.setData({
        aiDiff: result.diff ? diffRows(result.diff) : null,
        aiNotes: result.dataNotes || [],
        aiWarnings: result.warnings || [],
        aiInstruction: '',
      });
      wx.showToast({ title: 'AI已生成修订方案', icon: 'success' });
    } catch (error) {
      // 生成失败保留上一版有效草稿。
      this.reportError(error.message || 'AI修订失败，草稿已保留');
    } finally { this.setData({ aiBusy: false }); }
  },
  undoAi() {
    const plan = this.data.selected;
    if (!plan || this.data.aiBusy) return;
    wx.showModal({ title: '撤销上一次修改', content: '将恢复为上一版AI草稿内容。', success: async ({ confirm }) => {
      if (!confirm) return;
      this.setData({ aiBusy: true });
      try {
        const result = await api.undoAiTeamPlan(plan.id);
        await this.load();
        this.selectPlan(result.plan);
        this.setData({ aiDiff: null });
        wx.showToast({ title: '已撤销上一次修改', icon: 'success' });
      } catch (error) { this.reportError(error.message || '撤销失败'); }
      finally { this.setData({ aiBusy: false }); }
    } });
  },
  // —— 训练项执行确认（教练逐项勾选，代表队伍已组织实施） ——
  markCheck(event) {
    if (!this.data.canManage || this.data.checkBusy) return;
    const plan = this.data.selected;
    const { session, item, status } = event.currentTarget.dataset;
    const itemId = item || '';
    const previous = this.data.checks.find((row) => row.sessionId === session && row.itemId === itemId) || { revision: 0, status: 'pending' };
    const apply = async (nextStatus, reason) => {
      this.setData({ checkBusy: true });
      try {
        const result = await api.updateTeamPlanCheck(plan.id, { sessionId: session, itemId: itemId || undefined, status: nextStatus, reason, revision: previous.revision });
        this.setData({ checks: checkRows(plan, this.data.checks.map((row) => row.sessionId === session && row.itemId === itemId ? result.check : row)) });
      } catch (error) {
        // 保存失败恢复原状态提示。
        this.reportError(error.message || '确认失败，请重试');
        this.loadChecks(plan);
      } finally { this.setData({ checkBusy: false }); }
    };
    if (status === 'cancelled') {
      wx.showModal({ title: '取消训练安排', editable: true, placeholderText: '请填写简要原因（必填）', success: ({ confirm, content }) => {
        if (!confirm) return;
        if (!content || !content.trim()) { this.reportError('取消训练安排必须填写原因'); return; }
        apply('cancelled', content.trim());
      } });
    } else if (status === 'revert') {
      // 取消勾选恢复待执行。
      apply(null);
    } else {
      apply('executed');
    }
  },
});
