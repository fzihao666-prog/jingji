import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../core/shared-server.ts';
import { reportRangeSchema, reportCommentarySchema } from '../../shared/training-report.ts';
import { readReport, reportFingerprint, reportAiInput } from './report-service.ts';

type Dependencies = {
  db: DatabaseSync;
  requireAuth: RequestHandler;
  hasAccess: (user: AuthUser, athleteId: number) => boolean;
  currentUser: (req: Request) => AuthUser | null;
  generate: (data: ReturnType<typeof reportAiInput>) => Promise<unknown>;
};
const idSchema = z
  .string()
  .max(10)
  .regex(/^[1-9]\d*$/)
  .transform(Number);
const fingerprintSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/);
const generateSchema = z.strictObject({
  range: reportRangeSchema,
  fingerprint: fingerprintSchema,
  consent: z.literal(true),
});
const saveSchema = z.strictObject({
  range: reportRangeSchema,
  fingerprint: fingerprintSchema,
  commentary: reportCommentarySchema,
  confirmed: z.literal(true),
});

export function registerReportRoutes(app: Express, deps: Dependencies) {
  const { db } = deps;
  const pending = new Set<number>();
  const buckets = new Map<string, { count: number; reset: number }>();
  function limited(key: string, limit: number, interval: number) {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    const bucket = buckets.get(key) || { count: 0, reset: now + interval };
    bucket.count++;
    buckets.set(key, bucket);
    return bucket.count > limit;
  }
  const authorize: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = idSchema.safeParse(req.params.athleteId);
    if (!id.success) {
      res.status(400).json({ message: '运动员编号无效。' });
      return;
    }
    if (!deps.hasAccess(req.authUser!, id.data)) {
      res.status(403).json({ message: '无权访问该运动员报告。' });
      return;
    }
    const athlete = db
      .prepare('SELECT project FROM athletes WHERE id = ? AND active = 1')
      .get(id.data) as { project: string } | undefined;
    if (!athlete) {
      res.status(404).json({ message: '运动员不可用。' });
      return;
    }
    res.locals.reportScope = { id: id.data, project: athlete.project };
    next();
  };
  const root = '/api/athletes/:athleteId/reports';
  app.get(`${root}/preview`, deps.requireAuth, authorize, (req, res) => {
    const parsed = reportRangeSchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: '请选择不超过 90 天的有效日期范围。' });
    const { id, project } = res.locals.reportScope as { id: number; project: string };
    try {
      const data = readReport(db, id, project, parsed.data);
      return res.json({ data, fingerprint: reportFingerprint(data) });
    } catch {
      return res.status(503).json({ message: '报告统计暂不可用，请稍后重试。' });
    }
  });
  app.post(`${root}/commentary`, deps.requireAuth, authorize, async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: '请先预览报告，并同意发送去身份化训练汇总。' });
    const userId = req.authUser!.id;
    if (
      pending.has(userId) ||
      pending.size >= 2 ||
      limited(`ai-user:${userId}`, 6, 3600000) ||
      limited(`ai-ip:${req.ip}`, 12, 3600000)
    )
      return res.status(429).json({ message: 'AI 点评请求较多，请稍后重试。图表仍可查看。' });
    const { id, project } = res.locals.reportScope as { id: number; project: string };
    pending.add(userId);
    try {
      const data = readReport(db, id, project, parsed.data.range);
      if (reportFingerprint(data) !== parsed.data.fingerprint)
        return res.status(409).json({ message: '训练数据已变化，请重新预览报告。' });
      if (!data.totals.sessions)
        return res.status(400).json({ message: '暂无有效训练记录，无需生成 AI 点评。' });
      const result = await deps.generate(reportAiInput(data));
      // 等待模型期间账号、授权或项目可能变化，返回数据前再次校验。
      const current = deps.currentUser(req);
      const currentAthlete = db
        .prepare('SELECT project FROM athletes WHERE id = ? AND active = 1')
        .get(id) as { project: string } | undefined;
      if (
        !current ||
        current.id !== userId ||
        !deps.hasAccess(current, id) ||
        currentAthlete?.project !== project
      )
        return res.status(403).json({ message: '访问权限已变化，请重新登录。' });
      if (
        reportFingerprint(readReport(db, id, project, parsed.data.range)) !==
        parsed.data.fingerprint
      )
        return res.status(409).json({ message: '生成期间训练数据已变化，请重新预览。' });
      const commentary = reportCommentarySchema.safeParse(result);
      if (!commentary.success)
        return res.status(502).json({ message: 'AI 点评格式不符合要求，可重试或手动填写。' });
      return res.json(commentary.data);
    } catch {
      return res
        .status(503)
        .json({ message: 'AI 点评暂不可用，请检查服务端模型配置；图表可照常查看和保存。' });
    } finally {
      pending.delete(userId);
    }
  });
  app.post(root, deps.requireAuth, authorize, (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: '请确认报告；每类最多两条点评，合计不超过 250 字。' });
    if (limited(`save:${req.authUser!.id}`, 20, 60000))
      return res.status(429).json({ message: '保存过于频繁，请稍后重试。' });
    const { id: athleteId, project } = res.locals.reportScope as { id: number; project: string };
    try {
      const data = readReport(db, athleteId, project, parsed.data.range);
      if (reportFingerprint(data) !== parsed.data.fingerprint)
        return res.status(409).json({ message: '数据已变化，请重新预览再保存。' });
      const id = randomUUID(),
        createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO training_reports (id, athlete_id, project, created_by, created_at,
        from_date, to_date, kind, data_json, commentary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        athleteId,
        project,
        req.authUser!.id,
        createdAt,
        data.range.from,
        data.range.to,
        data.range.kind,
        JSON.stringify(data),
        JSON.stringify(parsed.data.commentary)
      );
      return res.status(201).json({ id, createdAt, data, commentary: parsed.data.commentary });
    } catch {
      return res.status(503).json({ message: '报告保存失败，请稍后重试。' });
    }
  });
  app.get(root, deps.requireAuth, authorize, (_req, res) => {
    const { id, project } = res.locals.reportScope as { id: number; project: string };
    return res.json(
      db
        .prepare(
          `SELECT id, created_at AS createdAt, from_date AS "from", to_date AS "to", kind
      FROM training_reports WHERE athlete_id = ? AND project = ? ORDER BY created_at DESC LIMIT 50`
        )
        .all(id, project)
    );
  });
  app.get(`${root}/:reportId`, deps.requireAuth, authorize, (req, res) => {
    const parsed = z.string().max(36).uuid().safeParse(req.params.reportId);
    if (!parsed.success) return res.status(400).json({ message: '报告编号无效。' });
    const { id, project } = res.locals.reportScope as { id: number; project: string };
    const row = db
      .prepare(
        `SELECT id, created_at AS createdAt, data_json AS data, commentary_json AS commentary
      FROM training_reports WHERE id = ? AND athlete_id = ? AND project = ?`
      )
      .get(parsed.data, id, project) as
      { id: string; createdAt: string; data: string; commentary: string } | undefined;
    if (!row) return res.status(404).json({ message: '报告不存在或不在当前权限范围。' });
    return res.json({ ...row, data: JSON.parse(row.data), commentary: JSON.parse(row.commentary) });
  });
}
