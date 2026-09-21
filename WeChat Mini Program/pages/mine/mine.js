const api = require('../../services/api');
const { ROLE_LABELS } = require('../../utils/format');

Page({
  data: {
    user: null,
    avatar: '',
    roleLabel: '',
    project: '',
    showPasswordForm: false,
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    saving: false,
    error: ''
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    const user = app.globalData.user;
    this.setData({
      user,
      avatar: user && user.displayName ? user.displayName.slice(0, 1) : '竞',
      roleLabel: user ? ROLE_LABELS[user.role] || user.role : '',
      project: app.globalData.currentProject
    });
  },

  onCurrentPassword(event) { this.setData({ currentPassword: event.detail.value, error: '' }); },
  onNewPassword(event) { this.setData({ newPassword: event.detail.value, error: '' }); },
  onConfirmPassword(event) { this.setData({ confirmPassword: event.detail.value, error: '' }); },
  togglePasswordForm() {
    this.setData({
      showPasswordForm: !this.data.showPasswordForm,
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      error: ''
    });
  },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  async changePassword() {
    const { currentPassword, newPassword, confirmPassword } = this.data;
    if (!currentPassword || !newPassword) {
      this.setData({ error: '请填写当前密码和新密码。' });
      return;
    }
    if (newPassword !== confirmPassword) {
      this.setData({ error: '两次输入的新密码不一致。' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      wx.showToast({ title: result.message || '密码已修改', icon: 'success' });
      this.setData({ showPasswordForm: false, currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      this.setData({ error: error.message || '密码修改失败。' });
    } finally {
      this.setData({ saving: false });
    }
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      success(result) {
        if (!result.confirm) return;
        getApp().clearSession();
        wx.reLaunch({ url: '/pages/login/login' });
      }
    });
  }
});
