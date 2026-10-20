import { db } from '../core/db.ts';

export function discardDataImport(batchId: string, userId: number, project: string) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const batch = db
      .prepare(
        `SELECT status, imported_count AS importedCount,
      committed_at AS committedAt FROM data_import_batches
      WHERE id = ? AND created_by = ? AND project = ?`
      )
      .get(batchId, userId, project);
    if (!batch) throw new Error('未找到该导入批次，或当前账号无权访问。');
    if (batch.status !== 'reviewing' || Number(batch.importedCount) > 0 || batch.committedAt) {
      throw new Error('仅可放弃尚未入库的待审核批次。');
    }
    // 外键级联仅清理暂存明细与候选资料；正式业务数据不在删除范围内。
    db.prepare(
      'DELETE FROM data_import_batches WHERE id = ? AND created_by = ? AND project = ?'
    ).run(batchId, userId, project);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
