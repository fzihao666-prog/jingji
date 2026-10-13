// 公共运动员模块的纯视图逻辑：关键词筛选 + 每页 5 人分页装配。
// 不依赖页面与网络；组件与测试共用，保证三处人员列表行为一致。
const { paginateList, PAGE_SIZE } = require('./pagination');

function normalizeAthleteItems(items) {
  return Array.isArray(items) ? items.filter((item) => item && item.id != null) : [];
}

function filterAthleteItems(items, keyword) {
  const list = normalizeAthleteItems(items);
  const key = String(keyword || '').trim().toLowerCase();
  if (!key) return list;
  return list.filter((item) => {
    const haystack = [item.name, item.meta, item.searchText]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(key);
  });
}

// 返回 {items: 当页切片, keyword, isEmpty, pager}；搜索变化后调用方应传 page=0。
function buildAthleteSelectorView(rawItems, keyword, page) {
  const filtered = filterAthleteItems(rawItems, keyword);
  const pager = paginateList(filtered, page, PAGE_SIZE);
  return {
    items: pager.items,
    keyword: String(keyword || ''),
    isEmpty: filtered.length === 0,
    pager: { page: pager.page, pageCount: pager.pageCount, total: pager.total },
  };
}

module.exports = { normalizeAthleteItems, filterAthleteItems, buildAthleteSelectorView, PAGE_SIZE };
