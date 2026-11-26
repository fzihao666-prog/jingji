import express from 'express';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { previousReleaseAssets } from './release-assets.ts';

it('切换后优先提供当前分包，并只回退上一版公开的哈希分包', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'jingji-assets-'));
  const current = join(fixture, 'current');
  const previous = join(fixture, 'bbbbbbb');
  await Promise.all([mkdir(current), mkdir(previous)]);
  await Promise.all([
    writeFile(join(fixture, 'previous'), 'bbbbbbb\n'),
    writeFile(join(current, 'shared-12345678.js'), '当前'),
    writeFile(join(previous, 'shared-12345678.js'), '旧版'),
    writeFile(join(previous, 'only-old.es-abcdefgh.js'), '旧版分包'),
    writeFile(join(previous, 'unversioned.js'), '普通文件'),
  ]);
  const app = express();
  app.use('/assets', express.static(current), previousReleaseAssets(fixture));
  app.get(/.*/, (_req, res) => res.send('当前入口'));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('未取得测试端口');
    const get = (path: string) => fetch(`http://127.0.0.1:${address.port}${path}`);
    expect(await (await get('/assets/shared-12345678.js')).text()).toBe('当前');
    const old = await get('/assets/only-old.es-abcdefgh.js');
    expect(old.status).toBe(200);
    expect(old.headers.get('content-type')).toContain('javascript');
    expect(old.headers.get('cache-control')).toContain('immutable');
    expect(await old.text()).toBe('旧版分包');
    for (const path of ['/assets/unversioned.js', '/assets/missing-12345678.js', '/assets/previous']) {
      const missing = await get(path);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('cache-control')).toBe('no-store');
      await missing.text();
    }
    expect(await (await get('/training-plans')).text()).toBe('当前入口');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(fixture, { recursive: true, force: true });
  }
});
