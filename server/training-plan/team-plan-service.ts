import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { TeamPlan, TeamPlanData } from '../../shared/team-plan.ts';
export { resolveTeamPlanSessions } from '../../shared/team-plan.ts';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  );
const metric = z.number().finite().min(0).max(100000).nullable().default(null);
const fields = {
  period: z.string().max(80).default(''),
  content: z.string().trim().min(1).max(4000),
  durationMin: metric,
  distanceKm: metric,
  intensity: z.string().max(200).default(''),
  sets: metric,
  reps: metric,
  load: metric,
  notes: z.string().max(4000).default(''),
};
const item = z
  .object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
  })
  .strict();
const session = z
  .object({
    id: z.string().trim().min(1).max(100),
    date,
    category: z.enum(['special', 'physical', 'recovery']),
    ...fields,
    items: z.array(item).max(50).optional(),
  })
  .strict();
const changes = z
  .object({
    period: fields.period.unwrap().optional(),
    content: fields.content.optional(),
    durationMin: metric.unwrap().optional(),
    distanceKm: metric.unwrap().optional(),
    intensity: fields.intensity.unwrap().optional(),
    sets: metric.unwrap().optional(),
    reps: metric.unwrap().optional(),
    load: metric.unwrap().optional(),
    notes: fields.notes.unwrap().optional(),
    items: z.array(item).max(50).optional(),
  })
  .strict();
export const teamPlanInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    startDate: date,
    endDate: date,
    data: z
      .object({
        goal: z.string().max(4000).default(''),
        focus: z.string().max(4000).default(''),
        sessions: z.array(session).max(1000),
        overrides: z
          .array(
            z
              .object({
                athleteId: z.number().int().positive(),
                sessionId: z.string().trim().min(1).max(100),
                changes,
                reason: z.string().trim().min(1).max(1000),
                createdBy: z.number().int().positive().optional(),
                updatedBy: z.number().int().positive().optional(),
                createdAt: z.string().max(40).optional(),
                updatedAt: z.string().max(40).optional(),
              })
              .strict()
          )
          .max(10000),
      })
      .strict(),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    if (value.startDate > value.endDate)
      ctx.addIssue({ code: 'custom', message: '结束日期不能早于开始日期' });
    for (const item of value.data.sessions) {
      if (ids.has(item.id) || item.date < value.startDate || item.date > value.endDate)
        ctx.addIssue({ code: 'custom', message: '训练课标识重复或日期超出计划周期' });
      ids.add(item.id);
    }
    for (const item of value.data.overrides) {
      const key = `${item.athleteId}:${item.sessionId}`;
      if (!ids.has(item.sessionId) || keys.has(key) || !Object.keys(item.changes).length)
        ctx.addIssue({ code: 'custom', message: '个人调整关联无效或重复' });
      const base = value.data.sessions.find((session) => session.id === item.sessionId);
      if (base) {
        for (const field of Object.keys(item.changes) as Array<keyof typeof item.changes>)
          if (item.changes[field] === base[field]) delete item.changes[field];
        if (!Object.keys(item.changes).length)
          ctx.addIssue({ code: 'custom', message: '个人调整必须包含实际差异' });
      }
      keys.add(key);
    }
  });
export function readTeamPlans(db: DatabaseSync): TeamPlan[] {
  // 兼容缺省 ai_metadata 列的旧库/测试表（生产迁移会补列）。
  const hasAiMetadata = (
    db.prepare('PRAGMA table_info(training_plans)').all() as { name: string }[]
  ).some((column) => column.name === 'ai_metadata');
  const rows = db
    .prepare(
      `SELECT p.id,p.root_id AS rootId,p.version,p.revision,p.status,p.team_id AS teamId,t.project,t.name AS team,p.title,p.start_date AS startDate,p.end_date AS endDate,p.plan_data AS data,${hasAiMetadata ? 'p.ai_metadata AS aiMetadata' : 'NULL AS aiMetadata'},p.published_at AS publishedAt,p.archived_at AS archivedAt FROM training_plans p JOIN project_teams t ON t.id=p.team_id WHERE p.model='team' ORDER BY p.start_date DESC,p.version DESC`
    )
    .all() as unknown as Array<Omit<TeamPlan, 'data' | 'aiMetadata'> & {
    data: string;
    aiMetadata: string | null;
  }>;
  return rows.map((row) => {
    let aiMetadata: TeamPlan['aiMetadata'] = null;
    if (row.aiMetadata) {
      try {
        aiMetadata = JSON.parse(row.aiMetadata) as TeamPlan['aiMetadata'];
      } catch {
        aiMetadata = null;
      }
    }
    return { ...row, data: JSON.parse(row.data) as TeamPlanData, aiMetadata };
  });
}
export function readTeamPlansForAthlete(
  db: DatabaseSync,
  athleteId: number,
  includeHistory = true
): TeamPlan[] {
  const athlete = db.prepare('SELECT team_id AS teamId FROM athletes WHERE id=?').get(athleteId) as
    { teamId: number } | undefined;
  return readTeamPlans(db)
    .filter(
      (plan) =>
        plan.teamId === athlete?.teamId &&
        (plan.status === 'published' || (includeHistory && plan.publishedAt !== null))
    )
    .map((plan) => ({
      ...plan,
      data: {
        ...plan.data,
        overrides: plan.data.overrides.filter((item) => item.athleteId === athleteId),
      },
    }));
}
