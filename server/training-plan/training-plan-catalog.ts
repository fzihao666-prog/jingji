import type { DatabaseSync } from 'node:sqlite';
import type { CatalogPlan, PlanKind } from '../../shared/training-plan-catalog.ts';
import {
  trainingContentCategory,
  trainingLoadCategory,
} from '../../shared/training-content-category.ts';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function parse(value: string) {
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}
function kindOf(data: Record<string, unknown>): PlanKind {
  const kinds = new Set<string>();
  for (const week of Array.isArray(data.weeklyPlans) ? data.weeklyPlans : []) {
    for (const day of Array.isArray(object(week).days) ? (object(week).days as unknown[]) : []) {
      const row = object(day);
      for (const item of Array.isArray(row.exercises)
        ? row.exercises
        : Array.isArray(row.items)
          ? row.items
          : []) {
        const value = object(item);
        const content = {
          structureType: String(value.structureType || ''),
          trainingType: String(value.trainingType || value.type || value.category || ''),
          content: String(value.name || ''),
        };
        const category = trainingLoadCategory(content);
        const detail = trainingContentCategory(content);
        if (!category && !['其它', '水上', '拉伸再生'].includes(detail)) kinds.add('physical');
        if (category === 'special' || category === 'physical') kinds.add(category);
      }
    }
  }
  return kinds.size > 1 ? 'combined' : kinds.has('special') ? 'special' : 'physical';
}

export function readTrainingPlanCatalog(
  db: DatabaseSync,
  scope: {
    athleteIds: number[];
    normalizeTrainingPlan?: (json: string) => unknown;
    canReadProjectPlan: (project: string, createdBy: number | null) => boolean;
  }
): CatalogPlan[] {
  const plans: CatalogPlan[] = [];
  if (scope.athleteIds.length) {
    const rows = db
      .prepare(
        `SELECT tp.id, tp.athlete_id AS athleteId, a.name AS athleteName,
      a.project, a.team_id AS teamId, COALESCE(pt.name, '') AS team,
      tp.title, tp.start_date AS startDate, tp.end_date AS endDate,
      COALESCE(u.display_name, '') AS createdBy, tp.plan_data AS dataJson
      FROM training_plans tp JOIN athletes a ON a.id=tp.athlete_id
      LEFT JOIN project_teams pt ON pt.id=a.team_id LEFT JOIN users u ON u.id=tp.created_by
      WHERE a.active=1 AND a.id IN (${scope.athleteIds.map(() => '?').join(',')}) ORDER BY tp.id`
      )
      .all(...scope.athleteIds) as Array<
      Omit<CatalogPlan, 'key' | 'source' | 'kind' | 'sourceStatus' | 'data'> & { dataJson: string }
    >;
    for (const { dataJson, ...row } of rows) {
      const original = parse(dataJson);
      const data = scope.normalizeTrainingPlan
        ? {
            ...original,
            ...object(scope.normalizeTrainingPlan(dataJson)),
            ...(Array.isArray(original.weeklyPlans) ? { weeklyPlans: original.weeklyPlans } : {}),
          }
        : original;
      plans.push({
        ...row,
        key: `training_plans:${row.id}`,
        source: 'training_plans',
        kind: kindOf(data),
        sourceStatus: '',
        data,
      });
    }
  }
  const special = db
    .prepare(
      `SELECT sp.id, sp.project, sp.week_start AS startDate, sp.title,
    sp.status, sp.created_by AS creatorId, COALESCE(u.display_name, '') AS createdBy
    FROM special_training_plans sp LEFT JOIN users u ON u.id=sp.created_by ORDER BY sp.id`
    )
    .all() as Array<{
    id: number;
    project: string;
    startDate: string;
    title: string;
    status: string;
    creatorId: number | null;
    createdBy: string;
  }>;
  const sessions = db.prepare(
    'SELECT * FROM special_training_plan_sessions WHERE plan_id = ? ORDER BY session_date, session_order, id'
  );
  for (const row of special) {
    if (!scope.canReadProjectPlan(row.project, row.creatorId)) continue;
    const end = new Date(`${row.startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    plans.push({
      key: `special_training_plans:${row.id}`,
      id: row.id,
      source: 'special_training_plans',
      kind: 'special',
      title: row.title,
      project: row.project,
      teamId: null,
      team: '',
      athleteId: null,
      athleteName: '',
      startDate: row.startDate,
      endDate: end.toISOString().slice(0, 10),
      createdBy: row.createdBy,
      sourceStatus: row.status,
      data: {
        sessions: sessions
          .all(row.id)
          .map((item) => ({ ...item, target: parse(String(item.target_json || '{}')) })),
      },
    });
  }
  return plans;
}
