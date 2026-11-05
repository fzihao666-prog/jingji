import type { Express, RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../core/db.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { accessibleAthleteIds, hasAthleteAccess } from '../core/permissions.ts';
import { dataImportScope } from '../data-import/data-import-access.ts';
import { isProject } from '../../shared/projects.ts';
import { ENODE_METRICS, type EnodeImportResult, type EnodeMetric } from '../../shared/enode.ts';
import { isValidIsoDate } from '../core/utils.ts';
import { importEnodeFile, readEnodeData } from './enode.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 12, fields: 2, fieldSize: 128 * 1024 },
}).array('files', 12);
const receive: RequestHandler = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      res.status(400).json({ message: '文件上传失败：单文件限12MB，每次最多12个文件。' });
      return;
    }
    next();
  });
};
export function registerEnodeRoutes(app: Express) {
  app.post(
    '/api/enode/import',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    receive,
    (req, res) => {
      const project: unknown = req.body?.project;
      if (!isProject(project) || !dataImportScope(req.authUser!, project).allowed)
        return res.status(403).json({ message: '当前账号无权向该项目导入。' });
      let matches: Record<string, number>;
      try {
        const parsed = z
          .record(z.string().max(100), z.number().int().positive())
          .safeParse(JSON.parse(req.body?.matches || '{}'));
        if (!parsed.success || Object.keys(parsed.data).length > 1000) throw Error('invalid');
        matches = parsed.data;
      } catch {
        return res.status(400).json({ message: '运动员对应关系格式无效。' });
      }
      const files = req.files;
      if (!Array.isArray(files) || !files.length)
        return res.status(400).json({ message: '请选择 enode 导出文件。' });
      const ids = new Set(accessibleAthleteIds(req.authUser!));
      const candidates = (
        db.prepare('SELECT id,name FROM athletes WHERE project=? AND active=1').all(project) as {
          id: number;
          name: string;
        }[]
      ).filter((p) => ids.has(p.id));
      if (Object.values(matches).some((id) => !candidates.some((p) => p.id === id)))
        return res.status(403).json({ message: '选择的运动员不在当前项目授权范围内。' });
      const results: EnodeImportResult[] = [];
      for (const file of files) {
        // 不使用文件名判断格式；兼容设备导出的无扩展名 CSV。
        try {
          results.push(
            importEnodeFile(db, {
              buffer: file.buffer,
              filename: file.originalname,
              project,
              userId: req.authUser!.id,
              candidates,
              matches,
            })
          );
        } catch {
          results.push({
            filename: file.originalname,
            kind: null,
            inserted: 0,
            skipped: 0,
            failed: 1,
            unresolvedNames: [],
            issues: [
              {
                row: 0,
                message:
                  '该文件未写入。请检查原始 CSV 格式、必要表头与行数；若文件无误，请稍后重试。',
              },
            ],
          });
        }
      }
      res.json({ results });
    }
  );
  app.get('/api/enode/data', requireAuth, (req, res) => {
    const parsed = z
      .object({
        athleteId: z.coerce.number().int().positive(),
        project: z.string(),
        kind: z.enum(['measurement', 'wellness', 'sessionRpe']),
        from: z.string(),
        to: z.string(),
        exercise: z.string().max(300).optional(),
        side: z.string().max(100).optional(),
        metric: z.string(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: '查询参数无效。' });
    const q = parsed.data;
    if (
      !isProject(q.project) ||
      !isValidIsoDate(q.from) ||
      !isValidIsoDate(q.to) ||
      q.from > q.to ||
      !Object.hasOwn(ENODE_METRICS, q.metric) ||
      ENODE_METRICS[q.metric as EnodeMetric].kind !== q.kind
    )
      return res.status(400).json({ message: '项目、日期范围或指标无效。' });
    const athlete = db
      .prepare('SELECT project FROM athletes WHERE id=? AND active=1')
      .get(q.athleteId) as { project: string } | undefined;
    if (!athlete || athlete.project !== q.project || !hasAthleteAccess(req.authUser!, q.athleteId))
      return res.status(403).json({ message: '无权查看该运动员在此项目的数据。' });
    res.json(readEnodeData(db, { ...q, metric: q.metric as EnodeMetric }));
  });
}
