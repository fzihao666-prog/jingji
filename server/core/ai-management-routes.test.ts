import express from 'express';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { aiDate, initializeAiLedger } from './ai-usage.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('./db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));

it('仅 DMD 可查看和调整全站预算，更新与审计同时落库', async () => {
  const db = new DatabaseSync(':memory:');
  fixture.db = db;
  vi.stubEnv('JWT_SECRET', 'synthetic-ai-management-test');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT,
      role TEXT, athlete_id INTEGER, active INTEGER, session_version INTEGER);
    INSERT INTO users VALUES (1, 'admin', '管理', 'DMD', NULL, 1, 1),
      (2, 'coach', '教练', 'SCC', NULL, 1, 1);
    CREATE TABLE audit_logs (user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER, detail TEXT);
  `);
  const ledger = initializeAiLedger(db);
  const job = { id: 'test', account: 2, feature: '体能建议' };
  const id = ledger.reserve(job, { name: 'Primary', model: 'test' }, 1000, 10000);
  ledger.finish(id, 'success', { input: 20, output: 10, cost: 100 });
  ledger.release(job);
  const { registerAiManagementRoutes } = await import('./ai-management-routes.ts');
  const app = express();
  app.use(express.json());
  registerAiManagementRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai-management`;
    const headers = (id: number) => ({
      Authorization: `Bearer ${jwt.sign({ id, role: 'DMD', sessionVersion: 1 }, 'synthetic-ai-management-test')}`,
      'Content-Type': 'application/json',
    });
    const update = (id: number, body: unknown) =>
      fetch(`${base}/settings`, {
        method: 'PUT',
        headers: headers(id),
        body: JSON.stringify(body),
      });
    expect((await fetch(base)).status).toBe(401);
    expect((await fetch(base, { headers: headers(2) })).status).toBe(403);
    expect((await update(2, { enabled: false, budgetYuan: 1 })).status).toBe(403);
    expect((await update(1, { enabled: false, budgetYuan: -1 })).status).toBe(400);
    const read = await fetch(`${base}?date=${aiDate()}&account=2&state=success`, {
      headers: headers(1),
    });
    expect(read.status).toBe(200);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(await read.json()).toMatchObject({
      settings: { enabled: true, budgetYuan: 10 },
      attempts: [{ account: 2, username: 'coach', cost: 100 }],
    });
    expect((await update(1, { enabled: false, budgetYuan: 1.23 })).status).toBe(200);
    expect(ledger.settings()).toEqual({ enabled: 0, budget: 1230000 });
    expect(db.prepare('SELECT user_id, entity_type FROM audit_logs').get()).toEqual({
      user_id: 1,
      entity_type: 'ai_settings',
    });
    expect(() =>
      ledger.reserve({ ...job, id: 'next' }, { name: 'Primary', model: 'test' }, 1, 10000)
    ).toThrow('已暂停');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    db.close();
    vi.unstubAllEnvs();
  }
});
