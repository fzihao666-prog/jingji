import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repository = 'registry.example.com/team/jingji';
const ref = (tag: string) => `${repository}:${tag}`;

function release(
  options: {
    previous?: string;
    unhealthy?: boolean;
    fail?: 'pull' | 'up' | 'curl' | 'remove' | 'lock';
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
      calls: existsSync(join(directory, 'calls'))
        ? readFileSync(join(directory, 'calls'), 'utf8')
        : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('发布后的镜像保留', () => {
  it('成功后仅删除本仓库的旧 SHA 版本，保留当前版和发布前健康版', () => {
    const result = release();
    expect(result.status, result.output).toBe(0);
    expect(result.deleted, result.output).toEqual([ref('ccccccc'), ref('ddddddd')]);
    expect(result.history).toEqual([ref('aaaaaaa'), ref('bbbbbbb')]);
  });

  it.each(['pull', 'up', 'curl'] as const)('%s 失败时不清理，也不覆盖成功历史', (fail) => {
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
