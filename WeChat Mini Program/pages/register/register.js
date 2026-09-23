const api = require('../../services/api');
const { projects, provinces, provinceCities } = require('../../data/register-data');

function genderFromIdentityNumber(value) {
  return /^\d{17}[\dX]$/.test(value) ? (Number(value[16]) % 2 ? '男' : '女') : '';
}

function birthDateFromIdentityNumber(value) {
  if (!/^\d{17}[\dX]$/.test(value)) return '';
  const year = value.slice(6, 10);
  const month = value.slice(10, 12);
  const day = value.slice(12, 14);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) return '';
  const candidate = new Date(Date.UTC(Number(year), numericMonth - 1, numericDay));
  if (
    candidate.getUTCFullYear() !== Number(year) ||
    candidate.getUTCMonth() !== numericMonth - 1 ||
    candidate.getUTCDate() !== numericDay
  ) {
    return '';
  }
  return `${year}-${month}-${day}`;
}

Page({
  data: {
    role: 'ATL',
    roleOptions: ['运动员', '教练'],
    roleCodes: ['ATL', 'SCC'],
    username: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    identityNumber: '',
    gender: '',
    birthDate: '',
    phone: '',
    project: '',
    projectLabel: '',
    team: '',
    teamIndex: 0,
    nativePlaceProvince: '',
    nativePlaceCity: '',
    projectOptions: projects.map((item) => item.label),
    projectCodes: projects.map((item) => item.code),
    provinceOptions: provinces,
    cityOptions: [],
    teamOptions: [],
    allTeams: [],
    teamsLoading: false,
    teamsError: '',
    submitting: false,
    error: '',
    success: ''
  },

  onLoad() {
    this.loadTeams();
  },

  onShow() {
    if (wx.getStorageSync('jingji-mini-token')) wx.reLaunch({ url: '/pages/index/index' });
  },

  goBack() {
    wx.navigateBack();
  },

  onRoleChange(event) {
    const index = Number(event.detail.value);
    const role = this.data.roleCodes[index] || 'ATL';
    this.setData({ role, error: '', success: '' });
  },

  async loadTeams() {
    if (this.data.teamsLoading) return;
    this.setData({ teamsLoading: true, teamsError: '' });
    try {
      const result = await api.teams();
      this.setData({
        allTeams: Array.isArray(result?.teams) ? result.teams : [],
        teamsLoading: false,
        teamsError: ''
      });
      this.syncTeamOptions();
    } catch (requestError) {
      this.setData({
        allTeams: [],
        teamsLoading: false,
        teamsError: requestError.message || '队伍列表加载失败'
      });
      this.syncTeamOptions();
    }
  },

  retryTeams() {
    this.loadTeams();
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
  onPhoneInput(event) {
    this.setData({ phone: event.detail.value.replace(/\s/g, ''), error: '' });
  },
  onIdentityInput(event) {
    const value = event.detail.value.replace(/\s/g, '').toUpperCase();
    this.setData({
      identityNumber: value,
      gender: genderFromIdentityNumber(value),
      birthDate: birthDateFromIdentityNumber(value),
      error: ''
    });
  },

  onProjectChange(event) {
    const index = Number(event.detail.value);
    const project = this.data.projectCodes[index] || '';
    const projectLabel = this.data.projectOptions[index] || '';
    const currentTeam = this.data.team;
    this.setData({ project, projectLabel, error: '' }, () => {
      this.syncTeamOptions();
      if (!this.data.teamOptions.length && !this.data.teamsLoading) {
        this.loadTeams();
      }
      if (!this.data.teamOptions.includes(currentTeam)) {
        this.setData({ team: this.data.teamOptions[0] || '', teamIndex: 0 });
      } else {
        this.setData({ teamIndex: this.data.teamOptions.indexOf(currentTeam) });
      }
    });
  },

  onTeamChange(event) {
    const index = Number(event.detail.value);
    const team = this.data.teamOptions[index] || '';
    this.setData({ team, teamIndex: index, error: '' });
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
    const teamOptions = allTeams
      .filter((item) => item.project === project)
      .map((item) => item.name);
    const teamIndex = Math.max(
      0,
      teamOptions.indexOf(this.data.teamOptions.includes(this.data.team) ? this.data.team : '')
    );
    const team = teamOptions.includes(this.data.team) ? this.data.team : teamOptions[0] || '';
    this.setData({
      teamOptions,
      team,
      teamIndex: team ? Math.max(0, teamOptions.indexOf(team)) : teamIndex
    });
  },

  validate() {
    const {
      role,
      username,
      password,
      confirmPassword,
      displayName,
      identityNumber,
      phone,
      project,
      team,
      nativePlaceProvince,
      nativePlaceCity
    } = this.data;
    if (!['ATL', 'SCC'].includes(role)) return '请选择注册身份。';
    if (!displayName) return '请填写姓名。';
    if (displayName.length < 2 || displayName.length > 20) return '姓名应为2至20个字符。';
    if (role === 'ATL') {
      if (!identityNumber) return '请填写身份证号。';
      if (!/^\d{17}[\dX]$/.test(identityNumber))
        return '身份证号须为18位，前17位为数字，末位为数字或X。';
      if (!nativePlaceProvince) return '请选择籍贯省份。';
      if (!nativePlaceCity) return '请选择籍贯城市。';
    }
    if (!phone) return '请填写手机号。';
    if (!/^1[3-9]\d{9}$/.test(phone)) return '手机号须为11位大陆手机号。';
    if (!project) return '请选择运动项目。';
    if (!team) return '请选择所属队伍。';
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
      role,
      username,
      password,
      displayName,
      phone,
      project,
      team,
      gender,
      identityNumber,
      nativePlaceProvince,
      nativePlaceCity
    } = this.data;
    this.setData({ submitting: true, error: '' });
    try {
      const payload = {
        username,
        password,
        displayName,
        role,
        project,
        team,
        phone
      };
      if (role === 'ATL') {
        payload.gender = gender;
        payload.identityNumber = identityNumber;
        payload.nativePlace = `${nativePlaceProvince}/${nativePlaceCity}`;
      }
      const result = await api.register(payload);
      wx.setStorageSync('jingji-mini-pending-account', username);
      wx.setStorageSync('jingji-mini-register-status', result.status || 'pending');
      const approved = result.status === 'approved';
      this.setData({
        success:
          result.message ||
          (approved ? '注册成功，可直接登录。' : '申请已提交，审核通过后即可登录。'),
        password: '',
        confirmPassword: ''
      });
      wx.showToast({ title: approved ? '注册成功' : '提交成功', icon: 'success', duration: 1500 });
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
