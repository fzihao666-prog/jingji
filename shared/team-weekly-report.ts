import { z } from 'zod';
import { isProject } from './projects.js';
import { reportDataSchema, reportRangeSchema } from './training-report.js';

export const teamWeeklyQuerySchema = z.strictObject({
  reportType: z.enum(['special', 'physical']),
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
export const teamWeeklyReportSchema = z.object({
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
export type TeamWeeklyReport = z.infer<typeof teamWeeklyReportSchema>;
