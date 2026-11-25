// 与网页端 src/utils/pagination.ts 语义一致的分页纯逻辑（页码从 1 起）。
// 只负责页码模型：收敛与前后可用性；不含 UI、状态与数据请求。
function clampPage(page, pageCount) {
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, Math.max(1, pageCount));
}

function buildPagerState(page, pageCount) {
  const count = Math.max(1, pageCount);
  const current = clampPage(page, count);
  return {
    page: current,
    pageCount: count,
    hasPrev: current > 1,
    hasNext: current < count,
  };
}

// 人员列表统一分页（spec：单页最多 5 人，≤5 全部展示，末页不足不补假数据）。
// page 为 0 基页码；返回当页切片 items 与页码模型（供 components/pager-nav 消费）。
const PAGE_SIZE = 5;

function paginateList(items, page, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : PAGE_SIZE;
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const state = buildPagerState(Number.isInteger(page) && page >= 0 ? page + 1 : 1, pageCount);
  const current = state.page - 1;
  return {
    items: list.slice(current * size, (current + 1) * size),
    page: current,
    pageCount: state.pageCount,
    total,
    pageSize: size,
    hasPrev: state.hasPrev,
    hasNext: state.hasNext,
  };
}

module.exports = { clampPage, buildPagerState, PAGE_SIZE, paginateList };
