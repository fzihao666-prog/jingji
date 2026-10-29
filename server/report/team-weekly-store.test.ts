import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { emptyTeamWeeklyCommentary } from '../../shared/team-weekly-ai.ts';
import {
  initializeTeamWeeklyStore,
  saveConfirmedWeekly,
  getConfirmedWeekly,
  listConfirmedWeekly,
} from './team-weekly-store.ts';
import { createTeamWeeklyPhotoStore, WEEKLY_TEMP_PHOTO_LIMITS } from './team-weekly-photos.ts';
const dbs: ReturnType<typeof createTeamWeeklyFixture>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
function fixture() {
  const db = createTeamWeeklyFixture();
  dbs.push(db);
  initializeTeamWeeklyStore(db);
  initializeTeamWeeklyStore(db);
  const report = readTeamWeeklyReport(
    db,
    { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'special' },
    [1, 3]
  );
  return {
    db,
    report,
    input: {
      report,
      commentary: emptyTeamWeeklyCommentary(),
      photoIds: [] as string[],
      expectedRevision: 0,
      userId: 1,
    },
  };
}
it('幂等初始化，保存稳定快照、同键替换且拒绝旧修订和失去权限的读取', () => {
  const { db, input, report } = fixture();
  const first = saveConfirmedWeekly(db, input, () => {}).saved;
  report.teamName = '后来名称';
  expect(getConfirmedWeekly(db, first.id, [1, 3]).report.teamName).not.toBe(report.teamName);
  expect(() => getConfirmedWeekly(db, first.id, [1])).toThrow('全部队员');
  expect(
    listConfirmedWeekly(db, { project: 'ROWING', teamId: 1, reportType: 'special' }, [1]).total
  ).toBe(0);
  expect(() => saveConfirmedWeekly(db, input, () => {})).toThrow('已更新');
  expect(() =>
    saveConfirmedWeekly(db, { ...input, expectedRevision: 1 }, () => {
      throw Error('事实变化');
    })
  ).toThrow('事实变化');
  expect(getConfirmedWeekly(db, first.id, [1, 3]).revision).toBe(1);
  expect(saveConfirmedWeekly(db, { ...input, expectedRevision: 1 }, () => {}).saved.id).toBe(
    first.id
  );
  expect(
    listConfirmedWeekly(db, { project: 'ROWING', teamId: 1, reportType: 'special' }, [1, 3]).total
  ).toBe(1);
});
it('照片解码压缩去元数据、授权、绑定与安全回收', async () => {
  const { db, input } = fixture();
  const dir = await mkdtemp(join(tmpdir(), 'weekly-photos-'));
  dirs.push(dir);
  const store = createTeamWeeklyPhotoStore(db, dir);
  const scope = { project: 'ROWING', teamId: 1, reportType: 'special' as const, userId: 1 };
  await expect(store.upload(Buffer.from('bad'), scope)).rejects.toThrow('有效');
  const raw = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: '#ff0000' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const photo = await store.upload(raw, scope);
  expect(photo.width).toBeLessThanOrEqual(1600);
  const bytes = await store.read(photo.id, 1, [1, 3]);
  const meta = await sharp(bytes).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.orientation).toBeUndefined();
  await expect(store.read(photo.id, 2, [1, 3])).rejects.toThrow('无权');
  expect(() =>
    saveConfirmedWeekly(db, { ...input, userId: 2, photoIds: [photo.id] }, () => {})
  ).toThrow('照片');
  expect(() =>
    saveConfirmedWeekly(
      db,
      { ...input, report: { ...input.report, reportType: 'physical' }, photoIds: [photo.id] },
      () => {}
    )
  ).toThrow('照片');
  const saved = saveConfirmedWeekly(db, { ...input, photoIds: [photo.id] }, () => {}).saved;
  expect(() =>
    saveConfirmedWeekly(
      db,
      {
        ...input,
        report: {
          ...input.report,
          range: { ...input.report.range, from: '2026-10-12', to: '2026-10-18' },
        },
        photoIds: [photo.id],
      },
      () => {}
    )
  ).toThrow('照片');
  expect(() =>
    saveConfirmedWeekly(
      db,
      { ...input, expectedRevision: 1, photoIds: ['00000000-0000-4000-8000-000000000000'] },
      () => {}
    )
  ).toThrow('照片');
  expect(getConfirmedWeekly(db, saved.id, [1, 3]).photos[0]?.id).toBe(photo.id);

  await expect(store.read(photo.id, 2, [1])).rejects.toThrow('全部队员');
  db.prepare('UPDATE team_weekly_photos SET created_at=0').run();
  await store.cleanup();
  expect((await store.read(photo.id, 1, [1, 3])).length).toBeGreaterThan(0);
  const replacement = saveConfirmedWeekly(db, { ...input, expectedRevision: 1 }, () => {});
  expect(replacement.saved.id).toBe(saved.id);
  await store.cleanupUnreferenced(replacement.removedPhotoIds);
  await expect(store.read(photo.id, 1, [1, 3])).rejects.toThrow('不存在');
  const temporary = await store.upload(raw, scope);
  db.prepare('UPDATE team_weekly_photos SET created_at=0 WHERE id=?').run(temporary.id);
  await store.cleanup();
  await expect(store.read(temporary.id, 1, [1, 3])).rejects.toThrow('不存在');
});

it('提交后的回读故障保留原错误，不尝试无事务回滚', () => {
  const { db, input } = fixture();
  const original = db.prepare.bind(db);
  const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    if (sql === 'SELECT * FROM team_weekly_reports WHERE id=?') throw new Error('提交后回读故障');
    return original(sql);
  });
  expect(() => saveConfirmedWeekly(db, input, () => {})).toThrow('提交后回读故障');
  prepare.mockRestore();
  expect(db.prepare('SELECT count(*) AS total FROM team_weekly_reports').get()?.total).toBe(1);
});

it('同账号并发上传在压缩后原子复核32张上限，超限文件立即移除', async () => {
  const { db } = fixture();
  const dir = await mkdtemp(join(tmpdir(), 'weekly-quota-'));
  dirs.push(dir);
  const store = createTeamWeeklyPhotoStore(db, dir);
  const insert = db.prepare('INSERT INTO team_weekly_photos VALUES(?,?,?,?,?,?,?,?,?,NULL)');
  for (let i = 0; i < 31; i++)
    insert.run(randomUUID(), 'ROWING', 1, 'special', 1, Date.now(), 10, 10, 100);
  const buffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const scope = { project: 'ROWING', teamId: 1, reportType: 'special' as const, userId: 1 };
  const result = await Promise.allSettled([
    store.upload(buffer, scope),
    store.upload(buffer, scope),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(db.prepare('SELECT count(*) AS n FROM team_weekly_photos').get()?.n).toBe(32);
  expect(await readdir(dir)).toHaveLength(1);
});
it('账户与全局临时字节上限在写入后拒绝并移除本次文件，不影响确认附件', async () => {
  const { db, input } = fixture();
  const dir = await mkdtemp(join(tmpdir(), 'weekly-bytes-'));
  dirs.push(dir);
  const store = createTeamWeeklyPhotoStore(db, dir);
  const buffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const scope = { project: 'ROWING', teamId: 1, reportType: 'special' as const, userId: 1 };
  const confirmed = await store.upload(buffer, scope);
  saveConfirmedWeekly(db, { ...input, photoIds: [confirmed.id] }, () => {});
  db.prepare('UPDATE team_weekly_photos SET bytes=? WHERE id=?').run(
    WEEKLY_TEMP_PHOTO_LIMITS.globalBytes + 1,
    confirmed.id
  );
  const temporary = await store.upload(buffer, scope);
  db.prepare('UPDATE team_weekly_photos SET bytes=? WHERE id=?').run(
    WEEKLY_TEMP_PHOTO_LIMITS.accountBytes - 1,
    temporary.id
  );
  await expect(store.upload(buffer, scope)).rejects.toThrow('待确认照片');
  expect(await readdir(dir)).toHaveLength(2);
  db.prepare('UPDATE team_weekly_photos SET user_id=2,bytes=? WHERE id=?').run(
    WEEKLY_TEMP_PHOTO_LIMITS.globalBytes - 1,
    temporary.id
  );
  await expect(store.upload(buffer, scope)).rejects.toThrow('待确认照片');
  expect(await readdir(dir)).toHaveLength(2);
  expect((await store.read(confirmed.id, 1, [1, 3])).length).toBeGreaterThan(0);
  expect(
    db.prepare('SELECT report_id FROM team_weekly_photos WHERE id=?').get(confirmed.id)?.report_id
  ).toBeTruthy();
});
