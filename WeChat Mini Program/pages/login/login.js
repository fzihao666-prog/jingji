const api = require('../../services/api');
const { TOKEN_KEY } = require('../../config');

const OLYMPIC_ICONS = [
  ['射箭', 'archery'],
  ['花样游泳', 'artistic swimming'],
  ['田径', 'athletics'],
  ['羽毛球', 'badminton'],
  ['棒球', 'baseball'],
  ['垒球', 'softball'],
  ['篮球', 'basketball'],
  ['三人篮球', '3x3 basketball'],
  ['沙滩排球', 'beach volleyball'],
  ['拳击', 'boxing'],
  ['激流回旋', 'canoe slalom'],
  ['静水皮划艇', 'canoe sprint'],
  ['自由式小轮车', 'cycling BMX freestyle'],
  ['竞速小轮车', 'cycling BMX racing'],
  ['山地自行车', 'cycling mountain bike'],
  ['公路自行车', 'cycling road'],
  ['场地自行车', 'cycling track'],
  ['跳水', 'diving'],
  ['盛装舞步', 'equestrian dressage'],
  ['马术三项', 'equestrian eventing'],
  ['场地障碍', 'equestrian jumping'],
  ['击剑', 'fencing'],
  ['足球', 'football'],
  ['高尔夫', 'golf'],
  ['竞技体操', 'artistic gymnastics'],
  ['艺术体操', 'rhythmic gymnastics'],
  ['手球', 'handball'],
  ['曲棍球', 'hockey'],
  ['柔道', 'judo'],
  ['空手道·型', 'karate kata'],
  ['空手道·组手', 'karate kumite'],
  ['马拉松游泳', 'marathon swimming'],
  ['现代五项', 'modern pentathlon'],
  ['赛艇', 'rowing'],
  ['七人制橄榄球', 'rugby'],
  ['帆船', 'sailing'],
  ['射击', 'shooting'],
  ['滑板', 'skateboarding'],
  ['运动攀岩', 'sport climbing'],
  ['冲浪', 'surfing'],
  ['游泳', 'swimming'],
  ['乒乓球', 'table tennis'],
  ['跆拳道', 'taekwondo'],
  ['网球', 'tennis'],
  ['蹦床', 'trampoline gymnastics'],
  ['铁人三项', 'triathlon'],
  ['排球', 'volleyball'],
  ['水球', 'water polo'],
  ['举重', 'weightlifting'],
  ['摔跤', 'wrestling']
].map(([label, name]) => ({
  label,
  src: api.assetUrl(`/assets/olympic-sports/${encodeURIComponent(name)}.gif`)
}));

Page({
  data: {
    olympicIcons: OLYMPIC_ICONS,
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
