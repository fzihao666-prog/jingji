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
  it('综合稿使用 Word 路径及标准 MIME，旧稿仍默认 PDF', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('word', { headers: { 'Content-Type': docxType } }))
      .mockResolvedValueOnce(
        new Response('pdf', { headers: { 'Content-Type': 'application/pdf' } })
      );
    vi.stubGlobal('fetch', fetcher);
    await api.downloadSavedWeekly('new/id', '综合.docx', 'docx');
    await api.downloadSavedWeekly('old', '旧版.pdf');
    expect(fetcher.mock.calls[0][0]).toBe('/api/reports/weekly/history/new%2Fid/docx');
    expect(fetcher.mock.calls[1][0]).toBe('/api/reports/weekly/history/old/pdf');
    expect(click).toHaveBeenCalledTimes(2);
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
    await expect(api.downloadSavedWeekly('new', '综合.docx', 'docx')).rejects.toThrow();
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
  it('历史与照片请求省略类型，由服务端采用综合默认值', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response('{"photos":[]}', { headers: { 'Content-Type': 'application/json' } })
      );
    vi.stubGlobal('fetch', fetcher);
    await api.weeklyReportHistory({ project: 'ROWING', teamId: 1, page: 1 });
    await api.uploadWeeklyPhotos({ project: 'ROWING', teamId: 1 }, []);
    expect(fetcher.mock.calls[0][0]).not.toContain('reportType');
    expect((fetcher.mock.calls[1][1].body as FormData).has('reportType')).toBe(false);
  });
});
