import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import type { Server } from 'node:http';
import type { TeamPlan } from '../../shared/team-plan.ts';
const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null, ids: [1, 2], role: 'SCC' }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
vi.mock('../core/permissions.ts', () => ({ accessibleAthleteIds: () => fixture.ids }));
vi.mock('../core/auth.ts', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { authUser: { id: 1, role: fixture.role, athleteId: 1 } });
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!roles.includes(fixture.role)) return res.status(403).json({ message: '无权维护计划' });
      next();
    },
}));
let server: Server;
let base: string;
beforeAll(async () => {
  const db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(
    `CREATE TABLE audit_logs(user_id INTEGER,action TEXT,entity_type TEXT,entity_id INTEGER,detail TEXT);CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE project_teams(id INTEGER PRIMARY KEY,project TEXT,name TEXT,active INTEGER);INSERT INTO project_teams VALUES(1,'赛艇','队伍',1);CREATE TABLE athletes(id INTEGER PRIMARY KEY,name TEXT,team_id INTEGER,project TEXT,active INTEGER);INSERT INTO athletes VALUES(1,'甲',1,'赛艇',1),(2,'乙',1,'赛艇',1);CREATE TABLE training_plans(id INTEGER PRIMARY KEY,athlete_id INTEGER NOT NULL,plan_date TEXT,start_date TEXT,end_date TEXT,title TEXT,plan_data TEXT,created_by INTEGER,updated_by INTEGER,updated_at TEXT,UNIQUE(athlete_id,plan_date));`
  );
  const { migrateTeamPlans } = await import('../core/team-plan-migration.ts');
  migrateTeamPlans(db);
  const { registerTeamPlanRoutes } = await import('./team-plan-routes.ts');
  const app = express();
  app.use(express.json());
  registerTeamPlanRoutes(app);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fixture.db?.close();
});
async function call(path: string, body?: unknown, method = 'POST') {
  const response = await fetch(base + '/api/team-plans' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    ...((await response.json()) as { plan: TeamPlan; plans: TeamPlan[]; message?: string }),
  };
}
const data = {
  goal: '',
  focus: '',
  sessions: [
    {
      id: 's',
      date: '2026-10-17',
      category: 'special',
      content: '训练',
      durationMin: 90,
      distanceKm: 16,
    },
  ],
  overrides: [
    { athleteId: 1, sessionId: 's', changes: { durationMin: 60 }, reason: '减量' },
    { athleteId: 2, sessionId: 's', changes: { durationMin: 70 }, reason: '调整' },
  ],
};
it('整队授权、草稿隔离、CAS、确认发布和修订版本保留', async () => {
  fixture.ids = [1];
  expect(
    (
      await call('', {
        teamId: 1,
        title: '队伍',
        startDate: '2026-10-17',
        endDate: '2026-10-17',
        data,
      })
    ).status
  ).toBe(403);
  fixture.ids = [1, 2];
  const created = await call('', {
    teamId: 1,
    title: '队伍',
    startDate: '2026-10-17',
    endDate: '2026-10-17',
    data,
  });
  expect(created.status).toBe(200);
  const id = created.plan.id;
  fixture.role = 'ATL';
  fixture.ids = [1];
  expect((await call('', undefined, 'GET')).plans).toHaveLength(0);
  expect((await call(`/${id}/transition`, { revision: 1, action: 'submit' })).status).toBe(403);
  fixture.role = 'SCC';
  fixture.ids = [1, 2];
  expect((await call(`/${id}/transition`, { revision: 99, action: 'submit' })).status).toBe(409);
  expect((await call(`/${id}/transition`, { revision: 1, action: 'submit' })).plan.status).toBe(
    'pending'
  );
  expect((await call(`/${id}/transition`, { revision: 2, action: 'publish' })).status).toBe(409);
  expect(
    (await call(`/${id}/transition`, { revision: 2, action: 'publish', confirmed: true })).plan
      .status
  ).toBe('published');
  fixture.role = 'ATL';
  fixture.ids = [1];
  expect((await call('', undefined, 'GET')).plans[0].data.overrides).toHaveLength(1);
  fixture.role = 'SCC';
  fixture.ids = [1, 2];
  const revised = await call(`/${id}/transition`, { revision: 3, action: 'revise' });
  expect(revised.plan.version).toBe(2);
  await call(`/${revised.plan.id}/transition`, { revision: 1, action: 'submit' });
  await call(`/${revised.plan.id}/transition`, { revision: 2, action: 'publish', confirmed: true });
  const plans = (await call('', undefined, 'GET')).plans;
  expect(plans.find((p: { id: number }) => p.id === id)?.status).toBe('archived');
  expect(plans).toHaveLength(2);
  expect(plans.find((plan) => plan.id === id)?.archivedAt).toBeTruthy();
  expect(fixture.db?.prepare('SELECT count(*) AS n FROM audit_logs').get()).toEqual({ n: 6 });
  expect((await call(`/${id}/transition`, { revision: -1, action: 'submit' })).status).toBe(400);
  expect((await call('/bad/transition', { revision: 1, action: 'submit' })).status).toBe(400);
});
