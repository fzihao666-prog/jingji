const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { periodFor, shortDate, ageAt } = require('../../utils/date');
const { number } = require('../../utils/format');

function buildTrainingView(training, athletes, to) {
  const summary = training.summary || {};
  const metrics = [
    { label: '专项训练时长', value: summary.durationMin == null ? '—' : number(summary.durationMin / 60), unit: summary.durationMin == null ? '' : 'h', note: '同队共同课次去重' },
    { label: '专项训练距离', value: number(summary.distanceKm), unit: 'km', note: '只统计已填报距离' },
    { label: '专项训练课次', value: number(summary.sessionCount, 0), unit: '课次', note: '当前筛选时间范围' },
    { label: '专项训练负荷', value: number(summary.load), unit: 'AU', note: '使用既有SRPE' }
  ];

  const days = (training.days || []).slice(-14);
  const maxDuration = Math.max(1, ...days.map((item) => Number(item.durationMin || 0)));
  const maxDistance = Math.max(1, ...days.map((item) => Number(item.distanceKm || 0)));
  const trend = days.map((item) => ({
    date: item.date,
    label: shortDate(item.date),
    duration: Number(item.durationMin || 0),
    distance: Number(item.distanceKm || 0),
    durationHeight: Math.max(2, Math.round(Number(item.durationMin || 0) / maxDuration * 100)),
    distanceHeight: Math.max(2, Math.round(Number(item.distanceKm || 0) / maxDistance * 100))
  }));

  const intensity = (training.intensity || []).filter((item) => Number(item.durationMin) > 0).map((item) => ({
    name: item.name,
    value: `${number(item.durationMin)} min`,
    percentage: number(item.percentage),
    width: Math.max(1, Math.min(100, Number(item.percentage) || 0))
  }));
  const content = (training.content || []).map((item) => ({
    name: item.name,
    value: `${item.count} 课次`,
    percentage: number(item.percentage),
    width: Math.max(1, Math.min(100, Number(item.percentage) || 0))
  }));
  const athleteRows = (athletes || []).slice(0, 30).map((athlete) => {
    const age = ageAt(athlete.birthDate, to);
    return {
      id: athlete.id,
      name: athlete.name,
      meta: `${athlete.gender || '性别未录入'} · ${age == null ? '年龄未录入' : `${age}岁`} · ${athlete.team || '未分队'}`,
      body: athlete.weightKg == null ? '体重未录入' : `${number(athlete.weightKg)} kg`,
      sessionCount: athlete.summary.sessionCount,
      duration: athlete.summary.durationMin == null ? '—' : `${number(athlete.summary.durationMin / 60)} h`,
      distance: athlete.summary.distanceKm == null ? '—' : `${number(athlete.summary.distanceKm)} km`,
      load: athlete.summary.load == null ? '—' : `${number(athlete.summary.load)} AU`
    };
  });
  return { metrics, trend, intensity, content, athleteRows, athleteTotal: (athletes || []).length };
}

Page({
  data: {
    loading: true,
    error: '',
    projects: [],
    project: '',
    range: 'month',
    from: '',
    to: '',
    teamItems: [{ id: 0, name: '全部队伍' }],
    teamIndex: 0,
    teamId: 0,
    championEvents: [],
    metrics: [],
    trend: [],
    intensity: [],
    content: [],
    athleteRows: [],
    athleteTotal: 0
  },

  onShow() { this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  async loadPage() {
    this.setData({ loading: true, error: '' });
    try {
      const context = await loadContext();
      const period = periodFor(this.data.range);
      this.setData({ projects: context.projects, project: context.project, from: period.from, to: period.to, teamId: 0, teamIndex: 0 });
      await this.loadProject(context.project, period);
    } catch (error) {
      if (error.message !== '未登录') this.setData({ error: error.message || '专项训练数据加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadProject(project, period) {
    const [teamResult, modelResult, trainingResult] = await Promise.all([
      api.overviewTeams(project),
      api.specialChampionModels(project),
      api.specialTrainingOverview(period.from, period.to, project, 0)
    ]);
    const teamItems = [{ id: 0, name: '全部队伍' }].concat(teamResult.teams || []);
    const championEvents = (modelResult.events || []).slice(0, 12).map((item) => ({
      code: item.eventCode,
      name: item.eventName,
      performance: item.bestPerformance || '待核实',
      meta: [item.country, item.competition, item.location].filter(Boolean).join(' · ') || '赛事来源待配置',
      pace: item.pace || ''
    }));
    this.setData(Object.assign({ teamItems, championEvents }, buildTrainingView(trainingResult.training, trainingResult.athletes, period.to)));
  },

  async loadTraining(teamId, period) {
    const result = await api.specialTrainingOverview(period.from, period.to, this.data.project, teamId);
    this.setData(buildTrainingView(result.training, result.athletes, period.to));
  },

  async onProjectChange(event) {
    const project = event.detail.value;
    const period = periodFor(this.data.range);
    getApp().setProject(project);
    this.setData({ project, from: period.from, to: period.to, teamId: 0, teamIndex: 0, loading: true, error: '' });
    try {
      await api.saveCurrentProject(project);
      await this.loadProject(project, period);
    } catch (error) {
      this.setData({ error: error.message || '项目切换失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onRangeChange(event) {
    const range = event.detail.value;
    const period = periodFor(range);
    this.setData({ range, from: period.from, to: period.to, loading: true, error: '' });
    try {
      await this.loadTraining(this.data.teamId, period);
    } catch (error) {
      this.setData({ error: error.message || '时间范围加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onTeamChange(event) {
    const teamIndex = Number(event.detail.value);
    const team = this.data.teamItems[teamIndex] || this.data.teamItems[0];
    const teamId = Number(team.id) || 0;
    this.setData({ teamIndex, teamId, loading: true, error: '' });
    try {
      await this.loadTraining(teamId, { from: this.data.from, to: this.data.to });
    } catch (error) {
      this.setData({ error: error.message || '队伍数据加载失败。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  showTrendDetail(event) {
    const item = this.data.trend[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    wx.showModal({
      title: item.date,
      content: `训练时长：${number(item.duration)} 分钟\n训练距离：${number(item.distance)} km`,
      showCancel: false
    });
  },

  goToAthlete(event) {
    const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
    if (!athleteId) return;
    if (!this.data.athleteRows.some((athlete) => Number(athlete.id) === athleteId)) {
      wx.showToast({ title: '该运动员不在当前权限范围', icon: 'none' });
      return;
    }
    getApp().globalData.selectedAthleteId = athleteId;
    wx.switchTab({ url: '/pages/profile/profile' });
  }
});
