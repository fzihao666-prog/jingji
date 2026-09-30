// 运动员管理页、花名册页（及后续列表页）共用的分页纯逻辑。
// 只负责页码模型：收敛、区间与页码项；不含 UI、状态与数据请求。

export type PagerItem =
  | { type: 'page'; page: number; current: boolean }
  | { type: 'ellipsis' };

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, Math.max(1, pageCount));
}

export function pageRange(page: number, pageSize: number, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = clampPage(page, pageCount);
  return {
    pageCount,
    current,
    hasPrev: current > 1,
    hasNext: current < pageCount,
    start: total ? (current - 1) * pageSize + 1 : 0,
    end: Math.min(current * pageSize, total),
  };
}

// 页码过多时按"首尾保留、当前页前后各 1 页、间隔以省略号收拢"生成页码项：
// 例如 20 页中的第 4 页 → 1 … 3 4 5 … 20；页数 ≤ 7 时全部平铺。
// 当前页贴边（第 1/末页）时向内侧多补 1 页，避免边缘窗口过稀。
export function buildPagerItems(page: number, pageCount: number): PagerItem[] {
  const current = clampPage(page, pageCount);
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => ({
      type: 'page' as const,
      page: index + 1,
      current: index + 1 === current,
    }));
  }
  const wanted = new Set([1, pageCount, current - 1, current, current + 1]);
  if (current - 1 <= 1) wanted.add(current + 2);
  if (current + 1 >= pageCount) wanted.add(current - 2);
  const numbers = [...wanted]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b);
  const items: PagerItem[] = [];
  let previous = 0;
  for (const number of numbers) {
    if (number - previous > 1) items.push({ type: 'ellipsis' });
    items.push({ type: 'page', page: number, current: number === current });
    previous = number;
  }
  return items;
}
