const { MINI_PROGRAM_FILING_NUMBER, FILING_QUERY_URL } = require('../../filing');

Component({
  data: {
    filingNumber: MINI_PROGRAM_FILING_NUMBER,
    filingQueryUrl: FILING_QUERY_URL
  },
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
