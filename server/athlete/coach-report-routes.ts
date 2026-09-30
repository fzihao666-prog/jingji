import type { Express, Request } from 'express';
import { requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import { hasAthleteAccess } from '../core/permissions.ts';
import {
  insertSession,
  listSessions,
  parseSessionId,
  readSession,
  sessionSchema,
  updateSession,
} from './training-session-service.ts';
import {
  COACH_REPORT_SOURCE,
  coachWellnessWriteSchema,
  firstIssueMessage,
  wellnessQuerySchema,
  wellnessWindow,
} from './self-daily-service.ts';
import { readWellness, upsertWellness } from './wellness-store.ts';

const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] as const;

function targetAthleteId(req: Request): number | null {
  const athleteId = Number(req.params.id || 0);
  if (!athleteId || !hasAthleteAccess(req.authUser!, athleteId)) return null;
  return athleteId;
}

function audit(userId: number, action: string, entityType: string, entityId: number, detail: unknown) {
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, action, entityType, entityId, JSON.stringify(detail));
}

// 教练代填报：管理角色在访问范围内为运动员录入训练课次与恢复日报，source 统一标记 coach_report。
export function registerCoachReportRoutes(app: Express) {
  app.get('/api/athletes/:id/training-sessions', requireAuth, requireRole(...MANAGER_ROLES), (req, res) => {
    const athleteId = targetAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '无权查看该运动员的训练记录。' });
    const rows = listSessions(athleteId);
    res.json({
      sessions: rows.map((row) => ({
        ...row,
        // 本人自评仍归运动员本人维护；教练侧只展示代填记录的修改入口。
        editable: row.source === 'coach_report',
      })),
    });
  });

  app.post('/api/athletes/:id/training-sessions', requireAuth, requireRole(...MANAGER_ROLES), (req, res) => {
    const user = req.authUser!;
    const athleteId = targetAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '无权为该运动员填写训练记录。' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '训练内容、日期或数值格式无效。' });
    const id = insertSession(athleteId, parsed.data, COACH_REPORT_SOURCE, user.id);
    audit(user.id, 'CREATE_COACH_TRAINING_SESSION', 'training_session', id, {
      athleteId,
      date: parsed.data.date,
    });
    return res.status(201).json({ session: { ...readSession(athleteId, id), editable: true } });
  });

  app.put('/api/athletes/:id/training-sessions/:sessionId', requireAuth, requireRole(...MANAGER_ROLES), (req, res) => {
    const user = req.authUser!;
    const athleteId = targetAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '无权修改该运动员的训练记录。' });
    const id = parseSessionId(req.params.sessionId as string);
    if (!id) return res.status(400).json({ message: '训练记录编号无效。' });
    const existing = readSession(athleteId, id);
    if (!existing) return res.status(404).json({ message: '训练记录不存在。' });
    if (existing.source !== COACH_REPORT_SOURCE)
      return res.status(403).json({ message: '只能修改教练代填的训练记录。' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '训练内容、日期或数值格式无效。' });
    updateSession(athleteId, id, parsed.data, existing);
    audit(user.id, 'UPDATE_COACH_TRAINING_SESSION', 'training_session', id, {
      athleteId,
      date: parsed.data.date,
    });
    return res.json({ session: { ...readSession(athleteId, id), editable: true } });
  });

  app.delete('/api/athletes/:id/training-sessions/:sessionId', requireAuth, requireRole(...MANAGER_ROLES), (req, res) => {
    const user = req.authUser!;
    const athleteId = targetAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '无权删除该运动员的训练记录。' });
    const id = parseSessionId(req.params.sessionId as string);
    if (!id) return res.status(400).json({ message: '训练记录编号无效。' });
    const existing = readSession(athleteId, id);
    if (!existing) return res.status(404).json({ message: '训练记录不存在。' });
    if (existing.source !== COACH_REPORT_SOURCE)
      return res.status(403).json({ message: '只能删除教练代填的训练记录。' });
    db.prepare('DELETE FROM training_sessions WHERE id = ? AND athlete_id = ?').run(id, athleteId);
    audit(user.id, 'DELETE_COACH_TRAINING_SESSION', 'training_session', id, { athleteId });
    return res.json({ message: '训练记录已删除。' });
  });

  app.get('/api/athletes/:id/wellness', requireAuth, requireRole(...MANAGER_ROLES), (req, res) => {
    const athleteId = targetAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '无权查看该运动员的恢复日报。' });
    const parsed = wellnessQuerySchema(new Date()).safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: firstIssueMessage(parsed.error, '恢复日报日期无效。') });
    const date = parsed.data.date || wellnessWindow(new Date()).today;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ date, record: readWellness(athleteId, date) });
  });

  app.post('/api/athletes/:id/wellness', requireAuth, requireRole(...MANAGER_ROLES), (req, res) => {
    const user = req.authUser!;
    const athleteId = targetAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '无权为该运动员填写恢复日报。' });
    const parsed = coachWellnessWriteSchema(new Date()).safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: firstIssueMessage(parsed.error, '恢复日报内容格式无效。') });
    const row = parsed.data;
    const date = row.date || wellnessWindow(new Date()).today;
    upsertWellness(athleteId, date, row, COACH_REPORT_SOURCE);
    audit(user.id, 'CREATE_COACH_WELLNESS', 'daily_wellness', athleteId, { date });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ date, record: readWellness(athleteId, date) });
  });
}
