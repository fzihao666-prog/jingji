import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { physicalChampionPayloadSchema } from '../../shared/physical-champion.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
let db: DatabaseSync, server: Server, baseUrl: string;
const secret = 'synthetic-reference-review-test-secret';
const draft = {
  project: 'VOLLEYBALL',
  key: 'jump',
  referenceLabel: '队内纵跳参考',
  value: 50,
  unit: 'cm',
  protocol: 'CMJ双手叉腰',
  direction: 'higher_better',
  sourceType: 'measured',
  sourceNature: 'team',
  sourceNote: '合成队内统计资料',
  gender: 'open',
  event: 'open',
  weightClass: 'open',
  ageGroup: 'adult',
  position: 'open',
  referenceLevel: 'open',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  dimensionVersion: 'v1',
  measurementCodes: ['vertical_jump_cm'],
  measurementUnit: 'cm',
  weightRelative: false,
};
function call(path: string, method = 'GET', body?: unknown, userId: number | null = 9001) {
  return fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(userId
        ? { Authorization: `Bearer ${jwt.sign({ id: userId, sessionVersion: 1 }, secret)}` }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  for (const [id, role] of [
    [9001, 'DMD'],
    [9002, 'DMD'],
    [9003, 'SCC'],
  ] as const) {
    db.prepare(
      "INSERT INTO users(id,username,password_hash,display_name,role) VALUES(?,?,'synthetic_hash','合成账号',?)"
    ).run(id, `reference_${id}`, role);
    db.prepare(
      'INSERT INTO user_project_permissions(user_id,project,granted_by) VALUES(?,?,?)'
    ).run(id, id === 9002 ? 'VOLLEYBALL' : '*', id);
    db.prepare(
      "INSERT INTO user_area_permissions(user_id,area_level,province,city,county,granted_by) VALUES(?,'national','','','',?)"
    ).run(id, id);
    db.prepare(
      "INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES(?,'*','*',?)"
    ).run(id, id);
  }
  const { registerPhysicalChampionRoutes } = await import('./physical-champion-routes.ts');
  const app = express();
  app.use(express.json());
  registerPhysicalChampionRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  db?.close();
  vi.unstubAllEnvs();
});
describe('专业参考HTTP授权与版本流程', () => {
  it('无登录/非管理角色/受限DMD不能创建或审核', async () => {
    for (const [id, status] of [
      [null, 401],
      [9002, 403],
      [9003, 403],
    ] as const) {
      expect((await call('/api/physical-champion/references', 'POST', draft, id)).status).toBe(
        status
      );
      expect(
        (
          await call(
            '/api/physical-champion/references/7/review',
            'POST',
            { expectedRevision: 0, status: 'reviewed' },
            id
          )
        ).status
      ).toBe(status);
    }
  });
  it('合法新项目返回待配置而未知项目拒绝', async () => {
    for (const project of ['CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL']) {
      const response = await call(
        `/api/physical-champion?project=${project}&from=2026-01-01&to=2026-01-31`
      );
      expect(response.status).toBe(200);
      const result = physicalChampionPayloadSchema.parse(await response.json());
      expect(result.groups).toEqual([]);
      expect(result.pendingReason).toContain('暂无');
    }
    expect(
      (await call('/api/physical-champion?project=UNKNOWN&from=2026-01-01&to=2026-01-31')).status
    ).toBe(400);
  });
  it('一次保存生效，停用后方可替换，兼容启用请求不复活旧版本', async () => {
    expect(
      (await call('/api/physical-champion/references', 'POST', { ...draft, status: 'reviewed' }))
        .status
    ).toBe(400);
    expect((await call('/api/physical-champion/references', 'POST', draft)).status).toBe(200);
    const first = db
      .prepare(
        "SELECT id FROM radar_reference_values WHERE project='VOLLEYBALL' ORDER BY id DESC LIMIT 1"
      )
      .get() as { id: number };
    expect(
      db.prepare('SELECT review_status FROM radar_reference_values WHERE id=?').get(first.id)
    ).toEqual({ review_status: 'reviewed' });
    expect(
      (
        await call(`/api/physical-champion/references/${first.id}`, 'PUT', {
          expectedRevision: 0,
          draft: { ...draft, value: 60 },
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(`/api/physical-champion/references/${first.id}/review`, 'POST', {
          expectedRevision: 0,
          status: 'disabled',
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(`/api/physical-champion/references/${first.id}`, 'PUT', {
          expectedRevision: 1,
          draft: { ...draft, value: 60 },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(`/api/physical-champion/references/${first.id}/review`, 'POST', {
          expectedRevision: 0,
          status: 'reviewed',
        })
      ).status
    ).toBe(200);
    expect(
      db
        .prepare('SELECT review_status,value_num FROM radar_reference_values WHERE id=?')
        .get(first.id)
    ).toEqual({ review_status: 'disabled', value_num: 50 });
  });
});
