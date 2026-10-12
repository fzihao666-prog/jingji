import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
import { idempotencyKeySchema } from './training-submission-service.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({ get db() { return fixture.db; } }));
let db: DatabaseSync;
let server: Server;
let baseUrl: string;
const secret = 'synthetic-self-training-idempotency-secret';
const key = 'training_retry_key_0001';
const payload = { date: '2026-10-10', startTime: '08:00', trainingType: '专项训练',
  intensityZone: 'U2', content: '测试训练', duration: 60, rpe: 5 };
const options = { databasePath: ':memory:', databaseExistedBeforeStartup: true };
function post(body: unknown = payload, requestKey: string | null = key, userId = 9001) {
  return fetch(`${baseUrl}/api/me/training-sessions`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: userId, sessionVersion: 1 }, secret)}`,
    ...(requestKey === null ? {} : { 'Idempotency-Key': requestKey }),
  }, body: JSON.stringify(body) });
}
function count(table: 'training_sessions' | 'training_submission_keys') {
  return (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;
}
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, options);
  db.exec("DELETE FROM strength_result_sets; DELETE FROM training_sessions;");
  for (const id of [9001, 9002]) {
    db.prepare('INSERT INTO athletes (id, name, project) VALUES (?, ?, ?)').run(id, `合成测试运动员${id}`, 'ROWING');
    db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role, athlete_id)
      VALUES (?, ?, 'synthetic_hash', '合成测试账号', 'ATL', ?)`).run(id, `synthetic_${id}`, id);
  }
  const { registerSelfTrainingRoutes } = await import('./self-training-routes.ts');
  const app = express(); app.use(express.json()); registerSelfTrainingRoutes(app);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: '测试内部错误' });
  });
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  db.exec('DELETE FROM training_sessions;');
  db.exec('DELETE FROM training_submission_keys');
  db.exec('UPDATE users SET active = 1, athlete_id = id WHERE id IN (9001, 9002)');
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); vi.unstubAllEnvs(); });

describe('训练填报幂等接口', () => {
  it('key格式保留大小写，接受边界长度且拒绝空白和非ASCII字符', () => {
    expect(idempotencyKeySchema.parse('Abc_0123456789-XY')).toBe('Abc_0123456789-XY');
    expect(idempotencyKeySchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('invalid_key_has_中文').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('').success).toBe(false);
    expect(idempotencyKeySchema.safeParse(' '.repeat(16)).success).toBe(false);
  });
  it('50 个并发相同 key 只写入一条并返回相同的201快照', async () => {
    const responses = await Promise.all(Array.from({ length: 50 }, () => post()));
    expect(responses.map((r) => r.status)).toEqual(Array(50).fill(201));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(count('training_sessions')).toBe(1);
    expect(count('training_submission_keys')).toBe(1);
  });
  it('不同key、不同账号和无key各自允许相同内容', async () => {
    expect((await post()).status).toBe(201);
    expect((await post(payload, 'training_retry_key_0002')).status).toBe(201);
    expect((await post(payload, key, 9002)).status).toBe(201);
    expect((await post(payload, null)).status).toBe(201);
    expect((await post(payload, null)).status).toBe(201);
    expect(count('training_sessions')).toBe(5);
  });
  it.each(['short', 'x'.repeat(129), 'invalid key_000000', 'invalid_key_000!'])('拒绝非法key：%s', async (requestKey) => {
    const response = await post(payload, requestKey);
    expect(response.status).toBe(400); expect(count('training_sessions')).toBe(0);
  });
  it('规范化等价内容重放，改变内容冲突409且不写入', async () => {
    const first = await (await post()).json();
    const replay = await post({ ...payload, content: ' 测试训练 ', duration: '60', rpe: '5', distance: '' });
    expect(replay.status).toBe(201); expect(await replay.json()).toEqual(first);
    expect((await post({ ...payload, duration: 61 })).status).toBe(409);
    expect(count('training_sessions')).toBe(1);
  });
  it('编辑或删除训练后仍返回原快照且不新增', async () => {
    const first = await (await post()).json();
    db.exec("UPDATE training_sessions SET content = '已编辑'");
    expect(await (await post()).json()).toEqual(first);
    db.exec('DELETE FROM training_sessions');
    expect(await (await post()).json()).toEqual(first);
    expect(count('training_sessions')).toBe(0);
  });
  it('重放仍校验登录、归属和内容结构', async () => {
    await post();
    db.exec('UPDATE users SET active = 0 WHERE id = 9001');
    expect((await post()).status).toBe(401);
    db.exec('UPDATE users SET active = 1, athlete_id = 9002 WHERE id = 9001');
    expect((await post()).status).toBe(409);
    db.exec('UPDATE users SET athlete_id = NULL WHERE id = 9001');
    expect((await post()).status).toBe(403);
    db.exec('UPDATE users SET athlete_id = 9001 WHERE id = 9001');
    expect((await post({ ...payload, rpe: 50 })).status).toBe(400);
  });
  it('幂等记录写入失败时训练与key一起回滚并允许重试', async () => {
    db.exec(`CREATE TRIGGER reject_submission_key BEFORE INSERT ON training_submission_keys
      BEGIN SELECT RAISE(ABORT, '模拟幂等记录失败'); END;`);
    try {
      expect((await post()).status).toBe(500);
      expect(count('training_sessions')).toBe(0); expect(count('training_submission_keys')).toBe(0);
      expect(db.isTransaction).toBe(false);
    } finally { db.exec('DROP TRIGGER reject_submission_key'); }
    expect((await post()).status).toBe(201);
  });
  it('已有训练数据库升级创建幂等表并保留训练', async () => {
    const first = z.object({ session: z.object({ id: z.number().int().positive() }) }).parse(await (await post()).json());
    db.exec('DROP TABLE training_submission_keys');
    initializeDatabase(db, options);
    expect(count('training_submission_keys')).toBe(0);
    expect(db.prepare('SELECT id FROM training_sessions WHERE id = ?').get(first.session.id)).toEqual({ id: first.session.id });
    expect((await post(payload, 'training_after_migration')).status).toBe(201);
  });
  it('数据库重复初始化保留已提交幂等记录和训练', async () => {
    const first = await (await post()).json();
    initializeDatabase(db, options);
    expect(count('training_submission_keys')).toBe(1);
    expect(await (await post()).json()).toEqual(first);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
