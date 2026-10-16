import type { DatabaseSync } from 'node:sqlite';
import { beijingDate } from './coach-daily-todos.ts';
import {
  resolveTeamPlanSessions,
  type TeamPlan,
  type TeamPlanSession,
} from '../../shared/team-plan.ts';

export class TrainingPlanLinkError extends Error {}
export type TrainingPlanLink = { planId: number; sessionId: string; target: TeamPlanSession };
export function initializeTrainingPlanLinks(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS training_plan_execution_links (
    training_session_id INTEGER PRIMARY KEY REFERENCES training_sessions(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE RESTRICT,
    session_id TEXT NOT NULL, target_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); CREATE INDEX IF NOT EXISTS training_plan_execution_links_plan ON training_plan_execution_links(plan_id,session_id);`);
}

export function resolveTrainingPlanLink(
  db: DatabaseSync,
  athleteId: number,
  input: {
    date: string;
    trainingType: string;
    teamPlanId?: number;
    planSessionId?: string;
  }
): TrainingPlanLink | null {
  if (!input.teamPlanId && !input.planSessionId) return null;
  if (!input.teamPlanId || !input.planSessionId)
    throw new TrainingPlanLinkError('计划版本与训练课必须同时选择。');
  const row = db
    .prepare(
      `SELECT p.id,p.root_id AS rootId,p.team_id AS teamId,p.status,p.archived_at AS archivedAt,p.published_at AS publishedAt,p.plan_data AS data
    FROM training_plans p JOIN athletes a ON a.team_id=p.team_id
    WHERE p.id=? AND p.model='team' AND a.id=?`
    )
    .get(input.teamPlanId, athleteId) as
    | {
        id: number;
        rootId: number;
        teamId: number;
        status: string;
        archivedAt: string | null;
        publishedAt: string | null;
        data: string;
      }
    | undefined;
  if (
    !row ||
    !['published', 'archived'].includes(row.status) ||
    !row.publishedAt ||
    beijingDate(new Date(row.publishedAt)) > input.date ||
    (row.archivedAt && input.date >= beijingDate(new Date(row.archivedAt)))
  )
    throw new TrainingPlanLinkError('只能关联本人队伍在训练当日已发布的有效计划。');
  const newer = db
    .prepare(
      `SELECT id,published_at AS publishedAt FROM training_plans
    WHERE model='team' AND root_id=? AND published_at IS NOT NULL AND (published_at>? OR (published_at=? AND id>?))`
    )
    .all(row.rootId, row.publishedAt, row.publishedAt, row.id) as {
    id: number;
    publishedAt: string;
  }[];
  if (newer.some((plan) => beijingDate(new Date(plan.publishedAt)) <= input.date))
    throw new TrainingPlanLinkError('该训练日期已有新版计划，请选择当时适用的发布版本。');
  const plan: Pick<TeamPlan, 'data'> = { data: JSON.parse(row.data) };
  const target = resolveTeamPlanSessions(plan, athleteId).find(
    (item) => item.id === input.planSessionId
  );
  const category = { special: '专项训练', physical: '体能训练', recovery: '恢复训练' };
  if (!target || target.date !== input.date || category[target.category] !== input.trainingType)
    throw new TrainingPlanLinkError('计划训练课的日期或训练类别与实际记录不一致。');
  return { planId: row.id, sessionId: target.id, target };
}
export function saveTrainingPlanLink(
  db: DatabaseSync,
  sessionId: number,
  link: TrainingPlanLink | null
) {
  if (!link) return;
  db.prepare(
    'INSERT INTO training_plan_execution_links(training_session_id,plan_id,session_id,target_json) VALUES(?,?,?,?)'
  ).run(sessionId, link.planId, link.sessionId, JSON.stringify(link.target));
}
