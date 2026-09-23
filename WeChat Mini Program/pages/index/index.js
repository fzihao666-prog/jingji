const api = require('../../services/api');
const { loadContext, projectAthletes } = require('../../utils/context');
const { periodFor, shortDate } = require('../../utils/date');
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

  onShow() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage(true).finally(() => wx.stopPullDownRefresh()); },

  async loadPage(refreshUser = false) {
    const pageRequest = this._pageRequest = (this._pageRequest || 0) + 1;
    this._todoRequest = (this._todoRequest || 0) + 1;
    this.setData({ loading: true, error: '', todos: null, todosError: '', canViewTodos: false });
    try {
      const context = await loadContext({ refreshUser });
      if (pageRequest !== this._pageRequest) return;
      const period = periodFor(this.data.range);
      const selectedAthleteId = context.user.athleteId || context.selectedAthleteId || 0;
      const athletes = projectAthletes(context.athletes, context.project);
      this.setData({
        user: context.user,
        projects: context.projects,
        project: context.project,
        athletes,
        selectedAthleteId,
        showAthlete: false,
        canSelfReport: context.user.role === 'ATL',
        canViewTodos: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'].includes(context.user.role),
        from: period.from,
        to: period.to
      });
      await Promise.all([
        this.loadOverview(context.project, selectedAthleteId, period),
        this.loadTodos(context.project)
      ]);
    } catch (error) {
      if (pageRequest === this._pageRequest && error.message !== '未登录') this.setData({ error: error.message || '训练总览加载失败。' });
    } finally {
      if (pageRequest === this._pageRequest) this.setData({ loading: false });
    }
  },

  async loadOverview(project, athleteId, period) {
    const result = await api.overview(period.from, period.to, this.data.canSelfReport ? athleteId : 0, project);
    if (project === this.data.project) this.setData(buildView(result.overview));
  },

  async loadTodos(project) {
    if (!this.data.canViewTodos) return;
    const requestId = this._todoRequest = (this._todoRequest || 0) + 1;
    this.setData({ todosLoading: true, todosError: '', todos: null, todosStatus: '正在核对今日填报与关注状态…' });
    try {
      const result = await api.dailyTodos(project);
      if (requestId !== this._todoRequest || project !== this.data.project) return;
      const todos = dailyTodoView(result.todos);
      const todosStatus = todos.counts.total
        ? `加载完成，未填报 ${todos.counts.missing} 人，需关注 ${todos.counts.attention} 人。`
        : '加载完成，当前项目暂无可访问的运动员。';
      this.setData({ todos, todosStatus });
    } catch (error) {
      if (requestId === this._todoRequest && project === this.data.project) {
        const todosError = error.message || '每日待办加载失败，请重试。';
        this.setData({ todosError, todosStatus: todosError });
      }
    } finally {
      if (requestId === this._todoRequest) this.setData({ todosLoading: false });
    }
  },

  retryTodos() {
    return this.loadTodos(this.data.project);
  },

  async onProjectChange(event) {
    const pageRequest = this._pageRequest = (this._pageRequest || 0) + 1;
    const project = event.detail.value;
    const app = getApp();
    const athletes = projectAthletes(app.globalData.athletes, project);
    const selectedAthleteId = app.globalData.user.athleteId || 0;
    app.setProject(project);
    app.globalData.selectedAthleteId = selectedAthleteId;
    this._todoRequest = (this._todoRequest || 0) + 1;
    this.setData({ project, athletes, selectedAthleteId, loading: true, error: '', todos: null, todosError: '', todosLoading: true, todosStatus: '正在切换项目…' });
    let projectSaved = false;
    try {
      await api.saveCurrentProject(project);
      if (pageRequest !== this._pageRequest) return;
      projectSaved = true;
      const period = periodFor(this.data.range);
      this.setData(period);
      await Promise.all([this.loadOverview(project, selectedAthleteId, period), this.loadTodos(project)]);
    } catch (error) {
      if (pageRequest !== this._pageRequest) return;
      this.setData({ error: error.message || '项目切换失败。' });
      if (!projectSaved) this.setData({ todosLoading: false, todosError: '项目切换未完成，请刷新重试。', todosStatus: '项目切换未完成，请刷新重试。' });
    } finally {
      if (pageRequest === this._pageRequest) this.setData({ loading: false });
    }
  },

  async onAthleteChange(event) {
    const selectedAthleteId = Number(event.detail.value) || 0;
    getApp().globalData.selectedAthleteId = selectedAthleteId;
    this.setData({ selectedAthleteId, loading: true, error: '' });
    try {
      await this.loadOverview(this.data.project, selectedAthleteId, { from: this.data.from, to: this.data.to });
    } catch (error) {
      this.setData({ error: error.message || '运动员数据加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onRangeChange(event) {
    const range = event.detail.value;
    const period = periodFor(range);
    this.setData({ range, from: period.from, to: period.to, loading: true, error: '' });
    try {
      await this.loadOverview(this.data.project, this.data.selectedAthleteId, period);
    } catch (error) {
      this.setData({ error: error.message || '时间范围加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
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
    if (!athleteId || !this.data.athletes.some((athlete) => Number(athlete.id) === athleteId)) return;
    getApp().globalData.selectedAthleteId = athleteId;
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  openTrainingEntry() {
    wx.navigateTo({ url: '/pages/training-entry/training-entry' });
  }
});
