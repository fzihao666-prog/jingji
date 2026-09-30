const FILING_QUERY_URL = 'https://beian.miit.gov.cn/';

Component({
  methods: {
    copyQueryUrl() {
      wx.setClipboardData({
        data: FILING_QUERY_URL,
        success: () => wx.showToast({ title: '查询网址已复制', icon: 'none' }),
        fail: () => wx.showToast({ title: '复制失败，请长按网址复制', icon: 'none' })
      });
    }
  }
});
