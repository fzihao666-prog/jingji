import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, RequestHandler } from 'express';
import multer from 'multer';
import type { AuthUser } from '../core/shared-server.ts';
import { weeklyGenerationSchema } from '../../shared/team-weekly-generation.ts';
import { teamWeeklyCommentarySchema } from '../../shared/team-weekly-ai.ts';
import { readTeamWeeklyReport, TeamWeeklyAccessError } from './team-weekly-report.ts';
import {
  teamWeeklyAiInput,
  teamWeeklyFingerprint,
  weeklyFallbackCommentary,
} from './team-weekly-ai.ts';
import { weeklyObservation } from './team-weekly-observation.ts';
import { renderTeamWeeklyDocx } from './team-weekly-docx.ts';

type Dependencies = {
  db: DatabaseSync;
  requireAuth: RequestHandler;
  currentUser: (req: Request) => AuthUser | null;
  generate: (data: ReturnType<typeof teamWeeklyAiInput>, signal: AbortSignal) => Promise<unknown>;
  accessibleIds: (user: AuthUser) => number[];
  renderDocx?: typeof renderTeamWeeklyDocx;
};
const allowedRole = (user: AuthUser | null): user is AuthUser =>
  Boolean(user && ['SCC', 'REG', 'TD', 'DMD'].includes(user.role));
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function registerTeamWeeklyRoutes(app: Express, deps: Dependencies) {
  const pending = new Set<number>();
  const buckets = new Map<number, { count: number; reset: number }>();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 0, fields: 1, fieldSize: 16000, parts: 1 },
  }).none();
  app.post('/api/reports/weekly/generate', deps.requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const user = req.authUser!;
    if (!allowedRole(user))
      return res.status(403).json({ message: '当前账号无权生成队伍周总结。' });
    const now = Date.now();
    for (const [id, value] of buckets) if (value.reset <= now) buckets.delete(id);
    const bucket = buckets.get(user.id) || { count: 0, reset: now + 60000 };
    if (pending.has(user.id) || pending.size >= 2 || bucket.count >= 6)
      return res.status(429).json({ message: '周总结正在生成或请求较多，请稍后重试。' });
    bucket.count++;
    buckets.set(user.id, bucket);
    pending.add(user.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', disconnect);
    const check = () => {
      if (controller.signal.aborted) throw new Error('cancelled');
      const current = deps.currentUser(req);
      if (!allowedRole(current) || current.id !== user.id)
        throw new TeamWeeklyAccessError('访问权限已变化。');
      return current;
    };
    try {
      await new Promise<void>((resolve, reject) =>
        upload(req, res, (error) => (error ? reject(error) : resolve()))
      );
      let body: unknown = req.body;
      if (req.is('multipart/form-data')) {
        if (
          Object.keys(req.body || {}).some((key) => key !== 'input') ||
          typeof req.body.input !== 'string'
        )
          return res.status(400).json({ message: '报告请求格式无效。' });
        try {
          body = JSON.parse(req.body.input);
        } catch {
          return res.status(400).json({ message: '报告请求格式无效。' });
        }
      }
      const parsed = weeklyGenerationSchema.safeParse(body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ message: '请选择有效队伍和周次；阶段最多100字，补充最多3000字。' });
      const input = parsed.data;
      const report = readTeamWeeklyReport(deps.db, input.query, deps.accessibleIds(check()), input);
      const fingerprint = teamWeeklyFingerprint(report);
      let commentary = weeklyFallbackCommentary(report);
      if (input.consent && (report.totals.sessions || weeklyObservation(report).text)) {
        try {
          const result = await deps.generate(teamWeeklyAiInput(report), controller.signal);
          const valid = teamWeeklyCommentarySchema.safeParse(result);
          if (valid.success && Object.values(valid.data).some((text) => text.trim()))
            commentary = valid.data;
        } catch {
          /* AI失败时仍下载包含真实数据的基础报告。 */
        }
      }
      const assertCurrent = () => {
        const current = check();
        const latest = readTeamWeeklyReport(
          deps.db,
          input.query,
          deps.accessibleIds(current),
          input
        );
        if (teamWeeklyFingerprint(latest) !== fingerprint)
          throw new TeamWeeklyAccessError('数据或访问范围已变化，请重新生成。');
      };
      assertCurrent();
      const file = await (deps.renderDocx || renderTeamWeeklyDocx)(
        report,
        commentary,
        controller.signal
      );
      assertCurrent();
      res.setHeader('Content-Type', docxMime);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="jingji-weekly-${report.range.from}.docx"; filename*=UTF-8''${encodeURIComponent(`${report.teamName}_周总结_${report.range.from}.docx`)}`
      );
      return res.send(file);
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof multer.MulterError)
        return res.status(400).json({ message: '报告请求格式无效，请检查补充内容。' });
      if (error instanceof TeamWeeklyAccessError)
        return res.status(403).json({ message: error.message });
      return res.status(503).json({
        message: controller.signal.aborted
          ? '生成超时，请稍后重试。'
          : '周总结生成失败，请稍后重试。',
      });
    } finally {
      clearTimeout(timer);
      res.off('close', disconnect);
      pending.delete(user.id);
    }
  });
}
