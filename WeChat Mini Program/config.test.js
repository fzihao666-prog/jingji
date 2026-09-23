import { describe, expect, it } from 'vitest';
import { NETWORK_DEBUG, resolveApiBaseUrl } from './config.js';

describe('小程序 API 地址配置', () => {
  it('为开发环境返回本地 Express 地址', () => {
    expect(resolveApiBaseUrl('development')).toBe('http://127.0.0.1:8787');
  });

  it('移除 API 地址的尾部斜杠', () => {
    expect(resolveApiBaseUrl('production', 'https://api.example.com/')).toBe('https://api.example.com');
  });

  it('拒绝非 HTTPS 的生产 API 地址', () => {
    expect(() => resolveApiBaseUrl('production', 'http://api.example.com')).toThrow(/HTTPS/);
  });

  it('为真机网络诊断显式开启安全的调试追踪', () => {
    expect(NETWORK_DEBUG).toBe(true);
  });
});
