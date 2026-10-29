import { weeklyDraftInputSchema, weeklySaveSchema } from '../../shared/team-weekly-workflow.ts';
import {
  initializeTeamWeeklyStore,
  getWeeklyRevision,
  saveConfirmedWeekly,
  getConfirmedWeekly,
  WeeklyStoreError,
} from './team-weekly-store.ts';
import type { TeamWeeklyPhotoStore } from './team-weekly-photos.ts';
import { weeklyObservation, weeklyObservationWarnings } from './team-weekly-observation.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { AuthUser } from '../core/shared-server.ts';
import { teamWeeklyQuerySchema } from '../../shared/team-weekly-report.ts';
import {
  readTeamWeeklyReport,
  readTeamWeeklyReportSnapshot,
  TeamWeeklyAccessError,
} from './team-weekly-report.ts';
import {
  teamWeeklyCommentarySchema,
  teamWeeklyGenerateSchema,
  teamWeeklyExportSchema,
} from '../../shared/team-weekly-ai.ts';
import {
  teamWeeklyFingerprint,
  teamWeeklyAiInput,
  weeklyFallbackCommentary,
} from './team-weekly-ai.ts';
import { renderTeamWeeklyPdf } from './team-weekly-pdf.ts';
type Dependencies = {
  db: DatabaseSync;
  requireAuth: RequestHandler;
  currentUser: (req: Request) => AuthUser | null;
  generate: (data: ReturnType<typeof teamWeeklyAiInput>, signal: AbortSignal) => Promise<unknown>;
  accessibleIds: (user: AuthUser) => number[];
  photoStore?: TeamWeeklyPhotoStore;
};
export function registerTeamWeeklyRoutes(app: Express, deps: Dependencies) {
  initializeTeamWeeklyStore(deps.db);
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
    if (error instanceof WeeklyStoreError)
      return res.status(error.status).json({ message: error.message });
    if (error instanceof TeamWeeklyAccessError)
      return res.status(403).json({ message: error.message });
    return res.status(503).json({ message: '周总结服务暂不可用，请稍后重试；仍可查看已有预览。' });
  }
  app.post('/api/reports/weekly/generate', deps.requireAuth, authorize, async (req, res) => {
    const parsed = weeklyDraftInputSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: '请选择专项或体能报告、队伍和周次；阶段最多100字，补充最多3000字。' });
    const user = req.authUser!;
    const input = parsed.data;
    try {
      const data = readTeamWeeklyReport(deps.db, input.query, deps.accessibleIds(user), input);
      const fingerprint = teamWeeklyFingerprint(data);
      const oldRow = deps.db
        .prepare(
          'SELECT id FROM team_weekly_reports WHERE project=? AND team_id=? AND week_start=? AND report_type=?'
        )
        .get(data.project, data.teamId, data.range.from, data.reportType);
      if (oldRow) getConfirmedWeekly(deps.db, String(oldRow.id), deps.accessibleIds(user));
      const expectedRevision = getWeeklyRevision(deps.db, {
        project: data.project,
        teamId: data.teamId,
        weekStart: data.range.from,
        reportType: data.reportType,
      });
      let commentary = weeklyFallbackCommentary(data);
      const messages = [...weeklyObservationWarnings(data)];
      const observation = weeklyObservation(data);
      if (observation.message) messages.push(observation.message);
      let aiStatus: 'generated' | 'fallback' | 'skipped' = 'skipped';
      if (input.consent && (data.totals.sessions || observation.text)) {
        if (
          pending.has(user.id) ||
          pending.size >= 2 ||
          limited(`ai:${user.id}`, 6, 3600000) ||
          limited(`ip:${req.ip}`, 12, 3600000)
        ) {
          aiStatus = 'fallback';
          messages.push('AI 正忙，已生成基础总结，可直接编辑保存。');
        } else {
          pending.add(user.id);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 210000);
          const disconnected = () => {
            if (!res.writableEnded) controller.abort();
          };
          res.once('close', disconnected);
          try {
            const result = await deps.generate(teamWeeklyAiInput(data), controller.signal);
            const validated = teamWeeklyCommentarySchema.safeParse(result);
            if (!validated.success || !Object.values(validated.data).some((text) => text.trim()))
              throw new Error('invalid draft');
            commentary = validated.data;
            aiStatus = 'generated';
          } catch {
            aiStatus = 'fallback';
            messages.push('AI 暂未完成，已保留图表、基础总结和教练补充，可继续编辑保存。');
          } finally {
            clearTimeout(timer);
            res.off('close', disconnected);
            pending.delete(user.id);
          }
        }
      } else
        messages.push(
          input.consent
            ? '本周有效资料不足，已生成基础报告。'
            : '未启用 AI，已生成基础总结，仍可编辑保存。'
        );
      const current = deps.currentUser(req);
      if (!current || current.id !== user.id || !['SCC', 'REG', 'TD', 'DMD'].includes(current.role))
        return res.status(403).json({ message: '访问权限已变化，请重新登录。' });
      const latest = readTeamWeeklyReport(deps.db, input.query, deps.accessibleIds(current), input);
      if (teamWeeklyFingerprint(latest) !== fingerprint)
        return res.status(409).json({ message: '生成期间数据已变化，请重新生成。' });
      // 不保留无对应事实章节的隐藏文案，避免隐藏字段占用编辑字数。
      if (!data.daily.some((day) => day.duration !== null || day.srpe !== null))
        commentary.training = '';
      if (data.reportType !== 'physical' || !data.strength?.length) commentary.strength = '';
      if (
        !data.recovery?.some(
          (day) => day.sleep !== null || day.pulse !== null || day.fatigue !== null
        )
      )
        commentary.recovery = '';
      return res.json({ data, commentary, fingerprint, expectedRevision, aiStatus, messages });
    } catch (error) {
      return failure(res, error);
    }
  });
  app.post('/api/reports/weekly/save', deps.requireAuth, authorize, async (req, res) => {
    const parsed = weeklySaveSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: '请核对报告，点评每段最多600字、合计2000字；照片最多八张。' });
    if (limited(`save:${req.authUser!.id}`, 20, 60000))
      return res.status(429).json({ message: '保存较频繁，请稍后重试。' });
    try {
      const user = req.authUser!;
      const input = parsed.data;
      const query = {
        project: input.report.project,
        teamId: input.report.teamId,
        date: input.report.range.from,
        reportType: input.report.reportType,
      };
      const metadata = { stage: input.report.stage, coachNotes: input.report.coachNotes };
      const canonical = readTeamWeeklyReport(deps.db, query, deps.accessibleIds(user), metadata);
      if (teamWeeklyFingerprint(canonical) !== input.fingerprint)
        return res.status(409).json({ message: '训练数据已变化，请重新生成后核对保存。' });
      if (input.photoIds.length && !deps.photoStore)
        throw new WeeklyStoreError(503, '照片服务暂不可用。');
      // 读取确认附件以检查文件仍存在；等待完成后事务内再复核权限与事实。
      for (const id of input.photoIds)
        await deps.photoStore!.read(id, user.id, deps.accessibleIds(user));
      const result = saveConfirmedWeekly(
        deps.db,
        { ...input, report: canonical, userId: user.id },
        () => {
          const current = deps.currentUser(req);
          if (
            !current ||
            current.id !== user.id ||
            !['SCC', 'REG', 'TD', 'DMD'].includes(current.role)
          )
            throw new WeeklyStoreError(403, '访问权限已变化。');
          const ids = deps.accessibleIds(current);
          const existing = deps.db
            .prepare(
              'SELECT id FROM team_weekly_reports WHERE project=? AND team_id=? AND week_start=? AND report_type=?'
            )
            .get(canonical.project, canonical.teamId, canonical.range.from, canonical.reportType);
          if (existing) getConfirmedWeekly(deps.db, String(existing.id), ids);
          const latest = readTeamWeeklyReportSnapshot(deps.db, query, ids, metadata);
          if (teamWeeklyFingerprint(latest) !== input.fingerprint)
            throw new WeeklyStoreError(409, '数据或访问范围已变化，请重新生成。');
        }
      );
      if (deps.photoStore)
        try {
          await deps.photoStore.cleanupUnreferenced(result.removedPhotoIds);
        } catch {
          console.warn('周报告旧附件清理延后重试。');
        }
      return res.json(result.saved);
    } catch (error) {
      return failure(res, error);
    }
  });
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
      const report = readTeamWeeklyReport(
        deps.db,
        parsed.data.query,
        deps.accessibleIds(user),
        parsed.data
      );
      if (teamWeeklyFingerprint(report) !== parsed.data.fingerprint)
        return res.status(409).json({ message: '训练数据已变化，请重新预览报告。' });
      if (!report.totals.sessions)
        return res.status(400).json({ message: '暂无有效训练记录，可直接手动填写点评。' });
      const result = await deps.generate(teamWeeklyAiInput(report), controller.signal);
      const current = deps.currentUser(req);
      if (!current || current.id !== user.id || !['SCC', 'REG', 'TD', 'DMD'].includes(current.role))
        return res.status(403).json({ message: '访问权限已变化，请重新登录。' });
      const latest = readTeamWeeklyReport(
        deps.db,
        parsed.data.query,
        deps.accessibleIds(current),
        parsed.data
      );
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
        return res
          .status(400)
          .json({ message: '请选择专项或体能报告、有效项目、队伍和周内日期；旧页面请刷新。' });
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
