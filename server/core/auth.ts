import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import type { AuthUser } from './shared-server.ts';
import type { Role } from '../../shared/access.ts';

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export const jwtSecret = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const jwtSecretPath = resolve(process.cwd(), 'data', '.jwt-secret');
  if (existsSync(jwtSecretPath)) return readFileSync(jwtSecretPath, 'utf8').trim();
  const generated = randomBytes(48).toString('hex');
  writeFileSync(jwtSecretPath, generated, { encoding: 'utf8', flag: 'wx' });
  return generated;
})();

export function consumeRateLimit(
  req: Request,
  scope: string,
  maxAttempts: number,
  windowMs: number
) {
  const key = `${scope}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > maxAttempts;
}

export function clearRateLimit(req: Request, scope: string) {
  const key = `${scope}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  rateBuckets.delete(key);
}

export function getAuthUser(req: Request): AuthUser | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const tokenUser = jwt.verify(header.slice(7), jwtSecret) as AuthUser;
    const current = db
      .prepare(
        `
      SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId
      FROM users WHERE id = ? AND active = 1
    `
      )
      .get(tokenUser.id) as AuthUser | undefined;
    return current || null;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: '登录状态已失效，请重新登录。' });
  req.authUser = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.authUser;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: '当前账户没有执行此操作的权限。' });
    }
    next();
  };
}
