import type { Express } from 'express';
import { z } from 'zod';
import { AI_FEATURES, AI_STATES, type AiManagementData } from '../../shared/ai-management.ts';
import { requireAuth, requireRole } from './auth.ts';
import { aiDate, currentAiLedger } from './ai-usage.ts';
import { isValidIsoDate } from './date-utils.ts';

const filters = z.strictObject({
  date: z.string().refine(isValidIsoDate).optional(),
  account: z
    .string()
    .regex(/^(?:[1-9]\d{0,14}|system)$/)
    .optional(),
  feature: z.enum(AI_FEATURES).optional(),
  state: z.enum(Object.keys(AI_STATES)).optional(),
  before: z
    .string()
    .regex(/^[1-9]\d{0,14}$/)
    .optional(),
});

const settingsInput = z.strictObject({
  enabled: z.boolean(),
  budgetYuan: z
    .number()
    .nonnegative()
    .multipleOf(0.01)
    .refine((value) => Number.isSafeInteger(Math.round(value * 1_000_000))),
});

export function registerAiManagementRoutes(app: Express) {
  const admin = [requireAuth, requireRole('DMD')];
  app.get('/api/ai-management', ...admin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = filters.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: 'AI 请求筛选条件无效。' });
    const { date, account = '', feature = '', state = '', before } = parsed.data;
    try {
      const ledger = currentAiLedger();
      const today = aiDate();
      const { enabled, budget } = ledger.settings();
      const rows = ledger.list(date ?? today, account, feature, state, Number(before ?? 0));
      const data: AiManagementData = {
        settings: { enabled: Boolean(enabled), budgetYuan: budget / 1_000_000 },
        today,
        summary: ledger.summary(today),
        attempts: rows.slice(0, 50),
        next: rows.length > 50 ? rows[49].id : null,
      };
      return res.json(data);
    } catch {
      return res.status(503).json({ message: 'AI 用量账本暂不可用。' });
    }
  });

  app.put('/api/ai-management/settings', ...admin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = settingsInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '请输入有效的开关和每日预算。' });
    try {
      const { enabled, budgetYuan } = parsed.data;
      currentAiLedger().update(req.authUser!.id, enabled, Math.round(budgetYuan * 1_000_000));
      return res.json(parsed.data);
    } catch {
      return res.status(503).json({ message: 'AI 设置暂时无法保存。' });
    }
  });
}
