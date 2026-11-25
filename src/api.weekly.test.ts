import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
describe('周总结客户端下载与默认范围', () => {
  const click = vi.fn();
  const createUrl = vi.fn(() => 'blob:report');
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('document', {
      createElement: () => ({ click, remove: vi.fn() }),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('window', { setTimeout: vi.fn() });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createUrl);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('一次请求生成并下载Word，不读取或保存历史', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('word', { headers: { 'Content-Type': docxType } }));
    vi.stubGlobal('fetch', fetcher);
    await api.downloadWeeklyReport({ query: { project: 'ROWING', teamId: 1, date: '2026-10-05' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/reports/weekly/generate');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      query: { project: 'ROWING', teamId: 1, date: '2026-10-05' },
    });
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('Content-Type')).toBe(
      'application/json'
    );
    expect(click).toHaveBeenCalledTimes(1);
  });
  it.each([
    [200, 'text/html', '<html>error</html>'],
    [200, 'application/json', '{"message":"导出失败"}'],
    [500, 'application/json', '{"message":"导出失败"}'],
    [200, 'application/pdf', 'wrong format'],
  ])('拒绝错误页及失败JSON：%s %s', async (status, type, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': type } }))
    );
    await expect(
      api.downloadWeeklyReport({ query: { project: 'ROWING', teamId: 1, date: '2026-10-05' } })
    ).rejects.toThrow();
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
