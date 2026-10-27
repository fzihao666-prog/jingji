import type { DatabaseSync } from 'node:sqlite';
import { normalizeProject } from '../../shared/projects.ts';

type TestIdentity = { athleteId: number; date: string; type: string; protocol: string; protocolVersion?: string; context?: string; attempt?: number };
export type StoredTestSession = { id: number; protocol: string; durationMin: number | null };

export function findTestSession(db: DatabaseSync, input: TestIdentity): StoredTestSession | undefined {
  const project = db.prepare('SELECT project FROM athletes WHERE id=?').get(input.athleteId) as { project: string } | undefined;
  return db.prepare(`SELECT id, protocol, duration_min AS durationMin FROM test_sessions
    WHERE athlete_id=? AND test_date=? AND test_type=?
    AND (project_code=? OR project_code IS NULL)
    AND COALESCE(NULLIF(protocol_code,''),protocol,'')=? AND COALESCE(protocol_version,'')=?
    AND context_key=? AND attempt_order=? ORDER BY project_code IS NULL, id LIMIT 1`)
    .get(input.athleteId, input.date, input.type, normalizeProject(project?.project) || '', input.protocol.trim(), input.protocolVersion || '', input.context || '', input.attempt || 1) as StoredTestSession | undefined;
}

/** 调用方事务内查重；旧协议原文保留，新记录写入明确的项目快照。 */
export function saveTestSession(db: DatabaseSync, input: TestIdentity & {
  source: string; createdBy: number | null; durationMin?: number | null; quality?: string;
}): StoredTestSession {
  const ownsTransaction = !db.isTransaction;
  if (ownsTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    const existing = findTestSession(db, input);
    if (existing) {
      db.prepare('UPDATE test_sessions SET duration_min=COALESCE(?,duration_min) WHERE id=?').run(input.durationMin ?? null, existing.id);
      if (ownsTransaction) db.exec('COMMIT');
      return existing;
    }
    const athlete = db.prepare('SELECT project FROM athletes WHERE id=?').get(input.athleteId) as { project: string } | undefined;
    const project = normalizeProject(athlete?.project);
    if (!project) throw new Error('测试所属运动员项目无效');
    const result = db.prepare(`INSERT INTO test_sessions(athlete_id,test_date,test_type,duration_min,protocol,source,quality,is_demo,created_by,
      project_code,project_status,project_source,protocol_code,protocol_version,context_key,attempt_order)
      VALUES(?,?,?,?,?,?,?,0,?,?,'confirmed','authenticated_write',?,?,?,?)`)
      .run(input.athleteId, input.date, input.type, input.durationMin ?? null, input.protocol.trim(), input.source, input.quality || 'valid', input.createdBy,
        project, input.protocol.trim(), input.protocolVersion || '', input.context || '', input.attempt || 1);
    if (ownsTransaction) db.exec('COMMIT');
    return { id: Number(result.lastInsertRowid), protocol: input.protocol.trim(), durationMin: input.durationMin ?? null };
  } catch (error) {
    if (ownsTransaction && db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
