import { z } from 'zod';
import { beijingDate } from '../core/coach-daily-todos.ts';
import { isValidIsoDate } from '../core/date-utils.ts';

// 恢复日报允许回填最近7天（含今天）；未来日期一律拒绝。
export const WELLNESS_BACKFILL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WELLNESS_SOURCE = 'athlete_self_report';

export function wellnessWindow(now: Date) {
  const today = beijingDate(now);
  const earliest = beijingDate(new Date(now.getTime() - (WELLNESS_BACKFILL_DAYS - 1) * DAY_MS));
  return { today, earliest };
}

function wellnessDate(now: Date) {
  const { today, earliest } = wellnessWindow(now);
  return z
    .string()
    .trim()
    .max(10)
    .refine(isValidIsoDate, { message: '恢复日报日期格式无效。' })
    .refine((value) => value >= earliest && value <= today, {
      message: `恢复日报只能填写最近${WELLNESS_BACKFILL_DAYS}天（含今天）的数据。`,
    });
}

// 数值字段支持 null（显式清空该项）、数字与数字字符串；空字符串按未填写处理。
function metric(min: number, max: number, message: string) {
  return z
    .union([z.string().max(20), z.number(), z.null()])
    .optional()
    .transform((value) => (value === '' || value === undefined || value === null ? null : Number(value)))
    .refine((value) => value === null || (Number.isFinite(value) && value >= min && value <= max), {
      message,
    });
}

// 恢复日报只保存原始自评数值：不生成诊断、评分或状态推断，未知字段直接拒绝。
export function wellnessWriteSchema(now: Date) {
  return z
    .strictObject({
      date: wellnessDate(now).optional(),
      sleepHours: metric(0, 24, '睡眠时长应为0至24小时。'),
      sleepQuality: metric(0, 10, '睡眠质量应为0至10分。'),
      morningPulse: metric(25, 250, '晨脉应为25至250bpm。'),
      weightKg: metric(20, 250, '体重应为20至250kg。'),
      fatigueIndex: metric(0, 10, '疲劳程度应为0至10分。'),
      sorenessIndex: metric(0, 10, '酸痛程度应为0至10分。'),
      moodIndex: metric(0, 10, '心情应为0至10分。'),
      // status 只接受本人自评的两种口径，attention/alert/missing 属于导入与教练侧分类。
      status: z.enum(['normal', 'rest']).optional(),
    })
    .refine(
      (row) =>
        [
          row.sleepHours,
          row.sleepQuality,
          row.morningPulse,
          row.weightKg,
          row.fatigueIndex,
          row.sorenessIndex,
          row.moodIndex,
        ].some((value) => value !== null),
      { message: '至少填写一项恢复数据。' }
    );
}

export function wellnessQuerySchema(now: Date) {
  return z.strictObject({ date: wellnessDate(now).optional() });
}

export function firstIssueMessage(error: z.ZodError, fallback: string) {
  return error.issues[0]?.message || fallback;
}
