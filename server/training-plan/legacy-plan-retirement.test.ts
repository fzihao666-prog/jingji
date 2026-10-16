import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import type { Server } from 'node:http';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
vi.mock('../core/auth.ts', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { authUser: { id: 9001, role: 'SCC', athleteId: 9001 } });
    next();
  },
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
vi.mock('../core/permissions.ts', () => ({
  hasAthleteAccess: () => true,
  accessibleAthleteIds: () => [9001],
  accountPermissions: () => ({ areas: [], projects: [], teams: [] }),
}));
let server: Server;
let base: string;
beforeAll(async () => {
  const db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec(
    `INSERT INTO athletes(id,name,project) VALUES(9001,'合成测试','ROWING');INSERT INTO users(id,username,password_hash,display_name,role) VALUES(9001,'synthetic_retirement','synthetic_hash','合成测试','SCC');`
  );
  db.prepare(
    `INSERT INTO training_plans(id,athlete_id,plan_date,plan_data,created_by,updated_by,model) VALUES(9001,9001,'test','{}',9001,9001,'team')`
  ).run();
  const { registerTrainingPlanRoutes } = await import('./training-plan-routes.ts');
  const app = express();
  app.use(express.json());
  registerTrainingPlanRoutes(app);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fixture.db?.close();
});
it('旧个人写入和AI入口返回410，不能覆盖或删除队伍版本', async () => {
  for (const [method, path] of [
    ['POST', ''],
    ['DELETE', '/9001'],
    ['POST', '/ai/analyze'],
    ['POST', '/ai/save'],
  ]) {
    const response = await fetch(base + '/api/training-plans' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId: 9001, planId: 9001, data: {} }),
    });
    expect(response.status).toBe(410);
  }
  expect(
    fixture.db!.prepare('SELECT model,plan_data FROM training_plans WHERE id=9001').get()
  ).toMatchObject({ model: 'team', plan_data: '{}' });
});
it('旧个人列表、目录和导出不泄漏队伍草稿', async () => {
  const list = await (await fetch(base + '/api/training-plans?athleteId=9001')).json();
  expect(list).toMatchObject({ plans: [] });
  const catalog = await (await fetch(base + '/api/training-plans/catalog')).json();
  expect(catalog).toMatchObject({ plans: [] });
  expect((await fetch(base + '/api/training-plans/9001/export')).status).toBe(404);
});
