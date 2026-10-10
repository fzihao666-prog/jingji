import { z } from 'zod';

export const accountPasswordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/)
  .regex(/\d/)
  .refine((value) => value === value.trim())
  .refine((value) => new TextEncoder().encode(value).length <= 72);

export const resetAccountPasswordSchema = z.strictObject({
  newPassword: accountPasswordSchema,
});

export const resetAccountPasswordResponseSchema = z.strictObject({ message: z.string() });

export const ACCOUNT_PASSWORD_HINT =
  '新密码须为8—72位，同时包含字母和数字，且不超过72字节，首尾不能有空白字符。';
