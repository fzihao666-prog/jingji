import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import ExcelJS from 'exceljs';
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

it('本人、代导入和零提交各自显示，覆盖保留原归属，角色筛选保持系统总数', async () => {
  const report = (await (
    await request('project=ROWING&from=2026-11-14&to=2026-11-14')
  ).json()) as SubmissionReport;
  expect(report.total).toBe(2);
  expect(report.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ group: true, role: '体能教练', direct: 1, delegated: 1, total: 2 }),
      expect.objectContaining({ name: '甲教练', direct: 1, delegated: 0, total: 1 }),
      expect.objectContaining({ name: '乙教练', direct: 0, total: 0 }),
    ])
  );
  const role = encodeURIComponent('康复治疗师');
  const filtered = (await (
    await request(`project=ROWING&from=2026-11-14&roles=${role}`)
  ).json()) as SubmissionReport;
  expect(filtered.total).toBe(2);
  expect(filtered.rows).toEqual([]);
});

it('网页与 Excel 使用同一范围与首次归属，越权和无效日期被拒绝', async () => {
  expect((await request('project=VOLLEYBALL')).status).toBe(403);
  expect((await request('project=ROWING', 9302)).status).toBe(403);
  expect(
    (await request(`project=ROWING&team=${encodeURIComponent('合成一队')}`, 9304)).status
  ).toBe(403);
  expect((await request('project=ROWING&from=2026-11-31')).status).toBe(400);
  const query = 'project=ROWING&from=2026-11-14&to=2026-11-14';
  const report = (await (await request(query)).json()) as SubmissionReport;
  const group = report.rows.find((row) => row.group)!;
  const response = await request(`${query}&key=${encodeURIComponent(group.key)}`);
  const detail = (await response.json()) as SubmissionReport;
  expect(detail.details.map(({ name, operator }) => [name, operator])).toEqual([
    ['', '管理员'],
    ['甲教练', '甲教练'],
  ]);
  const workbook = new ExcelJS.Workbook();
  const excel = await request(`${query}&format=xlsx`);
  expect(excel.status).toBe(200);
  await workbook.xlsx.load(await excel.arrayBuffer());
  expect(workbook.getWorksheet('汇总')?.getCell('G2').value).toBe(2);
  expect(workbook.getWorksheet('明细')?.rowCount).toBe(3);
});

it('通过历史导入批次找回首次提交，不重复计入覆盖批次', async () => {
  const query = 'project=ROWING&from=2026-11-12&to=2026-11-12';
  const response = await request(query);
  expect(response.status).toBe(200);
  const report = (await response.json()) as SubmissionReport;
  expect(report.total).toBe(1);
  expect(report.types).toEqual({ 日常监测: 1 });
  expect(report.rows).toContainEqual(
    expect.objectContaining({ name: '甲教练', direct: 1, total: 1 })
  );
});

it('未分队记录可单独筛选，查看和导出均要求未分队范围授权', async () => {
  db.exec(`
    INSERT INTO athletes(id,name,project,team) VALUES (9310,'未分队运动员','ROWING','');
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES (9301,'ROWING','*',9301);
    INSERT INTO training_sessions(id,athlete_id,session_date,training_type,structure_type,intensity_zone,created_by)
      VALUES (9310,9310,'2025-12-12','体能训练','','',9302);
    UPDATE submission_provenance SET submitted_at='2026-11-08 12:00:00'
      WHERE entity='training_session' AND entity_id=9310;
  `);
  try {
    const query = 'project=ROWING&team=&from=2026-11-08&to=2026-11-08';
    const response = await request(query);
    expect(response.status).toBe(200);
    const report = (await response.json()) as SubmissionReport;
    expect(report.teams).toContain('');
    expect(report.total).toBe(1);
    expect(report.rows.every((row) => row.team === '' || row.team === '未分队')).toBe(true);
    expect((await request(query, 9304)).status).toBe(403);
    expect((await request(`${query}&format=xlsx`, 9304)).status).toBe(403);
    const excel = await request(`${query}&format=xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await excel.arrayBuffer());
    expect(workbook.getWorksheet('汇总')?.getCell('A2').value).toBe('未分队');
  } finally {
    db.exec(
      "DELETE FROM athletes WHERE id=9310; DELETE FROM user_team_permissions WHERE user_id=9301 AND project='ROWING' AND team='*';"
    );
  }
});

it('默认合并授权项目，同一教练只出现一次且能查看跨项目明细', async () => {
  db.exec(`
    INSERT INTO user_project_permissions(user_id,project,granted_by) VALUES (9301,'VOLLEYBALL',9301);
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES (9301,'VOLLEYBALL','合成一队',9301);
    INSERT INTO athletes(id,name,project,team) VALUES (9320,'第二项目运动员','VOLLEYBALL','合成一队');
    INSERT INTO training_sessions(id,athlete_id,session_date,training_type,structure_type,intensity_zone,created_by)
      VALUES (9320,9320,'2025-12-12','体能训练','','',9302);
    UPDATE submission_provenance SET submitted_at='2026-11-13 19:00:00'
      WHERE entity='training_session' AND entity_id=9320;
  `);
  const query = 'from=2026-11-14&to=2026-11-14';
  const report = (await (await request(query)).json()) as SubmissionReport;
  expect(report.total).toBe(3);
  const coach = report.rows.filter((row) => row.name === '甲教练');
  expect(coach).toHaveLength(1);
  expect(coach[0]).toMatchObject({ total: 2, lastSubmitted: '2026-11-14' });
  expect(report.rows.filter((row) => row.group)).toHaveLength(2);
  const detail = (await (
    await request(`${query}&key=${encodeURIComponent(coach[0].key)}`)
  ).json()) as SubmissionReport;
  expect(detail.details.map((row) => row.project).sort()).toEqual(['ROWING', 'VOLLEYBALL']);
});

it('跨项目明细每页最多返回 50 条，保留准确总数', async () => {
  db.exec(`
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<61)
    INSERT INTO training_sessions(athlete_id,session_date,session_order,training_type,structure_type,intensity_zone,created_by)
      SELECT CASE WHEN n<=30 THEN 9301 ELSE 9320 END,'2025-11-01',n,'体能训练','','',9302 FROM seq;
    UPDATE submission_provenance SET submitted_at='2026-10-15 02:00:00'
      WHERE entity='training_session' AND entity_id IN (SELECT id FROM training_sessions WHERE session_date='2025-11-01');
  `);
  const query = 'from=2026-10-15&to=2026-10-15&key=%5B9302%5D';
  const first = (await (await request(`${query}&page=1`)).json()) as SubmissionReport;
  const next = (await (await request(`${query}&page=2`)).json()) as SubmissionReport;
  expect(first.detailTotal).toBe(61);
  expect(next.detailTotal).toBe(61);
  expect(first.details).toHaveLength(50);
  expect(next.details).toHaveLength(11);
  expect(new Set([...first.details, ...next.details].map(({ id }) => id)).size).toBe(61);
});
