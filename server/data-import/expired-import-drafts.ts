import { db } from '../core/db.ts';
import {
  IMPORT_DRAFT_CLEANUP_LIMIT,
  IMPORT_DRAFT_RETENTION_DAYS,
  type ExpiredImportDraft,
} from '../../shared/import-draft-cleanup.js';
import { importRevision, ImportRequestError } from './data-import-revision.ts';

// 正式数据可能通过非外键的批次标记关联；不能只依靠级联删除或状态判断。
const eligible = `b.created_by=? AND b.project=? AND b.status='reviewing'
  AND b.imported_count=0 AND b.committed_at IS NULL
  AND datetime(b.created_at)<datetime('now','-${IMPORT_DRAFT_RETENTION_DAYS} days')
  AND json_valid(b.summary_json)
  AND datetime(COALESCE(json_extract(CASE WHEN json_valid(b.summary_json) THEN b.summary_json ELSE '{}' END,'$.lastActivityAt'),b.created_at))<datetime('now','-${IMPORT_DRAFT_RETENTION_DAYS} days')
  AND (json_extract(CASE WHEN json_valid(b.summary_json) THEN b.summary_json ELSE '{}' END,'$.lastActivityAt') IS NOT NULL OR COALESCE(json_extract(CASE WHEN json_valid(b.summary_json) THEN b.summary_json ELSE '{}' END,'$.revision'),0)=0)
  AND NOT EXISTS (SELECT 1 FROM data_import_items i WHERE i.batch_id=b.id AND (i.committed_entity_id IS NOT NULL OR i.committed_entity_type<>''))
  AND NOT EXISTS (SELECT 1 FROM data_import_athlete_candidates c WHERE c.batch_id=b.id AND c.created_athlete_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM athletes a WHERE a.data_import_batch_id=b.id)
  AND NOT EXISTS (SELECT 1 FROM strength_result_sets s WHERE s.data_import_batch_id=b.id)
  AND NOT EXISTS (SELECT 1 FROM test_measurements t WHERE t.data_import_batch_id=b.id)
  AND NOT EXISTS (SELECT 1 FROM athlete_body_measurements m WHERE m.data_import_batch_id=b.id)
  AND NOT EXISTS (SELECT 1 FROM metric_scoring_rules r WHERE r.source_batch_id=b.id)`;

type CleanupScope = { userId: number; project: string; authorize: (id: string) => void };

export function listExpiredImportDrafts(input: CleanupScope): ExpiredImportDraft[] {
  const rows = db
    .prepare(
      `SELECT b.id,b.source_filename AS filename,b.created_at AS createdAt,b.item_count AS itemCount,b.summary_json AS summary FROM data_import_batches b WHERE ${eligible} ORDER BY b.created_at,b.id`
    )
    .all(input.userId, input.project) as Array<ExpiredImportDraft & { summary: string }>;
  const drafts: ExpiredImportDraft[] = [];
  for (const row of rows) {
    try {
      input.authorize(row.id);
    } catch (error) {
      if (error instanceof ImportRequestError && error.status === 403) continue;
      throw error;
    }
    drafts.push({
      id: row.id,
      filename: row.filename,
      createdAt: row.createdAt,
      itemCount: row.itemCount,
      revision: importRevision(JSON.parse(row.summary)),
    });
    if (drafts.length === IMPORT_DRAFT_CLEANUP_LIMIT) break;
  }
  return drafts;
}

export function cleanupExpiredImportDrafts(
  input: CleanupScope & {
    drafts: Array<{ id: string; revision: number }>;
    authorizeProject: () => void;
  }
) {
  if (
    !input.drafts.length ||
    input.drafts.length > IMPORT_DRAFT_CLEANUP_LIMIT ||
    new Set(input.drafts.map((row) => row.id)).size !== input.drafts.length
  )
    throw new ImportRequestError('请选择1至200个不重复的过期草稿。', 400);
  db.exec('BEGIN IMMEDIATE');
  try {
    input.authorizeProject();
    const available = new Map(listExpiredImportDrafts(input).map((row) => [row.id, row]));
    for (const requested of input.drafts) {
      const current = available.get(requested.id);
      if (!current || current.revision !== requested.revision)
        throw new ImportRequestError(
          '草稿状态、授权或内容已变化，请重新预览；本次未删除任何草稿。',
          409
        );
    }
    for (const row of input.drafts) {
      input.authorize(row.id);
      const result = db
        .prepare(`DELETE FROM data_import_batches AS b WHERE b.id=? AND ${eligible}`)
        .run(row.id, input.userId, input.project);
      if (Number(result.changes) !== 1)
        throw new ImportRequestError('草稿已变化，请重新预览。', 409);
    }
    db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,detail) VALUES (?, ?, ?, ?)').run(
      input.userId,
      'CLEANUP_EXPIRED_IMPORT_DRAFTS',
      'data_import_batch',
      JSON.stringify({
        project: input.project,
        retentionDays: IMPORT_DRAFT_RETENTION_DAYS,
        batchIds: input.drafts.map((row) => row.id),
        deletedCount: input.drafts.length,
      })
    );
    input.authorizeProject();
    db.exec('COMMIT');
    return { deletedCount: input.drafts.length, deletedIds: input.drafts.map((row) => row.id) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
