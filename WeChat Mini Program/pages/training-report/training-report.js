const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { todayBeijing } = require('../../utils/date');
const { projectLabel } = require('../../utils/project-label');
const { reportPeriod, reportView } = require('../../utils/training-report');
const kinds = ['week', 'month', 'custom'];
const emptyCommentary = () => ({ highlights: '', concerns: '', suggestions: '' });
Page({
  data: { athleteId: 0, athleteName: '', projectName: '', busy: false, error: '', saved: '',
    range: reportPeriod('week', todayBeijing()), kindIndex: 0, kinds: ['周报告', '月报告', '阶段报告'],
    report: null, view: null, history: [], showHistory: false, showDaily: false, commentary: emptyCommentary(),
    commentaryFields: [{ key: 'highlights', label: '主要表现' }, { key: 'concerns', label: '需要关注' }, { key: 'suggestions', label: '下一步建议' }] },
  onLoad(options) {
    this._alive = true;
    this.run(async () => {
      const context = await loadContext({ refreshUser: true });
      if (!this._alive) return;
      const id = Number(options.athleteId);
      const athlete = (context.projectAthletes || []).find(a => Number(a.id) === id);
      if (!athlete) throw new Error('当前项目无此运动员的访问权限，请返回档案重新选择。');
      this.setData({ athleteId: id, athleteName: athlete.name, projectName: projectLabel(athlete.project) });
    });
  },
  onUnload() { this._alive = false; },
  async run(work) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try { await work(); }
    catch (error) { if (this._alive) this.setData({ error: error.message || '请求失败，请重试。' }); }
    finally { if (this._alive) this.setData({ busy: false }); }
  },
  changeRange(range) {
    if (this.data.busy) return;
    this._preview = null;
    this.setData({ range, report: null, view: null, saved: '', error: '', commentary: emptyCommentary() });
  },
  onKind(event) {
    if (this.data.busy) return;
    const index = Number(event.detail.value);
    this.setData({ kindIndex: index });
    this.changeRange(reportPeriod(kinds[index], this.data.range.from));
  },
  onFrom(event) {
    const range = this.data.range;
    this.changeRange(range.kind === 'custom' ? { ...range, from: event.detail.value } : reportPeriod(range.kind, event.detail.value));
  },
  onTo(event) { this.changeRange({ ...this.data.range, to: event.detail.value }); },
  preview() {
    this.run(async () => {
      if (!this.data.athleteId) throw new Error('请返回档案选择运动员。');
      const range = this.data.range;
      const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
      if (!Number.isFinite(days) || days < 1 || days > 90) throw new Error('请选择有效日期，最长 90 天。');
      const result = await api.reportPreview(this.data.athleteId, range);
      if (!this._alive) return;
      this._preview = result;
      this.setData({ report: result.data, view: reportView(result.data), saved: '', commentary: emptyCommentary() });
    });
  },
  onCommentary(event) {
    const key = event.currentTarget.dataset.key;
    if (!['highlights', 'concerns', 'suggestions'].includes(key)) return;
    this.setData({ [`commentary.${key}`]: event.detail.value });
  },
  generate() {
    this.run(async () => {
      if (!this._preview || this.data.saved) throw new Error('请先预览图表。');
      if (!this._preview.data.totals.sessions) throw new Error('当前日期范围暂无有效训练记录，请调整日期后重新预览。');
      const confirmed = await new Promise((resolve) => wx.showModal({
        title: '生成 AI 点评',
        content: '是否将去身份化的训练汇总发送至配置的大模型？不发送姓名、联系方式、伤病和恢复健康数据。',
        confirmText: '同意生成',
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false)
      }));
      if (!confirmed || !this._alive) return;
      const result = await api.reportCommentary(this.data.athleteId, this._preview.data.range, this._preview.fingerprint);
      if (this._alive) this.setData({ commentary: Object.fromEntries(Object.entries(result).map(([key, values]) => [key, values.join('\n')])) });
    });
  },
  save() {
    if (this.data.busy || this.data.saved || !this._preview) return;
    wx.showModal({ title: '确认保存报告', content: '请核对图表与点评。保存为历史快照，不修改训练记录，两端都可查看。', success: (result) => {
      if (!result.confirm || !this._alive) return;
      this.run(async () => {
        const commentary = Object.fromEntries(Object.entries(this.data.commentary).map(([key, text]) => [key, text.split('\n').map(s => s.trim()).filter(Boolean)]));
        const lines = Object.values(commentary).flat();
        if (Object.values(commentary).some(a => a.length > 2) || lines.some(s => s.length > 100) || lines.join('').length > 250)
          throw new Error('每类最多两条，每条最多 100 字，合计最多 250 字。');
        const saved = await api.saveReport(this.data.athleteId, this._preview.data.range, this._preview.fingerprint, commentary);
        if (this._alive) { this.setData({ saved: saved.createdAt }); wx.showToast({ title: '已保存', icon: 'success' }); }
      });
    } });
  },
  history() {
    this.run(async () => {
      if (!this.data.athleteId) return;
      const history = await api.reportHistory(this.data.athleteId);
      if (this._alive) this.setData({ history, showHistory: true });
    });
  },
  openHistory(event) {
    this.run(async () => {
      const result = await api.reportDetail(this.data.athleteId, event.currentTarget.dataset.id);
      if (!this._alive) return;
      this._preview = null;
      this.setData({ report: result.data, view: reportView(result.data), range: result.data.range, kindIndex: kinds.indexOf(result.data.range.kind),
        saved: result.createdAt, showHistory: false,
        commentary: Object.fromEntries(Object.entries(result.commentary).map(([key, values]) => [key, values.join('\n')])) });
    });
  },
  toggleDaily() { this.setData({ showDaily: !this.data.showDaily }); },
});
