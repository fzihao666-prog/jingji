import { db } from '../core/db.ts';

export class ImportRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** 旧草稿没有修订号时按0读取；修订与草稿内容在同一事务中更新。 */
export function importRevision(summary: Record<string, unknown>): number {
  return Number.isSafeInteger(summary.revision) && Number(summary.revision) >= 0 ? Number(summary.revision) : 0;
}
export function assertImportRevision(batchId: string, userId: number, expected?: number) {
  const row = db.prepare('SELECT summary_json AS summary, status FROM data_import_batches WHERE id=? AND created_by=?').get(batchId, userId) as { summary: string; status: string } | undefined;
  if (!row) throw new ImportRequestError('未找到该导入批次，或当前账号无权访问。', 404);
  const summary = JSON.parse(row.summary || '{}') as Record<string, unknown>;
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || importRevision(summary) !== expected))
    throw new ImportRequestError('草稿已被其他页面修改，请刷新后重新校对；本次修改尚未保存。', 409);
  return { ...row, summary, revision: importRevision(summary) };
}
export function advanceImportRevision(batchId: string, userId: number, expected?: number) {
  const current = assertImportRevision(batchId, userId, expected);
  db.prepare('UPDATE data_import_batches SET summary_json=? WHERE id=? AND created_by=?').run(JSON.stringify({ ...current.summary, revision: current.revision + 1, lastActivityAt: new Date().toISOString() }), batchId, userId);
}
