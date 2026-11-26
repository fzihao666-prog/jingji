import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const repository = 'registry.example.com/team/jingji';
const ref = (tag: string) => `${repository}:${tag}`;

function release(
  options: {
    previous?: string;
    unhealthy?: boolean;
    fail?: 'pull' | 'up' | 'curl' | 'remove' | 'lock' | 'copy' | 'static';
    history?: string[];
    protectedTag?: string;
    dryRun?: boolean;
    repeat?: boolean;
  } = {}
) {
  const directory = mkdtempSync(join(tmpdir(), 'jingji release-$()-'));
  const script = resolve('scripts/release.sh');
  const executable = (name: string, source: string) => {
    const path = join(directory, name);
    writeFileSync(path, source);
    chmodSync(path, 0o700);
  };
  executable('ssh', '#!/bin/bash\nexec bash -c "${@: -1}"\n');
  executable('flock', '#!/bin/bash\n[ "$TEST_FAIL" != lock ]\n');
  executable('curl', '#!/bin/bash\n[ "$TEST_FAIL" != curl ]\n');
  executable(
    'docker',
    `#!${process.execPath}
const fs = require('node:fs');
const p = process.env.REMOTE_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(p + '/calls', JSON.stringify(args) + '\\n');
const command = args.join(' ');
const updated = fs.existsSync(p + '/updated');
const repo = process.env.IMAGE;
if (command.includes(' compose ') || args[0] === 'compose') {
  if (args.includes('pull') && process.env.TEST_FAIL === 'pull') process.exit(1);
  if (args.includes('up')) {
    fs.writeFileSync(p + '/updated', '1');
    if (process.env.TEST_FAIL === 'up') process.exit(1);
  }
  if (args.includes('-aq')) console.log('container');
  if (args.includes('exec') && process.env.TEST_FAIL === 'static') process.exit(1);
} else if (args[0] === 'create') {
  console.log('snapshot-container');
} else if (args[0] === 'cp') {
  if (process.env.TEST_FAIL === 'copy') process.exit(1);
  fs.writeFileSync(args.at(-1) + '/app-12345678.js', 'export {};');
  fs.writeFileSync(args.at(-1) + '/app-12345678.css', 'body{}');
  fs.writeFileSync(args.at(-1) + '/unversioned.js', 'export {};');
} else if (args[0] === 'rm') {
  process.exit(0);
} else if (args[0] === 'container' && args[1] === 'inspect') {
  if (command.includes('Config.Image')) console.log(repo + ':' + (updated ? 'aaaaaaa' : process.env.TEST_PREVIOUS));
  else if (command.includes('Health')) console.log(process.env.TEST_UNHEALTHY === '1' && !updated ? 'unhealthy' : 'healthy');
} else if (args[0] === 'container' && args[1] === 'ls') {
  if (command.includes('ancestor=sha256:' + process.env.TEST_PROTECTED)) console.log('other-container');
} else if (args[0] === 'image' && args[1] === 'ls') {
  console.log(['aaaaaaa', 'bbbbbbb', 'ccccccc', 'ddddddd'].map(t => repo + ':' + t).join('\\n'));
  console.log('another.example.com/app:eeeeeee');
  console.log(repo + ':latest');
} else if (args[0] === 'image' && args[1] === 'inspect') {
  console.log('sha256:' + args.at(-1).split(':').at(-1));
} else if (args[0] === 'image' && args[1] === 'rm') {
  if (process.env.TEST_FAIL === 'remove') process.exit(1);
  fs.appendFileSync(p + '/deleted', args.at(-1) + '\\n');
} else {
  console.error('未模拟的 Docker 命令：' + command);
  process.exit(2);
}
`
  );
  writeFileSync(join(directory, 'key'), '');
  writeFileSync(join(directory, '.env.compose'), 'IMAGE_TAG=bbbbbbb\n');
  if (options.history) {
    writeFileSync(join(directory, '.release-successful-images'), options.history.join('\n') + '\n');
  }
  try {
    const result = spawnSync(
      'bash',
      [script, '--tag', 'aaaaaaa', ...(options.dryRun ? ['--dry-run'] : [])],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          IMAGE: repository,
          REMOTE_DIR: directory,
          DEPLOY_SSH_KEY: join(directory, 'key'),
          TEST_PREVIOUS: options.previous ?? 'bbbbbbb',
          TEST_UNHEALTHY: options.unhealthy ? '1' : '0',
          TEST_FAIL: options.fail ?? '',
          TEST_PROTECTED: options.protectedTag ?? 'none',
        },
      }
    );
    if (options.repeat && result.status === 0) {
      rmSync(join(directory, 'deleted'), { force: true });
      const repeated = spawnSync('bash', [script, '--tag', 'aaaaaaa'], {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          IMAGE: repository,
          REMOTE_DIR: directory,
          DEPLOY_SSH_KEY: join(directory, 'key'),
          TEST_PREVIOUS: 'aaaaaaa',
        },
      });
      expect(repeated.status, repeated.stderr).toBe(0);
    }
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      deleted: existsSync(join(directory, 'deleted'))
        ? readFileSync(join(directory, 'deleted'), 'utf8').trim().split('\n')
        : [],
      history: existsSync(join(directory, '.release-successful-images'))
        ? readFileSync(join(directory, '.release-successful-images'), 'utf8').trim().split('\n')
        : [],
      assets: existsSync(join(directory, 'data/.release-assets/previous'))
        ? readFileSync(join(directory, 'data/.release-assets/previous'), 'utf8').trim()
        : '',
      calls: existsSync(join(directory, 'calls'))
        ? readFileSync(join(directory, 'calls'), 'utf8')
        : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('发布后的镜像保留', () => {
  it('健康检查首次连接重置后重试真实 HTTP 请求', async () => {
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      if (requests === 1) request.socket.resetAndDestroy();
      else response.end('{"status":"ok"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('未取得测试服务端口');
      const script = readFileSync(resolve('scripts/release.sh'), 'utf8');
      const command = script.match(/! (curl[^\n]+); then/)?.[1];
      if (!command) throw new Error('未找到发布脚本健康检查命令');
      await promisify(execFile)(
        'bash',
        ['-c', command.replace('http://127.0.0.1:8787/health', `http://127.0.0.1:${address.port}/health`)],
        { timeout: 5000, env: { ...process.env, NO_PROXY: '127.0.0.1' } }
      );
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('发布静态检查递归检查入口预加载和动态引用，并拒绝 HTML 回退', async () => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.url ?? '');
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<script type="module" src="/assets/index-12345678.js"></script>');
      } else if (req.url === '/assets/index-12345678.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end('import("./route.es-12345678.js")');
      } else if (req.url === '/assets/route.es-12345678.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end('import("./missing-12345678.js")');
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html>页面回退</html>');
      }
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('未取得测试服务端口');
      const script = readFileSync(resolve('scripts/release.sh'), 'utf8');
      const check = script.match(/<<'CHECK_ASSETS'\n([\s\S]+?)\nCHECK_ASSETS/)?.[1];
      if (!check) throw new Error('未找到发布静态检查命令');
      await expect(promisify(execFile)(process.execPath, [
        '--input-type=module', '-e',
        check.replace('http://127.0.0.1:8787', `http://127.0.0.1:${address.port}`),
      ], { timeout: 5000 })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('/assets/missing-12345678.js 返回 HTTP 200'),
      });
      expect(requests).toEqual(['/', '/assets/index-12345678.js', '/assets/route.es-12345678.js', '/assets/missing-12345678.js']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it('成功后仅删除本仓库的旧 SHA 版本，保留当前版和发布前健康版', () => {
    const result = release();
    expect(result.status, result.output).toBe(0);
    expect(result.deleted, result.output).toEqual([ref('ccccccc'), ref('ddddddd')]);
    expect(result.history).toEqual([ref('aaaaaaa'), ref('bbbbbbb')]);
  });

  it('切换前提取上一版分包，健康检查后验证静态资源', () => {
    const result = release();
    expect(result.status, result.output).toBe(0);
    expect(result.assets).toBe('bbbbbbb');
    const calls = result.calls.trim().split('\n').map((line) => JSON.parse(line) as string[]);
    const snapshot = calls.findIndex((args) => args[0] === 'cp');
    const switchImage = calls.findIndex((args) => args.includes('up'));
    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeLessThan(switchImage);
    expect(calls.findIndex((args) => args.includes('exec'))).toBeGreaterThan(switchImage);
  });

  it('提取失败时保留当前服务和发布记录', () => {
    const result = release({ fail: 'copy', history: [ref('bbbbbbb')] });
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain('"up"');
    expect(result.history).toEqual([ref('bbbbbbb')]);
  });

  it.each(['pull', 'up', 'curl', 'static'] as const)('%s 失败时不清理，也不覆盖成功历史', (fail) => {
    const result = release({ fail, history: [ref('bbbbbbb'), ref('ccccccc')] });
    expect(result.status).not.toBe(0);
    expect(result.deleted, result.output).toEqual([]);
    expect(result.history).toEqual([ref('bbbbbbb'), ref('ccccccc')]);
  });

  it('发布前容器不健康时保留记录中的最近成功版', () => {
    const result = release({ unhealthy: true, history: [ref('ccccccc'), ref('ddddddd')] });
    expect(result.status, result.output).toBe(0);
    expect(result.deleted, result.output).toEqual([ref('bbbbbbb'), ref('ddddddd')]);
  });

  it('没有可确认成功的旧版时保留旧镜像并跳过清理', () => {
    const result = release({ unhealthy: true });
    expect(result.status, result.output).toBe(0);
    expect(result.deleted, result.output).toEqual([]);
  });

  it('重复发布当前版仍保留之前的成功版本', () => {
    const result = release({ repeat: true });
    expect(result.history).toEqual([ref('aaaaaaa'), ref('bbbbbbb')]);
    expect(result.deleted, result.output).toEqual([ref('ccccccc'), ref('ddddddd')]);
  });

  it('保留被其他容器引用的旧版', () => {
    const result = release({ protectedTag: 'ccccccc' });
    expect(result.status, result.output).toBe(0);
    expect(result.deleted, result.output).toEqual([ref('ddddddd')]);
  });

  it('预览不执行远程 Docker 操作', () => {
    const result = release({ dryRun: true });
    expect(result.status, result.output).toBe(0);
    expect(result.deleted, result.output).toEqual([]);
    expect(result.calls).toBe('');
  });

  it('清理失败仍报告部署成功，并保留成功历史', () => {
    const result = release({ fail: 'remove' });
    expect(result.status, result.output).toBe(0);
    expect(result.deleted, result.output).toEqual([]);
    expect(result.history).toEqual([ref('aaaaaaa'), ref('bbbbbbb')]);
    expect(result.output).toContain('未能清理镜像');
  });

  it('未获取发布锁时不访问 Docker 或修改成功历史', () => {
    const result = release({ fail: 'lock', history: [ref('bbbbbbb'), ref('ccccccc')] });
    expect(result.status).not.toBe(0);
    expect(result.calls).toBe('');
    expect(result.history).toEqual([ref('bbbbbbb'), ref('ccccccc')]);
  });
});
