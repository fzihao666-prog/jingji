import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('训练记录客户端请求', () => {
  it('保留日期、项目、队伍，并按当前运动员缩小查询范围', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ records: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api.records('2026-10-01', '2026-10-30', 7, 'ROWING', 3)).resolves.toEqual({
      records: [],
    });
    const query = new URL(String(fetcher.mock.calls[0][0]), 'https://test.invalid').searchParams;
    expect(Object.fromEntries(query)).toEqual({
      from: '2026-10-01',
      to: '2026-10-30',
      project: 'ROWING',
      athleteId: '7',
      teamId: '3',
    });
  });
  it('页面离开时能够取消仍在等待的网络请求', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      (_path: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('已取消', 'AbortError')),
            { once: true }
          );
        })
    );
    const pending = api.records('2026-10-01', '2026-10-30', 7, 'ROWING', 3, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ networkError: true });
  });
});
