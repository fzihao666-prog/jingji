const api = require('../../services/api');
const { projects, provinces, provinceCities } = require('../../data/register-data');

function genderFromIdentityNumber(value) {
  return /^\d{17}[\dX]$/.test(value) ? (Number(value[16]) % 2 ? '男' : '女') : '';
}

Page({
  data: {
    username: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    identityNumber: '',
    gender: '',
    project: '',
    projectLabel: '',
    team: '',
    nativePlaceProvince: '',
    nativePlaceCity: '',
    projectOptions: projects.map((item) => item.label),
    projectCodes: projects.map((item) => item.code),
    provinceOptions: provinces,
    cityOptions: [],
    teamOptions: [],
    allTeams: [],
    submitting: false,
    error: '',
    success: ''
  },

  async onLoad() {
    try {
      const result = await api.teams();
      this.setData({ allTeams: result.teams || [] });
      this.syncTeamOptions();
    } catch {
      this.setData({ allTeams: [] });
      this.syncTeamOptions();
    }
  },

  onShow() {
    if (wx.getStorageSync('jingji-mini-token')) wx.reLaunch({ url: '/pages/index/index' });
  },

  goBack() {
    wx.navigateBack();
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value.trim().toLowerCase(), error: '' });
  },
  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: '' });
  },
  onConfirmPasswordInput(event) {
    this.setData({ confirmPassword: event.detail.value, error: '' });
  },
  onDisplayNameInput(event) {
    this.setData({ displayName: event.detail.value.trim(), error: '' });
  },
  onIdentityInput(event) {
    const value = event.detail.value.replace(/\s/g, '').toUpperCase();
    this.setData({ identityNumber: value, gender: genderFromIdentityNumber(value), error: '' });
  },

  onProjectChange(event) {
    const index = Number(event.detail.value);
    const project = this.data.projectCodes[index] || '';
    const projectLabel = this.data.projectOptions[index] || '';
    const currentTeam = this.data.team;
    this.setData({ project, projectLabel, error: '' }, () => {
      this.syncTeamOptions();
      if (!this.data.teamOptions.includes(currentTeam)) {
        this.setData({ team: this.data.teamOptions[0] || '' });
      }
    });
  },

  onTeamChange(event) {
    const team = this.data.teamOptions[Number(event.detail.value)] || '';
    this.setData({ team, error: '' });
  },

  onProvinceChange(event) {
    const province = this.data.provinceOptions[Number(event.detail.value)] || '';
    this.setData({
      nativePlaceProvince: province,
      nativePlaceCity: '',
      cityOptions: provinceCities[province] || [],
      error: ''
    });
  },

  onCityChange(event) {
    const city = this.data.cityOptions[Number(event.detail.value)] || '';
    this.setData({ nativePlaceCity: city, error: '' });
  },

  syncTeamOptions() {
    const { project, allTeams } = this.data;
    const teamOptions = allTeams.filter((item) => item.project === project).map((item) => item.name);
    const team = teamOptions.includes(this.data.team) ? this.data.team : teamOptions[0] || '';
    this.setData({ teamOptions, team });
  },

  validate() {
    const {
      username,
      password,
      confirmPassword,
      displayName,
      identityNumber,
      project,
      team,
      nativePlaceProvince,
      nativePlaceCity
    } = this.data;
    if (!displayName) return '请填写姓名。';
    if (displayName.length < 2 || displayName.length > 20) return '姓名应为2至20个字符。';
    if (!identityNumber) return '请填写身份证号。';
    if (!/^\d{17}[\dX]$/.test(identityNumber))
      return '身份证号须为18位，前17位为数字，末位为数字或X。';
    if (!project) return '请选择运动项目。';
    if (!team) return '请选择所属队伍。';
    if (!nativePlaceProvince) return '请选择籍贯省份。';
    if (!nativePlaceCity) return '请选择籍贯城市。';
    if (!username) return '请填写账号。';
    if (!/^[a-z0-9_]{4,24}$/.test(username)) return '账号须为4至24位字母、数字或下划线。';
    if (!password) return '请填写密码。';
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
      return '密码须为8至72位，且同时包含字母和数字。';
    if (password !== confirmPassword) return '两次输入的密码不一致。';
    return '';
  },

  async submit() {
    if (this.data.submitting || this.data.success) return;
    const error = this.validate();
    if (error) {
      this.setData({ error });
      return;
    }
    const {
      username,
      password,
      displayName,
      project,
      team,
      gender,
      identityNumber,
      nativePlaceProvince,
      nativePlaceCity
    } = this.data;
    this.setData({ submitting: true, error: '' });
    try {
      const result = await api.register({
        username,
        password,
        displayName,
        role: 'ATL',
        project,
        team,
        gender,
        identityNumber,
        nativePlace: `${nativePlaceProvince}/${nativePlaceCity}`
      });
      wx.setStorageSync('jingji-mini-pending-account', username);
      this.setData({
        success: result.message || '申请已提交，审核通过后即可登录。',
        password: '',
        confirmPassword: ''
      });
      wx.showToast({ title: '注册成功', icon: 'success', duration: 1500 });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (requestError) {
      this.setData({ error: requestError.message || '注册失败，请稍后重试。' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
