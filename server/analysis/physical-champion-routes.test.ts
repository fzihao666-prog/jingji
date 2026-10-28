import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { physicalChampionPayloadSchema } from '../../shared/physical-champion.ts';
import { initializePhysicalChampionReferences } from '../core/physical-champion-references.ts';
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
    [9004, 'ATL'],
    [9005, 'REG'],
    [9006, 'TD'],
    [9007, 'SCC'],
  ] as const) {
    db.prepare(
      "INSERT INTO users(id,username,password_hash,display_name,role) VALUES(?,?,'synthetic_hash','合成账号',?)"
    ).run(id, `reference_${id}`, role);
    db.prepare(
      'INSERT INTO user_project_permissions(user_id,project,granted_by) VALUES(?,?,?)'
    ).run(id, [9002, 9007].includes(id) ? 'VOLLEYBALL' : '*', id);
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
      expect(result.groups).toHaveLength(2);
      expect(
        result.groups.every(
          (group) =>
            group.references.length === 0 &&
            group.modelDimensions?.length === 8 &&
            group.modelDimensions.every((item) => item.value === null)
        )
      ).toBe(true);
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

describe('两行冠军模型的快捷数值维护', () => {
  const path = '/api/physical-champion/model-values';
  const reference = () =>
    db
      .prepare(
        "SELECT id,revision,value_num FROM radar_reference_values WHERE project='ROWING' AND source_type='estimated' AND gender='男' ORDER BY id LIMIT 1"
      )
      .get() as { id: number; revision: number; value_num: number };
  it.each([9003, 9005, 9006, 9002])('教练及以上可编辑授权项目数值（账号%s）', async (id) => {
    const project = id === 9002 ? 'VOLLEYBALL' : 'ROWING';
    const row =
      project === 'ROWING'
        ? reference()
        : (db
            .prepare(
              "SELECT id,revision,value_num FROM radar_reference_values WHERE project='VOLLEYBALL' AND review_status='reviewed' AND active=1 ORDER BY id DESC LIMIT 1"
            )
            .get() as ReturnType<typeof reference>);
    const input = {
      project,
      values: [{ id: row.id, expectedRevision: row.revision, value: row.value_num + 0.1 }],
    };
    expect((await call(path, 'PUT', input, id)).status).toBe(200);
    expect(
      db
        .prepare(
          'SELECT value_num,revision,source_type,source_nature FROM radar_reference_values WHERE id=?'
        )
        .get(row.id)
    ).toEqual({
      value_num: row.value_num + 0.1,
      revision: row.revision + 1,
      source_type: 'estimated',
      source_nature: 'estimated',
    });
    expect((await call(path, 'PUT', input, id)).status).toBe(409);
  });
  it('未登录、运动员及越项目编辑拒绝，所有数值与审计不变', async () => {
    const row = reference();
    const body = {
      project: 'ROWING',
      values: [{ id: row.id, expectedRevision: row.revision, value: 9 }],
    };
    const before = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get();
    expect((await call(path, 'PUT', body, null)).status).toBe(401);
    expect((await call(path, 'PUT', body, 9004)).status).toBe(403);
    expect((await call(path, 'PUT', body, 9007)).status).toBe(403);
    expect((await call(path, 'PUT', { ...body, project: 'VOLLEYBALL' }, 9007)).status).toBe(403);
    expect(reference()).toEqual(row);
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()).toEqual(before);
  });
  it('拒绝非法数值、重复指标和团队字段；批次后项失败时前项回滚', async () => {
    const row = reference();
    const value = { id: row.id, expectedRevision: row.revision, value: row.value_num + 1 };
    for (const values of [[{ ...value, value: 0 }], [value, value]])
      expect((await call(path, 'PUT', { project: 'ROWING', values }, 9003)).status).toBe(400);
    expect(
      (await call(path, 'PUT', { project: 'ROWING', values: [value], teamAverage: 99 }, 9003))
        .status
    ).toBe(400);
    const before = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get();
    expect(
      (
        await call(
          path,
          'PUT',
          { project: 'ROWING', values: [value, { ...value, id: 999999999 }] },
          9003
        )
      ).status
    ).toBe(404);
    expect(reference()).toEqual(row);
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()).toEqual(before);
  });
  it('已停用标准不能快捷修改或复活', async () => {
    const disabled = db
      .prepare(
        "SELECT id,revision,value_num FROM radar_reference_values WHERE project='VOLLEYBALL' AND review_status='disabled' LIMIT 1"
      )
      .get() as ReturnType<typeof reference>;
    const before = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get();
    expect(
      (
        await call(
          path,
          'PUT',
          {
            project: 'VOLLEYBALL',
            values: [{ id: disabled.id, expectedRevision: disabled.revision, value: 80 }],
          },
          9003
        )
      ).status
    ).toBe(409);
    expect(
      db
        .prepare('SELECT value_num,review_status FROM radar_reference_values WHERE id=?')
        .get(disabled.id)
    ).toEqual({ value_num: disabled.value_num, review_status: 'disabled' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()).toEqual(before);
  });
  it('快捷保存不修改测试事实；团队平均始终由两人的有效测试自动生成', async () => {
    const row = db
      .prepare(
        "SELECT id,revision,value_num,protocol FROM radar_reference_values WHERE project='ROWING' AND gender='男' AND metric_key='vertical_jump' AND source_type='estimated'"
      )
      .get() as ReturnType<typeof reference> & { protocol: string };
    for (const [id, value] of [
      [9901, 40],
      [9902, 60],
    ]) {
      db.prepare(
        "INSERT INTO athletes(id,name,project,gender,birth_date) VALUES(?,?,'ROWING','男','2000-01-01')"
      ).run(id, `合成测试人员${id}`);
      const test = db
        .prepare(
          "INSERT INTO test_sessions(athlete_id,test_date,test_type,protocol,protocol_version,context_key,project_code,project_status,source,quality,is_demo) VALUES(?,'2026-01-02','体能测试',?,'','','ROWING','confirmed','manual','valid',0)"
        )
        .run(id, row.protocol);
      db.prepare(
        "INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit,side,source,quality,is_demo) VALUES(?,'vertical_jump_cm',?,'cm','center','manual','valid',0)"
      ).run(Number(test.lastInsertRowid), value);
    }
    const before = db.prepare('SELECT * FROM test_measurements ORDER BY id').all();
    expect(
      (
        await call(
          path,
          'PUT',
          {
            project: 'ROWING',
            values: [{ id: row.id, expectedRevision: row.revision, value: 70 }],
          },
          9003
        )
      ).status
    ).toBe(200);
    expect(db.prepare('SELECT * FROM test_measurements ORDER BY id').all()).toEqual(before);
    const payload = physicalChampionPayloadSchema.parse(
      await (
        await call('/api/physical-champion?project=ROWING&from=2026-01-01&to=2026-01-31')
      ).json()
    );
    expect(payload.canEdit).toBe(true);
    const group = payload.groups.find((group) => group.references.some((ref) => ref.id === row.id));
    expect(group?.references.find((ref) => ref.id === row.id)?.value).toBe(70);
    expect(group?.team.find((value) => value.key === 'vertical_jump')).toMatchObject({
      value: 50,
      sampleCount: 2,
    });
    initializePhysicalChampionReferences(db);
    expect(
      db.prepare('SELECT value_num FROM radar_reference_values WHERE id=?').get(row.id)
    ).toEqual({ value_num: 70 });
  });
});

describe('所有项目共用体能框架，冠军值按项目独立配置', () => {
  it.each(['CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])(
    '%s无标准时展示团队实测，可直接填写冠军值并持久保存',
    async (project) => {
      db.prepare('UPDATE radar_reference_values SET active=0 WHERE project=?').run(project);
      const athleteId =
        project === 'CYCLING_ROAD' ? 9911 : project === 'CYCLING_TRACK' ? 9912 : 9913;
      db.prepare(
        "INSERT INTO athletes(id,name,project,gender,birth_date) VALUES(?,? ,?,'女','2000-01-01')"
      ).run(athleteId, `合成公共体能${athleteId}`, project);
      const session = db
        .prepare(
          "INSERT INTO test_sessions(athlete_id,test_date,test_type,protocol,protocol_version,context_key,project_code,project_status,source,quality,is_demo) VALUES(?,'2026-01-03','体能测试','CMJ双手叉腰','','',?,'confirmed','manual','valid',0)"
        )
        .run(athleteId, project);
      db.prepare(
        "INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit,side,source,quality,is_demo) VALUES(?,'vertical_jump_cm',40,'cm','center','manual','valid',0)"
      ).run(Number(session.lastInsertRowid));
      const path = `/api/physical-champion?project=${project}&from=2026-01-01&to=2026-01-31`;
      const count = db.prepare('SELECT COUNT(*) AS n FROM radar_reference_values').get();
      const before = physicalChampionPayloadSchema.parse(await (await call(path)).json());
      expect(db.prepare('SELECT COUNT(*) AS n FROM radar_reference_values').get()).toEqual(count);
      const group = before.groups.find((group) => group.gender === '女')!;
      expect(group.modelDimensions?.find((item) => item.key === 'vertical_jump')).toMatchObject({
        id: null,
        value: null,
      });
      expect(group.team.find((item) => item.key === 'vertical_jump')).toMatchObject({
        value: 40,
        achievedPercent: null,
        sampleCount: 1,
      });
      const save = {
        project,
        groupId: group.id,
        effectiveFrom: '2026-01-01',
        values: [{ key: 'vertical_jump', value: 50 }],
      };
      expect((await call('/api/physical-champion/model-values', 'PUT', save, 9003)).status).toBe(
        200
      );
      expect((await call('/api/physical-champion/model-values', 'PUT', save, 9003)).status).toBe(
        409
      );
      const after = physicalChampionPayloadSchema.parse(await (await call(path)).json());
      const configured = after.groups.find((item) => item.id === group.id)!;
      expect(configured.modelDimensions).toHaveLength(8);
      expect(configured.modelDimensions?.find((item) => item.key === 'vertical_jump')?.value).toBe(
        50
      );
      expect(configured.team.find((item) => item.key === 'vertical_jump')).toMatchObject({
        value: 40,
        achievedPercent: 80,
        sampleCount: 1,
      });
      expect(
        configured.modelDimensions?.find((item) => item.key === 'relative_squat')?.value
      ).toBeNull();
    }
  );
  it('初次配置校验项目、分组和指标；整批失败不留半份模型', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM radar_reference_values').get();
    const body = {
      project: 'CYCLING_ROAD',
      groupId: JSON.stringify(['男', 'open', 'open', 'adult', 'open', 'open']),
      effectiveFrom: '2026-01-01',
      values: [{ key: 'front_plank', value: 100 }],
    };
    expect((await call('/api/physical-champion/model-values', 'PUT', body, 9007)).status).toBe(403);
    expect(
      (
        await call(
          '/api/physical-champion/model-values',
          'PUT',
          { ...body, groupId: 'invalid' },
          9003
        )
      ).status
    ).toBe(400);
    expect(
      (
        await call(
          '/api/physical-champion/model-values',
          'PUT',
          { ...body, values: [{ key: 'fake_key', value: 100 }] },
          9003
        )
      ).status
    ).toBe(400);
    expect(
      (
        await call(
          '/api/physical-champion/model-values',
          'PUT',
          { ...body, values: [...body.values, { id: 9999999, expectedRevision: 0, value: 1 }] },
          9003
        )
      ).status
    ).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM radar_reference_values').get()).toEqual(before);
  });
});

it.each(['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM', 'CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])(
  '%s共用八项体能框架，项目与男女分组均隔离',
  async (project) => {
    const response = await call(
      `/api/physical-champion?project=${project}&from=2026-01-01&to=2026-01-31`
    );
    const result = physicalChampionPayloadSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups.every((group) => (group.modelDimensions?.length || 0) >= 8)).toBe(true);
    expect(
      result.groups.every((group) => group.references.every((ref) => ref.project === project))
    ).toBe(true);
    expect(
      result.groups.every(
        (group) => !group.label.includes('open') && !group.label.includes('adult')
      )
    ).toBe(true);
  }
);
