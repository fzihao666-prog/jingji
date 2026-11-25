import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { PasswordPool, PasswordPoolError } from './password-pool.ts';

const pools: PasswordPool[] = [];
function pool(options: ConstructorParameters<typeof PasswordPool>[0] = {}) {
  const result = new PasswordPool(options);
  pools.push(result);
  return result;
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((item) => item.close()));
});

describe('密码工作线程池', () => {
  it('生成 cost 11 哈希并正确比较密码，计算期间主线程仍能处理事件', async () => {
    const workerPool = pool({ size: 1 });
    let completed = false;
    const hashing = workerPool.hash('Secure123').then((hash) => {
      completed = true;
      return hash;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    const hash = await hashing;
    expect(hash).toMatch(/^\$2[aby]\$11\$/);
    expect(await workerPool.compare('Secure123', hash)).toBe(true);
    expect(await workerPool.compare('Wrong123', hash)).toBe(false);
  });

  it('队列满时拒绝新任务但完成已接受任务', async () => {
    const workerPool = pool({ size: 1, maxQueue: 1 });
    const active = workerPool.hash('Secure123');
    const queued = workerPool.hash('Secure456');
    await expect(workerPool.hash('Secure789')).rejects.toMatchObject({ code: 'OVERLOADED' });
    await expect(active).resolves.toEqual(expect.any(String));
    await expect(queued).resolves.toEqual(expect.any(String));
  });

  it('任务超时后拒绝任务并释放工作线程', async () => {
    const workerPool = pool({ size: 1, timeoutMs: 10 });
    await expect(workerPool.hash('Secure123')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('工作线程异常不暴露输入，后续任务仍有容量', async () => {
    const workerPool = pool({
      size: 1,
      workerUrl: new URL('data:text/javascript,throw new Error("private-input")'),
    });
    await expect(workerPool.hash('Secure123')).rejects.toEqual(
      new PasswordPoolError('WORKER_FAILED')
    );
    await expect(workerPool.hash('Secure456')).rejects.toEqual(
      new PasswordPoolError('WORKER_FAILED')
    );
  });

  it('工作线程意外正常退出也拒绝任务', async () => {
    const workerPool = pool({
      size: 1,
      workerUrl: new URL('data:text/javascript,import process from "node:process";process.exit(0)'),
    });
    await expect(workerPool.hash('Secure123')).rejects.toMatchObject({ code: 'WORKER_FAILED' });
  });

  it('等待中的任务保持进程存活，空闲工作线程不阻止进程退出', async () => {
    const moduleUrl = new URL('./password-pool.ts', import.meta.url).href;
    const script = `import { passwordPool } from ${JSON.stringify(moduleUrl)}; await passwordPool.hash('Secure123'); console.log('completed');`;
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { timeout: 5000 }
    );
    expect(result.stdout.trim()).toBe('completed');
  });

  it('关闭时拒绝运行和排队任务，之后不再接受任务', async () => {
    const workerPool = pool({ size: 1 });
    const active = expect(workerPool.hash('Secure123')).rejects.toMatchObject({ code: 'CLOSED' });
    const queued = expect(workerPool.hash('Secure456')).rejects.toMatchObject({ code: 'CLOSED' });
    await workerPool.close();
    await Promise.all([active, queued]);
    await expect(workerPool.hash('Secure789')).rejects.toMatchObject({ code: 'CLOSED' });
  });
});
