import express from 'express';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile, utimes, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { AuthUser } from '../core/shared-server.ts';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { emptyTeamWeeklyCommentary } from '../../shared/team-weekly-ai.ts';
import { z } from 'zod';
import {
  weeklyPhotoScopeSchema,
  type SavedTeamWeeklyReport,
} from '../../shared/team-weekly-storage.ts';
import { createTeamWeeklyPhotoStore } from './team-weekly-photos.ts';
import {
  initializeTeamWeeklyStore,
  saveConfirmedWeekly,
  WeeklyStoreError,
} from './team-weekly-store.ts';
import { registerWeeklyHistoryRoutes } from './team-weekly-history-routes.ts';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const db = createTeamWeeklyFixture();
  initializeTeamWeeklyStore(db);
  const dir = await mkdtemp(join(tmpdir(), 'weekly-routes-'));
  const photoStore = createTeamWeeklyPhotoStore(db, dir);
  const user: AuthUser = {
    id: 1,
    username: 'synthetic',
    displayName: '合成教练',
    role: 'SCC',
    athleteId: null,
    sessionVersion: 1,
  };
  const state = { active: true, allowed: true, ids: [1, 3] };
  const app = express();
  const renderPdf = vi.fn((saved: SavedTeamWeeklyReport, photos: Buffer[]) => {
    void saved;
    void photos;
    return Buffer.from('synthetic-pdf');
  });
  registerWeeklyHistoryRoutes(app, {
    db,
    photoStore,
    renderPdf,
    requireAuth: (req, _res, next) => {
      req.authUser = user;
      next();
    },
    currentUser: () => (state.active ? user : null),
    accessibleIds: () => state.ids,
    authorizeScope: (_user, scope) => {
      if (!state.allowed || scope.project !== 'ROWING' || scope.teamId !== 1)
        throw new WeeklyStoreError(403, '范围无权访问');
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reports/weekly`;
  const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const scope = { project: 'ROWING', teamId: 1, reportType: 'special' as const, userId: 1 };
  const upload = (field = 'files', extra = false) => {
    const form = new FormData();
    form.set('project', 'ROWING');
    form.set('teamId', '1');
    form.set('reportType', 'special');
    if (extra) form.set('unknown', 'value');
    form.append(field, new Blob([new Uint8Array(image)], { type: 'image/png' }), 'test.png');
    return fetch(`${base}/photos`, { method: 'POST', body: form });
  };
  const save = (photoIds: string[]) => {
    const report = readTeamWeeklyReport(
      db,
      { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'special' },
      [1, 3]
    );
    return saveConfirmedWeekly(
      db,
      { report, commentary: emptyTeamWeeklyCommentary(), photoIds, expectedRevision: 0, userId: 1 },
      () => {}
    ).saved;
  };
  return { db, dir, state, photoStore, base, image, scope, upload, save, renderPdf };
}
it('files上传返回私有照片；读取响应禁止缓存且拒绝过期scope', async () => {
  const s = await setup();
  const uploaded = await s.upload();
  expect(uploaded.status).toBe(200);
  const { photos } = z
    .object({ photos: z.array(z.object({ id: z.string() })) })
    .parse(await uploaded.json());
  expect(photos).toHaveLength(1);
  const response = await fetch(s.base + `/photos/${photos[0].id}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-type')).toContain('image/jpeg');
  s.state.allowed = false;
  expect((await fetch(s.base + `/photos/${photos[0].id}`)).status).toBe(403);
});
it('拒绝错误multipart字段及未知查询字段', async () => {
  const s = await setup();
  expect((await s.upload('file')).status).toBe(400);
  expect((await s.upload('files', true)).status).toBe(400);
  expect(
    weeklyPhotoScopeSchema.safeParse({
      project: 'ROWING',
      teamId: 1,
      reportType: 'special',
      unexpected: 1,
    }).success
  ).toBe(false);
  expect(
    (await fetch(s.base + '/history?project=ROWING&teamId=1&reportType=special&extra=1')).status
  ).toBe(400);
});
it('照片异步读取期间撤权不得返回内容', async () => {
  const s = await setup();
  const photo = await s.photoStore.upload(s.image, s.scope);
  const original = s.photoStore.read;
  vi.spyOn(s.photoStore, 'read').mockImplementation(async (...args) => {
    const bytes = await original(...args);
    s.state.active = false;
    return bytes;
  });
  const response = await fetch(s.base + `/photos/${photo.id}`);
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('synthetic-pdf');
});
it('历史PDF读取附件期间收紧队员权限不得输出PDF', async () => {
  const s = await setup();
  const photo = await s.photoStore.upload(s.image, s.scope);
  const saved = s.save([photo.id]);
  const original = s.photoStore.read;
  vi.spyOn(s.photoStore, 'read').mockImplementation(async (...args) => {
    const bytes = await original(...args);
    s.state.ids = [1];
    return bytes;
  });
  const response = await fetch(s.base + `/history/${saved.id}/pdf`);
  expect(response.status).toBe(403);
  expect(s.renderPdf).not.toHaveBeenCalled();
});
it('上传期间撤权会清除新临时附件；清理失败仍返回原权限错误', async () => {
  const s = await setup();
  const original = s.photoStore.upload;
  vi.spyOn(s.photoStore, 'upload').mockImplementation(async (...args) => {
    const photo = await original(...args);
    s.state.active = false;
    return photo;
  });
  expect((await s.upload()).status).toBe(403);
  expect(s.db.prepare('SELECT count(*) AS n FROM team_weekly_photos').get()?.n).toBe(0);
  s.state.active = true;
  vi.spyOn(s.photoStore, 'cleanupUnreferenced').mockRejectedValue(Error('disk unavailable'));
  expect((await s.upload()).status).toBe(403);
});
it('历史查询过滤失去访问权限的快照，下载使用保存数据', async () => {
  const s = await setup();
  const saved = s.save([]);
  const response = await fetch(s.base + `/history/${saved.id}/pdf`);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('synthetic-pdf');
  expect(s.renderPdf.mock.calls[0]?.[0]).toEqual(saved);
  s.state.ids = [1];
  expect((await fetch(s.base + `/history/${saved.id}`)).status).toBe(403);
  const list = z
    .object({ total: z.number(), items: z.array(z.unknown()) })
    .parse(
      await (await fetch(s.base + '/history?project=ROWING&teamId=1&reportType=special')).json()
    );
  expect(list.total).toBe(0);
  expect(list.items).toEqual([]);
});
it('只回收超过24小时且没有数据库行的UUID.jpg孤儿文件', async () => {
  const s = await setup();
  const old = join(s.dir, randomUUID() + '.jpg');
  const fresh = join(s.dir, randomUUID() + '.jpg');
  const unrelated = join(s.dir, 'notes.jpg');
  await writeFile(old, 'old');
  await writeFile(fresh, 'fresh');
  await writeFile(unrelated, 'unrelated');
  await utimes(old, 0, 0);
  await utimes(unrelated, 0, 0);
  const photo = await s.photoStore.upload(s.image, s.scope);
  s.save([photo.id]);
  await utimes(join(s.dir, photo.id + '.jpg'), 0, 0);
  await s.photoStore.cleanup();
  await expect(access(old)).rejects.toThrow();
  await access(fresh);
  await access(unrelated);
  await access(join(s.dir, photo.id + '.jpg'));
});

it('按账号在multer前限制十分钟12次上传，过期后恢复', async () => {
  const s = await setup();
  for (let i = 0; i < 12; i++) expect((await s.upload('file')).status).toBe(400);
  const blocked = await s.upload();
  expect(blocked.status).toBe(429);
  expect(s.db.prepare('SELECT count(*) AS n FROM team_weekly_photos').get()?.n).toBe(0);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 600001);
  expect((await s.upload()).status).toBe(200);
});
