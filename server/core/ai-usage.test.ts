import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createAiLedger } from './ai-usage.ts';

describe('AI 预算账本', () => {
  it('跨连接共享预算和账号并发，待确认占用继续计入预算', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jingji-ai-ledger-'));
    const path = join(directory, 'ledger.sqlite');
    const db = new DatabaseSync(path);
    const other = new DatabaseSync(path);
    try {
      const ledger = createAiLedger(db);
      const otherLedger = createAiLedger(other);
      const now = new Date('2026-11-06T15:59:59Z');
      const model = {
        name: 'Primary',
        model: 'test',
        pricing: { input: 2, output: 4, context: 100000 },
      };
      const job = { id: 'first', account: 1, feature: '体能建议' };
      const id = ledger.reserve(job, model, 8_000_000, 10000, () => now);
      expect(() =>
        otherLedger.reserve({ ...job, id: 'parallel' }, model, 1, 10000, () => now)
      ).toThrow('正在执行');
      expect(() =>
        otherLedger.reserve({ ...job, id: 'other', account: 2 }, model, 3_000_000, 10000, () => now)
      ).toThrow('预算');
      ledger.finish(id, 'unknown');
      ledger.release(job);
      expect(() =>
        ledger.reserve({ ...job, id: 'next' }, model, 3_000_000, 10000, () => now)
      ).toThrow('预算');
      expect(ledger.summary('2026-11-06').pending).toBe(8_000_000);
      expect(ledger.summary('2026-11-07').pending).toBe(0);
    } finally {
      other.close();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

it('每日每账号只允许二十次，备用模型共用请求编号，跨零点结算仍归原日', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const ledger = createAiLedger(db);
    const model = { name: 'Primary', model: 'test' };
    const now = new Date('2026-11-06T15:59:59Z');
    const tomorrow = new Date('2026-11-06T16:00:00Z');
    for (let index = 0; index < 20; index++) {
      const job = { id: String(index), account: 7, feature: '体能建议' };
      const id = ledger.reserve(job, model, 100, 1000, () => now);
      ledger.finish(id, 'success', { input: 2, output: 1, cost: 7 });
      if (index === 19) {
        const fallback = ledger.reserve(job, model, 100, 1000, () => now);
        ledger.finish(fallback, 'success', { input: 2, output: 1, cost: 7 });
      }
      ledger.release(job);
    }
    const next = { id: 'next', account: 7, feature: '体能建议' };
    expect(() => ledger.reserve(next, model, 100, 1000, () => now)).toThrow('今日 AI 请求上限');
    ledger.reserve(next, model, 100, 1000, () => tomorrow);
    expect(ledger.summary('2026-11-06')).toMatchObject({
      requests: 20,
      attempts: 21,
      settled: 147,
    });
    expect(ledger.summary('2026-11-07')).toMatchObject({ requests: 1, attempts: 1, pending: 100 });
  } finally {
    db.close();
  }
});
