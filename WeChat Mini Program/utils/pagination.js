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

module.exports = { clampPage, buildPagerState };
