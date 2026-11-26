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
// 早期批次没有队伍编号，依次使用当时队名和已授权的当前队伍。
const summary = "CASE WHEN json_valid(b.summary_json) THEN b.summary_json ELSE '{}' END";
const batchInTeam = `(
  json_extract(${summary}, '$.teamId')=s.team_id OR
  (json_extract(${summary}, '$.teamId') IS NULL AND
    COALESCE(NULLIF(json_extract(${summary}, '$.team'), ''), s.team_name)=s.team_name)
)`;
const trainingScope = `
  WITH roster AS (
    SELECT id, name FROM athletes WHERE project=? AND team_id=? AND active=1
      AND id IN (SELECT value FROM json_each(?))
  ), eligible AS (
    SELECT s.id, s.athlete_id, s.session_date, s.session_order, s.project_code,
      COALESCE(NULLIF(s.content,''), NULLIF(s.training_type,''), '训练课次') AS content,
      CASE WHEN s.duration_reported=1 THEN s.duration_min END AS duration_min,
      CASE WHEN s.distance_reported=1 THEN s.distance_km END AS distance_km,
      s.rpe, team.id AS team_id, team.name AS team_name
    FROM roster a JOIN training_sessions s ON s.athlete_id=a.id
    JOIN project_teams team ON team.id=? AND team.project=s.project_code
    LEFT JOIN training_record_session_scope scope ON scope.session_id=s.id
    WHERE (scope.team_id IS NULL OR scope.team_id=team.id)
      AND s.project_code=? AND s.project_status='confirmed' AND s.is_demo=0
      AND s.quality IN ('valid','partial') AND s.session_date BETWEEN ? AND ?
  ), imported_sets AS (
    SELECT r.id, r.training_session_id, r.exercise_name, r.actual_reps, r.actual_weight_kg, r.completed
    FROM eligible s JOIN strength_result_sets r ON r.training_session_id=s.id
    JOIN data_import_batches b ON b.id=r.data_import_batch_id AND b.status='committed' AND b.project=s.project_code
    WHERE ${batchInTeam}
  ), imported_sessions AS (
    SELECT s.id, MAX(CASE WHEN ${batchInTeam} THEN 1 ELSE 0 END) AS in_team
    FROM eligible s JOIN data_import_items i ON i.athlete_id=s.athlete_id AND i.committed_entity_id=s.id
      AND i.item_type='training_session' AND i.committed_entity_type='training_session'
    JOIN data_import_batches b ON b.id=i.batch_id AND b.status='committed' AND b.project=s.project_code
    GROUP BY s.id
  ), daily AS (
    SELECT s.* FROM eligible s LEFT JOIN imported_sessions imported ON imported.id=s.id
    WHERE imported.in_team=1 OR (
      imported.id IS NULL AND EXISTS (SELECT 1 FROM imported_sets r WHERE r.training_session_id=s.id)
    )
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
    const bindings = [
      project, teamId, JSON.stringify(athleteId === undefined ? allowed : [athleteId]),
      teamId, project, from, to,
    ] as const;
    res.setHeader('Cache-Control', 'no-store');
    if (athleteId === undefined) {
      const athletes = db.prepare(`${trainingScope}
        SELECT a.id, a.name, COUNT(d.id) AS recordCount, COUNT(DISTINCT d.session_date) AS trainingDays,
          SUM(d.duration_min) AS durationMin, MAX(d.session_date) AS latestDate
        FROM roster a LEFT JOIN daily d ON d.athlete_id=a.id
        GROUP BY a.id, a.name ORDER BY a.id
      `).all(...bindings) as DailyTrainingData['athletes'];
      return res.json({ athletes, rows: [], truncated: false } satisfies DailyTrainingData);
    }
    const rows = db.prepare(`${trainingScope}, recent AS (
      SELECT * FROM daily ORDER BY session_date DESC, session_order DESC, id DESC LIMIT ?
    ), entries AS (
      SELECT s.id, NULL AS setGroupId, s.session_date AS date, s.session_order AS sessionOrder,
        s.content AS projectName, s.duration_min AS durationMin, s.distance_km AS distanceKm, s.rpe,
        MAX(CASE WHEN d.field='强度' THEN d.value_num END) AS intensity,
        MAX(CASE WHEN d.field='强度' AND d.value_num IS NOT NULL THEN d.unit END) AS intensityUnit,
        MAX(CASE WHEN d.field='次数' THEN d.value_num END) AS repetitions,
        MAX(CASE WHEN d.field='组数' THEN d.value_num END) AS sets,
        MAX(CASE WHEN d.field='PRE' THEN d.value_num END) AS pre
      FROM recent s LEFT JOIN training_record_details d ON d.session_id=s.id AND d.team_id=s.team_id
        AND d.template_name=? AND d.detail_order=1
      GROUP BY s.id
      UNION ALL
      SELECT s.id, MIN(r.id), s.session_date, s.session_order, r.exercise_name, NULL, NULL, NULL,
        r.actual_weight_kg, 'kg', r.actual_reps, COUNT(*), NULL
      FROM recent s JOIN imported_sets r ON r.training_session_id=s.id AND r.completed=1
      GROUP BY s.id, r.exercise_name, r.actual_weight_kg, r.actual_reps
    )
    SELECT id, setGroupId, date, projectName, durationMin, distanceKm, rpe, intensity, intensityUnit, repetitions, sets, pre
    FROM entries ORDER BY date DESC, sessionOrder DESC, id DESC, setGroupId LIMIT ?
    `).all(...bindings, recordLimit + 1, DAILY_TRAINING_SHEET, recordLimit + 1) as DailyTrainingData['rows'];
    return res.json({ athletes: [], rows: rows.slice(0, recordLimit), truncated: rows.length > recordLimit } satisfies DailyTrainingData);
  });
}
