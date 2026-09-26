const api = require('../../services/api');
const { TOKEN_KEY } = require('../../config');

Page({
  data: {
    username: '',
    password: '',
    showPassword: false,
    rememberUsername: true,
    privacyAccepted: false,
    submitting: false,
    error: '',
    success: '',
    heroUrl: ''
  },

  onLoad() {
    const remembered = wx.getStorageSync('jingji-mini-remembered-username') || '';
    this.setData({
      username: remembered,
      heroUrl: api.assetUrl('/assets/login-rowing-hero.png')
    });
    if (wx.getStorageSync(TOKEN_KEY)) wx.reLaunch({ url: '/pages/index/index' });
  },

  onShow() {
    const pending = wx.getStorageSync('jingji-mini-pending-account');
    if (pending) {
      const status = wx.getStorageSync('jingji-mini-register-status') || 'pending';
      wx.removeStorageSync('jingji-mini-pending-account');
      wx.removeStorageSync('jingji-mini-register-status');
      this.setData({
        username: pending,
        password: '',
        error: '',
        success:
          status === 'approved'
            ? '注册成功，可直接登录。'
            : '注册申请已提交，审核通过后即可使用该账号登录。'
      });
    }
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  onUsernameInput(event) { this.setData({ username: event.detail.value.trim(), error: '' }); },
  onPasswordInput(event) { this.setData({ password: event.detail.value, error: '' }); },
  togglePassword() { this.setData({ showPassword: !this.data.showPassword }); },
  onRememberChange(event) { this.setData({ rememberUsername: event.detail.value.includes('remember') }); },
  onPrivacyChange(event) { this.setData({ privacyAccepted: event.detail.value.includes('accepted'), error: '' }); },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
  forgotPassword() { wx.showToast({ title: '请联系系统管理员重置密码', icon: 'none' }); },

  async login() {
    const { username, password, privacyAccepted, rememberUsername } = this.data;
    if (!username || !password) {
      this.setData({ error: '请输入账号和密码。' });
      return;
    }
    if (!privacyAccepted) {
      this.setData({ error: '请先阅读并同意隐私保护说明。' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const result = await api.login(username, password);
      getApp().setSession(result.token, result.user);
      if (rememberUsername) wx.setStorageSync('jingji-mini-remembered-username', username);
      else wx.removeStorageSync('jingji-mini-remembered-username');
      wx.reLaunch({ url: '/pages/index/index' });
    } catch (error) {
      this.setData({ error: error.message || '登录失败，请稍后重试。' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
