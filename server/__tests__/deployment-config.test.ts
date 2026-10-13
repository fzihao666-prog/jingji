import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Nginx 发布示例', () => {
  it('将 API、上传和 SPA 请求代理到同一个本机 Express 服务', () => {
    const configPath = resolve(process.cwd(), 'deploy/nginx/jingji.conf.example');

    expect(existsSync(configPath)).toBe(true);

    const config = readFileSync(configPath, 'utf8');
    expect(config).toContain('server_name api.example.com;');
    expect(config).toContain('location /api/');
    expect(config).toContain('location /uploads/');
    expect(config).toContain('proxy_pass http://127.0.0.1:8787;');
    expect(config).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    expect(config).toContain('client_max_body_size 85m;');
    expect(config).toContain('return 301 https://api.example.com$request_uri;');
    expect(config).not.toContain('https://$host$request_uri');
  });

  it('默认仅在本机监听 Express 内部端口', () => {
    const serverSource = readFileSync(resolve(process.cwd(), 'server/index.ts'), 'utf8');

    expect(serverSource).toContain("const host = process.env.HOST || '127.0.0.1';");
    expect(serverSource).toContain('app.listen(port, host');
  });

  it('在 Nginx 层压缩 JS/CSS，避免明文传输放大首屏体积', () => {
    const config = readFileSync(resolve(process.cwd(), 'deploy/nginx/jingji.conf.example'), 'utf8');

    expect(config).toContain('gzip on;');
    expect(config).toContain('gzip_proxied any;');
    expect(config).toMatch(/gzip_types[^;]*text\/css/);
    expect(config).toMatch(/gzip_types[^;]*text\/javascript/);
    expect(config).toMatch(/gzip_types[^;]*application\/javascript/);
    expect(config).toMatch(/gzip_types[^;]*application\/json/);
  });

  it('静态资源缓存策略：带内容 hash 的资产长缓存，普通资产缓存 30 天，HTML 每次重新验证', () => {
    const serverSource = readFileSync(resolve(process.cwd(), 'server/index.ts'), 'utf8');

    expect(serverSource).toContain('public, max-age=31536000, immutable');
    expect(serverSource).toContain('public, max-age=2592000');
    // 顶层 express.static 与 SPA 回退都必须发 no-cache，否则发布后浏览器拿不到新版本。
    const noCacheCount = serverSource.split("res.setHeader('Cache-Control', 'no-cache')").length - 1;
    expect(noCacheCount).toBeGreaterThanOrEqual(2);
    expect(serverSource).toMatch(/hashedAssetPattern\.test\(basename\(filePath\)\)/);
  });
});
