import { describe, expect, it, vi } from 'vitest';
import { recoverPageLoad } from './page-load-recovery';

const oldEntry = '/assets/index-12345678.js';
const newEntry = '/assets/index-abcdefgh.js';

function browser(latestEntry = newEntry, previousAttempt: string | null = null) {
  const reload = vi.fn();
  const setAttempt = vi.fn();
  const readLatestEntry = vi.fn().mockResolvedValue(latestEntry);
  return { currentEntry: oldEntry, readLatestEntry, getAttempt: () => previousAttempt, setAttempt, reload };
}

describe('页面分包加载恢复', () => {
  it('仅在首屏分包加载失败且入口已更新时自动重开', async () => {
    const runtime = browser();
    await recoverPageLoad(new TypeError('Failed to fetch dynamically imported module'), () => true, runtime);
    expect(runtime.setAttempt).toHaveBeenCalledWith(newEntry);
    expect(runtime.reload).toHaveBeenCalledOnce();
  });

  it('同版本、已恢复过、普通渲染异常和已打开页面均不自动重开', async () => {
    const error = new TypeError('Importing a module script failed.');
    for (const [runtime, safe, failure] of [
      [browser(oldEntry), true, error],
      [browser(newEntry, newEntry), true, error],
      [browser(newEntry, oldEntry), true, error],
      [browser(), true, new Error('表格渲染失败')],
      [browser(), false, error],
    ] as const) {
      await recoverPageLoad(failure, () => safe, runtime);
      expect(runtime.reload).not.toHaveBeenCalled();
    }
  });

  it('版本检查过程中页面开始渲染时不会自动重开', async () => {
    const runtime = browser();
    let safe = true;
    runtime.readLatestEntry.mockImplementation(async () => {
      safe = false;
      return newEntry;
    });
    await recoverPageLoad(new Error('Unable to preload CSS for /assets/app.css'), () => safe, runtime);
    expect(runtime.reload).not.toHaveBeenCalled();
  });

  it('版本检查失败时保留手动恢复', async () => {
    const runtime = browser();
    runtime.readLatestEntry.mockRejectedValue(new Error('访问超时'));
    await recoverPageLoad(new Error('error loading dynamically imported module'), () => true, runtime);
    expect(runtime.reload).not.toHaveBeenCalled();
  });
});
