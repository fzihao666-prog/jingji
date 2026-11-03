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

describe('主模型 DeepSeek 推理强度', () => {
  function configureDeepSeek(effort: string) {
    configure();
    vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1');
    vi.stubEnv('AI_MODEL', 'deepseek-v4-pro');
    vi.stubEnv('AI_REASONING_EFFORT', effort);
  }
  function successfulResponse() {
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  }
  it.each(['none', 'low', 'high', 'max'])('主模型实际请求携带 %s', async (effort) => {
    configureDeepSeek(effort);
    const fetcher = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetcher);
    await chatCompletion({ messages: [{ role: 'user', content: '只返回 JSON' }] });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      model: 'deepseek-v4-pro',
      reasoning_effort: effort,
    });
  });
  it('主模型强度不传给备用模型', async () => {
    configureDeepSeek('max');
    vi.stubEnv('AI_FALLBACK_BASE_URL', 'https://api.deepseek.com');
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal('fetch', fetcher);
    await chatCompletion({ messages: [] });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty('reasoning_effort');
  });
  it('未配置强度时不添加请求参数', async () => {
    configureDeepSeek('');
    const fetcher = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetcher);
    await chatCompletion({ messages: [] });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');
  });
  it('非 DeepSeek 官方接口不传该参数', async () => {
    configure();
    vi.stubEnv('AI_REASONING_EFFORT', 'high');
    const fetcher = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetcher);
    await chatCompletion({ messages: [] });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');
  });
  it('配置非法值时在请求前报错', async () => {
    configureDeepSeek('invalid');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(chatCompletion({ messages: [] })).rejects.toThrow('AI_REASONING_EFFORT');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
