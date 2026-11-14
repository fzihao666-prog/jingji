import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

it('一次请求取得授权队伍快照，供页面在本地筛选和导出', async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'synthetic-token' });
  const report = { teams: [], coaches: [], records: [], types: [] };
  const fetcher = vi.fn().mockResolvedValue(Response.json(report));
  vi.stubGlobal('fetch', fetcher);
  await expect(api.submissionReport()).resolves.toEqual(report);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/reports/submissions');
  expect(fetcher.mock.calls[0][1].headers.get('authorization')).toBe('Bearer synthetic-token');
});
