const { number } = require('./format');

// 首页与体能页共用的趋势明细：时长 + 负荷。
const durationLoadLines = (item) => [
  `训练时长：${number(item.duration)} 分钟`,
  `训练负荷：${number(item.load, 0)} AU`,
];

// 专项训练页的趋势明细：时长 + 距离。
const durationDistanceLines = (item) => [
  `训练时长：${number(item.duration)} 分钟`,
  `训练距离：${number(item.distance)} km`,
];

// 点击柱形图查看单日明细，页面只负责提供字段文案。
function showTrendModal(page, event, buildLines) {
  const item = page.data.trend[Number(event.currentTarget.dataset.index)];
  if (!item) return;
  wx.showModal({
    title: item.date,
    content: item.isPlaceholder
      ? '示例数据，仅用于展示图表效果\n' + buildLines(item).join('\n')
      : buildLines(item).join('\n'),
    showCancel: false,
  });
}

// 从首页待办或专项训练名单下钻档案，候选列表就是授权边界。
function goToAthlete(page, event, candidates) {
  const athleteId = Number(event.currentTarget.dataset.athleteId) || 0;
  if (!athleteId) return;
  if (!(candidates || []).some((item) => Number(item.id) === athleteId)) {
    wx.showToast({ title: '该运动员不在当前权限范围', icon: 'none' });
    return;
  }
  getApp().globalData.selectedAthleteId = athleteId;
  wx.switchTab({ url: '/pages/profile/profile' });
}

module.exports = { durationLoadLines, durationDistanceLines, showTrendModal, goToAthlete };
