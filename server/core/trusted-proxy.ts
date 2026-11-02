import type { Express } from 'express';

export function configureTrustedProxy(app: Express): void {
  // 宿主机 Nginx 经当前 Docker 网关转发；不信任其他容器或整个内网网段。
  app.set('trust proxy', ['loopback', '172.18.0.1']);
  const trustedAddress: (address: string) => boolean = app.get('trust proxy fn');
  // 仅信任直接连接的一跳，防止转发头中的回环/网关地址继续扩大信任链。
  app.set('trust proxy', (address: string, hop: number) => hop === 0 && trustedAddress(address));
}
