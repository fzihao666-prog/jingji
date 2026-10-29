import type { DatabaseSync } from 'node:sqlite';
import type { Express, RequestHandler } from 'express';
import type { AuthUser } from '../core/shared-server.ts';
import { teamWeeklyQuerySchema } from '../../shared/team-weekly-report.ts';
import { readTeamWeeklyReport, TeamWeeklyAccessError } from './team-weekly-report.ts';
import { renderTeamWeeklyPdf } from './team-weekly-pdf.ts';
type Dependencies = {
  db: DatabaseSync;
  requireAuth: RequestHandler;
  accessibleIds: (user: AuthUser) => number[];
};
export function registerTeamWeeklyRoutes(app: Express, deps: Dependencies) {
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
        if (format === 'preview') return res.json(report);
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
