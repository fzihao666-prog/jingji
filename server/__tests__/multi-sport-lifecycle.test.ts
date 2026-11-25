import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import * as XLSX from '@e965/xlsx';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TeamPlan } from '../../shared/team-plan.ts';
import { reportDataSchema } from '../../shared/training-report.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
import { readPlanExecution } from '../core/plan-execution.ts';
import { sessionSchema, listSessions } from '../athlete/training-session-service.ts';
import { submitSelfTraining } from '../athlete/training-submission-service.ts';
import { analyzeDataImport, commitDataImport } from '../data-import/data-import.ts';
import { readTeamPlansForAthlete } from '../training-plan/team-plan-service.ts';
import { readReport } from '../report/report-service.ts';

// 此集成测试只替换身份入口；计划路由、领域校验、事务与事实读取均运行真实实现。
const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null, athleteId: 91001, userId: 91001 }));
vi.mock('../core/db.ts', () => ({ get db() { return fixture.db; } }));
vi.mock('../core/permissions.ts', () => ({ accessibleAthleteIds: () => [fixture.athleteId] }));
vi.mock('../core/auth.ts', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { authUser: { id: fixture.userId, role: 'SCC' } }); next();
  },
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
let db: DatabaseSync;
let server: Server;
let baseUrl: string;
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

beforeAll(async () => {
  const { registerTeamPlanRoutes } = await import('../training-plan/team-plan-routes.ts');
  const app = express(); app.use(express.json()); registerTeamPlanRoutes(app);
  server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('隔离测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  db = new DatabaseSync(':memory:'); fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: false });
});
afterEach(() => { db.close(); fixture.db = null; });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

async function writePlan(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/team-plans${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json() as { plan: TeamPlan; message?: string };
  expect(response.status, result.message).toBe(200);
  return result.plan;
}

it.each([
  ['ROWING', 'on_water'], ['CANOE_SPRINT', 'on_water'], ['CANOE_SLALOM', 'on_water'],
  ['CYCLING_ROAD', 'cycling'], ['CYCLING_TRACK', 'cycling'], ['VOLLEYBALL', 'volleyball_technique'],
])('%s建档、发布计划、关联训练、导入测试及版本2报告共享正式事实', async (project, activityCode) => {
  // 合成人员为隔离库夹具；不通过注册接口，不测试真实身份认证。
  const athleteId = fixture.athleteId;
  const teamId = 91001;
  const athleteName = '合成闭环运动员';
  db.prepare('INSERT INTO project_teams(id,project,name) VALUES(?,?,?)').run(teamId, project, '合成闭环队');
  db.prepare('INSERT INTO athletes(id,name,project,team,team_id,gender) VALUES(?,?,?,?,?,?)').run(athleteId, athleteName, project, '合成闭环队', teamId, '男');
  db.prepare("INSERT INTO users(id,username,password_hash,display_name,role,athlete_id) VALUES(?,?,'fixture_hash','合成闭环教练','SCC',?)").run(fixture.userId, `lifecycle_${project}`, athleteId);
  const data = {
    goal: '合成计划目标', focus: '专项训练',
    sessions: [{ id: 'am', date, category: 'special', activityCode, intensitySystem: '', period: '上午', content: '合成专项课', durationMin: 90, distanceKm: null, intensity: '', sets: null, reps: null, load: null, notes: '' }],
    overrides: [{ athleteId, sessionId: 'am', changes: { durationMin: 60 }, reason: '合成人员目标调整' }],
  };
  const draft = await writePlan('', { teamId, title: '合成闭环计划', startDate: date, endDate: date, data });
  expect(draft.status).toBe('draft');
  const pending = await writePlan(`/${draft.id}/transition`, { revision: draft.revision, action: 'submit' });
  const published = await writePlan(`/${draft.id}/transition`, { revision: pending.revision, action: 'publish', confirmed: true });
  expect(published.status).toBe('published');
  expect(readTeamPlansForAthlete(db, athleteId).map(plan => plan.id)).toEqual([published.id]);

  const input = sessionSchema.parse({ date, startTime: '09:00', trainingType: '专项训练', activityCode, content: '合成专项课', duration: 60, rpe: 5, teamPlanId: published.id, planSessionId: 'am' });
  const created = submitSelfTraining(athleteId, fixture.userId, input, `lifecycle_${project}_0001`);
  expect(created.session).toMatchObject({ projectCode: project, activityCode, teamPlanId: published.id, planSessionId: 'am' });
  expect(listSessions(athleteId)).toHaveLength(1);
  const link = db.prepare('SELECT plan_id,session_id,target_json FROM training_plan_execution_links WHERE training_session_id=?').get(created.session.id) as { plan_id: number; session_id: string; target_json: string };
  expect(link).toMatchObject({ plan_id: published.id, session_id: 'am' });
  expect(JSON.parse(link.target_json)).toMatchObject({ id: 'am', activityCode, durationMin: 60 });
  const execution = readPlanExecution(db, { athleteIds: [athleteId], project, now: new Date(`${date}T12:00:00+08:00`) });
  expect(execution.athletes[0].lessonExecution[0]).toMatchObject({ status: 'complete', completionRate: 1, target: { durationMin: 60 } });

  db.prepare("INSERT INTO metric_definitions(code,label,domain,unit,direction,frequency,projects_json) VALUES('lifecycle_measurement','合成公共测量','custom','cm','neutral','phase','[]')").run();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['姓名', '测试日期', '指标代码', '数值', '单位', '协议'], [athleteName, date, 'lifecycle_measurement', 42, 'cm', '合成公共协议'],
  ]), '其他测试');
  const athletes = [{ id: athleteId, name: athleteName, project, team: '合成闭环队', gender: '男' }];
  const batch = analyzeDataImport({ buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), filename: `${project}合成闭环.xlsx`, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project, userId: fixture.userId, athletes, allowedTeams: new Set(['合成闭环队']) });
  expect(batch.errorCount).toBe(0);
  expect(commitDataImport({ batchId: batch.id, userId: fixture.userId, creatorRole: 'SCC', athletes, conflictPolicy: 'update', allowedTeams: new Set(['合成闭环队']) }).createdRecords).toBe(1);

  const report = reportDataSchema.parse(readReport(db, athleteId, project, { from: date, to: date, kind: 'custom' }));
  expect(report).toMatchObject({ version: 2, project, totals: { sessions: 1, duration: 60, srpe: 300 } });
  expect(report.tests).toHaveLength(1);
  expect(report.tests[0]).toMatchObject({ unit: 'cm', protocol: '合成公共协议', points: [{ date, value: 42 }] });
  expect(db.prepare('SELECT plan_id,session_id FROM training_plan_execution_links WHERE training_session_id=?').get(created.session.id)).toEqual({ plan_id: published.id, session_id: 'am' });
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
