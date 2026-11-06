import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

it('读取运动员照片时使用登录凭证并接收 JPEG 文件', async () => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'training-monitor-token' ? 'synthetic-session' : null),
  });
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(new Uint8Array([255, 216, 255, 217]), {
        headers: { 'Content-Type': 'image/jpeg' },
      })
    );
  vi.stubGlobal('fetch', fetcher);

  const controller = new AbortController();
  const photo = await api.athletePhoto(7, controller.signal);

  expect(fetcher).toHaveBeenCalledWith(
    '/api/athletes/7/photo',
    expect.objectContaining({
      signal: controller.signal,
      headers: expect.any(Headers),
    })
  );
  expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer synthetic-session');
  expect(photo.type).toBe('image/jpeg');
  expect(photo.size).toBe(4);
});
