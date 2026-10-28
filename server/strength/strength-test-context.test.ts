import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({ get db() { return fixture.db; } }));
let db: DatabaseSync, server: Server, url: string;
const secret = 'synthetic-strength-context-test';
beforeEach(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:'); fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec(`INSERT INTO athletes(id,name,project) VALUES(9201,'合成测试人员','VOLLEYBALL');
    INSERT INTO users(id,username,password_hash,display_name,role) VALUES(9201,'strength_context','synthetic','合成管理员','DMD');
    INSERT INTO user_project_permissions(user_id,project,granted_by) VALUES(9201,'*',9201);
    INSERT INTO user_area_permissions(user_id,area_level,province,city,county,granted_by) VALUES(9201,'national','','','',9201);
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES(9201,'*','*',9201);`);
  const { registerStrengthTestRoutes } = await import('./strength-test-routes.ts');
  const app = express(); app.use(express.json()); registerStrengthTestRoutes(app);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  url = `http://127.0.0.1:${address.port}/api/strength-tests`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); vi.unstubAllEnvs(); });
function save(extra: Record<string, unknown> = {}) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: 9201, sessionVersion: 1 }, secret)}` },
    body: JSON.stringify({ athleteId: 9201, testDate: '2026-01-02', notes: 'CMJ', metrics: { verticalJumpCm: 40 }, targets: {}, ...extra }) });
}
it('手工创建保留完整协议身份，同日不同版本条件和试次不覆盖', async () => {
  for (const input of [ { protocolVersion: 'v1' }, { protocolVersion: 'v2' }, { protocolVersion: 'v2', contextKey: '疲劳后' }, { protocolVersion: 'v2', attemptOrder: 2 } ]) {
    expect((await save(input)).status).toBe(200);
  }
  expect(db.prepare('SELECT COUNT(*) AS n FROM test_sessions WHERE athlete_id=9201').get()).toEqual({ n: 4 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM test_measurements tm JOIN test_sessions ts ON ts.id=tm.test_session_id WHERE ts.athlete_id=9201').get()).toEqual({ n: 4 });
});
it('无协议的旧客户端仍可采集，非法试次和不存在的日期拒绝', async () => {
  expect((await save({ notes: '' })).status).toBe(200);
  expect((await save({ attemptOrder: 0 })).status).toBe(400);
  expect((await save({ testDate: '2026-02-31' })).status).toBe(400);
});

it('批量查询按周期过滤并拒绝任一无权限ID', async () => {
  await save({ testDate: '2026-01-02' });
  await save({ testDate: '2026-02-02' });
  const headers = { Authorization: `Bearer ${jwt.sign({ id: 9201, sessionVersion: 1 }, secret)}` };
  const response = await fetch(`${url}?athleteIds=9201&from=2026-01-01&to=2026-01-31`, { headers });
  expect(response.status).toBe(200);
  const data = z.object({ tests: z.array(z.object({ metrics: z.object({ verticalJumpCm: z.number() }) })) }).parse(await response.json());
  expect(data.tests).toHaveLength(1);
  expect(data.tests[0].metrics.verticalJumpCm).toBe(40);
  expect((await fetch(`${url}?athleteIds=9201,999999`, { headers })).status).toBe(403);
  expect((await fetch(`${url}?athleteIds=bad`, { headers })).status).toBe(400);
});
