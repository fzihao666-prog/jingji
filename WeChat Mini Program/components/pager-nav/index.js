// 人员列表统一翻页控件：上下翻页 + 页号指示。
// 页码状态由父级持有（0 基），组件只负责展示与 pagechange 事件，不自己翻页。
Component({
  properties: {
    // 0 基当前页
    page: { type: Number, value: 0 },
    pageCount: { type: Number, value: 1 },
    total: { type: Number, value: 0 },
    unit: { type: String, value: '人' },
    // 无障碍播报前缀，如"未填报运动员"
    label: { type: String, value: '人员' },
  },
  methods: {
    onPrev() {
      this.emit(-1);
    },
    onNext() {
      this.emit(1);
    },
    emit(delta) {
      const target = this.data.page + delta;
      if (target < 0 || target > this.data.pageCount - 1) return;
      this.triggerEvent('pagechange', { page: target });
    },
  },
});
