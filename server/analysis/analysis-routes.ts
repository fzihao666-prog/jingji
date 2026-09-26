import { z } from 'zod';
import type { Express } from 'express';
import { db } from '../core/db.ts';
import { accessibleAthleteIds, accountPermissions, hasAthleteAccess } from '../core/permissions.ts';
import {
  cleanString,
  formatServerNumber,
  isValidIsoDate,
  numberOrNull,
  numberOrZero,
  parseDate,
  trainingSessionBreakdown,
} from '../core/utils.ts';
import { consumeRateLimit, requireAuth } from '../core/auth.ts';
import { normalizeOverviewRange } from '../training-plan/training-plan-service.ts';
import {
  buildAerobicEndurance,
  buildProfileComparison,
  buildWellnessTrends,
  resolveProfileScope,
} from './athlete-profile-service.ts';
import { buildOverviewPayload } from './overview-service.ts';
import {
  ROWING_RADAR_DIMENSIONS,
  buildRadarComparison,
  type RadarDimensionDefinition,
} from '../../shared/athlete-radar-model.ts';
import { CANOE_MODEL_STANDARD, analyzeCanoePeriod } from '../../shared/canoe-model.ts';
import {
  ROWING_MODEL_STANDARD,
  analyzeRowingPeriod,
  type RowingAnalysisRecord,
} from '../../shared/rowing-model.ts';
import { SLALOM_MODEL_STANDARD, analyzeSlalomPeriod } from '../../shared/slalom-model.ts';
import {
  PROJECTS,
  hasSpecialAnalysis,
  projectCapability,
  projectLabel,
  type Project,
} from '../../shared/projects.ts';
import type { AuthUser, TrainingBreakdown } from '../core/shared-server.ts';

export function analysisStandardForProject(project: string) {
  return projectCapability(project) === 'slalom'
    ? SLALOM_MODEL_STANDARD
    : projectCapability(project) === 'canoe'
      ? CANOE_MODEL_STANDARD
      : ROWING_MODEL_STANDARD;
}

export function analyzePeriodForProject(project: string, records: RowingAnalysisRecord[]) {
  return projectCapability(project) === 'slalom'
    ? analyzeSlalomPeriod(records)
    : projectCapability(project) === 'canoe'
      ? analyzeCanoePeriod(records)
      : analyzeRowingPeriod(records);
}

export function athleteProfileScope(
  user: AuthUser,
  athleteId: number,
  from: string,
  to: string,
  project: string
) {
  if (!athleteId || !hasAthleteAccess(user, athleteId)) return null;
  return resolveProfileScope({
    athleteId,
    accessibleAthleteIds: accessibleAthleteIds(user),
    from,
    to,
    project,
  });
}

export const radarMeasurementCodes = [
  'rowing_on_water_time_sec',
  'erg_2k_sec',
  'erg_5000_sec',
  'erg_5k_sec',
  'erg_30min_20spm_split_sec',
  'erg_peak_power_w',
  'seven_stroke_power_w',

  'squat_kg',
  'squatKg',

  'bench_pull_kg',
  'benchPullKg',

  'clean_kg',

  'high_pull_kg',
  'highPullKg',

  'vertical_jump_cm',
  'verticalJumpCm',

  'bench_pull_2min_reps',
  'bench_pull2_min_reps',

  'front_plank_sec',
  'frontPlankSec',
] as const;

export const radarMetricAliases: Partial<
  Record<RadarDimensionDefinition['key'], readonly (typeof radarMeasurementCodes)[number][]>
> = {
  rowing_on_water_time: ['rowing_on_water_time_sec'],
  rowing_erg_2000_time: ['erg_2k_sec'],

  rowing_erg_5000_time: ['erg_5000_sec', 'erg_5k_sec'],

  rowing_erg_30min_20spm_split: ['erg_30min_20spm_split_sec'],

  rowing_erg_peak_power: ['erg_peak_power_w', 'seven_stroke_power_w'],

  relative_squat: ['squat_kg', 'squatKg'],

  relative_bench_pull: ['bench_pull_kg', 'benchPullKg'],

  relative_high_pull: ['clean_kg', 'high_pull_kg', 'highPullKg'],

  vertical_jump: ['vertical_jump_cm', 'verticalJumpCm'],

  bench_pull_2min: ['bench_pull_2min_reps', 'bench_pull2_min_reps'],

  front_plank: ['front_plank_sec', 'frontPlankSec'],
};

export type RadarMeasurementRow = {
  code: (typeof radarMeasurementCodes)[number];
  value: number;
  testDate: string;
};

export type RadarReferenceRow = {
  value: number;
};

export const radarModelDateSchema = z.string().trim().pipe(z.iso.date());
export const radarModelQuerySchema = z.strictObject({
  from: radarModelDateSchema,
  to: radarModelDateSchema,
});
export const radarModelRequestSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number)
      .refine((value) => Number.isSafeInteger(value) && value > 0),
    from: radarModelDateSchema,
    to: radarModelDateSchema,
  })
  .refine(({ from, to }) => from <= to, { path: ['to'] });

export function firstRadarMeasurement(
  rows: Map<string, RadarMeasurementRow>,
  key: RadarDimensionDefinition['key']
) {
  const aliases = radarMetricAliases[key] || [];
  for (const code of aliases) {
    const row = rows.get(code);
    if (row) return row;
  }
  return null;
}

export function registerAnalysisRoutes(app: Express) {
  app.get('/api/overview/teams', requireAuth, (req, res) => {
    const user = req.authUser!;
    const project = cleanString(req.query.project);
    if (!PROJECTS.includes(project)) return res.status(400).json({ message: '请选择有效项目。' });
    const ids = accessibleAthleteIds(user);
    if (!ids.length) return res.json({ teams: [] });
    const placeholders = ids.map(() => '?').join(',');
    const teams = db
      .prepare(
        `
      SELECT pt.id, pt.project, pt.name, COUNT(a.id) AS athleteCount
      FROM project_teams pt
      JOIN athletes a ON a.team_id = pt.id AND a.active = 1
      WHERE pt.active = 1 AND pt.project = ? AND a.id IN (${placeholders})
      GROUP BY pt.id, pt.project, pt.name
      ORDER BY pt.name
    `
      )
      .all(project, ...ids);
    res.json({ teams });
  });

  app.get('/api/overview', requireAuth, (req, res) => {
    const user = req.authUser!;
    const range = normalizeOverviewRange({
      from: cleanString(req.query.from),
      to: cleanString(req.query.to),
    });
    const { from, to } = range;
    const requestedId = Number(req.query.athleteId || 0);
    const requestedTeamId = Number(req.query.teamId || 0);
    const project = cleanString(req.query.project);
    if (!PROJECTS.includes(project))
      return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ message: '请选择有效的分析日期范围。' });
    }
    if (user.role !== 'ATL' && requestedId) {
      return res.status(400).json({
        message: '管理账号的训练总览按权限范围进行团队聚合，请前往个人档案查看单人数据。',
      });
    }
    if (user.role === 'ATL' && requestedId && requestedId !== user.athleteId) {
      return res.status(403).json({ message: '运动员账号只能查看本人的训练总览。' });
    }
    if (!Number.isInteger(requestedTeamId) || requestedTeamId < 0) {
      return res.status(400).json({ message: '队伍筛选参数无效。' });
    }
    if (user.role === 'ATL' && requestedTeamId) {
      return res.status(400).json({ message: '个人训练总览不支持队伍筛选。' });
    }
    let ids = accessibleAthleteIds(user);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      ids = (
        db
          .prepare(
            `SELECT id FROM athletes WHERE id IN (${placeholders}) AND project = ? AND active = 1`
          )
          .all(...ids, project) as Array<{ id: number }>
      ).map((row) => row.id);
    }
    if (requestedTeamId) {
      if (!ids.length)
        return res.status(403).json({ message: '无权查看该队伍或该队伍当前没有可访问运动员。' });
      const selectedTeam = db
        .prepare(
          `
        SELECT pt.id FROM project_teams pt
        JOIN athletes a ON a.team_id = pt.id AND a.active = 1
        WHERE pt.id = ? AND pt.project = ? AND pt.active = 1 AND a.id IN (${ids.map(() => '?').join(',')})
        LIMIT 1
      `
        )
        .get(requestedTeamId, project, ...ids) as { id: number } | undefined;
      if (!selectedTeam)
        return res.status(403).json({ message: '无权查看该队伍或该队伍当前没有可访问运动员。' });
      ids = (
        db
          .prepare(
            `SELECT id FROM athletes WHERE id IN (${ids.map(() => '?').join(',')}) AND team_id = ?`
          )
          .all(...ids, requestedTeamId) as Array<{ id: number }>
      ).map((row) => row.id);
    }
    if (user.role === 'ATL') {
      if (!user.athleteId)
        return res.status(403).json({ message: '当前运动员账号未绑定人员档案。' });
      const selected = db
        .prepare('SELECT project FROM athletes WHERE id = ?')
        .get(user.athleteId) as { project: string } | undefined;
      if (!selected || selected.project !== project)
        return res.status(400).json({ message: '本人档案不属于当前项目。' });
      ids = [user.athleteId];
    }
    res.json({
      overview: buildOverviewPayload({
        athleteIds: ids,
        from,
        to,
        project,
        individual: user.role === 'ATL',
        period: range.period,
      }),
    });
  });

  app.get('/api/records', requireAuth, (req, res) => {
    const user = req.authUser!;
    const from = cleanString(req.query.from) || '2026-06-01';
    const to = cleanString(req.query.to) || '2026-12-31';
    const requestedId = Number(req.query.athleteId || 0);
    const project = cleanString(req.query.project);
    if (!PROJECTS.includes(project))
      return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
    let ids = accessibleAthleteIds(user);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      ids = (
        db
          .prepare(`SELECT id FROM athletes WHERE id IN (${placeholders}) AND project = ?`)
          .all(...ids, project) as Array<{ id: number }>
      ).map((row) => row.id);
    }
    if (requestedId) {
      if (!hasAthleteAccess(user, requestedId))
        return res.status(403).json({ message: '无权查看该运动员。' });
      const selected = db.prepare('SELECT project FROM athletes WHERE id = ?').get(requestedId) as
        { project: string } | undefined;
      if (!selected || selected.project !== project)
        return res.status(400).json({ message: '所选运动员不属于当前项目。' });
      ids = [requestedId];
    }
    if (!ids.length) return res.json({ records: [] });
    const placeholders = ids.map(() => '?').join(',');
    const records = db
      .prepare(
        `
      SELECT ts.id, ts.athlete_id AS athleteId, a.name AS athleteName,
        a.project, COALESCE(pt.name, '') AS team, COALESCE(ao.province, '未设置') AS region, COALESCE(ao.province, '未设置') AS province, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county,
        ts.session_date AS date, ts.training_type AS trainingType, ts.structure_type AS structureType,
        ts.intensity_zone AS intensityZone, ts.content, ts.duration_min AS durationMin,
        ts.distance_km AS distanceKm, ts.duration_reported AS durationReported,
        ts.distance_reported AS distanceReported, ts.rpe, ts.srpe, ts.smvl,
        dw.morning_pulse AS morningPulse, dw.weight_kg AS weightKg,
        dw.sleep_hours AS sleepHours, dw.fatigue_index AS fatigueIndex,
        COALESCE(dw.status, 'normal') AS status, '' AS coachNote,
        ts.average_heart_rate AS averageHeartRate, ts.max_heart_rate AS maxHeartRate,
        ts.average_power_w AS averagePowerW, ts.stroke_rate_spm AS strokeRateSpm,
        ts.updated_at AS updatedAt, COALESCE(u.display_name, '系统') AS updatedBy
      FROM training_sessions ts
      JOIN athletes a ON a.id = ts.athlete_id
      LEFT JOIN project_teams pt ON pt.id = a.team_id
      LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
      LEFT JOIN daily_wellness dw ON dw.athlete_id = ts.athlete_id AND dw.wellness_date = ts.session_date
      LEFT JOIN users u ON u.id = ts.created_by
      WHERE ts.athlete_id IN (${placeholders}) AND ts.session_date BETWEEN ? AND ?
      ORDER BY ts.session_date, ts.session_order, a.name
    `
      )
      .all(...ids, from, to) as Array<
      Record<string, unknown> & {
        trainingType: string;
        structureType: string;
        intensityZone: string;
        durationMin: number;
        distanceKm: number;
      }
    >;
    res.json({
      records: records.map((record) => ({
        ...record,
        durationReported: Boolean(record.durationReported),
        distanceReported: Boolean(record.distanceReported),
        trainingBreakdown: trainingSessionBreakdown(record),
      })),
    });
  });

  app.get('/api/analysis/model', requireAuth, (req, res) => {
    const project = cleanString(req.query.project);
    if (!PROJECTS.includes(project))
      return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
    if (!hasSpecialAnalysis(project))
      return res.status(409).json({ message: '该项目专项分析功能暂未配置。' });
    res.json({ standard: analysisStandardForProject(project) });
  });

  app.get('/api/special-champion-models', requireAuth, (req, res) => {
    const user = req.authUser!;
    const project = cleanString(req.query.project);
    if (!PROJECTS.includes(project))
      return res.status(400).json({ message: '请选择有效的运动项目。' });

    const projectAllowed =
      user.role === 'ATL'
        ? db
            .prepare('SELECT 1 FROM athletes WHERE id = ? AND project = ? AND active = 1')
            .get(user.athleteId, project) !== undefined
        : (() => {
            const permissions = accountPermissions(user.id);
            return permissions.projects.includes('*') || permissions.projects.includes(project);
          })();
    if (!projectAllowed) return res.status(403).json({ message: '无权查看当前项目的冠军模型。' });

    const events = db
      .prepare(
        `
      SELECT 
        event_code AS eventCode, 
        event_name AS eventName,
        country, 
        best_performance AS bestPerformance,
        pace,
        competition, 
        location
      FROM special_champion_models
      WHERE project = ? AND active = 1
      ORDER BY sort_order, event_code
    `
      )
      .all(project);
    res.json({ project, events });
  });

  app.get('/api/special-champion-models/ergometer', (req, res) => {
    const project = String(req.query.project || 'ROWING');
    const gender = String(req.query.gender || 'MALE');
    const testType = String(req.query.testType || '2000M');

    const rows = db
      .prepare(
        `
      SELECT
        body_weight_kg AS bodyWeightKg,
        level_code AS levelCode,
        standard_value AS standardValue,
        sort_order AS sortOrder
      FROM ergometer_champion_models
      WHERE project = ?
        AND gender = ?
        AND test_type = ?
        AND active = 1
      ORDER BY body_weight_kg, sort_order
    `
      )
      .all(project, gender, testType);

    res.json({
      project,
      gender,
      testType,
      rows,
    });
  });

  app.get('/api/analysis/summary', requireAuth, (req, res) => {
    const user = req.authUser!;
    const from = cleanString(req.query.from);
    const to = cleanString(req.query.to);
    const requestedId = Number(req.query.athleteId || user.athleteId || 0);
    const project = cleanString(req.query.project);
    if (!PROJECTS.includes(project))
      return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
    if (!hasSpecialAnalysis(project))
      return res.status(409).json({ message: '该项目专项分析功能暂未配置。' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ message: '请选择有效的分析日期范围。' });
    }
    if (!requestedId)
      return res.status(400).json({ message: '请选择一名运动员后再进行个人分析。' });
    if (!hasAthleteAccess(user, requestedId))
      return res.status(403).json({ message: '无权分析该运动员。' });
    const athlete = db.prepare('SELECT project FROM athletes WHERE id = ?').get(requestedId) as
      { project: string } | undefined;
    if (!athlete || athlete.project !== project)
      return res.status(400).json({ message: '所选运动员不属于当前项目。' });

    const records = db
      .prepare(
        `
      SELECT ts.session_date AS date, ts.training_type AS trainingType, ts.structure_type AS structureType,
        ts.intensity_zone AS intensityZone, ts.duration_min AS durationMin, ts.distance_km AS distanceKm,
        ts.rpe, ts.srpe, ts.smvl, dw.morning_pulse AS morningPulse, dw.weight_kg AS weightKg,
        dw.sleep_hours AS sleepHours, dw.fatigue_index AS fatigueIndex, COALESCE(dw.status, 'missing') AS status
      FROM training_sessions ts
      LEFT JOIN daily_wellness dw ON dw.athlete_id = ts.athlete_id AND dw.wellness_date = ts.session_date
      WHERE ts.athlete_id = ? AND ts.session_date BETWEEN ? AND ?
      ORDER BY ts.session_date, ts.session_order
    `
      )
      .all(requestedId, from, to) as RowingAnalysisRecord[];

    const standard = analysisStandardForProject(project);
    res.json({
      standard: {
        version: standard.version,
        decision: standard.decision,
        missingDataRule: standard.missingDataRule,
      },
      analysis: analyzePeriodForProject(project, records),
    });
  });

  app.get('/api/athletes/:id/overview', requireAuth, (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.params.id || 0);
    const range = normalizeOverviewRange({
      from: cleanString(req.query.from),
      to: cleanString(req.query.to),
    });
    const project = cleanString(req.query.project);
    if (!athleteId) return res.status(400).json({ message: '请选择一名运动员。' });
    if (!hasAthleteAccess(user, athleteId))
      return res.status(403).json({ message: '无权查看该运动员档案分析。' });
    if (!PROJECTS.includes(project))
      return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
    const athlete = db
      .prepare('SELECT project FROM athletes WHERE id = ? AND active = 1')
      .get(athleteId) as { project: string } | undefined;
    if (!athlete || athlete.project !== project)
      return res.status(400).json({ message: '所选运动员不属于当前项目。' });
    res.json({
      overview: buildOverviewPayload({
        athleteIds: [athleteId],
        from: range.from,
        to: range.to,
        project,
        individual: true,
        period: range.period,
      }),
    });
  });

  app.get('/api/athletes/:id/wellness-trends', requireAuth, (req, res) => {
    const athleteId = Number(req.params.id || 0);
    const project = cleanString(req.query.project);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (
      !PROJECTS.includes(project) ||
      !from ||
      !to ||
      !isValidIsoDate(from) ||
      !isValidIsoDate(to) ||
      from > to
    )
      return res.status(400).json({ message: '请选择有效项目和日期范围。' });
    const scope = athleteProfileScope(req.authUser!, athleteId, from, to, project);
    if (!scope) return res.status(403).json({ message: '无权查看该运动员恢复趋势。' });
    res.json(buildWellnessTrends(scope));
  });

  app.get('/api/athletes/:id/aerobic-endurance', requireAuth, (req, res) => {
    const athleteId = Number(req.params.id || 0);
    const project = cleanString(req.query.project);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (
      !PROJECTS.includes(project) ||
      !from ||
      !to ||
      !isValidIsoDate(from) ||
      !isValidIsoDate(to) ||
      from > to
    )
      return res.status(400).json({ message: '请选择有效项目和日期范围。' });
    const rangeDays =
      Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) +
      1;
    if (rangeDays > 366) return res.status(400).json({ message: '有氧耐力最多支持连续366天。' });
    if (consumeRateLimit(req, 'aerobic-endurance', 12, 60_000))
      return res.status(429).json({ message: '有氧耐力请求过于频繁，请稍后重试。' });
    const scope = athleteProfileScope(req.authUser!, athleteId, from, to, project);
    if (!scope) return res.status(403).json({ message: '无权查看该运动员有氧耐力数据。' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildAerobicEndurance(scope));
  });

  app.get('/api/athletes/:id/profile-comparison', requireAuth, (req, res) => {
    const athleteId = Number(req.params.id || 0);
    const project = cleanString(req.query.project);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (
      !PROJECTS.includes(project) ||
      !from ||
      !to ||
      !isValidIsoDate(from) ||
      !isValidIsoDate(to) ||
      from > to
    )
      return res.status(400).json({ message: '请选择有效项目和日期范围。' });
    const rangeDays =
      Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) +
      1;
    if (rangeDays > 366)
      return res.status(400).json({ message: '个人档案团队比较最多支持连续366天。' });
    if (consumeRateLimit(req, 'profile-comparison', 12, 60_000))
      return res.status(429).json({ message: '团队比较请求过于频繁，请稍后重试。' });
    const scope = athleteProfileScope(req.authUser!, athleteId, from, to, project);
    if (!scope) return res.status(403).json({ message: '无权查看该运动员团队比较。' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildProfileComparison(scope));
  });

  app.get('/api/athletes/:id/radar-models', requireAuth, (req, res) => {
    const user = req.authUser!;
    const parsedQuery = radarModelQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ message: '请选择有效运动员和日期范围。' });
    }
    const parsedRequest = radarModelRequestSchema.safeParse({
      id: req.params.id,
      ...parsedQuery.data,
    });
    if (!parsedRequest.success) {
      return res.status(400).json({ message: '请选择有效运动员和日期范围。' });
    }
    const { id: athleteId, from, to } = parsedRequest.data;
    if (!hasAthleteAccess(user, athleteId)) {
      return res.status(403).json({ message: '无权查看该运动员雷达模型。' });
    }
    const athlete = db
      .prepare(
        `
        SELECT a.project, a.gender, COALESCE(ap.current_event, '') AS currentEvent
        FROM athletes a
        LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
        WHERE a.id = ? AND a.active = 1
      `
      )
      .get(athleteId) as
      { project: string; gender: string | null; currentEvent: string } | undefined;
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
    if (athlete.project !== 'ROWING') {
      return res.status(400).json({ message: '该项目的雷达维度尚未配置。' });
    }

    res.setHeader('Cache-Control', 'no-store');
    const metricPlaceholders = radarMeasurementCodes.map(() => '?').join(',');
    const measurementRows = db
      .prepare(
        `
        SELECT tm.metric_code AS code, tm.value_num AS value, ts.test_date AS testDate
        FROM test_sessions ts
        JOIN test_measurements tm ON tm.test_session_id = ts.id
        WHERE ts.athlete_id = ? AND ts.test_date BETWEEN ? AND ?
          AND tm.metric_code IN (${metricPlaceholders})
          AND ts.quality = 'valid' AND tm.quality = 'valid'
          AND ts.is_demo = 0 AND tm.is_demo = 0
          AND tm.value_num > 0
          AND trim(ts.source) <> '' AND trim(tm.source) <> ''
          AND lower(ts.source) NOT LIKE '%demo%' AND lower(tm.source) NOT LIKE '%demo%'
          AND lower(ts.source) NOT LIKE '%seed%' AND lower(tm.source) NOT LIKE '%seed%'
          AND lower(ts.source) NOT LIKE '%estimated%' AND lower(tm.source) NOT LIKE '%estimated%'
        ORDER BY ts.test_date DESC, ts.id DESC, tm.id DESC
      `
      )
      .all(athleteId, from, to, ...radarMeasurementCodes) as RadarMeasurementRow[];
    const latestMeasurements = new Map<string, RadarMeasurementRow>();
    for (const row of measurementRows) {
      if (!latestMeasurements.has(row.code)) latestMeasurements.set(row.code, row);
    }

    const weightStatement = db.prepare(`
      SELECT weight_kg AS weight
      FROM athlete_body_measurements
      WHERE athlete_id = ? AND measurement_date <= ?
        AND weight_kg > 0 AND quality = 'valid' AND is_demo = 0
        AND trim(source) <> ''
        AND lower(source) NOT LIKE '%demo%'
        AND lower(source) NOT LIKE '%seed%'
        AND lower(source) NOT LIKE '%estimated%'
      ORDER BY measurement_date DESC, id DESC
      LIMIT 1
    `);
    const referenceStatement = db.prepare(`
    SELECT
      rv.value_num AS value
    FROM radar_reference_values rv
    WHERE rv.project = 'ROWING'
      AND rv.radar_kind = ?
      AND rv.metric_key = ?
      AND rv.gender = ?
      AND rv.unit = ?
      AND rv.active = 1

      AND (
        rv.metric_key <> 'rowing_on_water_time'
        OR (
          ? <> ''
          AND (
            rv.boat_class = ?
            OR rv.applicability = ?
          )
        )
      )

    ORDER BY rv.updated_at DESC, rv.id DESC
    LIMIT 1
  `);
    const gender = athlete.gender?.includes('女')
      ? '女'
      : athlete.gender?.includes('男')
        ? '男'
        : null;

    const buildModel = (kind: 'special' | 'physical') => ({
      kind,
      dimensions: ROWING_RADAR_DIMENSIONS[kind].map((definition) => {
        const measurement = firstRadarMeasurement(latestMeasurements, definition.key);
        let currentValue: number | null = measurement?.value ?? null;
        if (
          measurement &&
          (definition.key === 'relative_squat' ||
            definition.key === 'relative_bench_pull' ||
            definition.key === 'relative_high_pull')
        ) {
          const body = weightStatement.get(athleteId, measurement.testDate) as
            { weight: number } | undefined;
          currentValue = body?.weight
            ? Math.round((measurement.value / body.weight) * 100) / 100
            : null;
        }

        const reference = gender
          ? (referenceStatement.get(
              kind,
              definition.key,
              gender,
              definition.unit,
              athlete.currentEvent,
              athlete.currentEvent,
              athlete.currentEvent
            ) as RadarReferenceRow | undefined)
          : undefined;

        const referenceValue =
          reference && Number.isFinite(reference.value) ? reference.value : null;
        const comparison = buildRadarComparison(definition.direction, currentValue, referenceValue);
        return {
          ...definition,
          currentValue,
          referenceValue,
          achievedPercent: comparison.achievedPercent,
          signedDifference: comparison.signedDifference,
          status:
            currentValue === null
              ? ('measurement_pending' as const)
              : comparison.comparable
                ? ('ready' as const)
                : ('reference_pending' as const),
        };
      }),
    });

    return res.json({ special: buildModel('special'), physical: buildModel('physical') });
  });

  app.get('/api/athletes/:id/champion-model', requireAuth, (req, res) => {
    const user = req.authUser!;
    const athleteId = Number(req.params.id || 0);
    if (!athleteId) return res.status(400).json({ message: '请选择一名运动员。' });
    if (!hasAthleteAccess(user, athleteId))
      return res.status(403).json({ message: '无权查看该运动员冠军模型对标。' });
    const athlete = db
      .prepare(
        `
      SELECT id, name, project, gender
      FROM athletes
      WHERE id = ? AND active = 1
    `
      )
      .get(athleteId) as { id: number; name: string; project: Project; gender: string } | undefined;
    if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
    const gender = athlete.gender?.includes('女') ? '女' : '男';
    // 冠军模型尚未完成真实数据配置，任何历史初始化基线均不得用于正式对标或评分。
    const hasConfiguredChampionModel = false;
    if (!hasConfiguredChampionModel)
      return res.json({
        benchmark: {
          athleteId: athlete.id,
          athleteName: athlete.name,
          project: athlete.project,
          gender,
          modelVersion: 'UNCONFIGURED',
          rows: [],
          dimensions: [],
          summary: {
            score: null,
            averageStandardDistance: null,
            topPriorityIndex: null,
            achieved: 0,
            comparable: 0,
            primaryGap: '模型数据待配置。',
            source: '暂无正式冠军模型数据',
          },
        },
      });
    const standards = db
      .prepare(
        `
      SELECT cms.metric_code AS code, cms.model_version AS modelVersion,
        cms.target_min AS targetMin, cms.target_max AS targetMax, cms.elite_mean AS eliteMean,
        cms.weight, cms.rationale, cms.source_note AS sourceNote,
        md.label, md.domain, md.unit, md.direction
      FROM champion_model_standards cms
      JOIN metric_definitions md ON md.code = cms.metric_code
      WHERE cms.project = ? AND cms.gender = ? AND cms.active = 1
      ORDER BY cms.weight DESC, cms.metric_code
    `
      )
      .all(athlete.project, gender) as Array<{
      code: string;
      modelVersion: string;
      targetMin: number | null;
      targetMax: number | null;
      eliteMean: number | null;
      weight: number;
      rationale: string;
      sourceNote: string;
      label: string;
      domain: string;
      unit: string;
      direction: 'higher_better' | 'lower_better' | 'neutral';
    }>;
    if (!standards.length) {
      return res.json({
        benchmark: {
          athleteId: athlete.id,
          athleteName: athlete.name,
          project: athlete.project,
          gender,
          modelVersion: 'CHAMPION-2026-R1',
          rows: [],
          dimensions: [],
          summary: {
            score: null,
            averageStandardDistance: null,
            topPriorityIndex: null,
            achieved: 0,
            comparable: 0,
            primaryGap: '暂无该项目冠军模型标准。',
            source: '暂无标准',
          },
        },
      });
    }
    const codes = standards.map((row) => row.code);
    const placeholders = codes.map(() => '?').join(',');
    const rawMeasurements = db
      .prepare(
        `
      SELECT tm.metric_code AS code, tm.value_num AS value, tm.target_value AS target, tm.side,
        ts.test_date AS testDate, ts.id AS sessionId
      FROM test_sessions ts
      JOIN test_measurements tm ON tm.test_session_id = ts.id
      WHERE ts.athlete_id = ?
      ORDER BY ts.test_date DESC, ts.id DESC
    `
      )
      .all(athlete.id) as Array<{
      code: string;
      value: number;
      target: number | null;
      side: string;
      testDate: string;
      sessionId: number;
    }>;
    const canonicalCode = (code: string, side = 'center') => {
      const aliases: Record<string, string> = {
        height_cm: 'heightCm',
        arm_span_cm: 'armSpanCm',
        bench_press_kg: 'benchPressKg',
        bench_pull_kg: 'benchPullKg',
        squat_kg: 'squatKg',
        deadlift_kg: 'deadliftKg',
        front_plank_sec: 'frontPlankSec',
      };
      if (code === 'side_plank_sec')
        return side === 'left' ? 'leftPlankSec' : side === 'right' ? 'rightPlankSec' : code;
      return aliases[code] || code;
    };
    const bodyMeasurements = db
      .prepare(
        `
      SELECT measurement_date AS testDate, height_cm AS heightCm, body_fat_pct AS bodyFatPct,
        skeletal_muscle_kg AS skeletalMuscleKg
      FROM athlete_body_measurements
      WHERE athlete_id = ?
      ORDER BY measurement_date DESC, id DESC
    `
      )
      .all(athlete.id) as Array<{
      testDate: string;
      heightCm: number | null;
      bodyFatPct: number | null;
      skeletalMuscleKg: number | null;
    }>;
    type ChampionMeasurement = {
      code: string;
      value: number;
      target: number | null;
      testDate: string;
      sessionId: number;
    };
    const bodyChampionMeasurements: ChampionMeasurement[] = bodyMeasurements.flatMap((item) => {
      const values: Array<[string, number | null]> = [
        ['heightCm', item.heightCm],
        ['body_fat_pct', item.bodyFatPct],
        ['skeletal_muscle_kg', item.skeletalMuscleKg],
      ];
      return values.flatMap(([code, value]) =>
        typeof value === 'number'
          ? [{ code, value, target: null, testDate: item.testDate, sessionId: 0 }]
          : []
      );
    });
    const measurements: ChampionMeasurement[] = [
      ...rawMeasurements.map((item) => ({ ...item, code: canonicalCode(item.code, item.side) })),
      ...bodyChampionMeasurements,
    ].filter((item) => codes.includes(item.code));
    measurements.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        right.testDate.localeCompare(left.testDate) ||
        right.sessionId - left.sessionId
    );
    const byCode = new Map<
      string,
      Array<{ value: number; target: number | null; testDate: string; sessionId: number }>
    >();
    for (const measurement of measurements) {
      byCode.set(measurement.code, [...(byCode.get(measurement.code) || []), measurement]);
    }
    const lowerScore = (value: number, targetMax: number | null) =>
      targetMax && value > 0 ? (targetMax / value) * 100 : null;
    const higherScore = (value: number, targetMin: number | null) =>
      targetMin && targetMin > 0 ? (value / targetMin) * 100 : null;
    const standardDistanceFor = (
      value: number,
      standard: {
        targetMin: number | null;
        targetMax: number | null;
        eliteMean: number | null;
        direction: 'higher_better' | 'lower_better' | 'neutral';
      }
    ) => {
      if (
        standard.targetMin === null ||
        standard.targetMax === null ||
        standard.targetMin === standard.targetMax
      )
        return null;
      const width = Math.abs(standard.targetMax - standard.targetMin);
      if (standard.direction === 'higher_better') {
        if (value >= standard.targetMin && value <= standard.targetMax) return 0;
        if (value > standard.targetMax)
          return Math.round(((standard.targetMax - value) / width) * 100) / 100;
        return Math.round(((standard.targetMin - value) / width) * 100) / 100;
      }
      if (standard.direction === 'lower_better') {
        if (value >= standard.targetMin && value <= standard.targetMax) return 0;
        if (value < standard.targetMin)
          return Math.round(((value - standard.targetMin) / width) * 100) / 100;
        return Math.round(((value - standard.targetMax) / width) * 100) / 100;
      }
      if (!standard.eliteMean) return null;
      return Math.round((Math.abs(value - standard.eliteMean) / width) * 100) / 100;
    };
    const rows = standards.map((standard) => {
      const history = byCode.get(standard.code) || [];
      const current = history[0];
      const previous = history.find((item) => item.testDate !== current?.testDate);
      const value = current?.value ?? null;
      const rawPercent =
        value === null
          ? null
          : standard.direction === 'lower_better'
            ? lowerScore(value, standard.targetMax)
            : standard.direction === 'higher_better'
              ? higherScore(value, standard.targetMin)
              : standard.eliteMean
                ? 100 - (Math.abs(value - standard.eliteMean) / standard.eliteMean) * 100
                : null;
      const percent = rawPercent === null ? null : Math.round(rawPercent * 10) / 10;
      const score = percent === null ? null : Math.min(120, Math.max(0, percent));
      const status =
        score === null ? 'missing' : score >= 100 ? 'elite' : score >= 90 ? 'near' : 'develop';
      const standardDistance = value === null ? null : standardDistanceFor(value, standard);
      const eliteGapPct =
        value === null || !standard.eliteMean
          ? null
          : Math.round((Math.abs(value - standard.eliteMean) / standard.eliteMean) * 1000) / 10;
      const priorityIndex =
        standardDistance === null
          ? null
          : Math.max(0, Math.round(standardDistance * standard.weight * 1000) / 10);
      const gap =
        value === null
          ? null
          : standard.direction === 'lower_better'
            ? standard.targetMax === null
              ? null
              : Math.round((value - standard.targetMax) * 100) / 100
            : standard.targetMin === null
              ? null
              : Math.round((standard.targetMin - value) * 100) / 100;
      return {
        code: standard.code,
        label: standard.label,
        domain: standard.domain,
        unit: standard.unit,
        direction: standard.direction,
        value,
        previous: previous?.value ?? null,
        targetMin: standard.targetMin,
        targetMax: standard.targetMax,
        eliteMean: standard.eliteMean,
        percent,
        score,
        gap,
        standardDistance,
        eliteGapPct,
        priorityIndex,
        status,
        weight: standard.weight,
        rationale: standard.rationale,
        sourceNote: standard.sourceNote,
        testDate: current?.testDate ?? null,
      };
    });
    const dimensionDefinitions = [
      {
        key: 'body_shape',
        label: '身体形态Body Shape',
        codes: ['heightCm', 'armSpanCm', 'body_fat_pct', 'skeletal_muscle_kg'],
      },
      {
        key: 'endurance',
        label: '一般耐力Endurance',
        codes: ['general_endurance_score', 'erg_6k_sec'],
      },
      { key: 'vo2max', label: 'VO2Max', codes: ['vo2max_ml_kg_min'] },
      {
        key: 'asymmetry',
        label: '不对称性asymmetry',
        codes: ['asymmetry_index_pct', 'dsd_ratio', 'left_paddle_power_w', 'right_paddle_power_w'],
      },
      {
        key: 'power',
        label: '爆发力Power',
        codes: [
          'cmj_peak_power_w',
          'seven_stroke_power_w',
          'benchPressPeakPowerW',
          'benchPullPeakPowerW',
        ],
      },
      {
        key: 'anaerobic_power',
        label: '无氧功Anaerobic Power',
        codes: [
          'anaerobic_power_wkg',
          'wingatePeakPowerWkg',
          'wingateWorkJkg',
          'sprint_200_sec',
          'sprint_500_sec',
          'sprint300Sec',
        ],
      },
      {
        key: 'fmax',
        label: '最大力量Fmax',
        codes: ['imtp_peak_force_n', 'benchPressKg', 'benchPullKg', 'squatKg', 'deadliftKg'],
      },
      {
        key: 'core',
        label: '核心力量Core',
        codes: ['core_strength_score', 'frontPlankSec', 'leftPlankSec', 'rightPlankSec'],
      },
    ];
    const dimensions = dimensionDefinitions.map((definition) => {
      const items = rows.filter((row) => definition.codes.includes(row.code) && row.score !== null);
      const weight = items.reduce((sum, row) => sum + row.weight, 0);
      const current = weight
        ? Math.round(
            (items.reduce((sum, row) => sum + Math.min(120, row.score || 0) * row.weight, 0) /
              weight) *
              10
          ) / 10
        : null;
      const priorityIndex = items.length
        ? Math.round(items.reduce((sum, row) => sum + (row.priorityIndex || 0), 0) * 10) / 10
        : null;
      return {
        key: definition.key,
        label: definition.label,
        current,
        champion: 100,
        gap: current === null ? null : Math.round((100 - current) * 10) / 10,
        priorityIndex,
        comparable: items.length,
        achieved: items.filter((row) => row.status === 'elite').length,
      };
    });
    const comparable = rows.filter((row) => row.score !== null);
    const scoreSum = comparable.reduce((sum, row) => sum + (row.score || 0) * row.weight, 0);
    const weightSum = comparable.reduce((sum, row) => sum + row.weight, 0);
    const score = weightSum ? Math.round((scoreSum / weightSum) * 10) / 10 : null;
    const gapRows = comparable.filter(
      (row) => row.standardDistance !== null && row.standardDistance > 0
    );
    const averageStandardDistance = gapRows.length
      ? Math.round(
          (gapRows.reduce((sum, row) => sum + (row.standardDistance || 0) * row.weight, 0) /
            gapRows.reduce((sum, row) => sum + row.weight, 0)) *
            100
        ) / 100
      : comparable.length
        ? 0
        : null;
    const topPriorityIndex = comparable.length
      ? Math.max(...comparable.map((row) => row.priorityIndex || 0))
      : null;
    const achieved = comparable.filter((row) => row.status === 'elite').length;
    const primary = comparable
      .filter((row) => row.status !== 'elite')
      .sort((left, right) => (right.priorityIndex || 0) - (left.priorityIndex || 0))[0];
    const primaryGap = primary
      ? `${primary.label}标准化差距 ${formatServerNumber(primary.standardDistance, 2)} 个冠军区间宽度，加权补强优先级 ${formatServerNumber(primary.priorityIndex, 1)}，建议优先纳入下一阶段训练目标。`
      : comparable.length
        ? '已测试指标整体达到冠军模型参考区间，下一阶段重点维持专项表现和伤病风险控制。'
        : '暂无可对标实测数据，请先录入专业综合评估。';
    res.json({
      benchmark: {
        athleteId: athlete.id,
        athleteName: athlete.name,
        project: athlete.project,
        gender,
        modelVersion: standards[0]?.modelVersion || 'CHAMPION-2026-R1',
        rows,
        dimensions,
        summary: {
          score,
          averageStandardDistance,
          topPriorityIndex,
          achieved,
          comparable: comparable.length,
          primaryGap,
          source: standards[0]?.sourceNote || '项目冠军模型初始化生成',
        },
      },
    });
  });
}
