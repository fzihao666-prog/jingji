import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
import type { BasicSubmissionReport, SubmissionReport } from '../../shared/submission-report.ts';

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

it('基本信息检查仅导出所选授权队伍及四类正式填报情况', async () => {
  db.exec(`
    INSERT INTO athletes(id,name,project,team,team_id,gender,birth_date)
      SELECT 9310,'检查用合成队员','ROWING',name,id,'女','2000-01-01' FROM project_teams WHERE name='合成一队';
    INSERT INTO athletes(id,name,project,team) VALUES (9312,'待填合成队员','ROWING','合成一队');
    INSERT INTO athlete_profiles(athlete_id,training_years,best_result,native_place,education,event_item)
      VALUES(9310,0,'6:50.0','合成籍贯','本科','双桨');
    INSERT INTO athlete_body_measurements(athlete_id,measurement_date,height_cm,weight_kg,is_demo)
      VALUES(9310,'2025-12-01',175,68,0),(9310,'2025-12-02',193,90,1);
    INSERT INTO test_sessions(id,athlete_id,test_date,test_type,protocol,project_code,project_status)
      VALUES(9310,9310,'2025-12-01','力量素质测试','实测1RM','ROWING','confirmed'),
      (9311,9310,'2025-12-02','FMS测试','功能动作筛查（FMS）','ROWING','confirmed');
    INSERT INTO metric_definitions(code,label,domain,unit,direction,frequency)
      VALUES('ybt_left','YBT 左前伸','fitness','cm','neutral','session');
    INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit)
      VALUES(9310,'squat_kg',95,'kg'),(9310,'ybt_left',64,'cm');
    INSERT INTO injury_records(athlete_id,record_type,injury_name,body_part,status,onset_date,created_by)
      VALUES(9310,'formal','合成伤病','膝','rehab','2025-11-30',9302);
    INSERT INTO fms_import_observations(test_session_id,metric_code,observation_json,data_import_batch_id)
      VALUES(9311,'fms_hurdle_step','{"left":0}','synthetic');
    INSERT INTO training_sessions(id,athlete_id,session_date,training_type,structure_type,intensity_zone,content,duration_min,duration_reported,created_by,project_code,project_status)
      VALUES(9310,9310,'2025-12-01','体能训练','','','核心稳定',45,1,9302,'ROWING','confirmed'),
      (9311,9310,'2025-12-02','体能训练','','','力量训练',0,0,9301,'ROWING','confirmed');
    INSERT INTO strength_result_sets(training_session_id,exercise_name,actual_reps,actual_weight_kg,training_category,created_by)
      VALUES(9310,'平板支撑',2,0,'核心力量',9302);
    INSERT INTO training_plans(athlete_id,plan_date,start_date,end_date,title,plan_data,created_by,updated_by,model,team_id,status)
      SELECT 9310,'2025-12-01','2025-12-01','2025-12-07','合成安排',
        '{"sessions":[{"date":"2025-12-01","category":"physical","content":"深蹲","durationMin":35,"items":[{"title":"深蹲"}]}]}',
        9302,9302,'team',id,'published' FROM project_teams WHERE name='合成一队';
  `);
  const teamId = (name: string) => (db.prepare('SELECT id FROM project_teams WHERE name=?').get(name) as { id: number }).id;
  const firstTeam = teamId('合成一队');
  const secondTeam = teamId('合成二队');
  const fetchBasic = (id?: number, team: number | null = firstTeam) => fetch(
    `${url}/basic${team === null ? '' : `?teamId=${team}`}`,
    id ? { headers: { Authorization: `Bearer ${jwt.sign({ id, sessionVersion: 1 }, secret)}` } } : {}
  );
  const response = await fetchBasic(9301);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const report = await response.json() as BasicSubmissionReport;
  const rows = (name: string) => report.sheets.find(sheet => sheet.name === name)!.rows.slice(1);
  expect(report.team).toBe('合成一队');
  expect(JSON.stringify(report)).not.toContain('其他队运动员');
  expect(rows('队伍汇总')).toContainEqual(['赛艇', '合成一队', 2, report.asOf]);
  expect(rows('填报汇总')).toEqual([
    ['运动员档案', 0, 1, 1],
    ['体能与专项测试', 1, 0, 1],
    ['功能筛查', 1, 0, 1],
    ['每日训练', 1, 0, 1],
  ]);
  expect(rows('运动员档案').find(row => row[1] === '检查用合成队员')).toEqual([
    9310, '检查用合成队员', '部分填写', '代表队伍', '女', expect.any(Number), 175, 68, 0,
    '6:50.0', '合成籍贯', '', '本科', '双桨', '合成伤病（康复中）',
  ]);
  expect(rows('体能与专项测试')).toContainEqual([9310, '检查用合成队员', '已填写', 1, '2025-12-01']);
  expect(rows('功能筛查')).toContainEqual([9310, '检查用合成队员', '已填写', 2, '2025-12-02']);
  expect(rows('每日训练')).toContainEqual([9310, '检查用合成队员', '已填写', 2, 2, '2025-12-02']);
  expect(rows('每日训练')).toContainEqual([9312, '待填合成队员', '未填写', 0, 0, '']);
  expect(JSON.stringify(report)).not.toContain('合成运动员');
  const empty = await fetchBasic(9301, teamId('合成空队'));
  expect(empty.status).toBe(200);
  const emptyReport = await empty.json() as BasicSubmissionReport;
  expect(emptyReport.sheets[0].rows[1]).toEqual(['赛艇', '合成空队', 0, report.asOf]);
  expect((await fetchBasic(9301, secondTeam)).status).toBe(404);
  expect((await fetchBasic(9304)).status).toBe(404);
  expect((await fetchBasic(9304, secondTeam)).status).toBe(200);
  expect((await fetchBasic(9301, null)).status).toBe(400);
  expect((await fetchBasic(9302)).status).toBe(403);
  expect((await fetchBasic()).status).toBe(401);
});
