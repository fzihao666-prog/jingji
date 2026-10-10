import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { z } from 'zod';
import {
  resetAccountPasswordSchema,
  ACCOUNT_PASSWORD_HINT,
} from '../../shared/account-password.ts';
import { consumeRateLimit, requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import { canManageAccount } from '../core/permissions.ts';
import { userById } from '../core/utils.ts';

const accountIdSchema = z.coerce.number().int().positive().safe();

const accountResetBuckets = new Map<number, { count: number; resetAt: number }>();

function consumeAccountResetQuota(accountId: number) {
  const now = Date.now();
  for (const [id, bucket] of accountResetBuckets) {
    if (bucket.resetAt <= now) accountResetBuckets.delete(id);
  }
  const bucket = accountResetBuckets.get(accountId);
  if (!bucket) {
    accountResetBuckets.set(accountId, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > 6;
}

export function registerResetPasswordRoutes(app: Express) {
  app.post(
    '/api/access/accounts/:id/reset-password',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const actor = req.authUser!;
      if (
        consumeRateLimit(req, 'reset-account-password', 20, 15 * 60 * 1000) ||
        consumeAccountResetQuota(actor.id)
      ) {
        return res.status(429).json({ message: '重置操作过于频繁，请稍后再试。' });
      }
      const parsedId = accountIdSchema.safeParse(req.params.id);
      if (!parsedId.success) return res.status(400).json({ message: '账号编号无效。' });
      const target = userById(parsedId.data);
      if (!target || !canManageAccount(actor, target)) {
        return res.status(404).json({ message: '账号不存在或不在可管理范围内。' });
      }
      const parsed = resetAccountPasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: ACCOUNT_PASSWORD_HINT });
      const hash = bcrypt.hashSync(parsed.data.newPassword, 11);
      db.exec('BEGIN');
      try {
        db.prepare(
          'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?'
        ).run(hash, target.id);
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)'
        ).run(actor.id, 'RESET_ACCOUNT_PASSWORD', 'user', target.id);
        db.exec('COMMIT');
      } catch {
        db.exec('ROLLBACK');
        return res.status(500).json({ message: '密码重置失败，请稍后重试。' });
      }
      return res.json({ message: '密码已重置，该账号需使用新密码重新登录。' });
    }
  );
}
