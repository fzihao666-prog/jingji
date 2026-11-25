import { z } from 'zod';
import { accountPasswordSchema, ACCOUNT_PASSWORD_HINT } from './account-password.js';

export const ACCOUNT_USERNAME_HINT = '登录账号须为4—24位字母、数字或下划线，不区分大小写。';
export const INITIAL_ACCOUNT_PASSWORD_HINT = ACCOUNT_PASSWORD_HINT.replace('新密码', '初始密码');

export const accountCredentialsSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(4)
    .max(24)
    .regex(/^[a-z0-9_]+$/),
  password: accountPasswordSchema,
});
