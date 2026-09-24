function createRequestGuard() {
  let latest = 0;
  return {
    next() { latest += 1; return latest; },
    isLatest(id) { return id === latest; }
  };
}

async function loadWithGuard(page, guard, task, fallback) {
  const id = guard.next();
  page.setData({ loading: true, error: '' });
  try {
    const data = await task(() => guard.isLatest(id));
    if (guard.isLatest(id) && data) page.setData(data);
  } catch (error) {
    if (guard.isLatest(id) && error.message !== '未登录') {
      page.setData({ error: error.message || fallback });
    }
  } finally {
    if (guard.isLatest(id)) page.setData({ loading: false });
  }
}

module.exports = { createRequestGuard, loadWithGuard };
