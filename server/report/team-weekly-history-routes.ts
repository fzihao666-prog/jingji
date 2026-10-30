import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { weeklyReportTypeSchema } from '../../shared/team-weekly-report.ts';
import type { AuthUser } from '../core/shared-server.ts';
import {
  weeklyPhotoScopeSchema,
  type WeeklyPhotoScope,
  type SavedTeamWeeklyReport,
} from '../../shared/team-weekly-storage.ts';
import type { TeamWeeklyPhotoStore } from './team-weekly-photos.ts';
import {
  getConfirmedWeekly,
  listConfirmedWeekly,
  WeeklyStoreError,
  assertWeeklyAccess,
} from './team-weekly-store.ts';
type Dependencies = {
  db: DatabaseSync;
  requireAuth: RequestHandler;
  currentUser?: (req: Request) => AuthUser | null;
  accessibleIds: (user: AuthUser) => number[];
  authorizeScope: (user: AuthUser, scope: WeeklyPhotoScope) => void;
  photoStore: TeamWeeklyPhotoStore;
  renderPdf: (saved: SavedTeamWeeklyReport, photos: Buffer[]) => Buffer | Uint8Array;
  renderDocx?: (
    saved: SavedTeamWeeklyReport,
    photos: Buffer[],
    signal: AbortSignal
  ) => Promise<Buffer>;
};
export function registerWeeklyHistoryRoutes(app: Express, deps: Dependencies) {
  const gate: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const user = deps.currentUser ? deps.currentUser(req) : req.authUser;
    if (!user || !['SCC', 'REG', 'TD', 'DMD'].includes(user.role))
      return void res.status(403).json({ message: '当前账号无权访问队伍周总结。' });
    req.authUser = user;
    next();
  };
  const fail = (res: Response, error: unknown) =>
    res.status(error instanceof WeeklyStoreError ? error.status : 503).json({
      message: error instanceof WeeklyStoreError ? error.message : '报告服务暂不可用，请稍后重试。',
    });
  const refreshUser = (req: Request) => {
    const previous = req.authUser;
    const current = deps.currentUser ? deps.currentUser(req) : req.authUser;
    if (
      !current ||
      current.id !== previous?.id ||
      !['SCC', 'REG', 'TD', 'DMD'].includes(current.role)
    )
      throw new WeeklyStoreError(403, '访问权限已变化，请重新登录。');
    req.authUser = current;
    return current;
  };
  const authorizePhotoScope = (req: Request, id: string) => {
    const photo = deps.db
      .prepare('SELECT project,team_id,report_type FROM team_weekly_photos WHERE id=?')
      .get(id);
    if (!photo) throw new WeeklyStoreError(404, '照片不存在。');
    const scope = weeklyPhotoScopeSchema.parse({
      project: photo.project,
      teamId: photo.team_id,
      reportType: photo.report_type,
    });
    deps.authorizeScope(req.authUser!, scope);
  };
  const handlers = [deps.requireAuth, gate];
  app.get('/api/reports/weekly/history', ...handlers, (req, res) => {
    const parsed = weeklyPhotoScopeSchema
      .extend({
        reportType: weeklyReportTypeSchema.optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        week: z.iso.date().optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ message: '报告查询条件无效。' });
    try {
      deps.authorizeScope(req.authUser!, {
        ...parsed.data,
        reportType: parsed.data.reportType ?? 'combined',
      });
      res.json(listConfirmedWeekly(deps.db, parsed.data, deps.accessibleIds(req.authUser!)));
    } catch (e) {
      fail(res, e);
    }
  });
  app.get('/api/reports/weekly/history/:id', ...handlers, (req, res) => {
    try {
      const saved = getConfirmedWeekly(
        deps.db,
        String(req.params.id),
        deps.accessibleIds(req.authUser!)
      );
      deps.authorizeScope(req.authUser!, saved.report);
      res.json(saved);
    } catch (e) {
      fail(res, e);
    }
  });
  let exporting = 0;
  const exportBuckets = new Map<number, { count: number; expires: number }>();
  for (const format of ['pdf', 'docx'] as const)
    app.get(`/api/reports/weekly/history/:id/${format}`, ...handlers, async (req, res) => {
      const word = format === 'docx';
      const userId = req.authUser!.id;
      if (word) {
        const now = Date.now();
        for (const [id, bucket] of exportBuckets)
          if (bucket.expires <= now) exportBuckets.delete(id);
        const bucket = exportBuckets.get(userId) || { count: 0, expires: now + 60000 };
        if (exporting >= 2 || bucket.count >= 6)
          return void res.status(429).json({ message: 'Word 导出较繁忙，请稍后重试。' });
        bucket.count++;
        exportBuckets.set(userId, bucket);
        exporting++;
      }
      const controller = new AbortController();
      const disconnected = () => {
        if (!res.writableEnded) controller.abort();
      };
      const timer = setTimeout(() => controller.abort(), 60000);
      res.once('close', disconnected);
      try {
        const saved = getConfirmedWeekly(
          deps.db,
          String(req.params.id),
          deps.accessibleIds(req.authUser!)
        );
        deps.authorizeScope(req.authUser!, saved.report);
        if (word && saved.report.reportType !== 'combined')
          throw new WeeklyStoreError(400, '旧版报告请使用原 PDF 下载。');
        if (!word && saved.report.reportType === 'combined')
          throw new WeeklyStoreError(400, '综合周总结请下载可编辑 Word。');
        if (word && !deps.renderDocx)
          throw new WeeklyStoreError(503, 'Word 导出暂不可用，请稍后重试。');
        const assertCurrent = () => {
          const current = refreshUser(req);
          deps.authorizeScope(current, saved.report);
          assertWeeklyAccess(
            saved.report.athletes.map((a) => a.id),
            deps.accessibleIds(current)
          );
          const latest = getConfirmedWeekly(deps.db, saved.id, deps.accessibleIds(current));
          if (latest.revision !== saved.revision)
            throw new WeeklyStoreError(409, '报告已更新，请重新下载。');
          if (controller.signal.aborted) throw new Error('export cancelled');
        };
        const photos: Buffer[] = [];
        for (const photo of saved.photos) {
          assertCurrent();
          photos.push(
            await deps.photoStore.read(photo.id, userId, deps.accessibleIds(req.authUser!))
          );
        }
        assertCurrent();
        const bytes = word
          ? await deps.renderDocx!(saved, photos, controller.signal)
          : Buffer.from(deps.renderPdf(saved, photos));
        assertCurrent();
        res.setHeader(
          'Content-Type',
          word
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="jingji-weekly-${saved.report.range.from}.${format}"; filename*=UTF-8''${encodeURIComponent(`${saved.report.teamName}_训练周总结_${saved.report.range.from}.${format}`)}`
        );
        res.send(bytes);
      } catch (e) {
        if (!res.destroyed) fail(res, e);
      } finally {
        if (word) exporting--;
        clearTimeout(timer);
        res.off('close', disconnected);
      }
    });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 3, parts: 11 },
  }).array('files', 8);
  let processing = 0;
  const uploadBuckets = new Map<number, { count: number; expires: number }>();
  app.post('/api/reports/weekly/photos', ...handlers, (req, res) => {
    const now = Date.now();
    for (const [id, bucket] of uploadBuckets) if (bucket.expires <= now) uploadBuckets.delete(id);
    const bucket = uploadBuckets.get(req.authUser!.id) || { count: 0, expires: now + 600000 };
    if (bucket.count >= 12)
      return void res.status(429).json({ message: '照片上传较频繁，请稍后重试。' });
    bucket.count++;
    uploadBuckets.set(req.authUser!.id, bucket);
    if (processing >= 2) return void res.status(429).json({ message: '照片处理中，请稍后重试。' });
    processing++;
    upload(req, res, async (error) => {
      const created: string[] = [];
      try {
        if (error) throw new WeeklyStoreError(400, '照片最多八张，每张不超过8MB。');
        const scope = weeklyPhotoScopeSchema.safeParse(req.body);
        if (!scope.success) throw new WeeklyStoreError(400, '请选择报告项目和队伍。');
        deps.authorizeScope(req.authUser!, scope.data);
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) throw new WeeklyStoreError(400, '请选择照片。');
        await deps.photoStore.cleanup();
        const photos = [];
        for (const file of files) {
          const photo = await deps.photoStore.upload(file.buffer, {
            ...scope.data,
            userId: req.authUser!.id,
          });
          created.push(photo.id);
          photos.push(photo);
        }
        const current = refreshUser(req);
        deps.authorizeScope(current, scope.data);
        res.json({ photos });
      } catch (e) {
        try {
          await deps.photoStore.cleanupUnreferenced(created);
        } catch {
          /* 临时文件保留给定时回收，原错误仍明确返回。 */
        }
        fail(res, e);
      } finally {
        processing--;
      }
    });
  });
  app.get('/api/reports/weekly/photos/:id', ...handlers, async (req, res) => {
    try {
      authorizePhotoScope(req, String(req.params.id));
      const bytes = await deps.photoStore.read(
        String(req.params.id),
        req.authUser!.id,
        deps.accessibleIds(req.authUser!)
      );
      const current = refreshUser(req);
      authorizePhotoScope(req, String(req.params.id));
      deps.photoStore.authorize(String(req.params.id), current.id, deps.accessibleIds(current));
      res.type('image/jpeg').send(bytes);
    } catch (e) {
      fail(res, e);
    }
  });
  app.delete('/api/reports/weekly/photos/:id', ...handlers, async (req, res) => {
    try {
      authorizePhotoScope(req, String(req.params.id));
      await deps.photoStore.remove(
        String(req.params.id),
        req.authUser!.id,
        deps.accessibleIds(req.authUser!)
      );
      res.status(204).end();
    } catch (e) {
      fail(res, e);
    }
  });
}
