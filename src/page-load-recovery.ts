type RecoveryRuntime = {
  currentEntry: string | null;
  readLatestEntry: () => Promise<string | null>;
  getAttempt: () => string | null;
  setAttempt: (entry: string) => void;
  reload: () => void;
};

const moduleSource = 'script[type="module"][src]';
const builtEntry = /^\/assets\/index-[A-Za-z0-9_-]{8}\.js$/;
const attemptKey = 'jingji-page-load-recovery';
const chunkError = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css for/i;

function browserRecovery(): RecoveryRuntime {
  return {
    currentEntry: document.querySelector(moduleSource)?.getAttribute('src') ?? null,
    async readLatestEntry() {
      const response = await fetch('/', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null;
      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      return html.querySelector(moduleSource)?.getAttribute('src') ?? null;
    },
    getAttempt: () => sessionStorage.getItem(attemptKey),
    setAttempt: (entry) => sessionStorage.setItem(attemptKey, entry),
    reload: () => window.location.reload(),
  };
}

export function finishPageLoadRecovery() {
  try {
    sessionStorage.removeItem(attemptKey);
  } catch {
    // 网页照常运行，分包失败时仍可手动恢复。
  }
}

export async function recoverPageLoad(
  error: unknown,
  canReload: () => boolean,
  runtime?: RecoveryRuntime
): Promise<void> {
  if (!(error instanceof Error) || !chunkError.test(error.message) || !canReload()) return;
  try {
    const browser = runtime ?? browserRecovery();
    const current = browser.currentEntry;
    if (!current || !builtEntry.test(current)) return;
    const latest = await browser.readLatestEntry();
    if (!latest || !builtEntry.test(latest) || latest === current || !canReload()) return;
    if (browser.getAttempt() !== null) return;
    browser.setAttempt(latest);
    browser.reload();
  } catch {
    // 网络或浏览器存储不可用时保留手动恢复入口。
  }
}
