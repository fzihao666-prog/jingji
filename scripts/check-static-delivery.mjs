#!/usr/bin/env node
// 只读检查公网入口资源；不登录、不读取业务接口，也不修改服务器配置。
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';

async function download(url) {
  const start = performance.now();
  const response = await fetch(url, {
    headers: { 'Accept-Encoding': 'gzip' },
    signal: globalThis.AbortSignal.timeout(20000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${url.pathname} 返回 HTTP ${response.status}`);
  const body = await response.text();
  return { response, body, elapsed: Math.round(performance.now() - start) };
}

async function main() {
  if (process.argv.length !== 3)
    throw new Error('用法：node scripts/check-static-delivery.mjs https://你的域名/');
  const base = new URL(process.argv[2]);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('请使用不含账号密码的 HTTP/HTTPS 地址');
  }
  base.hash = '';
  const html = await download(base);
  const assets = [
    ...html.body.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g),
  ].map((match) => new URL(match[1], base));
  const unique = [...new Map(assets.map((url) => [url.href, url])).values()];
  if (!unique.length) throw new Error('入口未发现 JS/CSS 资源，无法确认压缩是否生效');
  const failures = [];
  for (const url of unique) {
    if (url.origin !== base.origin) throw new Error('入口引用了跨域资源，请分别检查对应域名');
    const { response, body, elapsed } = await download(url);
    const encoding = response.headers.get('content-encoding');
    const cache = response.headers.get('cache-control') || '';
    const type = response.headers.get('content-type') || '';
    console.log(`${url.pathname}：${elapsed}ms；压缩=${encoding || '无'}；缓存=${cache || '无'}`);
    // 与站点 gzip_min_length 1024 保持一致，小运行时文件无需强制压缩。
    if (Buffer.byteLength(body, 'utf8') >= 1024 && encoding !== 'gzip')
      failures.push(`${url.pathname} 未启用 gzip`);
    if (
      !/\bimmutable\b/i.test(cache) ||
      !/max-age=[1-9]\d*/i.test(cache) ||
      /\b(?:no-store|no-cache|private)\b/i.test(cache)
    )
      failures.push(`${url.pathname} 未启用不可变长缓存`);
    if (encoding === 'gzip' && !/accept-encoding/i.test(response.headers.get('vary') || ''))
      failures.push(`${url.pathname} 缺少 Vary: Accept-Encoding`);
    if (!/(?:javascript|text\/css)/i.test(type))
      failures.push(`${url.pathname} 资源类型异常：${type}`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`通过：${unique.length} 个入口静态资源的压缩与缓存符合要求`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '静态资源检查失败');
  process.exitCode = 1;
});
