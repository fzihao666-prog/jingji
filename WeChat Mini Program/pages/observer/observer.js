const api = require('../../services/api');
const { periodFor } = require('../../utils/date');
const { metricValue } = require('../../utils/training-empty');
const { strengthMetricRows } = require('../../utils/format');
const { buildSpecialTestView } = require('../../utils/special-test-view');
const { projectLabel } = require('../../utils/project-label');
const { effectiveSessions } = require('../team-plans/model');

Page({
  data: {
    loading: false, error: '', user: null, teams: [], teamIndex: 0, team: null,
    athletes: [], athleteIndex: 0, athlete: null, coaches: [], overview: [],
    sessions: [], tests: [], specialTests: [], plans: [],
    showAccount: false, currentPassword: '', newPassword: '', confirmPassword: '', accountBusy: false, accountError: '',
    ...periodFor('month')
  },
  onShow() { this.load(); },
  onUnload() { this._requestId = (this._requestId || 0) + 1; },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    const app = getApp();
    if (!app.globalData.token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    const requestId = this._requestId = (this._requestId || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const { user } = await api.me();
      app.globalData.user = user;
      if (user.role !== 'OBS') {
        wx.reLaunch({ url: '/pages/index/index' });
        return;
      }
      const [scope, people] = await Promise.all([api.observerTeams(), api.athletes()]);
      if (requestId !== this._requestId) return;
      const teams = (scope.teams || []).map(team => ({ ...team, label: `${team.name} · ${projectLabel(team.project)}` }));
      const previousTeamId = this.data.team?.id;
      const teamIndex = Math.max(0, teams.findIndex(team => Number(team.id) === Number(previousTeamId)));
      this._athletes = people.athletes || [];
      this.setData({ user, teams, teamIndex });
      await this.loadTeam();
    } catch (error) {
      if (requestId === this._requestId) this.setData({ error: error.message || '阅览内容加载失败，请重试。' });
    } finally {
      if (requestId === this._requestId) this.setData({ loading: false });
    }
  },
  async loadTeam() {
    const team = this.data.teams[this.data.teamIndex];
    const requestId = this._teamRequestId = (this._teamRequestId || 0) + 1;
    const athletes = team ? (this._athletes || []).filter(athlete => Number(athlete.teamId) === Number(team.id)) : [];
    this._athleteRequestId = (this._athleteRequestId || 0) + 1;
    this.setData({ team: team || null, athletes, athleteIndex: 0, athlete: null,
      coaches: team?.coaches || [], overview: [], sessions: [], tests: [], specialTests: [], plans: [] });
    if (!team) return;
    const [overview, plans] = await Promise.allSettled([
      api.overview(this.data.from, this.data.to, 0, team.project, team.id),
      api.teamPlans({ project: team.project, teamId: team.id })
    ]);
    if (requestId !== this._teamRequestId) return;
    const errors = [overview, plans].filter(result => result.status === 'rejected').map(result => result.reason.message || '部分内容加载失败。');
    const data = overview.status === 'fulfilled' ? overview.value.overview || {} : {};
    const summary = data.trainingAnalytics?.summary || {};
    this.setData({
      overview: [
        { label: '训练课次', value: metricValue(data.meta?.sessionCount, 0), unit: '次' },
        { label: '训练时长', value: metricValue(summary.totalDurationMin), unit: '分钟' },
        { label: '训练负荷', value: metricValue(data.trainingLoadRatio?.totalLoad, 0), unit: 'AU' }
      ],
      plans: plans.status === 'fulfilled' ? (plans.value.plans || []).filter(plan => Number(plan.teamId) === Number(team.id)) : [],
      error: errors.join(' ')
    });
    await this.loadAthlete();
  },
  async loadAthlete() {
    const athlete = this.data.athletes[this.data.athleteIndex];
    const team = this.data.team;
    const requestId = this._athleteRequestId = (this._athleteRequestId || 0) + 1;
    this.setData({ athlete: athlete || null, sessions: [], tests: [], specialTests: [],
      plans: this.data.plans.map(plan => ({ ...plan, viewSessions: effectiveSessions(plan, athlete?.id || 0) })) });
    if (!athlete || !team) return;
    const results = await Promise.allSettled([
      api.athleteTrainingSessions(athlete.id, this.data.from, this.data.to), api.strengthTests(athlete.id),
      api.specialTests(this.data.from, this.data.to, team.project, athlete.id)
    ]);
    if (requestId !== this._athleteRequestId) return;
    const [training, strength, special] = results;
    const inRange = date => date >= this.data.from && date <= this.data.to;
    const sessions = training.status === 'fulfilled' ? (training.value.sessions || []).filter(session => inRange(session.date)).map(session => ({
      ...session, durationText: metricValue(session.duration), distanceText: metricValue(session.distance), rpeText: metricValue(session.rpe)
    })) : [];
    const tests = strength.status === 'fulfilled' ? (strength.value.tests || []).filter(test => inRange(test.testDate)).map(test => ({ ...test, metrics: strengthMetricRows(test) })) : [];
    const specialView = buildSpecialTestView(special.status === 'fulfilled' ? special.value : null);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message || '部分个人数据加载失败。');
    this.setData({ sessions, tests, specialTests: specialView.events, error: [this.data.error, ...errors].filter(Boolean).join(' ') });
  },
  async runSelection(work) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try { await work(); }
    catch (error) { this.setData({ error: error.message || '加载失败，请重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  onTeam(event) {
    this.runSelection(async () => {
      this.setData({ teamIndex: Number(event.detail.value) });
      await this.loadTeam();
    });
  },
  onAthlete(event) {
    this.runSelection(async () => {
      this.setData({ athleteIndex: Number(event.detail.value) });
      await this.loadAthlete();
    });
  },
  onDate(event) {
    const field = event.currentTarget.dataset.field;
    if (!['from', 'to'].includes(field)) return;
    const range = { from: this.data.from, to: this.data.to, [field]: event.detail.value };
    if (range.from > range.to) {
      this.setData({ error: '开始日期须早于或等于结束日期。' });
      return;
    }
    this.runSelection(async () => { this.setData(range); await this.loadTeam(); });
  },
  openReports() {
    if (this.data.athlete) {
      getApp().setProject(this.data.team.project);
      wx.navigateTo({ url: `/pages/training-report/training-report?athleteId=${this.data.athlete.id}` });
    }
  },
  openAccount() { this.setData({ showAccount: !this.data.showAccount, accountError: '' }); },
  onPassword(event) {
    const field = event.currentTarget.dataset.field;
    if (['currentPassword', 'newPassword', 'confirmPassword'].includes(field)) {
      this.setData({ [field]: event.detail.value, accountError: '' });
    }
  },
  async changePassword() {
    if (this.data.accountBusy) return;
    const { currentPassword, newPassword, confirmPassword } = this.data;
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) {
      this.setData({ accountError: '请填写当前密码和一致的新密码。' });
      return;
    }
    this.setData({ accountBusy: true, accountError: '' });
    try {
      await api.changePassword(currentPassword, newPassword);
      this.setData({ showAccount: false, currentPassword: '', newPassword: '', confirmPassword: '' });
      wx.showToast({ title: '密码已修改', icon: 'success' });
    } catch (error) {
      this.setData({ accountError: error.message || '密码修改失败，请重试。' });
    } finally { this.setData({ accountBusy: false }); }
  },
  logout() {
    wx.showModal({ title: '退出登录', content: '确定退出当前账号吗？', success: async result => {
      if (!result.confirm) return;
      try { await api.logout(); }
      catch { wx.showToast({ title: '已退出本机登录', icon: 'none' }); }
      finally {
        getApp().clearSession();
        wx.reLaunch({ url: '/pages/login/login' });
      }
    } });
  }
});
