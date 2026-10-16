import { readStoredTrainingPlanData } from './training-plan-service.ts';
import type { Express } from 'express';
import { requireAuth } from '../core/auth.ts';
import { accessibleAthleteIds, accountPermissions } from '../core/permissions.ts';
import { db } from '../core/db.ts';
import { readTrainingPlanCatalog } from './training-plan-catalog.ts';

export function registerTrainingPlanCatalogRoutes(app: Express) {
  app.get('/api/training-plans/catalog', requireAuth, (req, res) => {
    const user = req.authUser!;
    const permissions = accountPermissions(user.id);
    const plans = readTrainingPlanCatalog(db, {
      athleteIds: accessibleAthleteIds(user),
      normalizeTrainingPlan: readStoredTrainingPlanData,
      // 旧专项计划只有项目归属；项目授权不代表全队、全地区授权。
      canReadProjectPlan: (project, creatorId) =>
        user.role !== 'ATL' &&
        (permissions.projects.includes('*') || permissions.projects.includes(project)) &&
        (creatorId === user.id ||
          (permissions.areas.some((area) => area.areaLevel === 'national') &&
            permissions.teams.some(
              (team) => (team.project === '*' || team.project === project) && team.team === '*'
            ))),
    });
    res.json({ plans });
  });
}
