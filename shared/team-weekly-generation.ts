import { z } from 'zod';
import { teamWeeklyQuerySchema } from './team-weekly-report.js';

/** 一次生成并下载；不接收浏览器提交的报告事实或文案。 */
export const weeklyGenerationSchema = z.strictObject({
  query: teamWeeklyQuerySchema.extend({
    teamId: z.number().int().positive().max(9999999999),
    reportType: z.literal('combined').default('combined'),
  }),
  stage: z.string().trim().max(100).default(''),
  coachNotes: z.string().trim().max(3000).default(''),
  consent: z.boolean().default(false),
});
export type WeeklyGenerationInput = z.input<typeof weeklyGenerationSchema>;
