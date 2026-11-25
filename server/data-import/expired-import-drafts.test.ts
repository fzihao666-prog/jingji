import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
import { db } from '../core/db.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
import { advanceImportRevision } from './data-import-revision.ts';
import type { ImportDraftCleanupPreview } from '../../shared/import-draft-cleanup.js';

let server: Server;
let base: string;
let token: string;
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'synthetic-expired-drafts-test-only');
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: false });
  db.prepare(
    "INSERT INTO users(id,username,password_hash,display_name,role) VALUES (701,'expired-drafts-test','test','虚构教练','SCC'),(702,'expired-drafts-other','test','其他虚构教练','SCC')"
  ).run();
  db.exec(
    "INSERT INTO user_area_permissions(user_id,area_level,granted_by) VALUES (701,'national',701); INSERT INTO user_project_permissions(user_id,project,granted_by) VALUES (701,'ROWING',701); INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES (701,'ROWING','清理测试甲队',701); INSERT INTO project_teams(project,name) VALUES ('ROWING','清理测试甲队')"
  );
  const { registerDataImportRoutes } = await import('./data-import-routes.ts');
  const { jwtSecret } = await import('../core/auth.ts');
  token = jwt.sign({ id: 701, sessionVersion: 1 }, jwtSecret);
  const app = express();
  app.use(express.json());
  registerDataImportRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  base = `http://127.0.0.1:${address.port}/api/data-import/draft-cleanup`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  db.exec(
    "DROP TRIGGER IF EXISTS cleanup_audit_failure; UPDATE athletes SET data_import_batch_id=NULL; DELETE FROM metric_scoring_rules WHERE source_batch_id IS NOT NULL; DELETE FROM data_import_batches; DELETE FROM audit_logs WHERE action='CLEANUP_EXPIRED_IMPORT_DRAFTS'; UPDATE user_team_permissions SET team='清理测试甲队' WHERE user_id=701"
  );
  draft('old');
});
function draft(
  id: string,
  owner = 701,
  project = 'ROWING',
  summary = { revision: 0, accessTeams: ['清理测试甲队'] }
) {
  db.prepare(
    "INSERT INTO data_import_batches(id,file_hash,source_filename,project,parser_version,created_by,created_at,summary_json) VALUES (?,?,?,?,'test',?,datetime('now','-40 days'),?)"
  ).run(id, id, `${id}.xlsx`, project, owner, JSON.stringify(summary));
}
async function preview(auth = token) {
  const response = await fetch(`${base}?project=ROWING`, {
    headers: { authorization: `Bearer ${auth}` },
  });
  return { status: response.status, body: (await response.json()) as ImportDraftCleanupPreview };
}
async function cleanup(
  drafts: Array<{ id: string; revision: number }>,
  extra: Record<string, unknown> = {}
) {
  const response = await fetch(base, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ project: 'ROWING', drafts, ...extra }),
  });
  return {
    status: response.status,
    body: (await response.json()) as { deletedCount?: number; message?: string },
  };
}
const exists = (id: string) =>
  Boolean(db.prepare('SELECT id FROM data_import_batches WHERE id=?').get(id));

it('预览只返回本人、当前项目和授权范围内无入库痕迹的过期草稿', async () => {
  draft('legacy-edited', 701, 'ROWING', { revision: 3, accessTeams: ['清理测试甲队'] });
  draft('new');
  draft('committed');
  draft('other', 702);
  draft('different-project', 701, 'CANOE_SPRINT');
  draft('unavailable-team', 701, 'ROWING', { revision: 0, accessTeams: [] });
  db.exec(
    "UPDATE data_import_batches SET created_at=datetime('now') WHERE id='new'; UPDATE data_import_batches SET status='committed',committed_at=datetime('now') WHERE id='committed'"
  );
  db.prepare(
    "INSERT INTO data_import_athlete_candidates(batch_id,normalized_name,name,project,team) VALUES ('unavailable-team','虚构新人','虚构新人','ROWING','权限外队伍')"
  ).run();
  const result = await preview();
  expect(result.status).toBe(200);
  expect(result.body.retentionDays).toBe(30);
  expect(result.body.drafts.map((row) => row.id)).toEqual(['old']);
  expect((await preview('invalid')).status).toBe(401);
});
it('近期校对延后过期时间，预览后已修改的草稿不会被删除', async () => {
  expect((await preview()).body.drafts).toHaveLength(1);
  advanceImportRevision('old', 701, 0);
  expect((await preview()).body.drafts).toEqual([]);
  expect((await cleanup([{ id: 'old', revision: 0 }])).status).toBe(409);
  expect(exists('old')).toBe(true);
});
it('有正式数据标记、正式引用或入库数量的批次均保留', async () => {
  draft('imported');
  draft('formal-athlete');
  draft('committed-item');
  draft('new-athlete-candidate');
  db.exec(
    "UPDATE data_import_batches SET imported_count=1 WHERE id='imported'; UPDATE athletes SET data_import_batch_id='formal-athlete' WHERE id=1"
  );
  db.prepare(
    "INSERT INTO data_import_items(batch_id,item_type,source_sheet,source_address,quality,committed_entity_type) VALUES ('committed-item','body_measurement','身体测量','A2','valid','body_measurement')"
  ).run();
  db.prepare(
    "INSERT INTO data_import_athlete_candidates(batch_id,normalized_name,name,project,team,created_athlete_id) VALUES ('new-athlete-candidate','虚构队员','虚构队员','ROWING','清理测试甲队',1)"
  ).run();
  expect((await preview()).body.drafts.map((row) => row.id)).toEqual(['old']);
});
it('确认后级联删除暂存明细，记录审计；正式数据保持不变，重复清理被拒绝', async () => {
  db.prepare(
    "INSERT INTO data_import_items(batch_id,item_type,source_sheet,source_address,quality) VALUES ('old','body_measurement','身体测量','A2','valid')"
  ).run();
  db.prepare(
    "INSERT INTO data_import_athlete_candidates(batch_id,normalized_name,name,project,team) VALUES ('old','虚构待确认队员','虚构待确认队员','ROWING','清理测试甲队')"
  ).run();
  const before = db.prepare('SELECT COUNT(*) AS n FROM athletes').get();
  expect((await cleanup([{ id: 'old', revision: 0 }])).body.deletedCount).toBe(1);
  expect(exists('old')).toBe(false);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM data_import_items WHERE batch_id='old'").get()
  ).toEqual({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM athletes').get()).toEqual(before);
  expect(
    db
      .prepare("SELECT COUNT(*) AS n FROM data_import_athlete_candidates WHERE batch_id='old'")
      .get()
  ).toEqual({ n: 0 });
  expect(
    db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='CLEANUP_EXPIRED_IMPORT_DRAFTS'")
      .get()
  ).toEqual({ n: 1 });
  expect((await cleanup([{ id: 'old', revision: 0 }])).status).toBe(409);
});
it('混入其他账号或过期修订使整批失败；拒绝重复ID与额外参数', async () => {
  draft('other', 702);
  expect(
    (
      await cleanup([
        { id: 'old', revision: 0 },
        { id: 'other', revision: 0 },
      ])
    ).status
  ).toBe(409);
  expect(exists('old')).toBe(true);
  expect(exists('other')).toBe(true);
  expect((await cleanup([{ id: 'old', revision: 1 }])).status).toBe(409);
  expect((await cleanup([{ id: ' ', revision: 0 }])).status).toBe(400);
  expect(
    (
      await cleanup([
        { id: 'old', revision: 0 },
        { id: 'old', revision: 0 },
      ])
    ).status
  ).toBe(400);
  expect((await cleanup([{ id: 'old', revision: 0 }], { ownerId: 702 })).status).toBe(400);
});
it('权限撤销后拒绝执行；审计失败时删除整体回滚', async () => {
  await preview();
  db.exec('DELETE FROM user_team_permissions WHERE user_id=701');
  try {
    expect((await cleanup([{ id: 'old', revision: 0 }])).status).toBe(403);
  } finally {
    db.exec(
      "INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES (701,'ROWING','清理测试甲队',701)"
    );
  }
  expect(exists('old')).toBe(true);
  db.exec(
    "CREATE TRIGGER cleanup_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='CLEANUP_EXPIRED_IMPORT_DRAFTS' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"
  );
  expect((await cleanup([{ id: 'old', revision: 0 }])).status).toBe(500);
  expect(exists('old')).toBe(true);
  db.exec('BEGIN IMMEDIATE; ROLLBACK;');
});

it('每次最多预览和清理200批，剩余草稿可再次预览；损坏摘要保守保留', async () => {
  for (let index = 0; index < 201; index += 1) draft(`bulk-${String(index).padStart(3, '0')}`);
  draft('corrupt');
  db.prepare("UPDATE data_import_batches SET summary_json='{invalid' WHERE id='corrupt'").run();
  const first = await preview();
  expect(first.status).toBe(200);
  expect(first.body.drafts).toHaveLength(200);
  expect((await cleanup(first.body.drafts.map(({ id, revision }) => ({ id, revision })))).body.deletedCount).toBe(200);
  expect((await preview()).body.drafts).toHaveLength(2);
  expect(exists('corrupt')).toBe(true);
});
