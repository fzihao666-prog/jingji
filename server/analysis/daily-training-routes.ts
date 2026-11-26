import type { Express } from 'express';
import { z } from 'zod';
import { DAILY_TRAINING_SHEET, type DailyTrainingData } from '../../shared/daily-training.ts';
import { isProject } from '../../shared/projects.ts';
import { requireAuth } from '../core/auth.ts';
import { isValidIsoDate } from '../core/date-utils.ts';
import { db } from '../core/db.ts';
import { accessibleAthleteIds, accountPermissions, permissionsAllowProjectTeam } from '../core/permissions.ts';

const id = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).refine(Number.isSafeInteger);
const querySchema = z.object({
  project: z.string().refine(isProject),
  teamId: id,
  athleteId: id.optional(),
  from: z.string().refine(isValidIsoDate),
  to: z.string().refine(isValidIsoDate),
}).strict().refine(({ from, to }) => from <= to);

const recordLimit = 1000;
// 用已提交的工作表来源识别课次，保留没有填写数值明细的有效训练。
const dailySessions = `
  SELECT s.id, s.athlete_id, s.session_date, s.session_order, s.content,
    CASE WHEN s.duration_reported=1 THEN s.duration_min END AS duration_min
  FROM roster a JOIN training_sessions s ON s.athlete_id=a.id
  JOIN training_record_session_scope scope ON scope.session_id=s.id AND scope.team_id=?
  WHERE s.project_code=? AND s.project_status='confirmed' AND s.is_demo=0
    AND s.quality IN ('valid','partial') AND s.session_date BETWEEN ? AND ?
    AND EXISTS (
      SELECT 1 FROM data_import_items i
      JOIN data_import_batches b ON b.id=i.batch_id AND b.status='committed' AND b.project=s.project_code
      WHERE i.athlete_id=s.athlete_id AND i.committed_entity_id=s.id
        AND i.item_type='training_session' AND i.committed_entity_type='training_session' AND i.source_sheet=?
    )
`;

export function registerDailyTrainingRoutes(app: Express) {
  app.get('/api/daily-training', requireAuth, (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: '请选择有效的项目、队伍和日期范围。' });
    const { project, teamId, athleteId, from, to } = parsed.data;
    const user = req.authUser!;
    const deny = () => res.status(403).json({ message: '无权查看所选项目、队伍或运动员的每日训练。' });
    const team = db.prepare('SELECT name FROM project_teams WHERE id=? AND project=? AND active=1')
      .get(teamId, project);
    if (!team) return deny();
    const allowed = accessibleAthleteIds(user);
    if (athleteId === undefined) {
      if (!permissionsAllowProjectTeam(accountPermissions(user.id), project, String(team.name))) return deny();
    } else if (!allowed.includes(athleteId) ||
        !db.prepare('SELECT 1 FROM athletes WHERE id=? AND project=? AND team_id=? AND active=1').get(athleteId, project, teamId)) {
      return deny();
    }
    const scope = `WITH roster AS (
      SELECT id, name FROM athletes WHERE project=? AND team_id=? AND active=1
        AND id IN (SELECT value FROM json_each(?))
    ), daily AS (${dailySessions})`;
    const bindings = [
      project, teamId, JSON.stringify(athleteId === undefined ? allowed : [athleteId]),
      teamId, project, from, to, DAILY_TRAINING_SHEET,
    ] as const;
    res.setHeader('Cache-Control', 'no-store');
    if (athleteId === undefined) {
      const athletes = db.prepare(`${scope}
        SELECT a.id, a.name, COUNT(d.id) AS recordCount, COUNT(DISTINCT d.session_date) AS trainingDays,
          SUM(d.duration_min) AS durationMin, MAX(d.session_date) AS latestDate
        FROM roster a LEFT JOIN daily d ON d.athlete_id=a.id
        GROUP BY a.id, a.name ORDER BY a.id
      `).all(...bindings) as DailyTrainingData['athletes'];
      return res.json({ athletes, rows: [], truncated: false } satisfies DailyTrainingData);
    }
    const rows = db.prepare(`${scope}, recent AS (
      SELECT * FROM daily ORDER BY session_date DESC, session_order DESC, id DESC LIMIT ?
    )
      SELECT s.id, s.session_date AS date, s.content AS projectName, s.duration_min AS durationMin,
        MAX(CASE WHEN d.field='强度' THEN d.value_num END) AS intensity,
        MAX(CASE WHEN d.field='强度' AND d.value_num IS NOT NULL THEN d.unit END) AS intensityUnit,
        MAX(CASE WHEN d.field='次数' THEN d.value_num END) AS repetitions,
        MAX(CASE WHEN d.field='组数' THEN d.value_num END) AS sets,
        MAX(CASE WHEN d.field='PRE' THEN d.value_num END) AS pre
      FROM recent s LEFT JOIN training_record_details d ON d.session_id=s.id AND d.team_id=?
        AND d.template_name=? AND d.detail_order=1
      GROUP BY s.id ORDER BY s.session_date DESC, s.session_order DESC, s.id DESC
    `).all(...bindings, recordLimit + 1, teamId, DAILY_TRAINING_SHEET) as DailyTrainingData['rows'];
    return res.json({ athletes: [], rows: rows.slice(0, recordLimit), truncated: rows.length > recordLimit } satisfies DailyTrainingData);
  });
}
