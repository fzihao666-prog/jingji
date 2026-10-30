import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { weeklyReportTypeSchema, type TeamWeeklyReport } from '../../shared/team-weekly-report.ts';
import type { TeamWeeklyCommentary } from '../../shared/team-weekly-ai.ts';
import {
  savedTeamWeeklyReportSchema,
  type SavedTeamWeeklyReport,
  type TeamWeeklyHistoryItem,
  type WeeklyPhoto,
} from '../../shared/team-weekly-storage.ts';
export class WeeklyStoreError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export function initializeTeamWeeklyStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS team_weekly_reports(id TEXT PRIMARY KEY,project TEXT NOT NULL,team_id INTEGER NOT NULL,week_start TEXT NOT NULL,report_type TEXT NOT NULL,team_name TEXT NOT NULL,revision INTEGER NOT NULL,saved_at TEXT NOT NULL,user_id INTEGER NOT NULL,athlete_ids TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(project,team_id,week_start,report_type));
 CREATE TABLE IF NOT EXISTS team_weekly_photos(id TEXT PRIMARY KEY,project TEXT NOT NULL,team_id INTEGER NOT NULL,report_type TEXT NOT NULL,user_id INTEGER NOT NULL,created_at INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes INTEGER NOT NULL,report_id TEXT);
 CREATE INDEX IF NOT EXISTS team_weekly_photos_report ON team_weekly_photos(report_id);`);
}
type Key = { project: string; teamId: number; weekStart: string; reportType: string };
export function getWeeklyRevision(db: DatabaseSync, key: Key) {
  return Number(
    db
      .prepare(
        'SELECT revision FROM team_weekly_reports WHERE project=? AND team_id=? AND week_start=? AND report_type=?'
      )
      .get(key.project, key.teamId, key.weekStart, key.reportType)?.revision || 0
  );
}
export function assertWeeklyAccess(ids: number[], accessible: number[]) {
  const allowed = new Set(accessible);
  if (!ids.length || ids.some((id) => !allowed.has(id)))
    throw new WeeklyStoreError(403, '当前权限无法访问这份报告的全部队员。');
}
export function photoMetadata(row: Record<string, unknown>): WeeklyPhoto {
  return {
    id: String(row.id),
    width: Number(row.width),
    height: Number(row.height),
    bytes: Number(row.bytes),
    url: `/api/reports/weekly/photos/${row.id}`,
  };
}
export function getConfirmedWeekly(
  db: DatabaseSync,
  id: string,
  accessible: number[]
): SavedTeamWeeklyReport {
  const row = db.prepare('SELECT * FROM team_weekly_reports WHERE id=?').get(id);
  if (!row) throw new WeeklyStoreError(404, '报告不存在。');
  assertWeeklyAccess(JSON.parse(String(row.athlete_ids)), accessible);
  return savedTeamWeeklyReportSchema.parse({
    ...JSON.parse(String(row.snapshot)),
    id: String(row.id),
    revision: Number(row.revision),
    savedAt: String(row.saved_at),
    photos: db
      .prepare('SELECT * FROM team_weekly_photos WHERE report_id=? ORDER BY created_at,id')
      .all(id)
      .map(photoMetadata),
  });
}
export function listConfirmedWeekly(
  db: DatabaseSync,
  filters: { project: string; teamId: number; reportType?: string; week?: string; page?: number },
  accessible: number[]
) {
  const where = `project=? AND team_id=? AND (? IS NULL OR report_type=?) AND (? IS NULL OR week_start=?) AND json_array_length(athlete_ids)>0 AND NOT EXISTS(SELECT 1 FROM json_each(athlete_ids) a WHERE a.value NOT IN(SELECT value FROM json_each(?)))`;
  const args = [
    filters.project,
    filters.teamId,
    filters.reportType ?? null,
    filters.reportType ?? null,
    filters.week || null,
    filters.week || null,
    JSON.stringify(accessible),
  ];
  const page = filters.page || 1;
  const total = Number(
    db.prepare(`SELECT count(*) AS total FROM team_weekly_reports WHERE ${where}`).get(...args)
      ?.total || 0
  );
  const visible = db
    .prepare(
      `SELECT id,project,team_id,team_name,week_start,report_type,revision,saved_at FROM team_weekly_reports WHERE ${where} ORDER BY week_start DESC,saved_at DESC LIMIT 20 OFFSET ?`
    )
    .all(...args, (page - 1) * 20);
  return {
    page,
    pageSize: 20,
    total,
    items: visible.map(
      (r) =>
        ({
          id: String(r.id),
          project: String(r.project),
          teamId: Number(r.team_id),
          teamName: String(r.team_name),
          weekStart: String(r.week_start),
          reportType: weeklyReportTypeSchema.parse(r.report_type),
          revision: Number(r.revision),
          savedAt: String(r.saved_at),
        }) satisfies TeamWeeklyHistoryItem
    ),
  };
}
export function saveConfirmedWeekly(
  db: DatabaseSync,
  input: {
    report: TeamWeeklyReport;
    commentary: TeamWeeklyCommentary;
    photoIds: string[];
    expectedRevision: number;
    userId: number;
  },
  validateFacts: () => void
) {
  const { report, photoIds } = input;
  if (photoIds.length > 8 || new Set(photoIds).size !== photoIds.length)
    throw new WeeklyStoreError(400, '照片最多八张且不能重复。');
  let confirmedId: string;
  let removedPhotoIds: string[];
  db.exec('BEGIN IMMEDIATE');
  try {
    validateFacts();
    const existing = db
      .prepare(
        'SELECT id,revision FROM team_weekly_reports WHERE project=? AND team_id=? AND week_start=? AND report_type=?'
      )
      .get(report.project, report.teamId, report.range.from, report.reportType);
    if (Number(existing?.revision || 0) !== input.expectedRevision)
      throw new WeeklyStoreError(409, '报告已更新，请重新加载后保存。');
    const id = existing ? String(existing.id) : randomUUID();
    const revision = input.expectedRevision + 1;
    const savedAt = new Date().toISOString();
    for (const photoId of photoIds) {
      const photo = db.prepare('SELECT * FROM team_weekly_photos WHERE id=?').get(photoId);
      if (
        !photo ||
        photo.project !== report.project ||
        photo.team_id !== report.teamId ||
        photo.report_type !== report.reportType ||
        (photo.report_id ? photo.report_id !== id : photo.user_id !== input.userId)
      )
        throw new WeeklyStoreError(403, '照片不属于当前报告或账号。');
    }
    const oldPhotoIds = db
      .prepare('SELECT id FROM team_weekly_photos WHERE report_id=?')
      .all(id)
      .map((r) => String(r.id));
    db.prepare(
      'INSERT INTO team_weekly_reports VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project,team_id,week_start,report_type) DO UPDATE SET revision=excluded.revision,saved_at=excluded.saved_at,user_id=excluded.user_id,athlete_ids=excluded.athlete_ids,snapshot=excluded.snapshot,team_name=excluded.team_name'
    ).run(
      id,
      report.project,
      report.teamId,
      report.range.from,
      report.reportType,
      report.teamName,
      revision,
      savedAt,
      input.userId,
      JSON.stringify(report.athletes.map((a) => a.id)),
      JSON.stringify({ report, commentary: input.commentary })
    );
    db.prepare('UPDATE team_weekly_photos SET report_id=NULL WHERE report_id=?').run(id);
    for (const photoId of photoIds)
      db.prepare('UPDATE team_weekly_photos SET report_id=? WHERE id=?').run(id, photoId);
    db.exec('COMMIT');
    confirmedId = id;
    removedPhotoIds = oldPhotoIds.filter((photoId) => !photoIds.includes(photoId));
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    saved: getConfirmedWeekly(
      db,
      confirmedId,
      report.athletes.map((a) => a.id)
    ),
    removedPhotoIds,
  };
}
