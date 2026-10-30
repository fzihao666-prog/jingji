import { z } from 'zod';
import { isProject } from './projects.js';
import { reportDataSchema, reportRangeSchema } from './training-report.js';

export const weeklyReportTypeSchema = z.enum(['special', 'physical', 'combined']);
export const teamWeeklyQuerySchema = z.strictObject({
  reportType: weeklyReportTypeSchema.default('combined'),
  project: z.string().max(40).refine(isProject),
  teamId: z
    .string()
    .max(10)
    .regex(/^[1-9]\d*$/)
    .transform(Number),
  date: z.string().max(10).pipe(z.iso.date()),
});
export type TeamWeeklyQuery = z.infer<typeof teamWeeklyQuerySchema>;
const value = z.number().finite().nullable();
const totals = z.object({
  sessions: z.number(),
  participations: z.number(),
  duration: value,
  distance: value,
  srpe: value,
  durationCount: z.number(),
  srpeCount: z.number(),
  distanceCount: z.number(),
  rpe: value,
  rpeCount: z.number(),
});
const planSession = z.object({
  date: z.string(),
  period: z.string().optional(),
  content: z.string(),
  duration: value,
  distance: value,
  status: z.string(),
  linkedRecords: z.number(),
});
export const legacyTeamWeeklyReportSchema = z.object({
  reportType: z.enum(['special', 'physical']),
  stage: z.string(),
  coachNotes: z.string(),
  templateVersion: z.literal('weekly-v2'),
  comparison: z.object({
    metrics: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        current: z.number(),
        previous: z.number(),
        unit: z.string(),
      })
    ),
    notes: z.array(z.string()),
  }),
  dataNotes: z.array(z.string()),
  project: z.string().refine(isProject),
  teamId: z.number(),
  teamName: z.string(),
  generatedAt: z.string(),
  fingerprint: z.string().optional(),
  range: reportRangeSchema,
  totals,
  previous: totals,
  daily: z.array(
    z.object({
      date: z.string(),
      sessions: z.number(),
      participations: z.number(),
      duration: value,
      srpe: value,
      rpe: value,
    })
  ),
  strength: z
    .array(
      z.object({
        athleteId: z.number(),
        athleteName: z.string(),
        exercise: z.string(),
        sets: z.number(),
        reps: z.number(),
        volumeKg: z.number(),
      })
    )
    .optional(),
  recovery: z
    .array(
      z.object({
        date: z.string(),
        sleep: value,
        pulse: value,
        fatigue: value,
        samples: z.number(),
      })
    )
    .optional(),
  categories: z.array(z.object({ label: z.string(), participations: z.number(), duration: value })),
  athletes: z.array(z.object({ id: z.number(), name: z.string(), data: reportDataSchema })),
  injuries: z.array(
    z.object({
      athlete: z.string(),
      date: z.string(),
      name: z.string(),
      status: z.string(),
      pain: value,
    })
  ),
  plansAvailable: z.boolean(),
  plans: z.array(planSession),
  nextPlans: z.array(planSession),
  summary: z.array(z.string()),
  concerns: z.array(z.string()),
  sourceNotes: z.array(z.string()),
});
export type LegacyTeamWeeklyReport = z.infer<typeof legacyTeamWeeklyReportSchema>;
const view = z.object({
  totals,
  previous: totals,
  daily: legacyTeamWeeklyReportSchema.shape.daily,
  categories: legacyTeamWeeklyReportSchema.shape.categories,
});
const combinedPlan = planSession.extend({
  category: z.enum(['special', 'physical', 'recovery']),
  sets: value,
  reps: value,
  load: value,
  notes: z.string(),
  items: z.array(z.object({ id: z.string(), title: z.string(), description: z.string() })),
});
export const combinedTeamWeeklyReportSchema = legacyTeamWeeklyReportSchema.extend({
  reportType: z.literal('combined'),
  templateVersion: z.literal('weekly-v3'),
  breakdown: z.object({ special: view, physical: view, unclassified: view }),
  trainingDetails: z.array(
    z.object({
      id: z.number(),
      athleteId: z.number(),
      athleteName: z.string(),
      date: z.string(),
      order: z.number(),
      category: z.enum(['special', 'physical', 'unclassified']),
      content: z.string(),
      duration: value,
      distance: value,
      srpe: value,
    })
  ),
  strengthPrevious: legacyTeamWeeklyReportSchema.shape.strength.unwrap(),
  strengthComparable: z.boolean(),
  strengthDetails: z.array(
    z.object({
      athleteId: z.number(),
      athleteName: z.string(),
      date: z.string(),
      exercise: z.string(),
      reps: value,
      weightKg: value,
      durationMin: value,
      distanceKm: value,
      note: z.string(),
      completed: z.boolean(),
    })
  ),
  plans: z.array(combinedPlan),
  nextPlans: z.array(combinedPlan),
});
export type CombinedTeamWeeklyReport = z.infer<typeof combinedTeamWeeklyReportSchema>;
export const teamWeeklyReportSchema = z.discriminatedUnion('templateVersion', [
  legacyTeamWeeklyReportSchema,
  combinedTeamWeeklyReportSchema,
]);
export type TeamWeeklyReport = z.infer<typeof teamWeeklyReportSchema>;
/** 只匹配规范动作全名；变式及不明确名称留在附录。 */
export const WEEKLY_FOCUS_EXERCISES = ['卧拉', '卧推', '深蹲', '硬拉'] as const;
