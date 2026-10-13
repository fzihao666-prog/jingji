import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const revision = 'a'.repeat(40);

function publish(options: { revision?: string; fail?: string; credentials?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'jingji-gitee-'));
  const executable = (path: string, content: string) => {
    writeFileSync(path, content);
    chmodSync(path, 0o700);
  };
  mkdirSync(join(directory, 'scripts'));
  mkdirSync(join(directory, 'bin'));
  copyFileSync(resolve('scripts/gitee-release.sh'), join(directory, 'scripts/gitee-release.sh'));
  executable(
    join(directory, 'scripts/release.sh'),
    '#!/bin/bash\nprintf "release %s\\n" "$*" >> "$CALLS"\n'
  );
  executable(
    join(directory, 'bin/docker'),
    `#!/bin/bash
printf 'docker %s\\n' "$*" >> "$CALLS"
if [ "$1" = login ]; then cat >/dev/null; fi
if [ "$1 $2" = 'buildx build' ] && [ "$TEST_FAIL" = build ]; then exit 1; fi
`
  );
  for (const name of ['git', 'ssh', 'ssh-keygen', 'flock']) {
    executable(join(directory, 'bin', name), `#!/bin/bash\n[ "$TEST_FAIL" != '${name}' ]\n`);
  }
  writeFileSync(join(directory, 'key'), '');
  const callsPath = join(directory, 'calls');
  try {
    const result = spawnSync(
      'bash',
      [join(directory, 'scripts/gitee-release.sh'), options.revision ?? revision],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
          IMAGE: 'registry.example.com/team/jingji',
          DEPLOY_HOST: 'ecs.example.com',
          DEPLOY_USER: 'deploy',
          REMOTE_DIR: '/srv/jingji',
          DEPLOY_SSH_KEY: join(directory, 'key'),
          GITEE_RELEASE_LOCK_FILE: join(directory, 'release.lock'),
          ACR_USERNAME: options.credentials ? 'ci' : '',
          ACR_PASSWORD: options.credentials ? 'test-password-never-log' : '',
          CALLS: callsPath,
          TEST_FAIL: options.fail ?? '',
        },
      }
    );
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls: existsSync(callsPath) ? readFileSync(callsPath, 'utf8') : '',
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('Gitee Docker 发布', () => {
  it('构建和部署使用相同的完整提交标签，登录密码不进入命令参数或日志', () => {
    const result = publish({ credentials: true });
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toContain(
      'docker login registry.example.com --username ci --password-stdin'
    );
    expect(result.calls).toContain(
      `docker buildx build --platform linux/amd64 --tag registry.example.com/team/jingji:${revision} --push .`
    );
    expect(result.calls).toContain(`release --tag ${revision}`);
    expect(result.calls + result.output).not.toContain('test-password-never-log');
  });

  it('拒绝非法标签，且不调用 Docker 或发布脚本', () => {
    const result = publish({ revision: 'latest' });
    expect(result.status).toBe(2);
    expect(result.calls).toBe('');
  });

  it.each(['build', 'ssh-keygen', 'flock'])('%s 失败时不部署', (fail) => {
    const result = publish({ fail });
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain('release --tag');
    if (fail !== 'build') expect(result.calls).not.toContain('docker buildx build');
  });
});
