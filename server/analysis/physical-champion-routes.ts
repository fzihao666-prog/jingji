import { canManageGlobalPhysicalReferences } from '../../shared/physical-champion-policy.ts';
import { z } from 'zod';
import type { Express } from 'express';
import { db } from '../core/db.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { accessibleAthleteIds, accountPermissions } from '../core/permissions.ts';
import { buildPhysicalChampion } from './physical-champion-service.ts';

const querySchema = z
  .strictObject({
    project: z.enum(['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM']),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine(
    (value) =>
      value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 366 * 86400000
  );
const idSchema = z.coerce.number().int().positive();
const editSchema = z.strictObject({
  value: z.number().finite().positive().max(10000),
  expectedValue: z.number().finite().positive(),
  expectedRevision: z.number().int().nonnegative(),
  protocol: z.string().trim().min(1).max(200),
  sourceType: z.enum(['measured', 'public_reference', 'estimated']),
  sourceNote: z.string().trim().min(1).max(500),
});
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
  // 全局参考标准影响所有组织，仅拥有全部项目权限的系统管理者可以维护。
  app.put('/api/physical-champion/references/:id', requireAuth, requireRole('DMD'), (req, res) => {
    const user = req.authUser!;
    if (!canManageGlobalPhysicalReferences(user.role, accountPermissions(user.id)))
      return res
        .status(403)
        .json({ message: '维护全局标准需要全国、全部项目及全部队伍管理权限。' });
    const id = idSchema.safeParse(req.params.id);
    const parsed = editSchema.safeParse(req.body);
    if (!id.success || !parsed.success)
      return res.status(400).json({ message: '参考值、协议或来源信息无效。' });
    const row = db
      .prepare(
        `SELECT id, source_id AS sourceId, project, revision, value_num AS value, (SELECT url FROM radar_reference_sources WHERE id = radar_reference_values.source_id) AS sourceUrl FROM radar_reference_values WHERE id = ? AND radar_kind = 'physical' AND active = 1`
      )
      .get(id.data) as
      | {
          id: number;
          sourceId: number;
          project: string;
          value: number;
          revision: number;
          sourceUrl: string;
        }
      | undefined;
    if (!row) return res.status(404).json({ message: '参考标准不存在。' });
    if (row.revision !== parsed.data.expectedRevision)
      return res.status(409).json({ message: '参考值已被更新，请刷新后再修改。' });
    const { value, protocol, sourceType, sourceNote } = parsed.data;
    // 每次修订独立来源，避免改动同源的其他指标；不接触运动员测试事实。
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db
        .prepare('SELECT revision FROM radar_reference_values WHERE id = ?')
        .get(row.id) as { revision: number };
      if (existing.revision !== parsed.data.expectedRevision) {
        db.exec('ROLLBACK');
        return res.status(409).json({ message: '参考值已被更新，请刷新后再修改。' });
      }
      db.prepare(
        `INSERT OR IGNORE INTO radar_reference_sources (project, name, url, source_year, protocol, verified_at)
        VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        row.project,
        sourceNote,
        row.sourceUrl,
        new Date().getUTCFullYear(),
        protocol,
        new Date().toISOString()
      );
      const source = db
        .prepare(
          `SELECT id FROM radar_reference_sources WHERE project = ? AND name = ? AND url = ? AND source_year = ? AND protocol = ?`
        )
        .get(row.project, sourceNote, row.sourceUrl, new Date().getUTCFullYear(), protocol) as {
        id: number;
      };
      db.prepare(
        `UPDATE radar_reference_values SET revision = revision + 1, source_id = ?, value_num = ?, protocol = ?, source_type = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`
      ).run(source.id, value, protocol, sourceType, row.id);
      db.prepare(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, 'UPDATE_PHYSICAL_REFERENCE', 'radar_reference_values', ?, ?)`
      ).run(user.id, row.id, JSON.stringify({ before: row.value, after: value, sourceType }));
      db.exec('COMMIT');
    } catch {
      db.exec('ROLLBACK');
      return res.status(500).json({ message: '参考标准保存失败，请稍后重试。' });
    }
    return res.json({ message: '参考标准已保存。' });
  });
}
