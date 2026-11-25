import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

async function checkDelivery(compressed: boolean, repeats = 200) {
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<script type="module" src="/assets/app-12345678.js"></script><link rel="stylesheet" href="/assets/app-12345678.css">'
      );
      return;
    }
    const body = Buffer.from('/* 静态资源 */'.repeat(repeats));
    res.setHeader('Content-Type', req.url?.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (compressed) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
    }
    res.end(compressed ? gzipSync(body) : body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试服务未监听 TCP 端口');
  try {
    return await run(process.execPath, [
      'scripts/check-static-delivery.mjs',
      `http://127.0.0.1:${address.port}/`,
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

describe('线上静态资源交付检查', () => {
  it('实际下载并验证 JS/CSS 的 gzip 压缩及长缓存', async () => {
    const result = await checkDelivery(true);
    expect(result.stdout).toContain('通过：2 个入口静态资源的压缩与缓存符合要求');
  });
  it('小于 Nginx 1024 字节压缩阈值的资源允许不压缩', async () => {
    const result = await checkDelivery(false, 1);
    expect(result.stdout).toContain('通过：2 个入口静态资源的压缩与缓存符合要求');
  });
  it('即使已有长缓存，未压缩也返回失败', async () => {
    await expect(checkDelivery(false)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('未启用 gzip'),
    });
  });
});
