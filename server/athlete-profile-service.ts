import { db } from './db.ts';
import { buildOverviewPayload } from './overview-service.ts';

type ProfileScopeInput = {
  athleteId: number;
  accessibleAthleteIds: number[];
  from: string;
  to: string;
  project: string;
};

type ProfileScope = ProfileScopeInput & { teamId: number | null; teamAthleteIds: number[] };

type NumericRow = { athleteId: number; date: string; value: number };

const usableSql = (alias: string) => `
  ${alias}.is_demo = 0
  AND ${alias}.quality NOT IN ('insufficient', 'outlier', 'estimated')
  AND lower(${alias}.source) NOT LIKE '%demo%'
  AND lower(${alias}.source) NOT LIKE '%seed%'
  AND lower(${alias}.source) NOT LIKE '%estimated%'
`;

function mean(values: number[]) {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
}

function difference(personalValue: number | null, teamMean: number | null) {
  return personalValue === null || teamMean === null ? null : Math.round((personalValue - teamMean) * 10) / 10;
}

export function resolveProfileScope(input: ProfileScopeInput): ProfileScope | null {
  const athlete = db.prepare('SELECT team_id AS teamId, project FROM athletes WHERE id = ? AND active = 1').get(input.athleteId) as { teamId: number | null; project: string } | undefined;
  if (!athlete || athlete.project !== input.project) return null;
  const teamAthleteIds = athlete.teamId === null ? [] : db.prepare(`
    SELECT id FROM athletes
    WHERE active = 1 AND project = ? AND team_id = ? AND id IN (${input.accessibleAthleteIds.map(() => '?').join(',') || 'NULL'})
  `).all(input.project, athlete.teamId, ...input.accessibleAthleteIds) as Array<{ id: number }>;
  return { ...input, teamId: athlete.teamId, teamAthleteIds: teamAthleteIds.map((row) => row.id) };
}

function queryWellness(scope: ProfileScope, column: 'sleep_hours' | 'morning_pulse' | 'weight_kg') {
  if (!scope.teamAthleteIds.length) return [] as NumericRow[];
  return db.prepare(`
    SELECT athlete_id AS athleteId, wellness_date AS date, ${column} AS value
    FROM daily_wellness dw
    WHERE dw.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')})
      AND dw.wellness_date BETWEEN ? AND ? AND ${column} IS NOT NULL AND ${usableSql('dw')}
  `).all(...scope.teamAthleteIds, scope.from, scope.to) as NumericRow[];
}

function queryRpe(scope: ProfileScope) {
  if (!scope.teamAthleteIds.length) return [] as NumericRow[];
  return db.prepare(`
    SELECT athlete_id AS athleteId, session_date AS date, AVG(rpe) AS value
    FROM training_sessions ts
    WHERE ts.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')})
      AND ts.session_date BETWEEN ? AND ? AND rpe IS NOT NULL AND ${usableSql('ts')}
    GROUP BY athlete_id, session_date
  `).all(...scope.teamAthleteIds, scope.from, scope.to) as NumericRow[];
}

function trend(key: string, label: string, unit: string, rows: NumericRow[], athleteId: number) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  return {
    key, label, unit,
    points: dates.map((date) => {
      const personal = rows.find((row) => row.athleteId === athleteId && row.date === date)?.value ?? null;
      const group = rows.filter((row) => row.date === date).map((row) => row.value);
      const teamMean = group.length >= 2 ? mean(group) : null;
      return { date, personalValue: personal, teamMean, teamSampleCount: teamMean === null ? null : group.length, hasPersonalValue: personal !== null };
    })
  };
}

export function buildWellnessTrends(scope: ProfileScope) {
  return {
    trends: [
      trend('rpe', 'RPE', '', queryRpe(scope), scope.athleteId),
      trend('sleepHours', '睡眠时长', '小时', queryWellness(scope, 'sleep_hours'), scope.athleteId),
      trend('morningPulse', '晨脉', 'bpm', queryWellness(scope, 'morning_pulse'), scope.athleteId),
      trend('weightKg', '体重', 'kg', queryWellness(scope, 'weight_kg'), scope.athleteId)
    ]
  };
}

function comparisonItem(input: { key: string; label: string; unit: string; personalValue: number | null; teamValues: number[]; dateLabel: string | null }) {
  const teamMean = input.teamValues.length >= 2 ? mean(input.teamValues) : null;
  return {
    key: input.key, label: input.label, unit: input.unit, personalValue: input.personalValue,
    teamMean, difference: difference(input.personalValue, teamMean), teamSampleCount: teamMean === null ? null : input.teamValues.length,
    dateLabel: input.dateLabel, unavailableReason: teamMean === null ? '暂无可比团队数据' : null
  };
}

function latestBodyWeight(scope: ProfileScope) {
  if (!scope.teamAthleteIds.length) return [] as NumericRow[];
  return db.prepare(`
    SELECT bm.athlete_id AS athleteId, bm.measurement_date AS date, bm.weight_kg AS value
    FROM athlete_body_measurements bm
    WHERE bm.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')}) AND bm.measurement_date <= ?
      AND bm.weight_kg IS NOT NULL AND ${usableSql('bm')}
      AND bm.measurement_date = (SELECT MAX(current_bm.measurement_date) FROM athlete_body_measurements current_bm
        WHERE current_bm.athlete_id = bm.athlete_id AND current_bm.measurement_date <= ? AND ${usableSql('current_bm')})
  `).all(...scope.teamAthleteIds, scope.to, scope.to) as NumericRow[];
}

function latestMeasurements(scope: ProfileScope) {
  if (!scope.teamAthleteIds.length) return [] as Array<NumericRow & { code: string; label: string; unit: string; domain: string }>;
  return db.prepare(`
    SELECT ts.athlete_id AS athleteId, ts.test_date AS date, tm.value_num AS value, tm.metric_code AS code,
      COALESCE(md.label, tm.metric_code) AS label, tm.unit, COALESCE(md.domain, '') AS domain
    FROM test_measurements tm
    JOIN test_sessions ts ON ts.id = tm.test_session_id
    LEFT JOIN metric_definitions md ON md.code = tm.metric_code
    WHERE ts.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')}) AND ts.test_date <= ?
      AND ${usableSql('ts')} AND ${usableSql('tm')}
      AND ts.test_date = (SELECT MAX(current_ts.test_date) FROM test_sessions current_ts
        JOIN test_measurements current_tm ON current_tm.test_session_id = current_ts.id
        WHERE current_ts.athlete_id = ts.athlete_id AND current_ts.test_date <= ?
          AND current_tm.metric_code = tm.metric_code AND ${usableSql('current_ts')} AND ${usableSql('current_tm')})
  `).all(...scope.teamAthleteIds, scope.to, scope.to) as Array<NumericRow & { code: string; label: string; unit: string; domain: string }>;
}

export function buildProfileComparison(scope: ProfileScope) {
  const personalOverview = buildOverviewPayload({ athleteIds: [scope.athleteId], from: scope.from, to: scope.to, project: scope.project, individual: true });
  const teamOverview = buildOverviewPayload({ athleteIds: scope.teamAthleteIds, from: scope.from, to: scope.to, project: scope.project, individual: false });
  const weightRows = latestBodyWeight(scope);
  const measurementRows = latestMeasurements(scope);
  const athleteValues = (select: (overview: ReturnType<typeof buildOverviewPayload>) => number | null) => scope.teamAthleteIds
    .map((athleteId) => select(buildOverviewPayload({ athleteIds: [athleteId], from: scope.from, to: scope.to, project: scope.project, individual: true })))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const items = [
    comparisonItem({ key: 'trainingDuration', label: '训练时长', unit: '分钟', personalValue: personalOverview.trainingVolume.totalDurationMin, teamValues: athleteValues((overview) => overview.trainingVolume.totalDurationMin), dateLabel: `${scope.from} 至 ${scope.to}` }),
    comparisonItem({ key: 'trainingLoad', label: '训练负荷', unit: 'AU', personalValue: personalOverview.trainingLoadRatio.totalLoad, teamValues: athleteValues((overview) => overview.trainingLoadRatio.totalLoad), dateLabel: `${scope.from} 至 ${scope.to}` }),
    comparisonItem({ key: 'specialDistance', label: '专项距离', unit: 'km', personalValue: personalOverview.trainingAnalytics.summary.specialDistanceKm, teamValues: athleteValues((overview) => overview.trainingAnalytics.summary.specialDistanceKm), dateLabel: `${scope.from} 至 ${scope.to}` }),
    comparisonItem({ key: 'weightKg', label: '体重', unit: 'kg', personalValue: weightRows.find((row) => row.athleteId === scope.athleteId)?.value ?? null, teamValues: weightRows.map((row) => row.value), dateLabel: weightRows.find((row) => row.athleteId === scope.athleteId)?.date ?? null })
  ];
  for (const code of [...new Set(measurementRows.map((row) => row.code))]) {
    const rows = measurementRows.filter((row) => row.code === code);
    const personal = rows.find((row) => row.athleteId === scope.athleteId);
    if (!personal) continue;
    const comparable = rows.filter((row) => row.date === personal.date && row.unit === personal.unit);
    items.push(comparisonItem({ key: `measurement:${code}`, label: personal.label, unit: personal.unit, personalValue: personal.value, teamValues: comparable.map((row) => row.value), dateLabel: personal.date }));
  }
  return { comparison: { scope: { athleteId: scope.athleteId, teamId: scope.teamId, project: scope.project, from: scope.from, to: scope.to, athleteCount: scope.teamAthleteIds.length }, items, teamSessionCount: teamOverview.meta.sessionCount } };
}
