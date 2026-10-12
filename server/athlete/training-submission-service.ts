import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '../core/db.ts';
import { insertSession, readSession, type SessionInput, type SessionRow } from './training-session-service.ts';

export const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).optional();
const operation = 'athlete_self_training_create';
type SubmissionResponse = { session: SessionRow & { editable: true } };
type SavedSubmission = { payloadHash: string; athleteId: number; responseJson: string };

export class TrainingSubmissionConflict extends Error {}

export function submitSelfTraining(
  athleteId: number, userId: number, input: SessionInput, key?: string
): SubmissionResponse {
  // 短写事务覆盖查重、课次序号分配、训练与幂等快照，避免多进程并发重复写入。
  db.exec('BEGIN IMMEDIATE');
  try {
    const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (key !== undefined) {
      const saved = db.prepare(`SELECT payload_hash AS payloadHash, athlete_id AS athleteId,
        response_json AS responseJson FROM training_submission_keys
        WHERE user_id = ? AND operation = ? AND idempotency_key = ?`).get(userId, operation, key) as SavedSubmission | undefined;
      if (saved) {
        if (saved.athleteId !== athleteId || saved.payloadHash !== payloadHash) {
          throw new TrainingSubmissionConflict('同一提交标识已用于其他训练内容，请确认后重新提交。');
        }
        const response = JSON.parse(saved.responseJson) as SubmissionResponse;
        db.exec('COMMIT');
        return response;
      }
    }
    const id = insertSession(athleteId, input, 'athlete_self_report', userId);
    const session = readSession(athleteId, id);
    if (!session) throw new Error('训练写入后读取失败。');
    const response: SubmissionResponse = { session: { ...session, editable: true } };
    if (key !== undefined) {
      db.prepare(`INSERT INTO training_submission_keys
        (user_id, operation, idempotency_key, payload_hash, athlete_id, training_session_id, response_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, operation, key, payloadHash, athleteId, id, JSON.stringify(response));
    }
    db.exec('COMMIT');
    return response;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
