import { copyFile, mkdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** 从备份数据库读取确认清单，避免将备份时点之后的附件混入恢复资料。 */
export async function backupWeeklyReportPhotos(
  databasePath: string,
  backupPath: string
): Promise<string | null> {
  const snapshot = new DatabaseSync(backupPath, { readOnly: true });
  let photoIds: string[];
  try {
    if (
      !snapshot
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_weekly_photos'")
        .get()
    )
      return null;
    photoIds = snapshot
      .prepare('SELECT id FROM team_weekly_photos WHERE report_id IS NOT NULL ORDER BY id')
      .all()
      .map((row) => String(row.id));
  } finally {
    snapshot.close();
  }
  if (!photoIds.length) return null;
  const destination = backupPath + '.weekly-photos';
  try {
    await mkdir(destination, { mode: 0o700 });
    for (const id of photoIds) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
        throw new Error('报告照片清单无效。');
      await copyFile(
        join(dirname(databasePath), 'weekly-report-photos', id + '.jpg'),
        join(destination, id + '.jpg'),
        constants.COPYFILE_EXCL
      );
    }
    return destination;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw new Error('周总结照片备份失败，本次备份不可用于恢复。', { cause: error });
  }
}
