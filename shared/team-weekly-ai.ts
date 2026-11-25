import { z } from 'zod';

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
