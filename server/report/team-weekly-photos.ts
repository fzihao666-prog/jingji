import { randomUUID } from 'node:crypto';
import { unlinkSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import type { WeeklyPhotoScope } from '../../shared/team-weekly-storage.ts';
import { getConfirmedWeekly, photoMetadata, WeeklyStoreError } from './team-weekly-store.ts';
export const WEEKLY_TEMP_PHOTO_LIMITS = {
  accountCount: 32,
  accountBytes: 64 * 1024 * 1024,
  globalBytes: 512 * 1024 * 1024,
} as const;
export function createTeamWeeklyPhotoStore(db: DatabaseSync, directory: string) {
  const path = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new WeeklyStoreError(404, '照片不存在。');
    return join(directory, `${id}.jpg`);
  };
  async function cleanupUnreferenced(ids: string[]) {
    for (const id of ids) {
      const row = db.prepare('SELECT report_id FROM team_weekly_photos WHERE id=?').get(id);
      if (!row || row.report_id) continue;
      try {
        unlinkSync(path(id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      db.prepare('DELETE FROM team_weekly_photos WHERE id=? AND report_id IS NULL').run(id);
    }
  }
  async function cleanup() {
    const ids = db
      .prepare('SELECT id FROM team_weekly_photos WHERE report_id IS NULL AND created_at<?')
      .all(Date.now() - 86400000)
      .map((r) => String(r.id));
    await cleanupUnreferenced(ids);
    let entries;
    try {
      entries = await opendir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for await (const entry of entries) {
      if (
        !entry.isFile() ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jpg$/.test(entry.name)
      )
        continue;
      const id = entry.name.slice(0, -4);
      try {
        if (statSync(path(id)).mtimeMs >= Date.now() - 86400000) continue;
        if (db.prepare('SELECT id FROM team_weekly_photos WHERE id=?').get(id)) continue;
        unlinkSync(path(id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  function checkTemporaryQuota(userId: number, bytes: number) {
    const total = db
      .prepare(
        `SELECT count(*) AS count,coalesce(sum(bytes),0) AS bytes FROM team_weekly_photos WHERE report_id IS NULL AND user_id=?`
      )
      .get(userId)!;
    const global = db
      .prepare(
        'SELECT coalesce(sum(bytes),0) AS bytes FROM team_weekly_photos WHERE report_id IS NULL'
      )
      .get()!;
    if (
      Number(total.count) >= WEEKLY_TEMP_PHOTO_LIMITS.accountCount ||
      Number(total.bytes) + bytes > WEEKLY_TEMP_PHOTO_LIMITS.accountBytes ||
      Number(global.bytes) + bytes > WEEKLY_TEMP_PHOTO_LIMITS.globalBytes
    )
      throw new WeeklyStoreError(429, '待确认照片较多，请先保存报告或移除不再使用的照片。');
  }
  async function upload(buffer: Buffer, scope: WeeklyPhotoScope & { userId: number }) {
    checkTemporaryQuota(scope.userId, 0);
    if (buffer.length > 8 * 1024 * 1024) throw new WeeklyStoreError(400, '每张照片不能超过8MB。');
    let result: Buffer;
    try {
      const decoder = sharp(buffer, {
        limitInputPixels: 25_000_000,
        animated: false,
        failOn: 'error',
      });
      const meta = await decoder.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages || 1) > 1)
        throw new Error('format');
      result = await decoder
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new WeeklyStoreError(400, '照片须为有效的JPEG、PNG或WebP，且解码尺寸不能过大。');
    }
    const dimensions = await sharp(result).metadata();
    const id = randomUUID();
    await mkdir(directory, { recursive: true });
    await writeFile(path(id), result, { flag: 'wx', mode: 0o600 });
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        checkTemporaryQuota(scope.userId, result.length);
        db.prepare(
          'INSERT INTO team_weekly_photos(id,project,team_id,report_type,user_id,created_at,width,height,bytes) VALUES(?,?,?,?,?,?,?,?,?)'
        ).run(
          id,
          scope.project,
          scope.teamId,
          scope.reportType,
          scope.userId,
          Date.now(),
          dimensions.width!,
          dimensions.height!,
          result.length
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      await unlink(path(id));
      throw error;
    }
    return photoMetadata({
      id,
      width: dimensions.width,
      height: dimensions.height,
      bytes: result.length,
    });
  }
  function authorize(id: string, userId: number, accessible: number[]) {
    const row = db.prepare('SELECT * FROM team_weekly_photos WHERE id=?').get(id);
    if (!row) throw new WeeklyStoreError(404, '照片不存在。');
    if (row.report_id) getConfirmedWeekly(db, String(row.report_id), accessible);
    else if (row.user_id !== userId) throw new WeeklyStoreError(403, '无权查看此照片。');
    return row;
  }
  async function read(id: string, userId: number, accessible: number[]) {
    authorize(id, userId, accessible);
    return readFile(path(id));
  }
  async function remove(id: string, userId: number, accessible: number[]) {
    const row = authorize(id, userId, accessible);
    if (row.report_id) throw new WeeklyStoreError(409, '已确认报告的照片不能单独删除。');
    await cleanupUnreferenced([id]);
  }
  return { upload, read, remove, cleanup, cleanupUnreferenced, authorize };
}
export type TeamWeeklyPhotoStore = ReturnType<typeof createTeamWeeklyPhotoStore>;
