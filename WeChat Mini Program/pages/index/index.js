const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { createInitialScope, applyScopeChange, saveProjectInOrder } = require('../../utils/page-scope');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { shortDate, todayBeijing } = require('../../utils/date');
const { number, INJURY_LABELS } = require('../../utils/format');
const { dailyTodoView } = require('../../utils/daily-todos');

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return valid.length ? sum(valid) / valid.length : null;
}

function buildView(overview) {
  const records = overview.records || [];
  const analytics = overview.trainingAnalytics || { summary: {}, days: [] };
  const summary = analytics.summary || {};
  const totalDuration = summary.totalDurationMin;
  const physicalDuration = summary.physicalDurationMin;
  const specialDuration = summary.specialDurationMin;
  const fatigue = average(records.map((item) => item.fatigueIndex));
  const highFatigue = new Set(records.filter((item) => Number(item.fatigueIndex) >= 7).map((item) => item.athleteId)).size;
  const totalSrpe = sum(records.map((item) => item.srpe));
  const loadRatio = overview.trainingLoadRatio || {};
  const injuries = overview.injuries || [];
  const activeInjuries = injuries.filter((item) => item.status !== 'healthy').map((item) => ({
    ...item,
    statusLabel: INJURY_LABELS[item.status] || item.status || '需关注'
  }));

  const metrics = [
    {
      label: '训练时长', value: totalDuration === null || totalDuration === undefined ? '—' : number(totalDuration / 60), unit: totalDuration == null ? '' : '小时',
      note: `体能 ${physicalDuration == null ? '—' : number(physicalDuration / 60)}h · 专项 ${specialDuration == null ? '—' : number(specialDuration / 60)}h`, tone: ''
    },
    {
      label: '训练负荷', value: number(loadRatio.totalLoad || totalSrpe, 0), unit: 'AU',
      note: `体能 ${number(loadRatio.physicalLoad || 0, 0)} · 专项 ${number(loadRatio.specialLoad || 0, 0)}`, tone: 'tone-orange'
    },
    {
      label: '疲劳指数', value: fatigue === null ? '—' : number(fatigue), unit: fatigue === null ? '' : '分',
      note: fatigue === null ? '暂无疲劳记录' : `疲劳偏高 ${highFatigue} 人`, tone: 'tone-teal'
    },
    {
      label: '损伤情况', value: number(activeInjuries.length, 0), unit: '人',
      note: activeInjuries.length ? `观察 ${activeInjuries.filter((item) => item.status === 'observation').length}人 · 受限/康复/停训 ${activeInjuries.filter((item) => ['restricted', 'rehab', 'suspended'].includes(item.status)).length}人` : '当前无活动性损伤', tone: 'tone-green'
    }
  ];

  const days = (analytics.days || []).slice(-14);
  const maxDuration = Math.max(1, ...days.map((item) => Number(item.physicalDurationMin || 0) + Number(item.specialDurationMin || 0)));
  const maxLoad = Math.max(1, ...days.map((item) => Number(item.physicalLoad || 0) + Number(item.specialLoad || 0)));
  const trend = days.map((item) => {
    const duration = Number(item.physicalDurationMin || 0) + Number(item.specialDurationMin || 0);
    const load = Number(item.physicalLoad || 0) + Number(item.specialLoad || 0);
    return {
      date: item.date,
      label: shortDate(item.date),
      duration,
      load,
      durationHeight: Math.max(2, Math.round(duration / maxDuration * 100)),
      loadHeight: Math.max(2, Math.round(load / maxLoad * 100))
    };
  });

  const intensity = (overview.intensityDistribution || []).filter((item) => Number(item.durationMin) > 0).map((item) => ({
    name: item.zone,
    value: `${number(item.durationMin, 0)} min`,
    percentage: number(item.percentage),
    width: Math.max(1, Math.min(100, Number(item.percentage) || 0))
  }));

  const attention = {
    show: highFatigue > 0 || activeInjuries.length > 0,
    title: '需要关注',
    summary: `疲劳偏高 ${highFatigue} 人 · 伤病状态 ${activeInjuries.length} 人`
  };

  return { metrics, trend, intensity, activeInjuries, attention, meta: overview.meta || {} };
}

Page({
  data: {
    loading: true,
    error: '',
    user: null,
    projects: [],
    project: '',
    athletes: [],
    selectedAthleteId: 0,
    showAthlete: true,
    range: 'month',
    from: '',
    to: '',
    metrics: [],
    trend: [],
    intensity: [],
    activeInjuries: [],
    attention: { show: false, title: '', summary: '' },
    meta: {},
    canSelfReport: false,
    canViewTodos: false,
    todos: null,
    todosLoading: false,
    todosError: '',
    todosStatus: ''
  },

  onShow() {
    const app = getApp();
    const fresh = this._lastLoadedAt && Date.now() - this._lastLoadedAt < 30000
      && this._loadedDate === todayBeijing()
      && this._loadedProject === app.globalData.currentProject
      && !app.globalData.homeNeedsRefresh && !this.data.error;
    if (!fresh) this.loadPage();
  },
  onPullDownRefresh() { this.loadPage(true).finally(() => wx.stopPullDownRefresh()); },

  loadPage(refreshUser = false) {
    this._guard = this._guard || createRequestGuard();
    this._todoGuard = this._todoGuard || createRequestGuard();
    this._todoGuard.next();
    this.setData({ todos: null, todosError: '', canViewTodos: false });
    return loadWithGuard(this, this._guard, async (isLatest) => {
      const context = await loadContext({ refreshUser });
      if (!isLatest()) return null;
      const scope = createInitialScope(context, { range: this.data.range, showAthlete: false });
      const canSelfReport = scope.user.role === 'ATL';
      const canViewTodos = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'].includes(scope.user.role);
      this.setData({ ...scope, canSelfReport, canViewTodos });
      const [overview] = await Promise.all([
        this.loadPageData({ ...scope, canSelfReport }),
        this.loadTodos(scope.project)
      ]);
      if (isLatest()) {
        this._lastLoadedAt = Date.now();
        this._loadedDate = todayBeijing();
        this._loadedProject = scope.project;
        getApp().globalData.homeNeedsRefresh = false;
      }
      return overview;
    }, '训练总览加载失败。');
  },

  async loadPageData(scope) {
    const result = await api.overview(scope.from, scope.to, scope.canSelfReport ? scope.selectedAthleteId : 0, scope.project);
    return buildView(result.overview);
  },

  async loadTodos(project) {
    if (!this.data.canViewTodos) return;
    this._todoGuard = this._todoGuard || createRequestGuard();
    const id = this._todoGuard.next();
    this.setData({ todosLoading: true, todosError: '', todos: null, todosStatus: '正在核对今日填报与关注状态…' });
    try {
      const result = await api.dailyTodos(project);
      if (!this._todoGuard.isLatest(id)) return;
      const todos = dailyTodoView(result.todos);
      const todosStatus = todos.counts.total
        ? `加载完成，未填报 ${todos.counts.missing} 人，需关注 ${todos.counts.attention} 人。`
        : '加载完成，当前项目暂无可访问的运动员。';
      this.setData({ todos, todosStatus });
    } catch (error) {
      if (this._todoGuard.isLatest(id)) {
        const todosError = error.message || '每日待办加载失败，请重试。';
        this.setData({ todosError, todosStatus: todosError });
      }
    } finally {
      if (this._todoGuard.isLatest(id)) this.setData({ todosLoading: false });
    }
  },

  retryTodos() {
    return this.loadTodos(this.data.project);
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') {
      this._todoGuard = this._todoGuard || createRequestGuard();
      this._todoGuard.next();
      this.setData({ metrics: [], trend: [], intensity: [], activeInjuries: [], meta: {}, todos: null, todosError: '', todosLoading: true, todosStatus: '正在切换项目…' });
    }
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') {
        try {
          await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
        } catch (error) {
          if (isLatest()) this.setData({ todosLoading: false, todosError: '项目切换未完成，请刷新重试。', todosStatus: '项目切换未完成，请刷新重试。' });
          throw error;
        }
      }
      if (!isLatest()) return null;
      const scope = this.data;
      if (change.field === 'project') {
        const [overview] = await Promise.all([this.loadPageData(scope), this.loadTodos(scope.project)]);
        return overview;
      }
      return this.loadPageData(scope);
    }, '训练总览加载失败。');
  },

  showTrendDetail(event) {
    const item = this.data.trend[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    wx.showModal({
      title: item.date,
      content: `训练时长：${number(item.duration)} 分钟\n训练负荷：${number(item.load, 0)} AU`,
      showCancel: false
    });
  },

  goToAthlete(event) {
    const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
    if (!athleteId) return;
    if (!this.data.athletes.some((athlete) => Number(athlete.id) === athleteId)) {
      wx.showToast({ title: '该运动员不在当前权限范围', icon: 'none' });
      return;
    }
    getApp().globalData.selectedAthleteId = athleteId;
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  openTrainingEntry() {
    wx.navigateTo({ url: '/pages/training-entry/training-entry' });
  }
});
