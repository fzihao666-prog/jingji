import type { Express } from 'express';
import { z } from 'zod';
import type { CustomTestTrend } from '../../shared/custom-test-trend.ts';
import { isProject } from '../../shared/projects.ts';
import { requireAuth } from '../core/auth.ts';
import { isValidIsoDate } from '../core/date-utils.ts';
import { db } from '../core/db.ts';
import { basicTestInTeam } from '../data-import/basic-test-scope.ts';
import { hasAthleteAccess } from '../core/permissions.ts';

const idSchema = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).refine(Number.isSafeInteger);
const querySchema = z.object({
  project: z.string().refine(isProject),
  teamId: idSchema,
  from: z.string().refine(isValidIsoDate),
  to: z.string().refine(isValidIsoDate),
  metricCode: z.string().regex(/^[a-z][a-z0-9_]{1,95}$/).optional(),
  protocol: z.string().max(1000).optional(),
  version: z.string().regex(/^\d{1,9}$/).transform(Number).optional(),
}).strict().refine(({ from, to }) => from <= to);

// 基础测试使用上传队伍，历史成绩仍使用原模板快照。
const customMeasurements = `
  FROM test_sessions s
  JOIN test_measurements m ON m.test_session_id=s.id
  JOIN metric_definitions definition ON definition.code=m.metric_code
  LEFT JOIN test_template_metric_details detail ON detail.metric_code=m.metric_code
  JOIN data_import_batches b ON b.id=m.data_import_batch_id AND b.status='committed' AND b.project=s.project_code
  LEFT JOIN test_template_downloads template ON template.id=json_extract(
    CASE WHEN json_valid(b.summary_json) THEN b.summary_json ELSE '{}' END, '$.testTemplateId'
  )
  JOIN project_teams team ON team.project=s.project_code
  WHERE s.athlete_id=? AND s.project_code=? AND team.id=?
    AND s.project_status='confirmed'
    AND s.is_demo=0 AND m.is_demo=0 AND m.source='file_import' AND m.value_num IS NOT NULL
    AND s.quality IN ('valid','partial') AND m.quality IN ('valid','partial')
    AND s.context_key='' AND s.attempt_order=1 AND m.side='center' AND m.unit=definition.unit
    AND (${basicTestInTeam} OR (
      template.team_id=team.id AND template.project=s.project_code
      AND s.protocol=detail.protocol AND s.protocol_version=CAST(detail.version AS TEXT)
      AND s.test_type=CASE WHEN detail.protocol='实测1RM' THEN '力量素质测试' ELSE '专项测试' END
    ))
`;

const version = "CAST(COALESCE(NULLIF(s.protocol_version,''),'0') AS INTEGER)";

function athleteInTeam(athleteId: number, project: string, teamId: number) {
  return db.prepare(`
    SELECT 1 FROM athletes a JOIN project_teams t ON t.id=a.team_id
    WHERE a.id=? AND a.project=? AND t.id=? AND t.project=a.project AND a.active=1 AND t.active=1
  `).get(athleteId, project, teamId);
}

export function registerCustomTestTrendRoutes(app: Express) {
  app.get('/api/athletes/:id/custom-training-details', requireAuth, (req, res) => {
    const athlete = idSchema.safeParse(req.params.id);
    const query = querySchema.safeParse(req.query);
    if (!athlete.success || !query.success)
      return res.status(400).json({ message: '请选择有效项目、队伍、运动员和日期范围。' });
    const { project, teamId, from, to } = query.data;
    if (!hasAthleteAccess(req.authUser!, athlete.data) || !athleteInTeam(athlete.data, project, teamId))
      return res.status(403).json({ message: '无权查看所选项目和队伍的训练明细。' });
    const rows = db.prepare(`
      SELECT s.session_date AS date, s.content AS session, s.session_order AS sessionOrder,
        d.template_name AS template, d.detail_order AS detailOrder, d.field, d.unit,
        d.value_num AS value, d.value_text AS text
      FROM training_sessions s JOIN training_record_details d ON d.session_id=s.id
      WHERE s.athlete_id=? AND s.project_code=? AND s.project_status='confirmed' AND s.is_demo=0
        AND d.team_id=? AND s.session_date BETWEEN ? AND ?
      ORDER BY s.session_date DESC, s.session_order DESC, d.detail_order DESC, d.template_name, d.field, d.unit
      LIMIT 1001
    `).all(athlete.data, project, teamId, from, to);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ rows: rows.slice(0, 1000), truncated: rows.length > 1000 });
  });

  app.get('/api/athletes/:id/custom-test-trend', requireAuth, (req, res) => {
    const athlete = idSchema.safeParse(req.params.id);
    const query = querySchema.safeParse(req.query);
    if (!athlete.success || !query.success)
      return res.status(400).json({ message: '请选择有效项目、队伍、运动员和日期范围。' });
    const { project, teamId, from, to, metricCode, protocol, version: requestedVersion } = query.data;
    const athleteId = athlete.data;
    if (!hasAthleteAccess(req.authUser!, athleteId) || !athleteInTeam(athleteId, project, teamId))
      return res.status(403).json({ message: '无权查看所选项目和队伍的该运动员成绩。' });

    const scope = [athleteId, project, teamId] as const;
    const metrics = db.prepare(`
      SELECT definition.code, definition.label, definition.unit, s.protocol, ${version} AS version
      ${customMeasurements}
      GROUP BY definition.code, s.protocol, ${version}
      ORDER BY MAX(s.test_date BETWEEN ? AND ?) DESC, definition.label, version DESC, definition.code, s.protocol
    `).all(...scope, from, to) as CustomTestTrend['metrics'];
    const selected = metricCode ? metrics.find(metric => metric.code === metricCode &&
      (protocol === undefined || metric.protocol === protocol) &&
      (requestedVersion === undefined || metric.version === requestedVersion)) : metrics[0];
    const points = selected ? db.prepare(`
      SELECT s.test_date AS date, m.value_num AS value
      ${customMeasurements} AND m.metric_code=? AND s.protocol=? AND ${version}=? AND s.test_date BETWEEN ? AND ?
      ORDER BY s.test_date
    `).all(...scope, selected.code, selected.protocol, selected.version, from, to) as CustomTestTrend['points'] : [];
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ metrics, metricCode: selected?.code ?? null, points } satisfies CustomTestTrend);
  });
}
