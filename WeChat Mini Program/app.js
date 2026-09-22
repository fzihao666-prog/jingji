const { TOKEN_KEY, USER_KEY, PROJECT_KEY } = require('./config');

App({
  globalData: {
    token: '',
    user: null,
    currentProject: '赛艇',
    projects: [],
    athletes: [],
    selectedAthleteId: 0
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync(TOKEN_KEY) || '';
    this.globalData.user = wx.getStorageSync(USER_KEY) || null;
    this.globalData.currentProject = wx.getStorageSync(PROJECT_KEY) || '赛艇';
  },

  setSession(token, user) {
    this.globalData.token = token;
    this.globalData.user = user;
    wx.setStorageSync(TOKEN_KEY, token);
    wx.setStorageSync(USER_KEY, user);
  },

  setProject(project) {
    this.globalData.currentProject = project;
    wx.setStorageSync(PROJECT_KEY, project);
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.user = null;
    this.globalData.athletes = [];
    this.globalData.selectedAthleteId = 0;
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_KEY);
  }
});
