import { isValidIsoDate } from '../core/utils.ts';

/** 批量查询与旧单人接口共用；权限校验由路由在查询之前执行。 */
export function strengthReadScope(query: Record<string, unknown>, fallbackId = 0) {
  const ids = query.athleteIds === undefined
    ? [Number(query.athleteId || fallbackId)]
    : typeof query.athleteIds === 'string' ? query.athleteIds.split(',').map(Number) : [];
  if (!ids.length || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
  const from = query.from;
  const to = query.to;
  if ((from !== undefined || to !== undefined) &&
    (typeof from !== 'string' || typeof to !== 'string' || !isValidIsoDate(from) || !isValidIsoDate(to) || from > to)) return null;
  return { ids: [...new Set(ids)], from: typeof from === 'string' ? from : null, to: typeof to === 'string' ? to : null };
}
