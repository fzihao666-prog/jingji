import { registerTeamPlanRoutes } from './team-plan-routes.ts';
import { registerTeamPlanAiRoutes } from './team-plan-ai-routes.ts';
import { registerTrainingPlanCatalogRoutes } from './training-plan-catalog-routes.ts';
import type { Express } from 'express';
import { requireAuth } from '../core/auth.ts';
import { hasAthleteAccess } from '../core/permissions.ts';
import { db } from '../core/db.ts';
import {
  buildTrainingPlanWorkbook,
  parseTrainingPlanData,
  readStoredTrainingPlanData,
} from './training-plan-service.ts';

export function registerTrainingPlanRoutes(app: Express) {
  registerTrainingPlanCatalogRoutes(app);
  registerTeamPlanRoutes(app);
  registerTeamPlanAiRoutes(app);
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
    WHERE tp.model = 'legacy' AND tp.athlete_id = ?
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
  // 旧个人计划停止写入；保留明确的迁移反馈，历史读取与导出继续可用。
  const retired = (_req: import('express').Request, res: import('express').Response) =>
    res
      .status(410)
      .json({ message: '个人独立计划已停用，请在小程序队伍训练计划中维护草稿并审核发布。' });
  app.post('/api/training-plans', requireAuth, retired);
  app.delete('/api/training-plans/:id', requireAuth, retired);
  app.post('/api/training-plans/ai/analyze', requireAuth, retired);
  app.post('/api/training-plans/ai/save', requireAuth, retired);
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
    WHERE tp.model = 'legacy' AND tp.id = ?
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
