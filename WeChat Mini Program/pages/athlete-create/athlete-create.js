const api = require('../../services/api');
const { personalProfilePayload } = require('../../utils/profile-payload');
const { projectOptions } = require('../../utils/project-label');
const { todayBeijing } = require('../../utils/date');
const MANAGER_ROLES = ['SCC', 'REG', 'TD', 'DMD'];

Page({
  data: {
    loading: true, saving: false, saved: false, allowed: false, error: '', fieldErrors: {},
    name: '', gender: '', birthDate: '', notes: '', project: '', teamId: 0,
    projectItems: [], projectIndex: 0, teamItems: [], teamIndex: 0,
    genderItems: ['暂不填写', '男', '女'], genderIndex: 0,
    areaItems: [], areaIndex: 0, needsArea: false, today: '',
  },

  onLoad(options = {}) {
    this._preferred = { project: options.project || '', teamId: Number(options.teamId) || 0 };
    this.setData({ today: todayBeijing() });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true, error: '', allowed: false });
    try {
      const { user } = await api.me();
      if (!MANAGER_ROLES.includes(user.role)) throw new Error('当前账号无权添加运动员。');
      const { teams = [], areas = [] } = await api.athleteCreateOptions();
      this._teams = teams;
      if (!teams.length) throw new Error('当前没有可管理的队伍，请联系管理员配置队伍权限。');
      const projectItems = projectOptions([...new Set(teams.map((team) => team.project))]);
      const preferred = this._preferred || {};
      const project = projectItems.some((item) => item.code === this.data.project) ? this.data.project
        : projectItems.some((item) => item.code === preferred.project) ? preferred.project : projectItems[0].code;
      const needsArea = user.role !== 'SCC' && !areas.some((area) => area.areaLevel === 'national');
      const areaItems = [{ label: '请选择档案行政归属', value: null }].concat(areas.map((area) => ({
        label: [area.province, area.city, area.county].filter(Boolean).join(' / '), value: area,
      })));
      if (needsArea && !areas.length) throw new Error('当前账号尚未配置行政管理范围，请联系管理员。');
      this.setData({ allowed: true, projectItems, areaItems, needsArea, project,
        projectIndex: projectItems.findIndex((item) => item.code === project),
        areaIndex: this.data.areaIndex < areaItems.length ? this.data.areaIndex : 0,
      });
      this.updateTeams(this.data.teamId || preferred.teamId);
    } catch (error) {
      this.setData({ error: error.message || '添加选项加载失败，请重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  updateTeams(preferredId) {
    const teams = (this._teams || []).filter((team) => team.project === this.data.project);
    const teamItems = [{ id: 0, name: '请选择队伍' }].concat(teams);
    const selected = teams.find((team) => Number(team.id) === Number(preferredId)) || (teams.length === 1 ? teams[0] : null);
    const teamId = selected ? Number(selected.id) : 0;
    this.setData({ teamItems, teamId, teamIndex: Math.max(0, teamItems.findIndex((team) => Number(team.id) === teamId)) });
  },

  markDirty() {
    this.setData({ fieldErrors: {}, error: '' });
    if (!this._dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '运动员资料尚未保存，确定离开吗？' });
    this._dirty = true;
  },
  input(event) {
    if (this.data.saving || this.data.saved) return;
    const field = event.currentTarget.dataset.field;
    if (!['name', 'notes'].includes(field)) return;
    this.setData({ [field]: event.detail.value });
    this.markDirty();
  },
  genderChange(event) {
    if (this.data.saving || this.data.saved) return;
    const genderIndex = Number(event.detail.value) || 0;
    this.setData({ genderIndex, gender: this.data.genderItems[genderIndex] === '暂不填写' ? '' : this.data.genderItems[genderIndex] });
    this.markDirty();
  },
  birthDateChange(event) {
    if (this.data.saving || this.data.saved) return;
    this.setData({ birthDate: event.detail.value });
    this.markDirty();
  },
  projectChange(event) {
    if (this.data.saving || this.data.saved) return;
    const projectIndex = Number(event.detail.value);
    const project = this.data.projectItems[projectIndex];
    if (!project || project.code === this.data.project) return;
    this.setData({ projectIndex, project: project.code });
    this.updateTeams(0);
    this.markDirty();
  },
  teamChange(event) {
    if (this.data.saving || this.data.saved) return;
    const teamIndex = Number(event.detail.value);
    const team = this.data.teamItems[teamIndex];
    if (!team) return;
    this.setData({ teamIndex, teamId: Number(team.id) });
    this.markDirty();
  },
  areaChange(event) {
    if (this.data.saving || this.data.saved) return;
    const areaIndex = Number(event.detail.value);
    if (!this.data.areaItems[areaIndex]) return;
    this.setData({ areaIndex });
    this.markDirty();
  },

  async save() {
    if (this.data.saving || this.data.saved || !this.data.allowed) return;
    const fieldErrors = {};
    let profile;
    try { profile = personalProfilePayload(this.data); }
    catch (error) { fieldErrors[this.data.name.trim().length < 2 || this.data.name.trim().length > 20 || /[\r\n\t<>]/.test(this.data.name) ? 'name' : 'birthDate'] = error.message; }
    const team = (this._teams || []).find((item) => item.project === this.data.project && Number(item.id) === this.data.teamId);
    if (!team) fieldErrors.team = '请选择有权管理的所属队伍。';
    const area = this.data.areaItems[this.data.areaIndex];
    if (this.data.needsArea && (!area || !area.value)) fieldErrors.area = '请选择档案行政归属。';
    if (Object.keys(fieldErrors).length) { this.setData({ fieldErrors }); return; }
    const payload = { name: profile.name, gender: profile.gender, birthDate: profile.birthDate,
      notes: profile.notes, project: team.project, team: team.name, createAccount: false };
    if (this.data.needsArea) Object.assign(payload, { region: area.value.province, city: area.value.city, county: area.value.county });
    this.setData({ saving: true, error: '' });
    try {
      const result = await api.createAthlete(payload);
      const app = getApp();
      app.setProject(team.project);
      app.globalData.pendingProject = team.project;
      app.globalData.selectedAthleteId = Number(result.id) || 0;
      app.globalData.dataVersion = (app.globalData.dataVersion || 0) + 1;
      app.globalData.homeNeedsRefresh = true;
      this.setData({ saved: true });
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      wx.showToast({ title: '运动员添加成功', icon: 'success' });
      this.returnToProfile();
    } catch (error) {
      this.setData({ error: error.message || '添加失败，请重试。' });
    } finally { this.setData({ saving: false }); }
  },
  returnToProfile() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) });
  },
});
