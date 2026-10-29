import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({ get db() { return fixture.db; } }));
let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:'); fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec("INSERT INTO athletes(id,name,project) VALUES(9101,'合成测试人员','ROWING')");
});
afterEach(() => db.close());
function sample(date: string, protocol: string, value: number, project = 'ROWING', status = 'confirmed') {
  const id = Number(db.prepare(`INSERT INTO test_sessions(athlete_id,test_date,test_type,protocol,protocol_code,protocol_version,context_key,project_code,project_status,duration_min)
    VALUES(9101,?,'力量素质测试',?,?,'v1','标准条件',?,?,10)`).run(date, protocol, protocol, project, status).lastInsertRowid);
  db.prepare("INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit,side) VALUES(?,'vertical_jump_cm',?,'cm','center')").run(id, value);
}
async function overview() {
  const { buildOverviewPayload } = await import('./overview-service.ts');
  return buildOverviewPayload({ athleteIds: [9101], from: '2026-01-01', to: '2026-01-31', project: 'ROWING', individual: true });
}
it('总览对比只使用最近测试的同协议上下文，已知他项目和pending不混入', async () => {
  sample('2026-01-01', 'A', 40); sample('2026-01-02', 'B', 80);
  sample('2026-01-03', 'A', 999, 'VOLLEYBALL'); sample('2026-01-04', 'A', 888, 'ROWING', 'pending_verification');
  const result = await overview();
  expect(result.measurements.find(row => row.code === 'vertical_jump_cm')).toMatchObject({ value: 80, previous: null, changePct: null });
  expect(result.meta.testCount).toBe(2);
  expect(result.trainingAnalytics.summary.testDurationMin).toBe(20);
});
it('同日不同协议的测试时长保留，不能当成同一批测试去重', async () => {
  sample('2026-01-02', 'A', 40); sample('2026-01-02', 'B', 80);
  const result = await overview();
  expect(result.meta.testCount).toBe(2);
  expect(result.trainingAnalytics.summary.testDurationMin).toBe(20);
});
it('总览按原始分区汇总，体系缺失不影响时长占比', async () => {
  for (const [order, system, duration] of [[1, 'U', 30], [2, 'UT', 60], [3, '', 10]] as const) {
    db.prepare(`INSERT INTO training_sessions(athlete_id,session_date,session_order,training_type,structure_type,intensity_zone,intensity_system,duration_min,project_code,project_status)
      VALUES(9101,'2026-01-01',?,'专项训练','','AT',?,?,'ROWING','confirmed')`).run(order, system, duration);
  }
  expect((await overview()).intensityDistribution).toEqual(expect.arrayContaining([
    expect.objectContaining({ zone: 'AT', durationMin: 100, sessionCount: 3, percentage: 100 }),
  ]));
});
it('骑行交叉训练即使填写水上同名强度，也不能归入水上训练量', async () => {
  db.exec(`INSERT INTO training_sessions(athlete_id,session_date,training_type,structure_type,intensity_zone,intensity_system,activity_code,duration_min,distance_km,project_code,project_status)
    VALUES(9101,'2026-01-01','专项训练','','U2','U','cycling',30,10,'ROWING','confirmed')`);
  const record = (await overview()).records[0];
  expect(record.trainingBreakdown.waterMinutes).toBe(0);
  expect(record.trainingBreakdown.waterDistanceByZone.U2).toBe(0);
});
it('赛艇有效FMS测量进入总览，真实零分不丢失', async () => {
  const id = Number(db.prepare(`INSERT INTO test_sessions(athlete_id,test_date,test_type,project_code,project_status)
    VALUES(9101,'2026-01-02','FMS测试','ROWING','confirmed')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit)
    VALUES(?,'fms_deep_squat',0,'分')`).run(id);
  expect((await overview()).measurements).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'fms_deep_squat', value: 0, sampleCount: 1 }),
  ]));
});
