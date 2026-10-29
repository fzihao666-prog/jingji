import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  utimesSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { runBackup, cleanupOldBackups, backupDatabase } from './backup.ts';
import { backupWeeklyReportPhotos } from './weekly-report-photo-backup.ts';
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture(withTable = true) {
  const root = mkdtempSync(join(tmpdir(), 'weekly-backup-'));
  directories.push(root);
  const source = join(root, 'source.db');
  const backups = join(root, 'backups');
  const photos = join(root, 'weekly-report-photos');
  mkdirSync(photos);
  const db = new DatabaseSync(source);
  db.exec(
    "CREATE TABLE training_facts(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO training_facts VALUES(1,'synthetic')"
  );
  if (withTable) db.exec('CREATE TABLE team_weekly_photos(id TEXT PRIMARY KEY,report_id TEXT)');
  db.close();
  return { root, source, backups, photos };
}
function photo(source: string, id: string, report: string | null) {
  const db = new DatabaseSync(source);
  try {
    db.prepare('INSERT INTO team_weekly_photos VALUES(?,?)').run(id, report);
  } finally {
    db.close();
  }
}
it('完整备份从SQLite快照清单复制确认附件，排除临时附件', async () => {
  const f = fixture();
  const confirmed = randomUUID(),
    temporary = randomUUID();
  photo(f.source, confirmed, 'saved-report');
  photo(f.source, temporary, null);
  writeFileSync(join(f.photos, confirmed + '.jpg'), 'synthetic JPEG');
  writeFileSync(join(f.photos, temporary + '.jpg'), 'temporary JPEG');
  const result = await runBackup({ databasePath: f.source, backupDir: f.backups });
  expect(readdirSync(result.backupPath + '.weekly-photos')).toEqual([confirmed + '.jpg']);
  expect(readFileSync(join(result.backupPath + '.weekly-photos', confirmed + '.jpg'), 'utf8')).toBe(
    'synthetic JPEG'
  );
  const snapshot = new DatabaseSync(result.backupPath, { readOnly: true });
  try {
    expect(snapshot.prepare('SELECT value FROM training_facts').get()?.value).toBe('synthetic');
  } finally {
    snapshot.close();
  }
});
it('附件缺失时本次数据库和已复制附件一并移除，不删除正式照片或旧备份', async () => {
  const f = fixture();
  const present = '00000000-0000-4000-8000-000000000001',
    missing = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  photo(f.source, present, 'saved');
  photo(f.source, missing, 'saved');
  writeFileSync(join(f.photos, present + '.jpg'), 'confirmed');
  mkdirSync(f.backups);
  writeFileSync(join(f.backups, 'jingji-older.db'), 'older');
  await expect(runBackup({ databasePath: f.source, backupDir: f.backups })).rejects.toThrow(
    '照片备份失败'
  );
  expect(readdirSync(f.backups)).toEqual(['jingji-older.db']);
  expect(readFileSync(join(f.photos, present + '.jpg'), 'utf8')).toBe('confirmed');
});
it('按备份快照读取清单，忽略备份完成后新增的确认图片', async () => {
  const f = fixture();
  const id = randomUUID();
  photo(f.source, id, 'saved');
  writeFileSync(join(f.photos, id + '.jpg'), 'confirmed');
  const backupPath = await backupDatabase(f.source, f.backups);
  photo(f.source, randomUUID(), 'later-report');
  await backupWeeklyReportPhotos(f.source, backupPath);
  expect(readdirSync(backupPath + '.weekly-photos')).toEqual([id + '.jpg']);
});
it('过期只删除对应basename的附件目录，保留相邻目录与非自动备份', () => {
  const f = fixture();
  mkdirSync(f.backups);
  const old = join(f.backups, 'jingji-old.db');
  writeFileSync(old, 'old');
  utimesSync(old, 0, 0);
  mkdirSync(old + '.weekly-photos');
  writeFileSync(join(old + '.weekly-photos', 'image.jpg'), 'old-photo');
  for (const name of [
    'jingji-other.db.weekly-photos',
    'manual.db.weekly-photos',
    'jingji-old.db.weekly-photos-extra',
  ])
    mkdirSync(join(f.backups, name));
  expect(cleanupOldBackups(f.backups, 7)).toBe(1);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(old + '.weekly-photos')).toBe(false);
  expect(readdirSync(f.backups).sort()).toEqual(
    [
      'jingji-old.db.weekly-photos-extra',
      'jingji-other.db.weekly-photos',
      'manual.db.weekly-photos',
    ].sort()
  );
});
it('旧数据库没有照片表时仍成功备份且不创建附件目录', async () => {
  const f = fixture(false);
  const result = await runBackup({ databasePath: f.source, backupDir: f.backups });
  expect(existsSync(result.backupPath)).toBe(true);
  expect(existsSync(result.backupPath + '.weekly-photos')).toBe(false);
});
