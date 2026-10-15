import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
import type { SpecialTestImportRow } from '../core/shared-server.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));

let db: DatabaseSync;
let server: Server;
let baseUrl: string;
let specialTestImportCache: Map<
  string,
  { ownerId: number; rows: SpecialTestImportRow[]; expiresAt: number }
>;
const secret = 'synthetic-special-test-scope-secret';
const options = { databasePath: ':memory:', databaseExistedBeforeStartup: true };
const coachA = 9301;
const coachB = 9302;

function token(userId: number) {
  return jwt.sign({ id: userId, sessionVersion: 1 }, secret);
}

async function json(path: string, method: string, body: unknown, userId: number) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(userId)}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, payload };
}

function importRow(
  crewName: string,
  memberAthleteIds: number[],
  memberNames: string[],
  bestMs: number,
  rowNumber = 1
): SpecialTestImportRow {
  return {
    rowNumber,
    testDate: '2026-07-28',
    project: 'ROWING',
    distanceM: 250,
    boatClass: '单人艇',
    genderGroup: '男子组',
    crewName,
    memberAthleteIds,
    memberNames,
    session: '下午',
    windConditions: '顶风1级',
    location: '训练基地',
    note: '',
    previousBestMs: null,
    attemptsMs: [bestMs],
    averageMs: bestMs,
    bestMs,
    errors: [],
    warnings: [],
  };
}

let importSeq = 0;
async function commitAs(userId: number, rows: SpecialTestImportRow[]) {
  const importId = `synthetic_import_${userId}_${(importSeq += 1)}`;
  specialTestImportCache.set(importId, { ownerId: userId, rows, expiresAt: Date.now() + 60_000 });
  return json('/api/special-tests/import/commit', 'POST', { importId }, userId);
}

function manualAs(
  userId: number,
  row: { crewName: string; memberAthleteIds: number[]; attemptsText: string[] }
) {
  return json(
    '/api/special-tests/manual',
    'POST',
    {
      project: 'ROWING',
      testDate: '2026-07-28',
      distanceM: 250,
      boatClass: '单人艇',
      genderGroup: '男子组',
      session: '下午',
      ...row,
    },
    userId
  );
}

function savedResults() {
  return db
    .prepare(
      'SELECT crew_name AS crewName, member_athlete_ids AS memberAthleteIds, best_ms AS bestMs FROM special_test_results ORDER BY id'
    )
    .all() as Array<{ crewName: string; memberAthleteIds: string; bestMs: number }>;
}

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, options);
  db.exec('DELETE FROM special_test_results; DELETE FROM special_test_events;');
  db.prepare(
    `INSERT INTO project_teams (id, project, name, active, created_at) VALUES
      (101, 'ROWING', '甲队', 1, CURRENT_TIMESTAMP), (102, 'ROWING', '乙队', 1, CURRENT_TIMESTAMP)`
  ).run();
  db.prepare(
    `INSERT INTO athletes (id, name, project, team_id, active) VALUES
      (9101, '测试甲桨手A', 'ROWING', 101, 1),
      (9102, '测试甲桨手B', 'ROWING', 101, 1),
      (9201, '测试乙桨手A', 'ROWING', 102, 1)`
  ).run();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, active, session_version) VALUES
      (9301, 'synthetic_coach_a', 'synthetic_hash', '合成甲队教练', 'SCC', 1, 1),
      (9302, 'synthetic_coach_b', 'synthetic_hash', '合成乙队教练', 'SCC', 1, 1)`
  ).run();
  db.prepare(
    `INSERT INTO user_project_permissions (user_id, project, granted_by, created_at) VALUES
      (9301, 'ROWING', 9301, CURRENT_TIMESTAMP), (9302, 'ROWING', 9302, CURRENT_TIMESTAMP)`
  ).run();
  db.prepare(
    `INSERT INTO user_team_permissions (user_id, project, team, granted_by, created_at) VALUES
      (9301, 'ROWING', '甲队', 9301, CURRENT_TIMESTAMP), (9302, 'ROWING', '乙队', 9302, CURRENT_TIMESTAMP)`
  ).run();
  const routes = await import('./special-training-routes.ts');
  specialTestImportCache = routes.specialTestImportCache;
  const app = express();
  app.use(express.json());
  routes.registerSpecialTrainingRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  db.exec('DELETE FROM special_test_results; DELETE FROM special_test_events;');
  specialTestImportCache.clear();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});

describe('专项测试成绩保存的范围保护', () => {
  it('部分导入只替换同名组合成绩，不删除未提及的既有成绩', async () => {
    const first = await commitAs(coachA, [
      importRow('甲一', [9101], ['测试甲桨手A'], 57150, 1),
      importRow('甲二', [9102], ['测试甲桨手B'], 59030, 2),
    ]);
    expect(first.status).toBe(200);
    expect(first.payload.imported).toBe(2);
    const second = await commitAs(coachA, [
      importRow('甲二', [9102], ['测试甲桨手B'], 58000, 1),
    ]);
    expect(second.payload.imported).toBe(1);
    const rows = savedResults();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.crewName === '甲一')?.bestMs).toBe(57150);
    expect(rows.find((row) => row.crewName === '甲二')?.bestMs).toBe(58000);
  });

  it('跨队伍同名组合导入不覆盖范围外成绩，冲突行跳过并提示', async () => {
    await commitAs(coachA, [importRow('甲一', [9101], ['测试甲桨手A'], 57150)]);
    const response = await commitAs(coachB, [
      importRow('甲一', [9201], ['测试乙桨手A'], 56000),
    ]);
    expect(response.status).toBe(200);
    expect(response.payload.imported).toBe(0);
    expect(response.payload.conflicts).toEqual([{ rowNumber: 1, crewName: '甲一' }]);
    const rows = savedResults();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].memberAthleteIds)).toEqual([9101]);
    expect(rows[0].bestMs).toBe(57150);
  });

  it('导入行成员不在当前账户范围时跳过且不写入', async () => {
    const response = await commitAs(coachA, [
      importRow('越权艇', [9201], ['测试乙桨手A'], 56000),
    ]);
    expect(response.payload.imported).toBe(0);
    expect(response.payload.conflicts).toEqual([{ rowNumber: 1, crewName: '越权艇' }]);
    expect(savedResults()).toHaveLength(0);
  });

  it('手工录入同名组合撞名返回409且不改动原成绩，本人重录仍幂等覆盖', async () => {
    await commitAs(coachA, [importRow('甲一', [9101], ['测试甲桨手A'], 57150)]);
    const conflict = await manualAs(coachB, {
      crewName: '甲一',
      memberAthleteIds: [9201],
      attemptsText: ['0:56.00'],
    });
    expect(conflict.status).toBe(409);
    let rows = savedResults();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].memberAthleteIds)).toEqual([9101]);
    expect(rows[0].bestMs).toBe(57150);
    const own = await manualAs(coachA, {
      crewName: '甲一',
      memberAthleteIds: [9101],
      attemptsText: ['0:55.90'],
    });
    expect(own.status).toBe(201);
    rows = savedResults();
    expect(rows).toHaveLength(1);
    expect(rows[0].bestMs).toBe(55900);
  });
});
