import type { AiAttempt } from '../../shared/ai-management.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

type Job = { id: string; account: number | null; feature: string };
type Model = { name: string; model: string; provider?: string };
type Usage = { input: number; output: number; cost: number };
export const aiJob = new AsyncLocalStorage<Job>();

export function runAiJob<T>(account: number | null, feature: string, run: () => T) {
  return aiJob.run({ id: randomUUID(), account, feature }, run);
}

export function aiDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export class AiGuardError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 503 = 503
  ) {
    super(message);
  }
}

export function withAiLedger<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof AiGuardError) throw error;
    throw new AiGuardError('AI 用量账本不可用，调用已暂停。');
  }
}

export function createAiLedger(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL, budget INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO ai_settings VALUES (1, 1, 10000000);
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id TEXT PRIMARY KEY, account INTEGER, day TEXT NOT NULL, active_until INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_jobs_account_day ON ai_jobs(account, day);
    CREATE TABLE IF NOT EXISTS ai_attempts (
      id INTEGER PRIMARY KEY, job TEXT NOT NULL, account INTEGER, feature TEXT NOT NULL,
      day TEXT NOT NULL, started TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      status TEXT NOT NULL, reserved INTEGER NOT NULL, input INTEGER, output INTEGER, cost INTEGER
    );
    CREATE INDEX IF NOT EXISTS ai_attempts_day ON ai_attempts(day, id);
  `);

  function transaction<T>(run: () => T) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function settings() {
    return db.prepare('SELECT enabled, budget FROM ai_settings WHERE id = 1').get() as {
      enabled: number;
      budget: number;
    };
  }

  function summary(day: string) {
    return db
      .prepare(
        `
      SELECT COUNT(DISTINCT job) AS requests, COUNT(*) AS attempts,
        COALESCE(SUM(input), 0) AS input, COALESCE(SUM(output), 0) AS output,
        COALESCE(SUM(cost), 0) AS settled,
        COALESCE(SUM(CASE WHEN status IN ('running', 'unknown') THEN reserved ELSE 0 END), 0) AS pending
      FROM ai_attempts WHERE day = ?
    `
      )
      .get(day) as {
      requests: number;
      attempts: number;
      input: number;
      output: number;
      settled: number;
      pending: number;
    };
  }

  return {
    settings,
    summary,
    update(account: number, enabled: boolean, budget: number) {
      return transaction(() => {
        const previous = settings();
        db.prepare('UPDATE ai_settings SET enabled = ?, budget = ? WHERE id = 1').run(
          Number(enabled),
          budget
        );
        db.prepare(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
          VALUES (?, 'UPDATE_AI_SETTINGS', 'ai_settings', 1, ?)`
        ).run(
          account,
          JSON.stringify({
            from: { enabled: Boolean(previous.enabled), budgetYuan: previous.budget / 1_000_000 },
            to: { enabled, budgetYuan: budget / 1_000_000 },
          })
        );
      });
    },
    reserve(job: Job, model: Model, amount: number, timeout: number, clock = () => new Date()) {
      return transaction(() => {
        const { enabled, budget } = settings();
        if (!enabled) throw new AiGuardError('AI 服务已暂停。');
        const now = clock();
        const day = aiDate(now);
        const { settled, pending } = summary(day);
        if (amount > budget - settled - pending) throw new AiGuardError('今日 AI 预算不足。', 429);
        const active = now.getTime();
        if (job.account !== null) {
          if (
            db
              .prepare('SELECT 1 FROM ai_jobs WHERE account = ? AND active_until > ? AND id != ?')
              .get(job.account, active, job.id)
          )
            throw new AiGuardError('当前账号已有 AI 请求正在执行。', 429);
          if (!db.prepare('SELECT 1 FROM ai_jobs WHERE id = ?').get(job.id)) {
            const count = db
              .prepare('SELECT COUNT(*) AS total FROM ai_jobs WHERE account = ? AND day = ?')
              .get(job.account, day);
            if (Number(count?.total) >= 20)
              throw new AiGuardError('当前账号已达到今日 AI 请求上限。', 429);
          }
        }
        db.prepare(
          `INSERT INTO ai_jobs VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET active_until = excluded.active_until`
        ).run(job.id, job.account, day, active + timeout + 60_000);
        return db
          .prepare(
            `INSERT INTO ai_attempts
          (job, account, feature, day, started, provider, model, status, reserved)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`
          )
          .run(
            job.id,
            job.account,
            job.feature,
            day,
            now.toISOString(),
            model.provider ?? model.name,
            model.model,
            amount
          ).lastInsertRowid;
      });
    },
    finish(id: number | bigint, status: 'success' | 'failed' | 'unknown', usage?: Usage) {
      db.prepare(
        `UPDATE ai_attempts SET status = ?, input = ?, output = ?, cost = ?
        WHERE id = ? AND status = 'running'`
      ).run(status, usage?.input ?? null, usage?.output ?? null, usage?.cost ?? null, id);
    },
    release(job: Job) {
      db.prepare('UPDATE ai_jobs SET active_until = 0 WHERE id = ?').run(job.id);
    },
    list(day: string, account: string, feature: string, status: string, before: number) {
      return db
        .prepare(
          `
        SELECT a.id, job, a.account, u.username, feature, started, provider, model,
          CASE WHEN status = 'running' AND j.active_until <= ? THEN 'unknown' ELSE status END AS state,
          reserved, input, output, cost
        FROM ai_attempts a JOIN ai_jobs j ON a.job = j.id
        LEFT JOIN users u ON a.account = u.id
        WHERE a.day = ? AND (? = '' OR COALESCE(CAST(a.account AS TEXT), 'system') = ?)
          AND (? = '' OR feature = ?)
          AND (? = '' OR state = ?)
          AND (? = 0 OR a.id < ?)
        ORDER BY a.id DESC LIMIT 51
      `
        )
        .all(
          Date.now(),
          day,
          account,
          account,
          feature,
          feature,
          status,
          status,
          before,
          before
        ) as AiAttempt[];
    },
  };
}

let ledger: ReturnType<typeof createAiLedger> | undefined;

export function initializeAiLedger(db: DatabaseSync) {
  ledger = createAiLedger(db);
  return ledger;
}

export function currentAiLedger() {
  if (!ledger) throw new AiGuardError('AI 用量账本不可用，调用已暂停。');
  return ledger;
}
