import { z } from 'zod';
import { teamWeeklyQuerySchema } from './team-weekly-report.js';

const paragraph = z.string().trim().max(600);
export const teamWeeklyCommentarySchema = z
  .strictObject({
    summary: paragraph,
    training: paragraph,
    strength: paragraph,
    recovery: paragraph,
    nextWeek: paragraph,
  })
  .refine((value) => Object.values(value).join('').length <= 2000);
export type TeamWeeklyCommentary = z.infer<typeof teamWeeklyCommentarySchema>;
export const emptyTeamWeeklyCommentary = (): TeamWeeklyCommentary => ({
  summary: '',
  training: '',
  strength: '',
  recovery: '',
  nextWeek: '',
});
const fingerprint = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/);
const query = teamWeeklyQuerySchema.extend({ teamId: z.number().int().positive().max(9999999999) });
export const teamWeeklyGenerateSchema = z.strictObject({
  query,
  fingerprint,
  consent: z.literal(true),
  coachNotes: z.string().trim().max(1000),
});
export const teamWeeklyExportSchema = z.strictObject({
  query,
  fingerprint,
  commentary: teamWeeklyCommentarySchema,
  confirmed: z.literal(true),
});
