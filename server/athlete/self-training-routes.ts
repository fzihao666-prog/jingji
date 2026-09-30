import type { Express, Request } from 'express';
import { requireAuth } from '../core/auth.ts';
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

function ownAthleteId(req: Request): number | null {
  const user = req.authUser!;
  if (user.role !== 'ATL' || !user.athleteId || !hasAthleteAccess(user, user.athleteId)) return null;
  return user.athleteId;
}

export function registerSelfTrainingRoutes(app: Express) {
  app.get('/api/me/training-sessions', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以查看训练填报。' });
    const rows = listSessions(athleteId);
    res.json({ sessions: rows.map((row) => ({ ...row, editable: row.source === 'athlete_self_report' && row.createdBy === req.authUser!.id })) });
  });

  app.post('/api/me/training-sessions', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以填写训练记录。' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '训练内容、日期或数值格式无效。' });
    const id = insertSession(athleteId, parsed.data, 'athlete_self_report', req.authUser!.id);
    const session = readSession(athleteId, id);
    return res.status(201).json({ session: { ...session, editable: true } });
  });

  app.put('/api/me/training-sessions/:id', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以修改训练填报。' });
    const id = parseSessionId(req.params.id as string);
    if (!id) return res.status(400).json({ message: '训练记录编号无效。' });
    const existing = readSession(athleteId, id);
    if (!existing) return res.status(404).json({ message: '训练记录不存在。' });
    if (existing.source !== 'athlete_self_report' || existing.createdBy !== req.authUser!.id)
      return res.status(403).json({ message: '只能修改本人填报的训练记录。' });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '训练内容、日期或数值格式无效。' });
    updateSession(athleteId, id, parsed.data, existing);
    return res.json({ session: { ...readSession(athleteId, id), editable: true } });
  });

  app.delete('/api/me/training-sessions/:id', requireAuth, (req, res) => {
    const athleteId = ownAthleteId(req);
    if (!athleteId) return res.status(403).json({ message: '只有运动员本人可以删除训练填报。' });
    const id = parseSessionId(req.params.id as string);
    if (!id) return res.status(400).json({ message: '训练记录编号无效。' });
    const existing = readSession(athleteId, id);
    if (!existing) return res.status(404).json({ message: '训练记录不存在。' });
    if (existing.source !== 'athlete_self_report' || existing.createdBy !== req.authUser!.id)
      return res.status(403).json({ message: '只能删除本人填报的训练记录。' });
    db.prepare('DELETE FROM training_sessions WHERE id = ? AND athlete_id = ?').run(id, athleteId);
    return res.json({ message: '训练记录已删除。' });
  });
}
