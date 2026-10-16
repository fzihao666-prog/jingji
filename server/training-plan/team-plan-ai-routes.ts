import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { db } from '../core/db.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { readTeamPlans } from './team-plan-service.ts';
import { teamPlanScope } from './team-plan-scope.ts';
import {
  generateTeamPlanDraft,
  undoTeamPlanAiChange,
  parseAiMetadata,
  TeamPlanAiError,
  type TeamPlanAiMetadata,
} from './team-plan-ai.ts';
import {
  readTeamPlanChecks,
  writeTeamPlanCheck,
  TeamPlanCheckError,
} from '../core/team-plan-checks.ts';
import type { TeamPlanData } from '../../shared/team-plan.ts';

// AI 生成计划、对话修改与训练项执行确认接口。
// AI 草稿以 model='team' + status='draft' 写入 training_plans，发布必须走既有 transition 流程。
export function registerTeamPlanAiRoutes(app: Express) {
  const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (value) =>
        !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
    );
  const roles = requireRole('SCC', 'REG', 'TD', 'DMD');

  function respondError(res: Response, error: unknown) {
    if (error instanceof TeamPlanAiError || error instanceof TeamPlanCheckError)
      return res.status(400).json({ message: error.message });
    if (error instanceof Error && /^4\d\d:/.test(error.message))
      return res
        .status(Number(error.message.slice(0, 3)))
        .json({ message: error.message.slice(4) });
    throw error;
  }

  function audit(userId: number, action: string, id: number, detail: object) {
    db.prepare(
      'INSERT INTO audit_logs (user_id,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?)'
    ).run(userId, action, 'training_plan', id, JSON.stringify(detail));
  }

  // 授权范围内查找目标队伍；AI 只读取该队伍数据，不跨队伍混合。
  function requireTeamAccess(req: Request, teamId: number) {
    const scope = teamPlanScope(db, req.authUser!);
    const team = scope.teams.find((item) => item.id === teamId);
    if (!team) throw new TeamPlanAiError('无权维护整个队伍计划');
    return team;
  }

  // 同队伍同日期只维护一份单日草稿：存在（含教练手工单日草稿）则复用更新；多日手工草稿不覆盖。
  function findDraft(teamId: number, targetDate: string) {
    return readTeamPlans(db).find(
      (plan) =>
        plan.teamId === teamId &&
        plan.status === 'draft' &&
        plan.startDate === targetDate &&
        plan.endDate === targetDate
    );
  }

  function readDraftWithMetadata(planId: number) {
    const row = db
      .prepare('SELECT plan_data AS data,ai_metadata AS meta FROM training_plans WHERE id=?')
      .get(planId) as { data: string; meta: string | null } | undefined;
    if (!row) return null;
    return {
      data: JSON.parse(row.data) as TeamPlanData,
      metadata: parseAiMetadata(row.meta),
    };
  }

  function saveDraft(
    req: Request,
    input: {
      id?: number;
      teamId: number;
      date: string;
      title: string;
      data: TeamPlanData;
      metadata: TeamPlanAiMetadata;
    }
  ): number {
    const now = new Date().toISOString();
    if (input.id) {
      const result = db
        .prepare(
          `UPDATE training_plans SET title=?,plan_data=?,ai_metadata=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,revision=revision+1
          WHERE id=? AND status='draft'`
        )
        .run(
          input.title,
          JSON.stringify(input.data),
          JSON.stringify(input.metadata),
          req.authUser!.id,
          input.id
        );
      if (!result.changes) throw new TeamPlanAiError('草稿已变化或已被发布，请刷新后重试');
      return input.id;
    }
    const scope = teamPlanScope(db, req.authUser!);
    const anchor = scope.athletes.find((athlete) => athlete.teamId === input.teamId);
    if (!anchor) throw new TeamPlanAiError('队伍暂无可归属的运动员');
    const result = db
      .prepare(
        `INSERT INTO training_plans (athlete_id,plan_date,start_date,end_date,title,plan_data,ai_metadata,created_by,updated_by,model,team_id)
        VALUES (?,?,?,?,?,?,?,?,?,'team',?)`
      )
      .run(
        anchor.id,
        randomUUID(),
        input.date,
        input.date,
        input.title,
        JSON.stringify(input.data),
        JSON.stringify(input.metadata),
        req.authUser!.id,
        req.authUser!.id,
        input.teamId
      );
    const savedId = Number(result.lastInsertRowid);
    db.prepare('UPDATE training_plans SET root_id=? WHERE id=?').run(savedId, savedId);
    return savedId;
  }

  // POST /api/team-plans/ai/generate —— 手动触发 AI 生成次日计划草稿（自动生成失败后的补充入口）。
  app.post('/api/team-plans/ai/generate', requireAuth, roles, async (req, res) => {
    const parsed = z
      .object({ teamId: positiveId, date, constraints: z.string().max(2000).optional() })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '参数无效' });
    try {
      const team = requireTeamAccess(req, parsed.data.teamId);
      const existing = findDraft(parsed.data.teamId, parsed.data.date);
      const existingFull = existing?.id ? readDraftWithMetadata(existing.id) : null;
      const result = await generateTeamPlanDraft({
        db,
        teamId: parsed.data.teamId,
        date: parsed.data.date,
        constraints: parsed.data.constraints,
        userId: req.authUser!.id,
        existingDraft: existingFull?.metadata
          ? { id: existing!.id, data: existingFull.data, metadata: existingFull.metadata }
          : existingFull
            ? { id: existing!.id, data: existingFull.data, metadata: null }
            : undefined,
      });
      const savedId = saveDraft(req, {
        id: existing?.id,
        teamId: parsed.data.teamId,
        date: parsed.data.date,
        title: `${parsed.data.date} ${team.name} AI训练计划`,
        data: result.data,
        metadata: result.metadata,
      });
      audit(req.authUser!.id, 'TEAM_PLAN_AI_GENERATE', savedId, {
        teamId: parsed.data.teamId,
        date: parsed.data.date,
        modelUsed: result.modelUsed,
        reused: Boolean(existing),
      });
      res.json({
        plan: readTeamPlans(db).find((plan) => plan.id === savedId),
        dataNotes: result.metadata.dataNotes,
        warnings: result.metadata.warnings,
        modelUsed: result.modelUsed,
        diff: result.diff,
      });
    } catch (error) {
      respondError(res, error);
    }
  });

  // POST /api/team-plans/ai/:id/revise —— 教练自然语言修改当前草稿，保留未涉及内容。
  app.post('/api/team-plans/ai/:id/revise', requireAuth, roles, async (req, res) => {
    const parsedId = positiveId.safeParse(Number(req.params.id));
    const parsedBody = z
      .object({
        instruction: z.string().trim().min(1).max(2000),
        constraints: z.string().max(2000).optional(),
      })
      .safeParse(req.body);
    if (!parsedId.success || !parsedBody.success)
      return res.status(400).json({ message: '参数无效' });
    try {
      const plan = readTeamPlans(db).find((item) => item.id === parsedId.data);
      if (!plan) return res.status(404).json({ message: '计划不存在' });
      requireTeamAccess(req, plan.teamId);
      if (plan.status !== 'draft')
        return res.status(409).json({ message: '只能修改草稿，已发布计划请创建修订' });
      const full = readDraftWithMetadata(plan.id);
      if (!full) return res.status(404).json({ message: '草稿不存在' });
      const result = await generateTeamPlanDraft({
        db,
        teamId: plan.teamId,
        date: plan.startDate,
        constraints: parsedBody.data.constraints,
        userId: req.authUser!.id,
        existingDraft: { id: plan.id, data: full.data, metadata: full.metadata },
        instruction: parsedBody.data.instruction,
      });
      // AI 失败由 chatJson 抛错；上一版有效草稿保持不变。
      saveDraft(req, {
        id: plan.id,
        teamId: plan.teamId,
        date: plan.startDate,
        title: plan.title,
        data: result.data,
        metadata: result.metadata,
      });
      audit(req.authUser!.id, 'TEAM_PLAN_AI_REVISE', plan.id, {
        instruction: parsedBody.data.instruction.slice(0, 200),
      });
      res.json({
        plan: readTeamPlans(db).find((item) => item.id === plan.id),
        diff: result.diff,
        dataNotes: result.metadata.dataNotes,
        warnings: result.metadata.warnings,
      });
    } catch (error) {
      respondError(res, error);
    }
  });

  // POST /api/team-plans/ai/:id/undo —— 撤销上一次 AI 修改。
  app.post('/api/team-plans/ai/:id/undo', requireAuth, roles, (req, res) => {
    const parsedId = positiveId.safeParse(Number(req.params.id));
    if (!parsedId.success) return res.status(400).json({ message: '参数无效' });
    try {
      const plan = readTeamPlans(db).find((item) => item.id === parsedId.data);
      if (!plan) return res.status(404).json({ message: '计划不存在' });
      requireTeamAccess(req, plan.teamId);
      if (plan.status !== 'draft')
        return res.status(409).json({ message: '只能撤销草稿的修改' });
      const full = readDraftWithMetadata(plan.id);
      if (!full?.metadata) return res.status(400).json({ message: '该草稿无AI修改历史' });
      const restored = undoTeamPlanAiChange({ data: full.data, metadata: full.metadata });
      saveDraft(req, {
        id: plan.id,
        teamId: plan.teamId,
        date: plan.startDate,
        title: plan.title,
        data: restored.data,
        metadata: restored.metadata,
      });
      audit(req.authUser!.id, 'TEAM_PLAN_AI_UNDO', plan.id, {});
      res.json({ plan: readTeamPlans(db).find((item) => item.id === plan.id) });
    } catch (error) {
      respondError(res, error);
    }
  });

  // GET /api/team-plans/:id/checks —— 读取训练项执行确认（运动员只读可见）。
  app.get('/api/team-plans/:id/checks', requireAuth, (req, res) => {
    const parsedId = positiveId.safeParse(Number(req.params.id));
    if (!parsedId.success) return res.status(400).json({ message: '参数无效' });
    try {
      const plan = readTeamPlans(db).find((item) => item.id === parsedId.data);
      if (!plan) return res.status(404).json({ message: '计划不存在' });
      const scope = teamPlanScope(db, req.authUser!);
      const user = req.authUser!;
      const allowed =
        scope.teams.some((team) => team.id === plan.teamId) ||
        (user.role === 'ATL' &&
          user.athleteId !== undefined &&
          scope.athletes.some(
            (athlete) => athlete.id === user.athleteId && athlete.teamId === plan.teamId
          ));
      if (!allowed) return res.status(403).json({ message: '无权查看该计划确认状态' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ checks: readTeamPlanChecks(db, plan.id) });
    } catch (error) {
      respondError(res, error);
    }
  });

  // PUT /api/team-plans/:id/checks —— 教练逐项确认队伍组织实施情况。
  app.put('/api/team-plans/:id/checks', requireAuth, roles, (req, res) => {
    const parsedId = positiveId.safeParse(Number(req.params.id));
    const parsedBody = z
      .object({
        sessionId: z.string().trim().min(1).max(100),
        itemId: z.string().trim().max(100).optional(),
        status: z.enum(['executed', 'cancelled']).nullable(),
        reason: z.string().max(500).optional(),
        revision: z.number().int().min(0).optional(),
      })
      .safeParse(req.body);
    if (!parsedId.success || !parsedBody.success)
      return res.status(400).json({ message: '参数无效' });
    try {
      const plan = readTeamPlans(db).find((item) => item.id === parsedId.data);
      if (!plan) return res.status(404).json({ message: '计划不存在' });
      requireTeamAccess(req, plan.teamId);
      if (!['published', 'archived'].includes(plan.status))
        return res.status(409).json({ message: '只能确认已发布计划的训练项' });
      const sessions = plan.data.sessions;
      const session = sessions.find((item) => item.id === parsedBody.data.sessionId);
      if (!session) return res.status(400).json({ message: '训练课不存在' });
      const itemId = parsedBody.data.itemId || '';
      if (itemId && !(session.items || []).some((item) => item.id === itemId))
        return res.status(400).json({ message: '训练内容项不存在' });
      const check = writeTeamPlanCheck(db, {
        planId: plan.id,
        sessionId: session.id,
        itemId,
        status: parsedBody.data.status,
        reason: parsedBody.data.reason,
        revision: parsedBody.data.revision,
        userId: req.authUser!.id,
      });
      audit(
        req.authUser!.id,
        parsedBody.data.status === null
          ? 'TEAM_PLAN_CHECK_REVERT'
          : parsedBody.data.status === 'executed'
            ? 'TEAM_PLAN_CHECK_EXECUTED'
            : 'TEAM_PLAN_CHECK_CANCELLED',
        plan.id,
        { sessionId: session.id, itemId, status: parsedBody.data.status }
      );
      res.json({ check });
    } catch (error) {
      respondError(res, error);
    }
  });
}
