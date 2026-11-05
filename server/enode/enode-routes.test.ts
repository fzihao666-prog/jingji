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
const secret = 'synthetic-enode-test-only';
const header = '日期 [yyyy-MM-dd],时间,运动员,stress,mood,sleep,soreness,fatigue,wellnessScore';
const csv = header + '\n2026-10-03,01:00:00,合成设备人员,4,5,5,5,4,23';
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec(`INSERT INTO athletes(id,name,project) VALUES(9401,'合成设备人员','ROWING'),(9402,'合成设备人员','VOLLEYBALL');
    INSERT INTO users(id,username,password_hash,display_name,role) VALUES(9401,'enode_full','synthetic','合成管理员','DMD'),(9402,'enode_partial','synthetic','合成管理员','DMD'),(9403,'enode_athlete','synthetic','合成运动员','ATL');
    INSERT INTO user_project_permissions VALUES(9401,'*',9401,CURRENT_TIMESTAMP),(9402,'VOLLEYBALL',9401,CURRENT_TIMESTAMP);
    INSERT INTO user_area_permissions(user_id,area_level,province,city,county,granted_by) VALUES(9401,'national','','','',9401),(9402,'national','','','',9401);
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES(9401,'*','*',9401),(9402,'*','*',9401);`);
  const { registerEnodeRoutes } = await import('./enode-routes.ts');
  const app = express();
  app.use(express.json());
  registerEnodeRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('无端口');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});
const auth = (id = 9401) => ({
  Authorization: `Bearer ${jwt.sign({ id, sessionVersion: 1 }, secret)}`,
});
function upload(id = 9401, matches = '{}', contents = csv) {
  const body = new FormData();
  body.append('project', 'ROWING');
  body.append('matches', matches);
  body.append('files', new Blob([contents]), '无扩展名导出');
  return fetch(url + '/api/enode/import', { method: 'POST', body, headers: auth(id) });
}
const path =
  '/api/enode/data?athleteId=9401&project=ROWING&kind=wellness&metric=wellnessScore&from=2026-10-01&to=2026-10-31';
it('无登录拒绝；导入拒绝角色越权、项目越权、人员映射越权', async () => {
  expect((await fetch(url + path)).status).toBe(401);
  expect((await upload(9403)).status).toBe(403);
  expect((await upload(9402)).status).toBe(403);
  expect((await upload(9401, '{"合成设备人员":9402}')).status).toBe(403);
  expect(db.prepare('SELECT COUNT(*) AS n FROM enode_records').get()).toEqual({ n: 0 });
});
it('上传即入库、重传去重、查询按项目与运动员隔离，审计同事务保存', async () => {
  const first = await upload();
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ results: [{ inserted: 1, failed: 0 }] });
  expect(await (await upload()).json()).toMatchObject({ results: [{ inserted: 0, skipped: 1 }] });
  const read = await fetch(url + path, { headers: auth() });
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ total: 1, daily: [{ mean: 23 }] });
  expect((await fetch(url + path, { headers: auth(9402) })).status).toBe(403);
  expect(
    (await fetch(url + path.replace('project=ROWING', 'project=VOLLEYBALL'), { headers: auth() }))
      .status
  ).toBe(403);
  expect(
    (
      await fetch(url + path.replace('metric=wellnessScore', 'metric=meanVelocity'), {
        headers: auth(),
      })
    ).status
  ).toBe(400);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='IMPORT_ENODE'").get()
  ).toEqual({ n: 2 });
});
it('混合文件分别报告成功、空文件和格式失败，不重复写入成功文件', async () => {
  const body = new FormData();
  body.append('project', 'ROWING');
  body.append('files', new Blob([csv]), '状态');
  body.append(
    'files',
    new Blob([
      '日期 [yyyy-MM-dd],时间,运动员,sessionRpe,trainingLoad,workoutStart,workoutEnd,durationMin,sessionCount,exercises,volume',
    ]),
    '空RPE'
  );
  body.append('files', new Blob(['bad,file']), '错误文件');
  const response = await fetch(url + '/api/enode/import', {
    method: 'POST',
    body,
    headers: auth(),
  });
  expect(await response.json()).toMatchObject({
    results: [
      { skipped: 1 },
      { kind: 'sessionRpe', inserted: 0, failed: 0 },
      { kind: null, failed: 1 },
    ],
  });
});
