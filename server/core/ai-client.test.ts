import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion } from './ai-client.ts';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function configure() {
  for (const suffix of ['', '_FALLBACK']) {
    vi.stubEnv(`AI${suffix}_BASE_URL`, 'https://example.invalid');
    vi.stubEnv(`AI${suffix}_API_KEY`, 'synthetic-test');
    vi.stubEnv(`AI${suffix}_MODEL`, 'synthetic-model');
  }
}
describe('模型调用取消边界', () => {
  it('已取消时不请求供应商', async () => {
    configure();
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(chatCompletion({ messages: [], signal: controller.signal })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('请求中取消会终止当前调用且不继续fallback', async () => {
    configure();
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: unknown, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
          controller.abort();
        })
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(chatCompletion({ messages: [], signal: controller.signal })).rejects.toThrow(
      'aborted'
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('未取消时仍支持原有供应商fallback', async () => {
    configure();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetcher);
    expect((await chatCompletion({ messages: [] })).content).toBe('{}');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
