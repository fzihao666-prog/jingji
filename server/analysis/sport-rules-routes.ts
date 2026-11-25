import type { Express, Request, RequestHandler } from 'express';
import { projectRules, SPORT_MODULES } from '../../shared/sport-rules.ts';

export function registerSportRulesRoutes(app: Express, deps: {
  requireAuth: RequestHandler;
  projects: (request: Request) => readonly string[];
  referenceAvailable?: (project: string) => boolean;
}) {
  app.get('/api/projects/rules', deps.requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const rules = projectRules(req.query.project);
    if (!rules) return res.status(400).json({ message: '请选择明确有效的运动项目。' });
    if (!deps.projects(req).includes(rules.project))
      return res.status(403).json({ message: '无权访问该项目配置。' });
    if (deps.referenceAvailable?.(rules.project))
      rules.capabilities.reference = { status: 'available', reason: '已有有效冠军展示参考；正式评分另校验来源与资格，仍须逐项匹配人群与协议。' };
    return res.json({ rules, modules: SPORT_MODULES });
  });
}
