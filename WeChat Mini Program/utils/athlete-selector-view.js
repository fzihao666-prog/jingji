// 公共运动员模块的纯视图逻辑：每页 5 人分页装配。
// 不依赖页面与网络；组件与测试共用，保证三处人员列表行为一致。
const { paginateList, PAGE_SIZE } = require('./pagination');

function normalizeAthleteItems(items) {
  return Array.isArray(items) ? items.filter((item) => item && item.id != null) : [];
}

function buildAthleteSelectorView(rawItems, page) {
  const filtered = normalizeAthleteItems(rawItems);
  const pager = paginateList(filtered, page, PAGE_SIZE);
  return {
    items: pager.items,
    isEmpty: filtered.length === 0,
    pager: { page: pager.page, pageCount: pager.pageCount, total: pager.total },
  };
}

module.exports = { normalizeAthleteItems, buildAthleteSelectorView, PAGE_SIZE };
