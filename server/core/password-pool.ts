import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';

type FailureCode = 'OVERLOADED' | 'TIMEOUT' | 'WORKER_FAILED' | 'CLOSED';
export class PasswordPoolError extends Error {
  constructor(public readonly code: FailureCode) {
    super(code);
  }
}
type Payload =
  | { operation: 'hash'; password: string }
  | { operation: 'compare'; password: string; hash: string };
type Task = {
  payload: Payload;
  resolve: (value: string | boolean) => void;
  reject: (error: PasswordPoolError) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Slot = { worker: Worker; task?: Task };
const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.union([z.string().max(100), z.boolean()]) }).strict(),
  z.object({ ok: z.literal(false) }).strict(),
]);

export class PasswordPool {
  private readonly size: number;
  private readonly maxQueue: number;
  private readonly timeoutMs: number;
  private readonly workerUrl: URL;
  private readonly slots = new Set<Slot>();
  private readonly queue: Task[] = [];
  private closed = false;
  private readonly terminating = new Set<Promise<number>>();

  constructor(
    options: { size?: number; maxQueue?: number; timeoutMs?: number; workerUrl?: URL } = {}
  ) {
    this.size = options.size ?? Math.max(1, Math.min(2, availableParallelism() - 1));
    this.maxQueue = options.maxQueue ?? 32;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.workerUrl = options.workerUrl ?? new URL('./password-worker.mjs', import.meta.url);
    if (
      !Number.isInteger(this.size) ||
      this.size < 1 ||
      this.size > 2 ||
      !Number.isInteger(this.maxQueue) ||
      this.maxQueue < 0 ||
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs <= 0
    ) {
      throw new Error('密码工作线程池配置无效');
    }
  }

  async hash(password: string): Promise<string> {
    return (await this.submit({ operation: 'hash', password })) as string;
  }
  async compare(password: string, hash: string): Promise<boolean> {
    return (await this.submit({ operation: 'compare', password, hash })) as boolean;
  }

  private submit(payload: Payload): Promise<string | boolean> {
    if (this.closed) return Promise.reject(new PasswordPoolError('CLOSED'));
    const idle = [...this.slots].some((slot) => !slot.task);
    if (
      !idle &&
      this.slots.size + this.terminating.size >= this.size &&
      this.queue.length >= this.maxQueue
    ) {
      return Promise.reject(new PasswordPoolError('OVERLOADED'));
    }
    return new Promise((resolve, reject) => {
      const task: Task = {
        payload,
        resolve,
        reject,
        timer: setTimeout(() => this.timeout(task), this.timeoutMs),
      };
      this.queue.push(task);
      this.dispatch();
    });
  }

  private timeout(task: Task) {
    const index = this.queue.indexOf(task);
    if (index >= 0) this.queue.splice(index, 1);
    const slot = [...this.slots].find((item) => item.task === task);
    task.reject(new PasswordPoolError('TIMEOUT'));
    if (slot) {
      slot.task = undefined;
      this.remove(slot);
    }
    this.dispatch();
  }

  private remove(slot: Slot) {
    if (!this.slots.delete(slot)) return;
    const termination = slot.worker.terminate();
    this.terminating.add(termination);
    void termination.finally(() => {
      this.terminating.delete(termination);
      this.dispatch();
    });
  }

  private fail(slot: Slot) {
    if (!this.slots.has(slot)) return;
    if (slot.task) {
      clearTimeout(slot.task.timer);
      slot.task.reject(new PasswordPoolError('WORKER_FAILED'));
      slot.task = undefined;
    }
    this.remove(slot);
  }

  private dispatch() {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = [...this.slots].find((item) => !item.task);
      if (!slot) {
        if (this.slots.size + this.terminating.size >= this.size) return;
        try {
          slot = { worker: new Worker(this.workerUrl, { execArgv: [] }) };
        } catch {
          const task = this.queue.shift()!;
          clearTimeout(task.timer);
          task.reject(new PasswordPoolError('WORKER_FAILED'));
          continue;
        }
        const created = slot;
        this.slots.add(created);
        created.worker.on('error', () => this.fail(created));
        created.worker.on('exit', () => this.fail(created));
        created.worker.on('message', (message: unknown) => {
          const task = created.task;
          if (!task || !this.slots.has(created)) return;
          const parsed = responseSchema.safeParse(message);
          if (
            !parsed.success ||
            !parsed.data.ok ||
            typeof parsed.data.value !== (task.payload.operation === 'hash' ? 'string' : 'boolean')
          ) {
            this.fail(created);
            return;
          }
          clearTimeout(task.timer);
          created.task = undefined;
          task.resolve(parsed.data.value);
          created.worker.unref();
          this.dispatch();
        });
      }
      slot.task = this.queue.shift()!;
      slot.worker.ref();
      try {
        slot.worker.postMessage(slot.task.payload);
      } catch {
        this.fail(slot);
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.queue.splice(0)) {
      clearTimeout(task.timer);
      task.reject(new PasswordPoolError('CLOSED'));
    }
    for (const slot of this.slots) {
      if (slot.task) {
        clearTimeout(slot.task.timer);
        slot.task.reject(new PasswordPoolError('CLOSED'));
        slot.task = undefined;
      }
      this.remove(slot);
    }
    await Promise.all(this.terminating);
  }
}

export const passwordPool = new PasswordPool();
