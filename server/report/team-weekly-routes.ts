import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { AuthUser } from '../core/shared-server.ts';
import { teamWeeklyQuerySchema } from '../../shared/team-weekly-report.ts';
import { readTeamWeeklyReport, TeamWeeklyAccessError } from './team-weekly-report.ts';
import {
  teamWeeklyCommentarySchema,
  teamWeeklyGenerateSchema,
  teamWeeklyExportSchema,
} from '../../shared/team-weekly-ai.ts';
import { teamWeeklyFingerprint, teamWeeklyAiInput } from './team-weekly-ai.ts';
import { renderTeamWeeklyPdf } from './team-weekly-pdf.ts';
type Dependencies = {
  db: DatabaseSync;
  requireAuth: RequestHandler;
  currentUser: (req: Request) => AuthUser | null;
  generate: (data: ReturnType<typeof teamWeeklyAiInput>, signal: AbortSignal) => Promise<unknown>;
  accessibleIds: (user: AuthUser) => number[];
};
export function registerTeamWeeklyRoutes(app: Express, deps: Dependencies) {
  const pending = new Set<number>();
  const aiBuckets = new Map<string, { count: number; reset: number }>();
  function limited(key: string, limit: number, interval: number) {
    const now = Date.now();
    for (const [id, item] of aiBuckets) if (item.reset <= now) aiBuckets.delete(id);
    const item = aiBuckets.get(key) || { count: 0, reset: now + interval };
    item.count++;
    aiBuckets.set(key, item);
    return item.count > limit;
  }
  const authorize: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['SCC', 'REG', 'TD', 'DMD'].includes(req.authUser!.role)) {
      res.status(403).json({ message: '当前账号无权生成队伍周总结。' });
      return;
    }
    next();
  };
  function failure(res: Response, error: unknown) {
    if (error instanceof TeamWeeklyAccessError)
      return res.status(403).json({ message: error.message });
    return res.status(503).json({ message: '周总结服务暂不可用，请稍后重试；仍可查看已有预览。' });
  }
  app.post('/api/reports/weekly/commentary', deps.requireAuth, authorize, async (req, res) => {
    const parsed = teamWeeklyGenerateSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: '请先预览报告并同意发送训练汇总。' });
    const user = req.authUser!;
    if (
      pending.has(user.id) ||
      pending.size >= 2 ||
      limited(`ai:${user.id}`, 6, 3600000) ||
      limited(`ip:${req.ip}`, 12, 3600000)
    )
      return res.status(429).json({ message: 'AI 点评请求较多，请稍后重试。' });
    pending.add(user.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 210000);
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', disconnected);
    try {
      const report = readTeamWeeklyReport(deps.db, parsed.data.query, deps.accessibleIds(user));
      if (teamWeeklyFingerprint(report) !== parsed.data.fingerprint)
        return res.status(409).json({ message: '训练数据已变化，请重新预览报告。' });
      if (!report.totals.sessions)
        return res.status(400).json({ message: '暂无有效训练记录，可直接手动填写点评。' });
      const result = await deps.generate(teamWeeklyAiInput(report), controller.signal);
      const current = deps.currentUser(req);
      if (!current || current.id !== user.id || !['SCC', 'REG', 'TD', 'DMD'].includes(current.role))
        return res.status(403).json({ message: '访问权限已变化，请重新登录。' });
      const latest = readTeamWeeklyReport(deps.db, parsed.data.query, deps.accessibleIds(current));
      if (teamWeeklyFingerprint(latest) !== parsed.data.fingerprint)
        return res.status(409).json({ message: '生成期间训练数据已变化，请重新预览。' });
      const commentary = teamWeeklyCommentarySchema.safeParse(result);
      if (!commentary.success)
        return res.status(502).json({ message: 'AI 点评格式不符合要求，可重试或手动填写。' });
      return res.json(commentary.data);
    } catch (error) {
      return failure(res, error);
    } finally {
      clearTimeout(timer);
      res.off('close', disconnected);
      pending.delete(user.id);
    }
  });
  app.post('/api/reports/weekly/pdf', deps.requireAuth, authorize, (req, res) => {
    const parsed = teamWeeklyExportSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: '请核对并确认点评；每段最多600字、合计最多2000字。' });
    if (limited(`pdf:${req.authUser!.id}`, 12, 60000))
      return res.status(429).json({ message: '报告导出较频繁，请稍后重试。' });
    try {
      const report = readTeamWeeklyReport(
        deps.db,
        parsed.data.query,
        deps.accessibleIds(req.authUser!)
      );
      if (teamWeeklyFingerprint(report) !== parsed.data.fingerprint)
        return res.status(409).json({ message: '训练数据已变化，请重新预览报告并核对点评。' });
      const pdf = renderTeamWeeklyPdf(report, parsed.data.commentary);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="jingji-weekly-${report.range.from}.pdf"`
      );
      return res.send(pdf);
    } catch (error) {
      return failure(res, error);
    }
  });
  const buckets = new Map<number, { count: number; reset: number }>();
  for (const format of ['preview', 'pdf'] as const)
    app.get(`/api/reports/weekly/${format}`, deps.requireAuth, (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const user = req.authUser!;
      if (!['SCC', 'REG', 'TD', 'DMD'].includes(user.role))
        return res.status(403).json({ message: '当前账号无权生成队伍周总结。' });
      const parsed = teamWeeklyQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return res.status(400).json({ message: '请选择有效项目、队伍和周内日期。' });
      const now = Date.now();
      for (const [id, b] of buckets) if (b.reset <= now) buckets.delete(id);
      const bucket = buckets.get(user.id) || { count: 0, reset: now + 60000 };
      bucket.count++;
      buckets.set(user.id, bucket);
      if (bucket.count > 12)
        return res.status(429).json({ message: '报告生成较频繁，请稍后重试。' });
      try {
        const report = readTeamWeeklyReport(deps.db, parsed.data, deps.accessibleIds(user));
        if (format === 'preview')
          return res.json({ ...report, fingerprint: teamWeeklyFingerprint(report) });
        const pdf = renderTeamWeeklyPdf(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="jingji-weekly-${report.range.from}.pdf"; filename*=UTF-8''${encodeURIComponent(`${report.teamName}_训练周总结_${report.range.from}.pdf`)}`
        );
        return res.send(pdf);
      } catch (error) {
        if (error instanceof TeamWeeklyAccessError)
          return res.status(403).json({ message: error.message });
        return res.status(503).json({ message: '周总结生成失败，请稍后重试。' });
      }
    });
}
