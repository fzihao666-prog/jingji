import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
let db: DatabaseSync, server: Server, baseUrl: string;
const secret = 'synthetic-analysis-project-isolation';
beforeEach(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec(`INSERT INTO users(id,username,password_hash,display_name,role) VALUES(9001,'analysis_isolation','synthetic','合成管理员','DMD');
    INSERT INTO user_project_permissions(user_id,project,granted_by) VALUES(9001,'*',9001);
    INSERT INTO user_area_permissions(user_id,area_level,province,city,county,granted_by) VALUES(9001,'national','','','',9001);
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES(9001,'*','*',9001);
    INSERT INTO athletes(id,name,project,gender,birth_date) VALUES(9001,'合成转项运动员','ROWING','男','2000-01-01');`);
  const { registerAnalysisRoutes } = await import('./analysis-routes.ts');
  const app = express();
  registerAnalysisRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  db?.close();
  vi.unstubAllEnvs();
});
async function read(path: string) {
  const response = await fetch(baseUrl + path, {
    headers: { Authorization: `Bearer ${jwt.sign({ id: 9001, sessionVersion: 1 }, secret)}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}
function train(date: string, project: string | null, status: string, duration: number) {
  db.prepare(
    `INSERT INTO training_sessions(athlete_id,session_date,training_type,structure_type,intensity_zone,duration_min,distance_km,project_code,project_status)
    VALUES(9001,?,'专项训练','连续训练','UT2',?,10,?,?)`
  ).run(date, duration, project, status);
}
function test(date: string, project: string | null, status: string, value: number) {
  const session = db
    .prepare(
      `INSERT INTO test_sessions(athlete_id,test_date,test_type,protocol,project_code,project_status) VALUES(9001,?,'力量素质测试','CMJ双手叉腰',?,?)`
    )
    .run(date, project, status);
  db.prepare(
    "INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit) VALUES(?,'vertical_jump_cm',?,'cm')"
  ).run(Number(session.lastInsertRowid), value);
}
const range = 'from=2026-01-01&to=2026-01-31';
it('专项汇总只评价当前项目已确认事实，其他项目及待核实记录不改变结果', async () => {
  train('2026-01-01', 'ROWING', 'confirmed', 30);
  const baseline = await read(`/api/analysis/summary?project=ROWING&athleteId=9001&${range}`);
  train('2026-01-02', 'CANOE_SPRINT', 'confirmed', 300);
  train('2026-01-03', 'ROWING', 'pending_verification', 400);
  train('2026-01-04', null, 'pending_verification', 500);
  train('2026-01-05', 'ROWING', 'confirmed', 600);
  db.exec(
    "UPDATE training_sessions SET source='synthetic_30d_current_v1' WHERE session_date='2026-01-05'"
  );
  train('2026-01-06', 'ROWING', 'confirmed', 700);
  db.exec(
    "UPDATE training_sessions SET source='simulation_legacy' WHERE session_date='2026-01-06'"
  );
  expect(await read(`/api/analysis/summary?project=ROWING&athleteId=9001&${range}`)).toEqual(
    baseline
  );
});
it('旧雷达只读取当前项目已确认测量，转项前测试和待核实记录不覆盖当前值', async () => {
  test('2026-01-01', 'ROWING', 'confirmed', 40);
  const path = `/api/athletes/9001/radar-models?${range}`;
  const baseline = await read(path);
  expect(baseline).toMatchObject({
    physical: {
      dimensions: expect.arrayContaining([
        expect.objectContaining({ key: 'vertical_jump', currentValue: 40 }),
      ]),
    },
  });
  test('2026-01-02', 'CANOE_SPRINT', 'confirmed', 90);
  test('2026-01-03', 'ROWING', 'pending_verification', 100);
  test('2026-01-04', null, 'pending_verification', 110);
  test('2026-01-05', 'ROWING', 'confirmed', 120);
  db.exec(
    "UPDATE test_sessions SET source='synthetic_30d_current_v1' WHERE test_date='2026-01-05'"
  );
  test('2026-01-06', 'ROWING', 'confirmed', 130);
  db.exec(
    "UPDATE test_measurements SET source='simulation_legacy' WHERE test_session_id IN (SELECT id FROM test_sessions WHERE test_date='2026-01-06')"
  );
  expect(await read(path)).toEqual(baseline);
});
it('公共原始记录保留待核实记录及归属提示，但排除已知其他项目事实', async () => {
  train('2026-01-01', 'ROWING', 'confirmed', 30);
  train('2026-01-02', 'CANOE_SPRINT', 'confirmed', 300);
  train('2026-01-03', 'ROWING', 'pending_verification', 400);
  train('2026-01-04', null, 'pending_verification', 500);
  const payload = await read(`/api/records?project=ROWING&athleteId=9001&${range}`);
  expect(payload).toMatchObject({
    records: [
      { date: '2026-01-01' },
      { date: '2026-01-03' },
      { date: '2026-01-04', projectCode: null, projectStatus: 'pending_verification' },
    ],
  });
});

const profileScope = {
  athleteId: 9001,
  accessibleAthleteIds: [9001],
  from: '2026-01-01',
  to: '2026-01-31',
  project: 'ROWING',
  teamId: null,
  teamAthleteIds: [9001],
};
it('档案RPE趋势排除其他项目、待核实及模拟训练', async () => {
  const { buildWellnessTrends } = await import('./athlete-profile-service.ts');
  train('2026-01-01', 'ROWING', 'confirmed', 30);
  db.exec('UPDATE training_sessions SET rpe=5');
  const baseline = buildWellnessTrends(profileScope);
  for (const [date, project, status, source] of [
    ['2026-01-02', 'CANOE_SPRINT', 'confirmed', 'manual'],
    ['2026-01-03', 'ROWING', 'pending_verification', 'manual'],
    ['2026-01-04', null, 'pending_verification', 'manual'],
    ['2026-01-05', 'ROWING', 'confirmed', 'synthetic_30d_current_v1'],
    ['2026-01-06', 'ROWING', 'confirmed', 'simulation_legacy'],
  ] as const) {
    train(date, project, status, 900);
    db.prepare('UPDATE training_sessions SET rpe=9,source=? WHERE session_date=?').run(
      source,
      date
    );
  }
  expect(buildWellnessTrends(profileScope)).toEqual(baseline);
});
it('档案最新测试及有氧摘要不被其他项目、待核实和模拟测试覆盖', async () => {
  const { buildProfileComparison, buildAerobicEndurance } =
    await import('./athlete-profile-service.ts');
  test('2026-01-01', 'ROWING', 'confirmed', 40);
  db.exec(
    "UPDATE test_measurements SET metric_code='erg_2k_sec',unit='秒' WHERE test_session_id IN (SELECT id FROM test_sessions WHERE athlete_id=9001)"
  );
  const comparison = () =>
    buildProfileComparison(profileScope).comparison.items.find(
      (row) => row.key === 'measurement:erg_2k_sec'
    );
  const baselineComparison = comparison();
  const baselineAerobic = buildAerobicEndurance(profileScope);
  expect(baselineComparison?.personalValue).toBe(40);
  expect(baselineAerobic.metrics[0]?.personalValue).toBe(40);
  for (const [date, project, status, source] of [
    ['2026-01-02', 'CANOE_SPRINT', 'confirmed', 'manual'],
    ['2026-01-03', 'ROWING', 'pending_verification', 'manual'],
    ['2026-01-04', null, 'pending_verification', 'manual'],
    ['2026-01-05', 'ROWING', 'confirmed', 'synthetic_30d_current_v1'],
    ['2026-01-06', 'ROWING', 'confirmed', 'simulation_legacy'],
  ] as const) {
    test(date, project, status, 90);
    db.prepare(
      "UPDATE test_measurements SET metric_code='erg_2k_sec',unit='秒',source=? WHERE test_session_id IN (SELECT id FROM test_sessions WHERE test_date=?)"
    ).run(source, date);
  }
  expect(comparison()).toEqual(baselineComparison);
  expect(buildAerobicEndurance(profileScope)).toEqual(baselineAerobic);
});

it.each([
  ['protocol', '另一协议'],
  ['protocol_version', 'v2'],
  ['context_key', 'outdoor'],
  ['side', 'right'],
  ['protocol_version', ''],
  ['protocol', ''],
])('档案团队比较不跨%s条件，完整相同条件才计算差异', async (field, otherValue) => {
  const { buildProfileComparison, buildAerobicEndurance } =
    await import('./athlete-profile-service.ts');
  db.exec("INSERT INTO athletes(id,name,project,gender) VALUES(9002,'合成队友','ROWING','男')");
  const scope = { ...profileScope, teamAthleteIds: [9001, 9002] };
  test('2026-01-10', 'ROWING', 'confirmed', 40);
  const teammate = db
    .prepare(
      "INSERT INTO test_sessions(athlete_id,test_date,test_type,protocol,project_code,project_status) VALUES(9002,'2026-01-10','测试','CMJ双手叉腰','ROWING','confirmed')"
    )
    .run();
  db.prepare(
    "INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit) VALUES(?,'vertical_jump_cm',60,'cm')"
  ).run(Number(teammate.lastInsertRowid));
  db.exec(
    "UPDATE test_sessions SET protocol_version='v1',context_key='indoor' WHERE athlete_id IN (9001,9002); UPDATE test_measurements SET metric_code='erg_2k_sec',unit='秒',side='left' WHERE test_session_id IN (SELECT id FROM test_sessions WHERE athlete_id IN (9001,9002))"
  );
  const table = field === 'side' ? 'test_measurements' : 'test_sessions';
  const target = field === 'side' ? 'test_session_id' : 'id';
  db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${target}=?`).run(
    otherValue,
    Number(teammate.lastInsertRowid)
  );
  const comparison = () =>
    buildProfileComparison(scope).comparison.items.find(
      (row) => row.key === 'measurement:erg_2k_sec'
    );
  expect(comparison()).toMatchObject({ personalValue: 40, teamMean: null, difference: null });
  expect(buildAerobicEndurance(scope).metrics[0]).toMatchObject({
    personalValue: 40,
    teamMean: null,
    difference: null,
  });
  const matchingValue = {
    protocol: 'CMJ双手叉腰',
    protocol_version: 'v1',
    context_key: 'indoor',
    side: 'left',
  }[field];
  db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${target}=?`).run(
    matchingValue!,
    Number(teammate.lastInsertRowid)
  );
  expect(comparison()).toMatchObject({ teamMean: 50, difference: -10 });
  expect(buildAerobicEndurance(scope).metrics[0]).toMatchObject({ teamMean: 50, difference: -10 });
});
it('有氧趋势只连接相同明确协议版本、条件与侧别，未知版本仅展示原始值', async () => {
  const { buildAerobicEndurance } = await import('./athlete-profile-service.ts');
  for (const date of ['2026-01-01', '2026-01-02', '2026-01-03'])
    test(date, 'ROWING', 'confirmed', 40);
  db.exec(
    "UPDATE test_sessions SET protocol_version='v1',context_key='indoor' WHERE athlete_id=9001; UPDATE test_measurements SET metric_code='erg_2k_sec',unit='秒',side='left' WHERE test_session_id IN (SELECT id FROM test_sessions WHERE athlete_id=9001); UPDATE test_sessions SET context_key='outdoor' WHERE athlete_id=9001 AND test_date='2026-01-02'"
  );
  expect(buildAerobicEndurance(profileScope).trend?.points.map((point) => point.date)).toEqual([
    '2026-01-01',
    '2026-01-03',
  ]);
  db.exec(
    "UPDATE test_sessions SET protocol_version=NULL WHERE athlete_id=9001 AND test_date='2026-01-03'"
  );
  expect(buildAerobicEndurance(profileScope)).toMatchObject({
    metrics: [{ personalValue: 40, teamMean: null, difference: null }],
    trend: null,
  });
});

it.each(['CANOE_SPRINT', 'CANOE_SLALOM', 'CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])(
  '%s个人雷达返回可展示空状态，不泄漏赛艇维度',
  async (project) => {
    db.prepare('UPDATE athletes SET project=? WHERE id=9001').run(project);
    const result = await read(`/api/athletes/9001/radar-models?${range}`);
    expect(result).toMatchObject({
      special: { dimensions: [], unavailableReason: expect.stringContaining('尚未配置') },
      physical: { dimensions: [] },
    });
  }
);

it('训练记录按真实队伍过滤并拒绝非法及跨项目队伍', async () => {
  db.exec(`INSERT INTO project_teams(id,project,name) VALUES(9901,'ROWING','合成甲队'),(9902,'ROWING','合成乙队'),(9903,'CANOE_SPRINT','合成跨项目队');
    UPDATE athletes SET team_id=9901 WHERE id=9001;
    INSERT INTO athletes(id,name,project,gender,birth_date,team_id) VALUES(9002,'合成乙队运动员','ROWING','男','2000-01-01',9902);`);
  train('2026-01-01', 'ROWING', 'confirmed', 30);
  db.exec(`INSERT INTO training_sessions(athlete_id,session_date,training_type,structure_type,intensity_zone,duration_min,distance_km,project_code,project_status)
    VALUES(9002,'2026-01-01','专项训练','连续训练','UT2',90,10,'ROWING','confirmed');`);
  const payload = await read(`/api/records?project=ROWING&teamId=9901&${range}`) as { records: Array<{ athleteId: number }> };
  expect(payload.records.map((row) => row.athleteId)).toEqual([9001]);
  for (const [teamId, status] of [['abc',400],['-1',400],['9903',403],['9999',403]]) {
    const response = await fetch(`${baseUrl}/api/records?project=ROWING&teamId=${teamId}&${range}`, {
      headers: { Authorization: `Bearer ${jwt.sign({ id: 9001, sessionVersion: 1 }, secret)}` },
    });
    expect(response.status).toBe(status);
  }
});
