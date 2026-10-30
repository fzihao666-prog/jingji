import { z } from 'zod';
import { teamWeeklyReportSchema, weeklyReportTypeSchema } from './team-weekly-report.js';
import { teamWeeklyCommentarySchema } from './team-weekly-ai.js';
export const weeklyPhotoScopeSchema = z.strictObject({
  project: z.string().min(1).max(40),
  teamId: z.coerce.number().int().positive(),
  reportType: weeklyReportTypeSchema.default('combined'),
});
export type WeeklyPhotoScope = z.infer<typeof weeklyPhotoScopeSchema>;
export type WeeklyPhotoScopeInput = z.input<typeof weeklyPhotoScopeSchema>;
export const weeklyPhotoSchema = z.strictObject({
  id: z.string().uuid(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  url: z.string().regex(/^\/api\/reports\/weekly\/photos\/[a-f0-9-]{36}$/),
});
export type WeeklyPhoto = z.infer<typeof weeklyPhotoSchema>;
export const confirmTeamWeeklySchema = z.strictObject({
  report: teamWeeklyReportSchema,
  commentary: teamWeeklyCommentarySchema,
  photoIds: z.array(z.string().uuid()).max(8).default([]),
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.literal(true),
});
export const savedTeamWeeklyReportSchema = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  savedAt: z.iso.datetime(),
  report: teamWeeklyReportSchema,
  commentary: teamWeeklyCommentarySchema,
  photos: z.array(weeklyPhotoSchema).max(8),
});
export type SavedTeamWeeklyReport = z.infer<typeof savedTeamWeeklyReportSchema>;
export const teamWeeklyHistoryItemSchema = z.strictObject({
  id: z.string().uuid(),
  project: z.string(),
  teamId: z.number().int().positive(),
  teamName: z.string(),
  weekStart: z.iso.date(),
  reportType: weeklyReportTypeSchema,
  revision: z.number().int().positive(),
  savedAt: z.iso.datetime(),
});
export type TeamWeeklyHistoryItem = z.infer<typeof teamWeeklyHistoryItemSchema>;
export const teamWeeklyHistorySchema = z.strictObject({
  page: z.number().int().positive(),
  pageSize: z.literal(20),
  total: z.number().int().nonnegative(),
  items: z.array(teamWeeklyHistoryItemSchema).max(20),
});
export type TeamWeeklyHistory = z.infer<typeof teamWeeklyHistorySchema>;
