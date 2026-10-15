import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
import type { SpecialTestImportRow } from '../core/shared-server.ts';

// 路由模块在加载时会读取 db；用 hoisted fixture 把它替换成内存库，既隔离正式数据，
// 又让请求经过真实的路由、鉴权、权限判断和 SQL，而不是只测试某个内部函数。
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
  // 每次请求都签发对应教练的 token，用不同身份穿过真实鉴权中间件。
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
  // 固定“同一测试事件”的其他维度，只改变组合、成员和成绩，便于精确观察覆盖边界。
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
  // 省略 Excel 解析阶段，直接构造 preview 后的缓存；本文件专注验证 commit 的权限与写库行为。
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
  // 两名教练都能访问 ROWING 项目，但分别只能访问甲队、乙队；这是后续越权场景的关键夹具。
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
    // 使用随机空闲端口，避免与本机开发服务或并行测试争抢固定端口。
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  // 每个用例从空结果表和空导入缓存开始，避免执行顺序影响测试结论。
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
    // Arrange：同一事件先保存两个组合。
    const first = await commitAs(coachA, [
      importRow('甲一', [9101], ['测试甲桨手A'], 57150, 1),
      importRow('甲二', [9102], ['测试甲桨手B'], 59030, 2),
    ]);
    expect(first.status).toBe(200);
    expect(first.payload.imported).toBe(2);
    // Act：第二次导入只携带“甲二”，模拟用户上传局部更新文件。
    const second = await commitAs(coachA, [
      importRow('甲二', [9102], ['测试甲桨手B'], 58000, 1),
    ]);
    expect(second.payload.imported).toBe(1);
    // Assert：“甲一”应保留，“甲二”应覆盖，防止实现误删整个事件下的成绩。
    const rows = savedResults();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.crewName === '甲一')?.bestMs).toBe(57150);
    expect(rows.find((row) => row.crewName === '甲二')?.bestMs).toBe(58000);
  });

  it('跨队伍同名组合导入不覆盖范围外成绩，冲突行跳过并提示', async () => {
    // 甲队先占用组合名“甲一”，随后乙队教练在同一事件下导入同名组合。
    await commitAs(coachA, [importRow('甲一', [9101], ['测试甲桨手A'], 57150)]);
    const response = await commitAs(coachB, [
      importRow('甲一', [9201], ['测试乙桨手A'], 56000),
    ]);
    expect(response.status).toBe(200);
    // HTTP 200 表示这批导入流程正常结束；imported=0 和 conflicts 才表示该行被安全跳过。
    expect(response.payload.imported).toBe(0);
    expect(response.payload.conflicts).toEqual([{ rowNumber: 1, crewName: '甲一' }]);
    // 再查数据库证明保护不是“只返回提示”：甲队原记录确实没有被乙队覆盖。
    const rows = savedResults();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].memberAthleteIds)).toEqual([9101]);
    expect(rows[0].bestMs).toBe(57150);
  });

  it('导入行成员不在当前账户范围时跳过且不写入', async () => {
    // 即使没有同名旧记录，只要新行包含当前教练不可访问的运动员，也不得落库。
    const response = await commitAs(coachA, [
      importRow('越权艇', [9201], ['测试乙桨手A'], 56000),
    ]);
    expect(response.payload.imported).toBe(0);
    expect(response.payload.conflicts).toEqual([{ rowNumber: 1, crewName: '越权艇' }]);
    expect(savedResults()).toHaveLength(0);
  });

  it('手工录入同名组合撞名返回409且不改动原成绩，本人重录仍幂等覆盖', async () => {
    await commitAs(coachA, [importRow('甲一', [9101], ['测试甲桨手A'], 57150)]);
    // 与批量导入不同，单条手工录入用 409 明确表达同名组合冲突。
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
    // 同一权限范围内的本人重录则允许覆盖，且结果表仍只有一条，体现幂等性。
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
