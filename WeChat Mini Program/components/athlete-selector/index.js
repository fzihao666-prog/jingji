// 公共运动员模块：搜索 + 每页 5 人分页 + 选中高亮 + 档案详情入口。
// 页面持有业务数据与权限；组件只做纯视图：归一化 items 形状、分页切片与事件上抛。
const {
  normalizeAthleteItems,
  buildAthleteSelectorView,
} = require('../../utils/athlete-selector-view');

Component({
  properties: {
    title: { type: String, value: '运动员' },
    // 模块标题右侧说明，如"当前范围共 8 人"；缺省时组件按总数生成。
    note: { type: String, value: '' },
    // 归一化条目：{id, name, meta?, tags?: [{text, tone}], value?, summary?: [text], searchText?}
    items: { type: Array, value: [] },
    selectedId: { type: Number, value: 0 },
    // 右上角详情入口文案；空字符串表示不展示详情入口。
    detailLabel: { type: String, value: '档案 ›' },
    emptyText: { type: String, value: '暂无可管理运动员' },
    searchPlaceholder: { type: String, value: '搜索运动员姓名' },
    label: { type: String, value: '运动员' },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },
  data: {
    keyword: '',
    pager: { page: 0, pageCount: 1, total: 0 },
    pageItems: [],
    isEmpty: true,
  },
  observers: {
    'items, keyword': function onItemsKeywordChange() {
      this.refreshView(this.data.keyword, 0);
    },
  },
  methods: {
    refreshView(keyword, page) {
      const view = buildAthleteSelectorView(this.properties.items, keyword, page);
      this.setData({
        keyword: view.keyword,
        pageItems: view.items,
        isEmpty: view.isEmpty,
        pager: view.pager,
      });
    },
    onSearchInput(event) {
      this.refreshView(event.detail.value || '', 0);
    },
    onPageChange(event) {
      this.refreshView(this.data.keyword, event.detail.page || 0);
    },
    onSelectItem(event) {
      const id = Number(event.currentTarget.dataset.athleteId);
      const item = normalizeAthleteItems(this.properties.items).find((row) => row.id === id);
      if (!item) return;
      this.triggerEvent('select', { id, item });
    },
    onOpenDetail(event) {
      const id = Number(event.currentTarget.dataset.athleteId);
      const item = normalizeAthleteItems(this.properties.items).find((row) => row.id === id);
      if (!item) return;
      this.triggerEvent('detail', { id, item });
    },
  },
});
