import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getToken, setToken } from './api';

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  let token: string | null = 'test-token';
  vi.stubGlobal('localStorage', {
    getItem: () => token,
    setItem: (_key: string, value: string) => { token = value; },
    removeItem: () => { token = null; },
  });
  vi.stubGlobal('window', { location: { reload } });
});

afterEach(() => vi.unstubAllGlobals());

describe('网页会话失效处理', () => {
  it('当前密码错误时保留登录状态并返回原提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ message: '当前密码不正确。' }, { status: 401 })
    ));

    await expect(api.changePassword('wrong', 'NewPassword123')).rejects.toMatchObject({
      status: 401,
      message: '当前密码不正确。',
    });
    expect(getToken()).toBe('test-token');
    expect(reload).not.toHaveBeenCalled();
  });

  it('当前会话确实失效时清除令牌并重新加载', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ code: 'SESSION_EXPIRED' }, { status: 401 })
    ));

    await expect(api.me()).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(getToken()).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('旧请求返回会话失效时保留期间写入的新令牌', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      setToken('new-test-token');
      return Response.json({ code: 'SESSION_EXPIRED' }, { status: 401 });
    }));

    await expect(api.me()).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(getToken()).toBe('new-test-token');
    expect(reload).not.toHaveBeenCalled();
  });
});
