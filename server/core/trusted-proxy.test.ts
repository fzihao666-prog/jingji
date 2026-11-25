import express, { type Request } from 'express';
import { describe, expect, it } from 'vitest';
import { configureTrustedProxy } from './trusted-proxy.ts';

function clientIp(remoteAddress: string, forwarded: string): string | undefined {
  const app = express();
  configureTrustedProxy(app);
  const request: Request = Object.assign(Object.create(express.request), {
    app,
    socket: { remoteAddress },
    headers: { 'x-forwarded-for': forwarded },
  });
  return request.ip;
}

describe('单机 Nginx 与 Docker 代理的客户端 IP', () => {
  it.each(['127.0.0.1', '::1', '172.18.0.1', '::ffff:172.18.0.1'])(
    '信任直接代理 %s，不同客户端保留独立 IP',
    (source) => {
      expect(clientIp(source, '198.51.100.10')).toBe('198.51.100.10');
      expect(clientIp(source, '203.0.113.20')).toBe('203.0.113.20');
    }
  );

  it.each(['172.18.0.2', '172.19.0.1', '10.0.0.1', '198.51.100.10'])(
    '不信任其他来源 %s 提供的转发头',
    (source) => {
      expect(clientIp(source, '203.0.113.20')).toBe(source);
    }
  );

  it.each(['203.0.113.99', '127.0.0.1', '172.18.0.1'])(
    'Nginx 追加真实 IP 后，忽略客户端伪造的前缀 %s',
    (forged) => {
      expect(clientIp('172.18.0.1', `${forged}, 198.51.100.10`)).toBe('198.51.100.10');
    }
  );

  it('转发头中的内网地址也不能成为额外受信任跳点', () => {
    expect(clientIp('172.18.0.1', '203.0.113.99, 127.0.0.1')).toBe('127.0.0.1');
  });
});
