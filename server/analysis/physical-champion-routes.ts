import { canManageGlobalPhysicalReferences } from '../../shared/physical-champion-policy.ts';
import { isProject } from '../../shared/projects.ts';
import {
  savePhysicalReferenceDraft,
  reviewPhysicalReference,
  PhysicalReferenceError,
} from '../core/physical-champion-references.ts';
import { z } from 'zod';
import type { Express, Request } from 'express';
import { db } from '../core/db.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { accessibleAthleteIds, accountPermissions } from '../core/permissions.ts';
import { buildPhysicalChampion } from './physical-champion-service.ts';

const querySchema = z
  .strictObject({
    project: z.string().max(80).refine(isProject),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine(
    (value) =>
      value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 366 * 86400000
  );
const idSchema = z.coerce.number().int().positive();
export function registerPhysicalChampionRoutes(app: Express) {
  app.get('/api/physical-champion', requireAuth, (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: '请选择有效项目及不超过366天的日期范围。' });
    const user = req.authUser!;
    const permissions = accountPermissions(user.id);
    const projectAllowed =
      user.role === 'ATL'
        ? !!db
            .prepare('SELECT 1 FROM athletes WHERE id = ? AND project = ? AND active = 1')
            .get(user.athleteId, parsed.data.project)
        : permissions.projects.includes('*') || permissions.projects.includes(parsed.data.project);
    if (!projectAllowed) return res.status(403).json({ message: '无权查看该项目冠军模型。' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(
      buildPhysicalChampion(db, {
        ...parsed.data,
        athleteIds: accessibleAthleteIds(user),
        canEdit: canManageGlobalPhysicalReferences(user.role, permissions),
      })
    );
  });
  const manage = (req: Request) => {
    const user = req.authUser!;
    return { id: user.id, role: user.role, permissions: accountPermissions(user.id) };
  };
  const failure = (error: unknown, res: import('express').Response) =>
    res
      .status(error instanceof PhysicalReferenceError ? error.status : 500)
      .json({
        message:
          error instanceof PhysicalReferenceError
            ? error.message
            : '参考标准保存失败，请稍后重试。',
      });
  app.post('/api/physical-champion/references', requireAuth, requireRole('DMD'), (req, res) => {
    try {
      return res.json(savePhysicalReferenceDraft(db, manage(req), req.body));
    } catch (error) {
      return failure(error, res);
    }
  });
  app.put('/api/physical-champion/references/:id', requireAuth, requireRole('DMD'), (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const body = z
      .strictObject({ expectedRevision: z.number().int().nonnegative(), draft: z.unknown() })
      .safeParse(req.body);
    if (!id.success || !body.success)
      return res.status(400).json({ message: '参考版本参数无效。' });
    try {
      return res.json(
        savePhysicalReferenceDraft(db, manage(req), body.data.draft, {
          id: id.data,
          expectedRevision: body.data.expectedRevision,
        })
      );
    } catch (error) {
      return failure(error, res);
    }
  });
  app.post(
    '/api/physical-champion/references/:id/review',
    requireAuth,
    requireRole('DMD'),
    (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) return res.status(400).json({ message: '参考标识符无效。' });
      try {
        return res.json(reviewPhysicalReference(db, manage(req), id.data, req.body));
      } catch (error) {
        return failure(error, res);
      }
    }
  );
}
