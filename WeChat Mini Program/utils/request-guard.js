function createRequestGuard() {
  let latest = 0;
  return {
    next() { latest += 1; return latest; },
    /** @param {number} id */
    isLatest(id) { return id === latest; }
  };
}

/**
 * @param {{ setData(values: Record<string, unknown>): void }} page
 * @param {ReturnType<typeof createRequestGuard>} guard
 * @param {(isLatest: () => boolean) => Promise<Record<string, unknown> | null | undefined>} task
 * @param {string} fallback
 */
async function loadWithGuard(page, guard, task, fallback) {
  const id = guard.next();
  page.setData({ loading: true, error: '' });
  try {
    const data = await task(() => guard.isLatest(id));
    if (guard.isLatest(id) && data) page.setData(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (guard.isLatest(id) && message !== '未登录') {
      page.setData({ error: message || fallback });
    }
  } finally {
    if (guard.isLatest(id)) page.setData({ loading: false });
  }
}

module.exports = { createRequestGuard, loadWithGuard };
