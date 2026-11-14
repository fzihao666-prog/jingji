import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('用账号令牌请求当前筛选范围，接收 XLSX 后触发下载', async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'synthetic-token' });
  const response = new Response('synthetic-workbook', {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
  vi.stubGlobal('window', { setTimeout: vi.fn() });
  const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-workbook');
  await api.exportSubmissionReport(new URLSearchParams({ project: 'ROWING', team: '' }));
  const [path, request] = fetcher.mock.calls[0];
  expect(Object.fromEntries(new URL(path, 'https://test.invalid').searchParams)).toEqual({
    project: 'ROWING',
    team: '',
    format: 'xlsx',
  });
  expect(request.headers.get('authorization')).toBe('Bearer synthetic-token');
  expect(objectUrl).toHaveBeenCalledWith(expect.any(Blob));
  expect(link.download).toBe('数据提交检查.xlsx');
  expect(link.click).toHaveBeenCalledOnce();
});
