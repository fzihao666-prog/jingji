import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { db } from '../core/db.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { readTeamPlans, teamPlanInput, validateTeamPlanContext } from './team-plan-service.ts';
import { teamPlanScope } from './team-plan-scope.ts';
import type { TeamPlanData } from '../../shared/team-plan.ts';
import { buildTeamPlanWorkbook, readTeamPlanWorkbook } from './team-plan-workbook.ts';

const planUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
}).single('file');
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function registerTeamPlanRoutes(app: Express) {
  const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const transitionInput = z.object({
    revision: positiveId,
    action: z.enum(['submit', 'return', 'publish', 'archive', 'revise']),
    confirmed: z.boolean().optional(),
  });
  function audit(req: Request, action: string, id: number, detail: object) {
    db.prepare(
      'INSERT INTO audit_logs (user_id,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?)'
    ).run(
      req.authUser!.id,
      `TEAM_PLAN_${action.toUpperCase()}`,
      'training_plan',
      id,
      JSON.stringify(detail)
    );
  }
  function scope(req: Request) {
    return teamPlanScope(db, req.authUser!);
  }
  function insertDraft(
    req: Request,
    teamId: number,
    athleteId: number,
    plan: { title: string; startDate: string; endDate: string },
    data: TeamPlanData
  ) {
    const result = db.prepare(
      `INSERT INTO training_plans (athlete_id,plan_date,start_date,end_date,title,plan_data,created_by,updated_by,model,team_id) VALUES (?,?,?,?,?,?,?,?,'team',?)`
    ).run(athleteId, randomUUID(), plan.startDate, plan.endDate, plan.title, JSON.stringify(data), req.authUser!.id, req.authUser!.id, teamId);
    const id = Number(result.lastInsertRowid);
    db.prepare('UPDATE training_plans SET root_id=? WHERE id=?').run(id, id);
    return id;
  }
  app.get('/api/team-plans', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.authUser!.role === 'ATL' && !req.authUser!.athleteId)
      return res.status(403).json({ message: '账号尚未关联运动员' });
    const allowed = scope(req);
    const user = req.authUser!;
    const requested =
      req.query.athleteId === undefined ? null : positiveId.safeParse(Number(req.query.athleteId));
    if (requested && !requested.success) return res.status(400).json({ message: '运动员 ID 无效' });
    const target = user.role === 'ATL' ? user.athleteId : requested?.data || null;
    if (target && !allowed.athletes.some((athlete) => athlete.id === target))
      return res.status(403).json({ message: '无权查看该运动员计划' });
    const historyIds =
      user.role === 'ATL' &&
      target &&
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='training_plan_execution_links'"
        )
        .get()
        ? new Set(
            (
              db
                .prepare(
                  'SELECT DISTINCT l.plan_id AS id FROM training_plan_execution_links l JOIN training_sessions s ON s.id=l.training_session_id WHERE s.athlete_id=?'
                )
                .all(target) as Array<{ id: number }>
            ).map((row) => row.id)
          )
        : new Set<number>();
    let plans = readTeamPlans(db).filter((plan) =>
      user.role === 'ATL'
        ? historyIds.has(plan.id) ||
          allowed.athletes.some((athlete) => athlete.teamId === plan.teamId)
        : allowed.teams.some((team) => team.id === plan.teamId)
    );
    if (target)
      plans = plans.filter((plan) =>
        allowed.athletes.some(
          (athlete) =>
            athlete.id === target && (athlete.teamId === plan.teamId || historyIds.has(plan.id))
        )
      );
    if (req.query.project) plans = plans.filter((plan) => plan.project === req.query.project);
    if (user.role === 'ATL')
      plans = plans
        .filter(
          (plan) => plan.publishedAt !== null && ['published', 'archived'].includes(plan.status)
        )
        .map((plan) => ({
          ...plan,
          // 运动员端不下发 AI 生成信息。
          aiMetadata: null,
          data: {
            ...plan.data,
            overrides: plan.data.overrides.filter((item) => item.athleteId === target),
          },
        }));
    else
      // 管理端下发 AI 摘要与对话，不下发内部历史快照（撤销在服务端处理）。
      plans = plans.map((plan) =>
        plan.aiMetadata
          ? {
              ...plan,
              aiMetadata: {
                source: plan.aiMetadata.source,
                model: plan.aiMetadata.model,
                generatedAt: plan.aiMetadata.generatedAt,
                targetDate: plan.aiMetadata.targetDate,
                dataNotes: plan.aiMetadata.dataNotes,
                warnings: plan.aiMetadata.warnings,
                conversation: plan.aiMetadata.conversation,
              },
            }
          : plan
      );
    if (user.role === 'OBS') plans = plans.map((plan) => ({ ...plan, aiMetadata: null }));
    res.json({
      plans,
      teams: user.role === 'ATL' ? [] : allowed.teams,
      athletes: allowed.athletes,
    });
  });
  function write(req: Request, res: Response) {
    let allowed = scope(req);
    const parsedId =
      req.params.id === undefined ? null : positiveId.safeParse(Number(req.params.id));
    if (parsedId && !parsedId.success) return res.status(400).json({ message: '计划 ID 无效' });
    const id = parsedId?.data || 0;
    const isTransition = req.path.endsWith('/transition');
    const control = isTransition
      ? transitionInput.safeParse(req.body)
      : z.object({ revision: positiveId }).safeParse(req.body);
    if (id && !control.success) return res.status(400).json({ message: '版本或操作无效' });
    if (!id && !positiveId.safeParse(req.body?.teamId).success)
      return res.status(400).json({ message: '队伍 ID 无效' });
    const existing = id ? readTeamPlans(db).find((plan) => plan.id === id) : undefined;
    if (id && !existing) return res.status(404).json({ message: '计划不存在' });
    const teamId = existing?.teamId || Number(req.body?.teamId);
    if (!allowed.teams.some((team) => team.id === teamId))
      return res.status(403).json({ message: '无权维护整个队伍计划' });
    db.exec('BEGIN IMMEDIATE');
    try {
      allowed = scope(req);
      if (!allowed.teams.some((team) => team.id === teamId))
        throw new Error('403:队伍访问范围已变化，请刷新');
      if (existing) {
        const current = readTeamPlans(db).find((plan) => plan.id === id)!;
        if (isTransition && transitionInput.safeParse(req.body).data?.action === 'publish') {
          try {
            validateTeamPlanContext(current.project, current.data);
          } catch (error) {
            throw new Error('400:' + (error instanceof Error ? error.message : '计划活动不适用'));
          }
        }
        if (current.revision !== req.body?.revision) throw new Error('409:计划已变化，请刷新');
        if (req.path.endsWith('/transition')) {
          const action = req.body?.action;
          if (action === 'revise') {
            if (current.status !== 'published') throw new Error('409:仅已发布计划可以修订');
            if (
              readTeamPlans(db).some(
                (plan) =>
                  plan.rootId === current.rootId && ['draft', 'pending'].includes(plan.status)
              )
            )
              throw new Error('409:已存在修订草稿');
            const version =
              Math.max(
                ...readTeamPlans(db)
                  .filter((plan) => plan.rootId === current.rootId)
                  .map((plan) => plan.version)
              ) + 1;
            const result = db
              .prepare(
                `INSERT INTO training_plans (athlete_id,plan_date,start_date,end_date,title,plan_data,created_by,updated_by,model,team_id,root_id,version) SELECT athlete_id,?,start_date,end_date,title,plan_data,?,?,model,team_id,root_id,? FROM training_plans WHERE id=?`
              )
              .run(randomUUID(), req.authUser!.id, req.authUser!.id, version, id);
            audit(req, 'revise', Number(result.lastInsertRowid), { sourcePlanId: id, version });
            db.exec('COMMIT');
            return res.json({
              plan: readTeamPlans(db).find((plan) => plan.id === Number(result.lastInsertRowid)),
            });
          }
          const next =
            action === 'submit' && current.status === 'draft'
              ? 'pending'
              : action === 'return' && current.status === 'pending'
                ? 'draft'
                : action === 'publish' &&
                    current.status === 'pending' &&
                    req.body.confirmed === true
                  ? 'published'
                  : action === 'archive' && current.status === 'published'
                    ? 'archived'
                    : null;
          if (!next) throw new Error('409:状态转换无效，发布必须明确确认');
          if (next === 'published') {
            if (
              current.data.overrides.some(
                (item) =>
                  !allowed.athletes.some(
                    (athlete) => athlete.id === item.athleteId && athlete.teamId === teamId
                  )
              )
            )
              throw new Error('409:个人调整名单已变化，请退回草稿更新');
            if (!current.data.sessions.length) throw new Error('400:至少安排一节训练课');
            if (
              readTeamPlans(db).some(
                (plan) =>
                  plan.id !== id &&
                  plan.teamId === teamId &&
                  plan.rootId !== current.rootId &&
                  plan.status === 'published' &&
                  plan.startDate <= current.endDate &&
                  plan.endDate >= current.startDate
              )
            )
              throw new Error('409:该队伍周期已有发布计划');
            db.prepare(
              "UPDATE training_plans SET status='archived',revision=revision+1,archived_at=? WHERE model='team' AND root_id=? AND status='published'"
            ).run(new Date().toISOString(), current.rootId);
          }
          db.prepare(
            `UPDATE training_plans SET status=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP,published_at=CASE WHEN ?='published' THEN ? ELSE published_at END,archived_at=CASE WHEN ?='archived' THEN ? ELSE archived_at END,reviewed_by=CASE WHEN ?='published' THEN ? ELSE reviewed_by END WHERE id=? AND revision=?`
          ).run(
            next,
            req.authUser!.id,
            next,
            new Date().toISOString(),
            next,
            new Date().toISOString(),
            next,
            req.authUser!.id,
            id,
            current.revision
          );
          audit(req, action, id, { revision: current.revision, status: next });
          db.exec('COMMIT');
          return res.json({ plan: readTeamPlans(db).find((plan) => plan.id === id) });
        }
        if (current.status !== 'draft') throw new Error('409:只能编辑草稿，已发布计划请创建修订');
      }
      const parsed = teamPlanInput.safeParse(req.body);
      if (!parsed.success)
        throw new Error(
          '400:计划字段无效：' + parsed.error.issues.map((issue) => issue.message).join('；')
        );
      try {
        validateTeamPlanContext(
          allowed.teams.find((team) => team.id === teamId)!.project,
          parsed.data.data
        );
      } catch (error) {
        throw new Error('400:' + (error instanceof Error ? error.message : '项目训练规则不匹配'));
      }
      const now = new Date().toISOString();
      const data: TeamPlanData = {
        ...parsed.data.data,
        overrides: parsed.data.data.overrides.map((item) => {
          if (
            !allowed.athletes.some(
              (athlete) => athlete.id === item.athleteId && athlete.teamId === teamId
            )
          )
            throw new Error('403:个人调整必须属于授权队伍');
          const previous = existing?.data.overrides.find(
            (old) => old.athleteId === item.athleteId && old.sessionId === item.sessionId
          );
          return {
            ...item,
            createdBy: previous?.createdBy || req.authUser!.id,
            createdAt: previous?.createdAt || now,
            updatedBy: req.authUser!.id,
            updatedAt: now,
          };
        }),
      };
      let savedId = id;
      if (existing)
        db.prepare(
          'UPDATE training_plans SET title=?,start_date=?,end_date=?,plan_data=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?'
        ).run(
          parsed.data.title,
          parsed.data.startDate,
          parsed.data.endDate,
          JSON.stringify(data),
          req.authUser!.id,
          id,
          existing.revision
        );
      else {
        const anchor = allowed.athletes.find((athlete) => athlete.teamId === teamId)!;
        savedId = insertDraft(req, teamId, anchor.id, parsed.data, data);
      }
      audit(req, existing ? 'update' : 'create', savedId, {
        teamId,
        revision: existing ? existing.revision + 1 : 1,
      });
      db.exec('COMMIT');
      res.json({ plan: readTeamPlans(db).find((plan) => plan.id === savedId) });
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof Error && /^\d{3}:/.test(error.message))
        return res
          .status(Number(error.message.slice(0, 3)))
          .json({ message: error.message.slice(4) });
      throw error;
    }
  }
  const roles = requireRole('SCC', 'REG', 'TD', 'DMD');
  app.get('/api/team-plans/template', requireAuth, roles, async (_req, res) => {
    const buffer = Buffer.from(await buildTeamPlanWorkbook().xlsx.writeBuffer());
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', "attachment; filename=\"team-plan-template.xlsx\"; filename*=UTF-8''" + encodeURIComponent('竞迹队伍训练计划模板.xlsx'));
    return res.type(xlsxType).send(buffer);
  });
  app.post('/api/team-plans/import', requireAuth, roles, (req, res, next) => {
    const id = positiveId.safeParse(Number(req.query.teamId));
    const project = z.string().min(1).safeParse(req.query.project);
    if (!id.success || !project.success) return res.status(400).json({ message: '请选择运动项目和队伍。' });
    const teamId = id.data;
    const matches = (team: { id: number; project: string }) => team.id === teamId && team.project === project.data;
    if (!scope(req).teams.some(matches)) return res.status(403).json({ message: '无权维护所选项目的整支队伍计划。' });
    planUpload(req, res, (error: unknown) => {
      if (error || !req.file || !/\.xlsx$/i.test(req.file.originalname))
        return res.status(400).json({ message: '请选择不超过 2 MB 的 .xlsx 计划文件。' });
      let plans: ReturnType<typeof readTeamPlanWorkbook>;
      try {
        plans = readTeamPlanWorkbook(req.file.buffer);
        for (const plan of plans) validateTeamPlanContext(project.data, plan.data);
      } catch (failure) {
        return res.status(400).json({ message: failure instanceof Error ? failure.message : '计划文件无效。' });
      }
      try {
        db.exec('BEGIN IMMEDIATE');
        const allowed = scope(req);
        const anchor = allowed.athletes.find((athlete) => athlete.teamId === teamId);
        if (!anchor || !allowed.teams.some(matches)) {
          db.exec('ROLLBACK');
          return res.status(403).json({ message: '队伍访问范围已变化，请刷新。' });
        }
        const existing = readTeamPlans(db, teamId).filter((plan) => plan.status !== 'archived');
        const drafts = [];
        let skipped = 0;
        for (const plan of plans) {
          const samePeriod = existing.filter((current) => current.startDate === plan.startDate && current.endDate === plan.endDate);
          if (samePeriod.some((current) => current.title === plan.title && JSON.stringify(current.data) === JSON.stringify(plan.data))) {
            skipped++;
            continue;
          }
          if (samePeriod.length) {
            db.exec('ROLLBACK');
            return res.status(409).json({ message: `${plan.startDate} 至 ${plan.endDate} 已有队伍计划，请在训练计划中处理该周期。` });
          }
          const draftId = insertDraft(req, teamId, anchor.id, plan, plan.data);
          audit(req, 'import', draftId, { teamId, revision: 1 });
          drafts.push({ id: draftId, title: plan.title, sessions: plan.data.sessions.length });
        }
        db.exec('COMMIT');
        return res.json({ drafts, skipped });
      } catch (failure) {
        if (db.isTransaction) db.exec('ROLLBACK');
        next(failure);
      }
    });
  });
  app.post('/api/team-plans', requireAuth, roles, write);
  app.put('/api/team-plans/:id', requireAuth, roles, write);
  app.post('/api/team-plans/:id/transition', requireAuth, roles, write);
}
