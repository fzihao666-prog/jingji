import type { Express } from 'express';
import { upload } from '../core/uploads.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { hasAthleteAccess } from '../core/permissions.ts';
import { cleanString } from '../core/utils.ts';
import { db } from '../core/db.ts';
import { TrainingPlanAIService, type AthleteContext } from './ai-service.ts';
import {
  buildTrainingPlanWorkbook,
  getAthleteContext,
  normalizeAIPlanToMatrix,
  parseTrainingPlanData,
  readStoredTrainingPlanData,
} from './training-plan-service.ts';

export function registerTrainingPlanRoutes(app: Express) {
  app.get('/api/training-plans', requireAuth, (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.query.athleteId || user.athleteId || 0);
    if (!athleteId) return res.status(400).json({ message: '请选择一名运动员。' });
    if (!hasAthleteAccess(user, athleteId))
      return res.status(403).json({ message: '无权查看该运动员的体能训练。' });
    const rows = db
      .prepare(
        `
    SELECT tp.id, tp.athlete_id AS athleteId, a.name AS athleteName, a.project, COALESCE(pt.name, '') AS team,
      a.photo_url AS photoUrl, tp.plan_data AS dataJson, tp.updated_at AS updatedAt,
      u.display_name AS updatedBy
    FROM training_plans tp
    JOIN athletes a ON a.id = tp.athlete_id
    LEFT JOIN project_teams pt ON pt.id = a.team_id
    JOIN users u ON u.id = tp.updated_by
    WHERE tp.athlete_id = ?
    ORDER BY tp.start_date DESC, tp.id DESC
  `
      )
      .all(athleteId) as Array<{
      id: number;
      athleteId: number;
      athleteName: string;
      project: string;
      team: string;
      photoUrl: string;
      dataJson: string;
      updatedAt: string;
      updatedBy: string;
    }>;
    res.json({
      plans: rows.map(({ dataJson, ...row }) => ({
        ...row,
        data: readStoredTrainingPlanData(dataJson),
      })),
    });
  });
  app.post(
    '/api/training-plans',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const user = req.authUser!;
      const athleteId = Number(req.body?.athleteId || 0);
      const requestedPlanId = Number(req.body?.planId || 0);
      if (!athleteId || !hasAthleteAccess(user, athleteId)) {
        return res.status(403).json({ message: '无权维护该运动员的体能训练。' });
      }
      const parsed = parseTrainingPlanData(req.body?.data);
      if (parsed.errors.length) return res.status(400).json({ message: parsed.errors.join('；') });
      const existing = requestedPlanId
        ? (db
            .prepare('SELECT id FROM training_plans WHERE id = ? AND athlete_id = ?')
            .get(requestedPlanId, athleteId) as { id: number } | undefined)
        : (db
            .prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?')
            .get(athleteId, parsed.data.startDate) as { id: number } | undefined);
      if (requestedPlanId && !existing)
        return res.status(404).json({ message: '要更新的历史训练不存在。' });
      try {
        if (existing) {
          db.prepare(
            `
        UPDATE training_plans SET
          plan_date = ?, start_date = ?, end_date = ?, title = ?, schedule_label = ?,
          plan_data = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
          ).run(
            parsed.data.startDate,
            parsed.data.startDate,
            parsed.data.endDate,
            parsed.data.title,
            parsed.data.scheduleLabel,
            JSON.stringify(parsed.data),
            user.id,
            existing.id
          );
        } else {
          db.prepare(
            `
        INSERT INTO training_plans
          (athlete_id, plan_date, start_date, end_date, title, schedule_label, plan_data, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
          ).run(
            athleteId,
            parsed.data.startDate,
            parsed.data.startDate,
            parsed.data.endDate,
            parsed.data.title,
            parsed.data.scheduleLabel,
            JSON.stringify(parsed.data),
            user.id,
            user.id
          );
        }
      } catch (saveError) {
        if (saveError instanceof Error && saveError.message.includes('UNIQUE')) {
          return res.status(409).json({ message: '该运动员已有相同开始日期的体能训练。' });
        }
        throw saveError;
      }
      const saved =
        existing ||
        (db
          .prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?')
          .get(athleteId, parsed.data.startDate) as { id: number });
      db.prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
      ).run(
        user.id,
        existing ? 'UPDATE_TRAINING_PLAN' : 'CREATE_TRAINING_PLAN',
        'training_plan',
        saved.id,
        JSON.stringify({
          athleteId,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          exercises: parsed.data.exercises.length,
        })
      );
      res.json({ message: existing ? '体能训练已更新。' : '体能训练已保存。', id: saved.id });
    }
  );
  app.delete(
    '/api/training-plans/:id',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const planId = Number(req.params.id);
      const row = db
        .prepare(
          `
    SELECT tp.id, tp.athlete_id AS athleteId, tp.start_date AS startDate,
      tp.end_date AS endDate, tp.title, a.name AS athleteName
    FROM training_plans tp
    JOIN athletes a ON a.id = tp.athlete_id
    WHERE tp.id = ?
  `
        )
        .get(planId) as
        | {
            id: number;
            athleteId: number;
            startDate: string;
            endDate: string;
            title: string;
            athleteName: string;
          }
        | undefined;
      if (!row) return res.status(404).json({ message: '历史训练不存在或已经删除。' });
      if (!hasAthleteAccess(req.authUser!, row.athleteId)) {
        return res.status(403).json({ message: '无权删除该运动员的体能训练。' });
      }
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM training_plans WHERE id = ?').run(planId);
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          req.authUser!.id,
          'DELETE_TRAINING_PLAN',
          'training_plan',
          planId,
          JSON.stringify(row)
        );
        db.exec('COMMIT');
        res.json({ message: '历史训练已删除。' });
      } catch (deleteError) {
        db.exec('ROLLBACK');
        throw deleteError;
      }
    }
  );
  app.post(
    '/api/training-plans/ai/analyze',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    upload.none(),
    async (req, res) => {
      try {
        const athleteId = Number(req.body.athleteId);

        if (!athleteId) {
          return res.status(400).json({ message: '请选择运动员' });
        }

        if (!hasAthleteAccess(req.authUser!, athleteId)) {
          return res.status(403).json({ message: '无权访问该运动员数据' });
        }

        // 获取运动员上下文
        const context = getAthleteContext(athleteId);

        const inputContent = cleanString(req.body.text);
        if (!inputContent) {
          return res.status(400).json({ message: '请输入训练需求描述' });
        }

        // 调用 AI 生成体能训练
        const aiService = new TrainingPlanAIService();
        const result = await aiService.generateTrainingPlan(context, inputContent);

        // 记录审计日志
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          req.authUser!.id,
          'AI_GENERATE_TRAINING_PLAN',
          'training_plan',
          athleteId,
          JSON.stringify({ model: result.modelUsed, inputType: 'text' })
        );

        res.json({
          plan: result.plan,
          aiMetadata: {
            inputType: 'text',
            inputContent: inputContent.slice(0, 1000),
            modelUsed: result.modelUsed,
            attempts: result.attempts,
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error('[AI Training Plan] Error:', error);
        res.status(500).json({
          message: `AI 生成失败：${error instanceof Error ? error.message : '未知错误'}`,
        });
      }
    }
  );
  app.post(
    '/api/training-plans/ai/save',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        const { athleteId, plan, aiMetadata } = req.body;
        const targetId = Number(athleteId);
        if (!Number.isInteger(targetId) || targetId <= 0 || !plan) {
          return res.status(400).json({ message: '缺少必要参数' });
        }
        if (plan.sourceType === 'ai_import' || aiMetadata?.operation === 'import') {
          return res.status(400).json({ message: '仅支持保存 AI 生成的体能训练' });
        }
        if (!hasAthleteAccess(req.authUser!, targetId)) {
          return res.status(403).json({ message: '无权管理该运动员' });
        }
        if (!cleanString(plan.title) || cleanString(plan.title).length > 80) {
          return res.status(400).json({ message: '请确认训练名称，长度应为1至80个字符' });
        }
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(cleanString(plan.startDate)) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(cleanString(plan.endDate))
        ) {
          return res.status(400).json({ message: '请人工确认有效的开始日期和结束日期' });
        }
        if (plan.startDate > plan.endDate) {
          return res.status(400).json({ message: '结束日期不能早于开始日期' });
        }
        if (!Array.isArray(plan.weeklyPlans) || plan.weeklyPlans.length === 0) {
          return res.status(400).json({ message: '体能训练内容为空' });
        }

        const athlete = db.prepare('SELECT id, name FROM athletes WHERE id = ?').get(targetId) as
          { id: number; name: string } | undefined;
        if (!athlete) return res.status(400).json({ message: '运动员不存在，请刷新名单后重试' });
        const existing = db
          .prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?')
          .get(targetId, plan.startDate) as { id: number } | undefined;
        if (existing)
          return res.status(409).json({ message: '该运动员已有相同开始日期的体能训练' });

        const storedPlan = normalizeAIPlanToMatrix(
          {
            sourceType: 'ai_generated',
            title: plan.title,
            summary: plan.summary || '',
            startDate: plan.startDate,
            endDate: plan.endDate,
            scheduleLabel: plan.scheduleLabel || '',
            bodyWeight: plan.bodyWeight ?? null,
            age: plan.age ?? null,
            durationWeeks: plan.durationWeeks ?? null,
            weeklyPlans: plan.weeklyPlans,
            exercises: Array.isArray(plan.exercises) ? plan.exercises : [],
          },
          targetId
        );
        if (!Array.isArray(storedPlan.exercises) || !storedPlan.exercises.length) {
          return res.status(400).json({ message: 'AI体能训练没有可写入训练矩阵的项目' });
        }

        const inserted = db
          .prepare(
            `
        INSERT INTO training_plans
          (athlete_id, plan_date, start_date, end_date, title, schedule_label, plan_data, ai_metadata, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
          )
          .run(
            targetId,
            plan.startDate,
            plan.startDate,
            plan.endDate,
            plan.title,
            plan.scheduleLabel || '',
            JSON.stringify(storedPlan),
            JSON.stringify(aiMetadata),
            req.authUser!.id,
            req.authUser!.id
          );
        const planId = Number(inserted.lastInsertRowid);
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          req.authUser!.id,
          'SAVE_AI_TRAINING_PLAN',
          'training_plan',
          planId,
          JSON.stringify({ athleteId: targetId, title: plan.title, model: aiMetadata?.modelUsed })
        );
        res.json({
          message: 'AI 体能训练已保存',
          id: planId,
          created: 1,
          replaced: 0,
          skipped: 0,
          results: [{ athleteId: targetId, athleteName: athlete.name, status: 'created', planId }],
        });
      } catch (error) {
        console.error('[AI Training Plan Save] Error:', error);
        if (error instanceof Error && error.message.includes('UNIQUE')) {
          return res.status(409).json({ message: '该运动员已有相同开始日期的体能训练' });
        }
        res
          .status(500)
          .json({ message: `保存失败：${error instanceof Error ? error.message : '未知错误'}` });
      }
    }
  );
  app.get('/api/training-plans/:id/export', requireAuth, async (req, res) => {
    const planId = Number(req.params.id);
    const row = db
      .prepare(
        `
    SELECT tp.id, tp.athlete_id AS athleteId, a.name AS athleteName, a.project, COALESCE(pt.name, '') AS team,
      a.photo_url AS photoUrl, tp.plan_data AS dataJson
    FROM training_plans tp
    JOIN athletes a ON a.id = tp.athlete_id
    LEFT JOIN project_teams pt ON pt.id = a.team_id
    WHERE tp.id = ?
  `
      )
      .get(planId) as
      | {
          id: number;
          athleteId: number;
          athleteName: string;
          project: string;
          team: string;
          photoUrl: string;
          dataJson: string;
        }
      | undefined;
    if (!row) return res.status(404).json({ message: '体能训练不存在。' });
    if (!hasAthleteAccess(req.authUser!, row.athleteId))
      return res.status(403).json({ message: '无权导出该体能训练。' });
    const parsed = parseTrainingPlanData(JSON.parse(row.dataJson || '{}'));
    if (parsed.errors.length)
      return res.status(409).json({ message: `体能训练数据不完整：${parsed.errors.join('；')}` });
    const workbook = await buildTrainingPlanWorkbook({
      athleteName: row.athleteName,
      project: row.project,
      team: row.team,
      photoUrl: row.photoUrl,
      data: parsed.data,
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const safePeriod = `${parsed.data.startDate.replaceAll('-', '')}-${parsed.data.endDate.replaceAll('-', '')}`;
    const filename = `${row.athleteName}_${safePeriod}_四周体能训练.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(Buffer.from(buffer));
  });
}
