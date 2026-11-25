import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import type { Server } from 'node:http';
import type { TeamPlan } from '../../shared/team-plan.ts';

const fixture = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  ids: [1, 2],
  role: 'SCC' as string,
  // AI 返回内容由测试逐场次控制。
  aiReply: null as unknown,
  onReply: null as (() => void) | null,
}));
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
vi.mock('../core/ai-client.ts', () => ({
  chatJson: async () => {
    const callback = fixture.onReply;
    fixture.onReply = null;
    callback?.();
    return { data: fixture.aiReply, modelUsed: 'Test (mock)' };
  },
  chatCompletion: async () => ({ content: '{}', modelUsed: 'Test (mock)' }),
  cleanJson: (text: string) => text,
  configuredModels: () => [],
}));

let server: Server;
let base: string;
beforeAll(async () => {
  const db = new DatabaseSync(':memory:');
  fixture.db = db;
  db.exec(
    `CREATE TABLE audit_logs(user_id INTEGER,action TEXT,entity_type TEXT,entity_id INTEGER,detail TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);
    CREATE TABLE project_teams(id INTEGER PRIMARY KEY,project TEXT,name TEXT,active INTEGER);
    INSERT INTO project_teams VALUES(1,'赛艇','队伍',1);
    CREATE TABLE athletes(id INTEGER PRIMARY KEY,name TEXT,team_id INTEGER,project TEXT,active INTEGER);
    INSERT INTO athletes VALUES(1,'甲',1,'赛艇',1),(2,'乙',1,'赛艇',1);
    CREATE TABLE training_plans(id INTEGER PRIMARY KEY,athlete_id INTEGER NOT NULL,plan_date TEXT,start_date TEXT,end_date TEXT,title TEXT,plan_data TEXT,ai_metadata TEXT,created_by INTEGER,updated_by INTEGER,updated_at TEXT,UNIQUE(athlete_id,plan_date));
    CREATE TABLE training_sessions(id INTEGER PRIMARY KEY,athlete_id INTEGER,session_date TEXT,session_order INTEGER DEFAULT 1,duration_min REAL DEFAULT 0,distance_km REAL DEFAULT 0,duration_reported INTEGER DEFAULT 1,distance_reported INTEGER DEFAULT 1,rpe REAL,srpe REAL DEFAULT 0,training_type TEXT DEFAULT '',structure_type TEXT DEFAULT '',intensity_zone TEXT DEFAULT '',content TEXT DEFAULT '',source TEXT DEFAULT 'manual',quality TEXT DEFAULT 'valid',is_demo INTEGER DEFAULT 0);
    CREATE TABLE daily_wellness(id INTEGER PRIMARY KEY,athlete_id INTEGER,wellness_date TEXT,sleep_hours REAL,morning_pulse REAL,fatigue_index REAL,status TEXT DEFAULT 'normal',quality TEXT DEFAULT 'valid',is_demo INTEGER DEFAULT 0);
    CREATE TABLE special_test_events(id INTEGER PRIMARY KEY,test_date TEXT,project TEXT,distance_m INTEGER,boat_class TEXT,gender_group TEXT,session TEXT DEFAULT '',created_by INTEGER DEFAULT 1);
    CREATE TABLE special_test_results(id INTEGER PRIMARY KEY,event_id INTEGER,crew_name TEXT,member_athlete_ids TEXT DEFAULT '[]',best_ms INTEGER,average_ms INTEGER);
    CREATE TABLE strength_result_sets(id INTEGER PRIMARY KEY,training_session_id INTEGER,exercise_name TEXT,set_index INTEGER,actual_reps REAL,actual_weight_kg REAL,completed INTEGER DEFAULT 1);`
  );
  const { migrateTeamPlans } = await import('../core/team-plan-migration.ts');
  migrateTeamPlans(db);
  const { initializeTeamPlanChecks } = await import('../core/team-plan-checks.ts');
  initializeTeamPlanChecks(db);
  const { registerTeamPlanAiRoutes } = await import('./team-plan-ai-routes.ts');
  const app = express();
  app.use(express.json());
  registerTeamPlanAiRoutes(app);
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
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    ...((await response.json()) as {
      plan: TeamPlan;
      diff: { added: unknown[]; removed: unknown[]; modified: unknown[]; personal?: unknown[] };
      checks: Array<{ sessionId: string; itemId: string; status: string; revision: number }>;
      check: { status: string; revision: number };
      dataNotes: string[];
      warnings: string[];
      message?: string;
    }),
  };
}

const aiSessions = (durationMin: number | null) => ({
  date: '2026-10-17',
  focus: '有氧耐力',
  goal: '阶段目标',
  dataNotes: ['晨检数据不足'],
  sessions: [
    {
      date: '2026-10-17',
      category: 'special',
      period: 'morning',
      content: '水上有氧训练',
      durationMin,
      distanceKm: 16,
      intensity: 'U2',
      notes: '',
      items: [
        { title: '热身', description: '低强度划行' },
        { title: '主训练', description: '持续划行' },
      ],
    },
    {
      date: '2026-10-17',
      category: 'physical',
      period: 'afternoon',
      content: '基础力量',
      durationMin: 60,
      intensity: '',
      notes: '',
    },
  ],
});

it('生成草稿、对话修改保留差异、撤销与逐项确认', async () => {
  fixture.ids = [1, 2];
  fixture.role = 'SCC';

  // 生成：写入草稿并返回数据缺失说明。
  fixture.aiReply = aiSessions(90);
  const generated = await call('/api/team-plans/ai/generate', {
    teamId: 1,
    date: '2026-10-17',
    constraints: '明天场地受限',
  });
  expect(generated.status).toBe(200);
  expect(generated.plan.status).toBe('draft');
  expect(generated.plan.data.sessions).toHaveLength(2);
  expect(generated.plan.data.sessions[0].items).toHaveLength(2);
  expect(generated.dataNotes).toEqual(['晨检数据不足']);
  const planId = generated.plan.id;

  // 重复生成复用草稿，不产生第二份。
  fixture.aiReply = aiSessions(80);
  const regenerated = await call('/api/team-plans/ai/generate', {
    teamId: 1,
    date: '2026-10-17',
  });
  expect(regenerated.status).toBe(200);
  expect(regenerated.plan.id).toBe(planId);
  expect(regenerated.plan.data.sessions[0].durationMin).toBe(80);

  // 对话修改：返回差异，未涉及的训练课保留。
  fixture.aiReply = aiSessions(60);
  const revised = await call(`/api/team-plans/ai/${planId}/revise`, {
    instruction: '上午训练量减少20%',
  });
  expect(revised.status).toBe(200);
  expect(revised.plan.data.sessions[0].durationMin).toBe(60);
  expect(revised.plan.data.sessions[1].content).toBe('基础力量');
  expect(revised.diff.modified).toHaveLength(1);

  // 撤销恢复上一版。
  const undone = await call(`/api/team-plans/ai/${planId}/undo`);
  expect(undone.status).toBe(200);
  expect(undone.plan.data.sessions[0].durationMin).toBe(80);

  // 发布前置：未发布计划不允许勾选。
  expect(
    (await call(`/api/team-plans/${planId}/checks`, { sessionId: 's1', status: 'executed' }, 'PUT'))
      .status
  ).toBe(409);

  // 手工把草稿置为已发布后逐项确认。
  fixture
    .db!.prepare("UPDATE training_plans SET status='published',published_at=? WHERE id=?")
    .run(new Date().toISOString(), planId);
  const checked = await call(
    `/api/team-plans/${planId}/checks`,
    { sessionId: 's1', itemId: 's1-1', status: 'executed', revision: 0 },
    'PUT'
  );
  expect(checked.status).toBe(200);
  expect(checked.check.status).toBe('executed');

  const listed = await call(`/api/team-plans/${planId}/checks`, undefined, 'GET');
  expect(listed.checks).toHaveLength(1);
  expect(listed.checks[0].itemId).toBe('s1-1');

  // 取消需填写原因。
  const noReason = await call(
    `/api/team-plans/${planId}/checks`,
    { sessionId: 's1', itemId: 's1-1', status: 'cancelled', revision: 1 },
    'PUT'
  );
  expect(noReason.status).toBe(400);

  const cancelled = await call(
    `/api/team-plans/${planId}/checks`,
    { sessionId: 's1', itemId: 's1-1', status: 'cancelled', reason: '大风取消', revision: 1 },
    'PUT'
  );
  expect(cancelled.status).toBe(200);
  expect(cancelled.check.status).toBe('cancelled');

  // 撤销勾选回到待执行。
  const reverted = await call(
    `/api/team-plans/${planId}/checks`,
    { sessionId: 's1', itemId: 's1-1', status: null, revision: 2 },
    'PUT'
  );
  expect(reverted.check.status).toBe('pending');

  // 并发版本不符拒绝覆盖。
  const stale = await call(
    `/api/team-plans/${planId}/checks`,
    { sessionId: 's1', itemId: 's1-1', status: 'executed', revision: 1 },
    'PUT'
  );
  expect(stale.status).toBe(400);
});

it('无队伍授权的教练与运动员不能生成或确认', async () => {
  fixture.ids = [9];
  expect(
    (await call('/api/team-plans/ai/generate', { teamId: 1, date: '2026-10-17' })).status
  ).toBe(400);
  fixture.ids = [1, 2];
  fixture.role = 'ATL';
  expect(
    (await call('/api/team-plans/ai/generate', { teamId: 1, date: '2026-10-17' })).status
  ).toBe(403);
});

it('AI摘要覆盖完整28天，缺失测量不冒充零，忽略目标日以后的周期', async () => {
  const { buildTeamAiContext } = await import('./team-plan-ai.ts');
  const db = fixture.db!;
  db.prepare(
    `INSERT INTO training_sessions(id,athlete_id,session_date,duration_min,distance_km,duration_reported,distance_reported,rpe,srpe) VALUES(900,1,'2026-09-19',0,0,0,0,NULL,NULL)`
  ).run();
  const context = buildTeamAiContext(db, { teamId: 1, date: '2026-10-17' });
  const days = context.dailyLoads as Array<Record<string, unknown>>;
  expect(days).toHaveLength(28);
  expect(days[0]).toMatchObject({
    date: '2026-09-19',
    sessions: 1,
    durationMin: null,
    distanceKm: null,
  });
  expect(days.at(-1)?.date).toBe('2026-10-16');
  expect(context.loadTrend).toMatchObject({
    recent7: { durationMin: null, distanceKm: null, load: null },
  });
  db.prepare('DELETE FROM training_sessions WHERE id=900').run();
});

it('教练指定个人减量复用现有差异，非本队调整失败保留上一版草稿', async () => {
  fixture.role = 'SCC';
  fixture.ids = [1, 2];
  const reply = aiSessions(90);
  fixture.aiReply = {
    ...reply,
    date: '2026-10-18',
    sessions: reply.sessions.map((session) => ({ ...session, date: '2026-10-18' })),
  };
  const generated = await call('/api/team-plans/ai/generate', { teamId: 1, date: '2026-10-18' });
  expect(generated.status).toBe(200);
  const base = fixture.aiReply as Record<string, unknown>;
  fixture.aiReply = {
    ...base,
    overrides: [
      { athleteId: 1, sessionId: 's1', changes: { durationMin: 45 }, reason: '教练要求减量' },
    ],
  };
  const revised = await call(`/api/team-plans/ai/${generated.plan.id}/revise`, {
    instruction: '甲上午减量到45分钟',
  });
  expect(revised.status).toBe(200);
  expect(revised.plan.data.overrides[0]).toMatchObject({
    athleteId: 1,
    changes: { durationMin: 45 },
    createdBy: 1,
  });
  expect(revised.plan.data.sessions[0].durationMin).toBe(90);
  expect(revised.diff.personal).toHaveLength(1);
  fixture.aiReply = {
    ...base,
    overrides: [
      { athleteId: 999, sessionId: 's1', changes: { durationMin: 30 }, reason: '错误队员' },
    ],
  };
  const denied = await call(`/api/team-plans/ai/${generated.plan.id}/revise`, {
    instruction: '再调整',
  });
  expect(denied.status).not.toBe(200);
  const saved = JSON.parse(
    (
      fixture
        .db!.prepare('SELECT plan_data FROM training_plans WHERE id=?')
        .get(generated.plan.id) as { plan_data: string }
    ).plan_data
  );
  expect(saved.overrides[0].changes.durationMin).toBe(45);
});

it('AI生成期间人工修改草稿时拒绝覆盖', async () => {
  const reply = aiSessions(90);
  fixture.aiReply = {
    ...reply,
    date: '2026-10-19',
    sessions: reply.sessions.map((session) => ({ ...session, date: '2026-10-19' })),
  };
  const generated = await call('/api/team-plans/ai/generate', { teamId: 1, date: '2026-10-19' });
  expect(generated.status).toBe(200);
  fixture.onReply = () => {
    const data = structuredClone(generated.plan.data);
    data.sessions[0].durationMin = 75;
    fixture
      .db!.prepare('UPDATE training_plans SET plan_data=?,revision=revision+1 WHERE id=?')
      .run(JSON.stringify(data), generated.plan.id);
  };
  const revised = await call(`/api/team-plans/ai/${generated.plan.id}/revise`, {
    instruction: '修改上午训练',
  });
  expect(revised.status).not.toBe(200);
  const row = fixture
    .db!.prepare('SELECT plan_data FROM training_plans WHERE id=?')
    .get(generated.plan.id) as { plan_data: string };
  expect(JSON.parse(row.plan_data).sessions[0].durationMin).toBe(75);
});
