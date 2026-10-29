import { z } from 'zod';
import { teamWeeklyQuerySchema, teamWeeklyReportSchema } from './team-weekly-report.js';
import { teamWeeklyCommentarySchema } from './team-weekly-ai.js';
export const weeklyDraftInputSchema = z.strictObject({
  query: teamWeeklyQuerySchema.extend({ teamId: z.number().int().positive().max(9999999999) }),
  stage: z.string().trim().max(100).default(''),
  coachNotes: z.string().trim().max(3000).default(''),
  consent: z.boolean().default(false),
});
export const weeklyDraftSchema = z.object({
  data: teamWeeklyReportSchema,
  commentary: teamWeeklyCommentarySchema,
  fingerprint: z.string().length(64),
  expectedRevision: z.number().int().nonnegative(),
  aiStatus: z.enum(['generated', 'fallback', 'skipped']),
  messages: z.array(z.string()),
});
export type WeeklyDraft = z.infer<typeof weeklyDraftSchema>;
export type WeeklyDraftInput = z.infer<typeof weeklyDraftInputSchema>;
export const weeklySaveSchema = z.strictObject({
  report: teamWeeklyReportSchema,
  fingerprint: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]+$/),
  commentary: teamWeeklyCommentarySchema,
  photoIds: z.array(z.string().uuid()).max(8).default([]),
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.literal(true),
});
