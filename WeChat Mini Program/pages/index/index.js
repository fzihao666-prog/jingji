const api = require('../../services/api');
const { loadContext, projectAthletes } = require('../../utils/context');
const { periodFor, shortDate } = require('../../utils/date');
const { number, INJURY_LABELS } = require('../../utils/format');

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
    canSelfReport: false
  },

  onShow() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage(true).finally(() => wx.stopPullDownRefresh()); },

  async loadPage(refreshUser = false) {
    this.setData({ loading: true, error: '' });
    try {
      const context = await loadContext({ refreshUser });
      const period = periodFor(this.data.range);
      const selectedAthleteId = context.user.athleteId || context.selectedAthleteId || 0;
      const athletes = projectAthletes(context.athletes, context.project);
      this.setData({
        user: context.user,
        projects: context.projects,
        project: context.project,
        athletes,
        selectedAthleteId,
        showAthlete: context.user.role !== 'ATL',
        canSelfReport: context.user.role === 'ATL',
        from: period.from,
        to: period.to
      });
      await this.loadOverview(context.project, selectedAthleteId, period);
    } catch (error) {
      if (error.message !== '未登录') this.setData({ error: error.message || '训练总览加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadOverview(project, athleteId, period) {
    const result = await api.overview(period.from, period.to, athleteId, project);
    this.setData(buildView(result.overview));
  },

  async onProjectChange(event) {
    const project = event.detail.value;
    const app = getApp();
    const athletes = projectAthletes(app.globalData.athletes, project);
    const selectedAthleteId = app.globalData.user.athleteId || 0;
    app.setProject(project);
    app.globalData.selectedAthleteId = selectedAthleteId;
    this.setData({ project, athletes, selectedAthleteId, loading: true, error: '' });
    try {
      await api.saveCurrentProject(project);
      const period = periodFor(this.data.range);
      this.setData(period);
      await this.loadOverview(project, selectedAthleteId, period);
    } catch (error) {
      this.setData({ error: error.message || '项目切换失败。' });
    } finally {
      this.setData({ loading: false });
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
    if (!athleteId) return;
    getApp().globalData.selectedAthleteId = athleteId;
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  openTrainingEntry() {
    wx.navigateTo({ url: '/pages/training-entry/training-entry' });
  }
});
