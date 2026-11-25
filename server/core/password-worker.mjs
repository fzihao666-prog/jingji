import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const taskSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('hash'), password: z.string().max(72) }).strict(),
  z
    .object({
      operation: z.literal('compare'),
      password: z.string().max(72),
      hash: z.string().max(100),
    })
    .strict(),
]);
parentPort.on('message', (message) => {
  try {
    const task = taskSchema.parse(message);
    const value =
      task.operation === 'hash'
        ? bcrypt.hashSync(task.password, 11)
        : bcrypt.compareSync(task.password, task.hash);
    parentPort.postMessage({ ok: true, value });
  } catch {
    // 工作线程只返回固定错误，密码和原始异常不得传出。
    parentPort.postMessage({ ok: false });
  }
});
