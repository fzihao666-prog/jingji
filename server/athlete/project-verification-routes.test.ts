import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
let db: DatabaseSync, server: Server, url: string;
const secret = 'synthetic-project-verification';
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec(`INSERT INTO athletes(id,name,project) VALUES(9101,'合成核实人员','ROWING');
 INSERT INTO users(id,username,password_hash,display_name,role) VALUES(9101,'verify_full','synthetic','合成管理','DMD'),(9102,'verify_partial','synthetic','合成管理','DMD');
 INSERT INTO user_project_permissions VALUES(9101,'*',9101,CURRENT_TIMESTAMP),(9102,'VOLLEYBALL',9101,CURRENT_TIMESTAMP);
 INSERT INTO user_area_permissions(user_id,area_level,province,city,county,granted_by) VALUES(9101,'national','','','',9101),(9102,'national','','','',9101);
 INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES(9101,'*','*',9101),(9102,'*','*',9101);
 INSERT INTO training_sessions(id,athlete_id,session_date,training_type,structure_type,intensity_zone,duration_min,distance_km) VALUES(9101,9101,'2026-01-01','专项训练','','',30,0);
 INSERT INTO test_sessions(id,athlete_id,test_date,test_type) VALUES(9101,9101,'2026-01-01','体能测试');`);
  const { registerProjectVerificationRoutes } = await import('./project-verification-routes.ts');
  const app = express();
  app.use(express.json());
  registerProjectVerificationRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('无端口');
  url = `http://127.0.0.1:${a.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});
function request(path: string, project = 'ROWING', id = 9101) {
  return fetch(url + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt.sign({ id, sessionVersion: 1 }, secret)}`,
    },
    body: JSON.stringify({ project }),
  });
}
it('拒绝越权，人工核实两类事实并幂等，不能重分类已确认记录', async () => {
  expect((await request('/api/training-sessions/9101/verify-project', 'ROWING', 9102)).status).toBe(
    403
  );
  for (const path of ['training-sessions', 'test-sessions']) {
    expect((await request(`/api/${path}/9101/verify-project`)).status).toBe(200);
    expect((await request(`/api/${path}/9101/verify-project`)).status).toBe(200);
    expect((await request(`/api/${path}/9101/verify-project`, 'VOLLEYBALL')).status).toBe(409);
  }
  const { buildSpecialTrainingPayload } = await import('../analysis/overview-service.ts');
  expect(
    buildSpecialTrainingPayload({
      athleteIds: [9101],
      project: 'ROWING',
      from: '2026-01-01',
      to: '2026-01-01',
      individual: true,
    }).training.summary.sessionCount
  ).toBe(1);
  expect(
    db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='VERIFY_FACT_PROJECT'").get()
  ).toEqual({ n: 2 });
  expect(
    db
      .prepare(
        'SELECT project_code,project_status,project_source FROM training_sessions WHERE id=9101'
      )
      .get()
  ).toEqual({
    project_code: 'ROWING',
    project_status: 'confirmed',
    project_source: 'manual_verification',
  });
});
it('审计失败完整回滚核实状态', async () => {
  db.exec(
    "UPDATE training_sessions SET project_status='pending_verification',project_code=NULL WHERE id=9101; CREATE TRIGGER refuse_verification BEFORE INSERT ON audit_logs WHEN NEW.action='VERIFY_FACT_PROJECT' BEGIN SELECT RAISE(ABORT,'拒绝审计'); END"
  );
  expect((await request('/api/training-sessions/9101/verify-project')).status).toBe(500);
  expect(db.prepare('SELECT project_status FROM training_sessions WHERE id=9101').get()).toEqual({
    project_status: 'pending_verification',
  });
  db.exec('DROP TRIGGER refuse_verification');
});
