import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
import type { SubmissionReport } from '../../shared/submission-report.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));

const secret = 'synthetic-submissions';
let db: DatabaseSync;
let server: Server;
let url: string;
let directory: string;

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  directory = mkdtempSync(join(tmpdir(), 'submission-report-test-'));
  db = new DatabaseSync(join(directory, 'test.db'));
  db.exec('PRAGMA journal_mode=WAL');
  fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec(`
    INSERT INTO users(id,username,password_hash,display_name,role) VALUES
      (9301,'synthetic_manager','synthetic','管理员','DMD'),
      (9302,'synthetic_coach_a','synthetic','甲教练','SCC'),
      (9303,'synthetic_coach_b','synthetic','乙教练','SCC'),
      (9304,'synthetic_outside','synthetic','其他队管理','TD');
    INSERT INTO coach_profiles(user_id,category) VALUES (9302,'体能教练'),(9303,'体能教练');
    INSERT INTO user_project_permissions(user_id,project,granted_by) VALUES
      (9301,'ROWING',9301),(9302,'ROWING',9301),(9303,'ROWING',9301),(9304,'ROWING',9301);
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES
      (9301,'ROWING','合成一队',9301),(9302,'ROWING','合成一队',9301),
      (9303,'ROWING','合成一队',9301),(9304,'ROWING','合成二队',9301);
    INSERT INTO athletes(id,name,project,team) VALUES
      (9301,'合成运动员','ROWING','合成一队'),(9302,'其他队运动员','ROWING','合成二队');
    INSERT INTO training_sessions(id,athlete_id,session_date,training_type,structure_type,intensity_zone,created_by)
      VALUES (9301,9301,'2025-12-12','体能训练','','',9302),
      (9302,9301,'2025-12-13','体能训练','','',9301),
      (9303,9302,'2025-12-13','体能训练','','',9301);
    UPDATE submission_provenance SET submitted_at='2026-11-13 18:00:00'
      WHERE entity='training_session' AND entity_id BETWEEN 9301 AND 9303;
    UPDATE training_sessions SET created_by=9301 WHERE id=9301;
    INSERT INTO daily_wellness(id,athlete_id,wellness_date) VALUES(9301,9301,'2025-12-12');
    INSERT INTO data_import_batches(id,file_hash,source_filename,project,parser_version,status,created_by,committed_at)
      VALUES('old-wellness','old-wellness','合成历史.xlsx','ROWING','test','committed',9302,'2026-11-12 01:00:00'),
      ('overwrite-wellness','overwrite-wellness','合成覆盖.xlsx','ROWING','test','committed',9301,'2026-11-13 08:00:00');
    INSERT INTO data_import_items(batch_id,item_type,source_sheet,source_address,quality,conflict_json,committed_entity_type,committed_entity_id)
      VALUES('old-wellness','wellness','恢复','B2','valid','{"exists":false}','daily_wellness',9301),
      ('overwrite-wellness','wellness','恢复','B2','valid','{"exists":true}','daily_wellness',9301);

  `);
  // 再次启动兼容已生成的首次提交证据。
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  const { registerSubmissionReportRoutes } = await import('./submission-report-routes.ts');
  const app = express();
  registerSubmissionReportRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无端口');
  url = `http://127.0.0.1:${address.port}/api/reports/submissions`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  db?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function request(query = 'project=ROWING', id = 9301) {
  return fetch(`${url}?${query}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ id, sessionVersion: 1 }, secret)}` },
  });
}

it('同队多人共享队伍存量，管理员录入只计一次，服务端裁切权限', async () => {
  db.exec(`
    INSERT OR IGNORE INTO project_teams(project,name) VALUES ('ROWING','合成一队'),('ROWING','合成二队'),('ROWING','合成空队');
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES (9301,'ROWING','合成空队',9301);
    UPDATE athletes SET team_id=(SELECT id FROM project_teams WHERE project='ROWING' AND name=team) WHERE id IN (9301,9302);
  `);
  const response = await request('');
  expect(response.status).toBe(200);
  const report = (await response.json()) as SubmissionReport;
  const index = report.teams.findIndex(({ name }) => name === '合成一队');
  expect(report.teams[index].coaches).toEqual([9302, 9303]);
  expect(
    report.records
      .filter(([team]) => team === index)
      .map(([, , , id]) => id)
      .sort()
  ).toEqual([
    'athlete:9301',
    'daily_wellness:9301',
    'training_session:9301',
    'training_session:9302',
  ]);
  expect(report.teams.find(({ name }) => name === '合成空队')?.coaches).toEqual([]);
  expect(report.teams.some(({ name }) => name === '合成二队')).toBe(false);
  expect((await request('', 9302)).status).toBe(403);
});

it('转队后历史随新队，离队清空归最后一队', async () => {
  db.exec(`
    UPDATE athletes SET team='合成二队',team_id=(SELECT id FROM project_teams WHERE project='ROWING' AND name='合成二队') WHERE id=9301;
    UPDATE athletes SET active=0,team='',team_id=NULL WHERE id=9301;
  `);
  const response = await request('', 9304);
  expect(response.status).toBe(200);
  const report = (await response.json()) as SubmissionReport;
  const record = report.records.find(([, , , id]) => id === 'training_session:9301');
  expect(record?.[2]).toBe('2025-12-12');
  expect(report.teams[record![0]].name).toBe('合成二队');
  const original = (await (await request('')).json()) as SubmissionReport;
  expect(original.records.some(([, , , id]) => id === 'training_session:9301')).toBe(false);
});
