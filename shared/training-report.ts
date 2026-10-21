import { z } from 'zod';

export const reportRangeSchema = z
  .strictObject({
    from: z.string().max(10).pipe(z.iso.date()),
    to: z.string().max(10).pipe(z.iso.date()),
    kind: z.enum(['week', 'month', 'custom']),
  })
  .refine(({ from, to }) => from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 < 90, {
    message: '请选择不超过 90 天的有效日期范围。',
  })
  .refine(
    ({ kind, from, to }) => {
      if (kind === 'custom') return true;
      if (!Number.isFinite(Date.parse(from))) return false;
      const period = reportPeriod(kind, from);
      return period.from === from && period.to === to;
    },
    { message: '周报和月报必须使用自然周或自然月。' }
  );
export type ReportRange = z.infer<typeof reportRangeSchema>;
export const reportCommentarySchema = z
  .strictObject({
    highlights: z.array(z.string().trim().min(1).max(100)).max(2),
    concerns: z.array(z.string().trim().min(1).max(100)).max(2),
    suggestions: z.array(z.string().trim().min(1).max(100)).max(2),
  })
  .refine((value) => Object.values(value).flat().join('').length <= 250);
export type ReportCommentary = z.infer<typeof reportCommentarySchema>;
export const emptyReportCommentary = (): ReportCommentary => ({
  highlights: [],
  concerns: [],
  suggestions: [],
});
const value = z.number().finite().nullable();
const totals = z.strictObject({
  sessions: z.number(),
  duration: value,
  distance: value,
  srpe: value,
  durationCount: z.number(),
  distanceCount: z.number(),
  srpeCount: z.number(),
});
const point = z.strictObject({ date: z.string(), value: z.number() });
export const reportDataSchema = z.strictObject({
  version: z.literal(1),
  range: reportRangeSchema,
  project: z.string(),
  totals,
  previous: totals,
  daily: z.array(
    z.strictObject({
      date: z.string(),
      sessions: z.number(),
      special: value,
      physical: value,
      recovery: value,
      other: value,
      duration: value,
      srpe: value,
    })
  ),
  categories: z.array(
    z.strictObject({ key: z.string(), label: z.string(), sessions: z.number(), duration: value })
  ),
  tests: z.array(
    z.strictObject({
      key: z.string(),
      label: z.string(),
      unit: z.string(),
      protocol: z.string(),
      side: z.string(),
      points: z.array(point),
      first: point,
      last: point,
      change: value,
    })
  ),
  wellness: z.array(
    z.strictObject({
      key: z.string(),
      label: z.string(),
      unit: z.string(),
      days: z.number(),
      points: z.array(point),
      average: value,
    })
  ),
  days: z.number(),
  trainingDays: z.number(),
  wellnessDays: z.number(),
});
export type ReportData = z.infer<typeof reportDataSchema>;
export const reportPreviewSchema = z.strictObject({
  data: reportDataSchema,
  fingerprint: z.string().length(64),
});
export type ReportPreview = z.infer<typeof reportPreviewSchema>;
export const savedReportSchema = z.strictObject({
  id: z.string(),
  createdAt: z.string(),
  data: reportDataSchema,
  commentary: reportCommentarySchema,
});
export type SavedReport = z.infer<typeof savedReportSchema>;
export const reportHistorySchema = z.array(
  z.strictObject({
    id: z.string(),
    createdAt: z.string(),
    from: z.string(),
    to: z.string(),
    kind: z.string(),
  })
);
export type ReportHistory = z.infer<typeof reportHistorySchema>;

/** 周按周一至周日，月按自然月；以选择的日期为锚点，不依赖 UTC 当天。 */
export function reportPeriod(
  kind: 'week' | 'month' | 'custom',
  anchor: string
): { kind: 'week' | 'month' | 'custom'; from: string; to: string } {
  const date = new Date(`${anchor}T00:00:00Z`);
  const end = new Date(date);
  if (kind === 'week') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    end.setTime(date.getTime() + 6 * 86400000);
  } else if (kind === 'month') {
    date.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }
  return { kind, from: date.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
