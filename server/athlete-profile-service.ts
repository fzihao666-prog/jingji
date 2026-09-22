import { db } from './db.ts';
import { buildOverviewPayload } from './overview-service.ts';
import { trainingStatusMetric } from '../shared/training-status-metrics.js';

type ProfileScopeInput = {
  athleteId: number;
  accessibleAthleteIds: number[];
  from: string;
  to: string;
  project: string;
};

type ProfileScope = ProfileScopeInput & { teamId: number | null; teamAthleteIds: number[] };

type NumericRow = { athleteId: number; date: string; value: number };

type AerobicMeasurementRow = NumericRow & {
  sessionId: number;
  testType: string;
  code: string;
  label: string;
  unit: string;
};

const usableSql = (alias: string) => `
  ${alias}.is_demo = 0
  AND ${alias}.quality NOT IN ('insufficient', 'outlier', 'estimated')
  AND lower(${alias}.source) NOT LIKE '%demo%'
  AND lower(${alias}.source) NOT LIKE '%seed%'
  AND lower(${alias}.source) NOT LIKE '%estimated%'
`;

function mean(values: number[]) {
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    : null;
}

function difference(personalValue: number | null, teamMean: number | null) {
  return personalValue === null || teamMean === null
    ? null
    : Math.round((personalValue - teamMean) * 10) / 10;
}

export function resolveProfileScope(input: ProfileScopeInput): ProfileScope | null {
  const athlete = db
    .prepare('SELECT team_id AS teamId, project FROM athletes WHERE id = ? AND active = 1')
    .get(input.athleteId) as { teamId: number | null; project: string } | undefined;
  if (!athlete || athlete.project !== input.project) return null;
  const teamAthleteIds =
    athlete.teamId === null
      ? []
      : (db
          .prepare(
            `
    SELECT id FROM athletes
    WHERE active = 1 AND project = ? AND team_id = ? AND id IN (${input.accessibleAthleteIds.map(() => '?').join(',') || 'NULL'})
  `
          )
          .all(input.project, athlete.teamId, ...input.accessibleAthleteIds) as Array<{
          id: number;
        }>);
  return { ...input, teamId: athlete.teamId, teamAthleteIds: teamAthleteIds.map((row) => row.id) };
}

function queryWellness(scope: ProfileScope, column: 'sleep_hours' | 'morning_pulse' | 'weight_kg') {
  if (!scope.teamAthleteIds.length) return [] as NumericRow[];
  return db
    .prepare(
      `
    SELECT athlete_id AS athleteId, wellness_date AS date, ${column} AS value
    FROM daily_wellness dw
    WHERE dw.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')})
      AND dw.wellness_date BETWEEN ? AND ? AND ${column} IS NOT NULL AND ${usableSql('dw')}
  `
    )
    .all(...scope.teamAthleteIds, scope.from, scope.to) as NumericRow[];
}

function queryRpe(scope: ProfileScope) {
  if (!scope.teamAthleteIds.length) return [] as NumericRow[];
  return db
    .prepare(
      `
    SELECT athlete_id AS athleteId, session_date AS date, AVG(rpe) AS value
    FROM training_sessions ts
    WHERE ts.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')})
      AND ts.session_date BETWEEN ? AND ? AND rpe IS NOT NULL AND ${usableSql('ts')}
    GROUP BY athlete_id, session_date
  `
    )
    .all(...scope.teamAthleteIds, scope.from, scope.to) as NumericRow[];
}

function trend(key: string, label: string, unit: string, rows: NumericRow[], athleteId: number) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  return {
    key,
    label,
    unit,
    points: dates.map((date) => {
      const personal =
        rows.find((row) => row.athleteId === athleteId && row.date === date)?.value ?? null;
      const group = rows.filter((row) => row.date === date).map((row) => row.value);
      const teamMean = group.length >= 2 ? mean(group) : null;
      return {
        date,
        personalValue: personal,
        teamMean,
        teamSampleCount: teamMean === null ? null : group.length,
        hasPersonalValue: personal !== null,
      };
    }),
  };
}

export function buildWellnessTrends(scope: ProfileScope) {
  return {
    trends: [
      trend('rpe', 'RPE', '', queryRpe(scope), scope.athleteId),
      trend('sleepHours', '睡眠时长', '小时', queryWellness(scope, 'sleep_hours'), scope.athleteId),
      trend('morningPulse', '晨脉', 'bpm', queryWellness(scope, 'morning_pulse'), scope.athleteId),
      trend('weightKg', '体重', 'kg', queryWellness(scope, 'weight_kg'), scope.athleteId),
    ],
  };
}

function comparisonItem(input: {
  key: string;
  label: string;
  unit: string;
  personalValue: number | null;
  teamValues: number[];
  dateLabel: string | null;
}) {
  const teamMean = input.teamValues.length >= 2 ? mean(input.teamValues) : null;
  return {
    key: input.key,
    label: input.label,
    unit: input.unit,
    personalValue: input.personalValue,
    teamMean,
    difference: difference(input.personalValue, teamMean),
    teamSampleCount: teamMean === null ? null : input.teamValues.length,
    dateLabel: input.dateLabel,
    unavailableReason: teamMean === null ? '暂无可比团队数据' : null,
  };
}

function latestBodyWeight(scope: ProfileScope) {
  if (!scope.teamAthleteIds.length) return [] as NumericRow[];
  return db
    .prepare(
      `
    SELECT bm.athlete_id AS athleteId, bm.measurement_date AS date, bm.weight_kg AS value
    FROM athlete_body_measurements bm
    WHERE bm.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')}) AND bm.measurement_date <= ?
      AND bm.weight_kg IS NOT NULL AND ${usableSql('bm')}
      AND bm.measurement_date = (SELECT MAX(current_bm.measurement_date) FROM athlete_body_measurements current_bm
        WHERE current_bm.athlete_id = bm.athlete_id AND current_bm.measurement_date <= ? AND ${usableSql('current_bm')})
  `
    )
    .all(...scope.teamAthleteIds, scope.to, scope.to) as NumericRow[];
}

function latestMeasurements(scope: ProfileScope) {
  if (!scope.teamAthleteIds.length)
    return [] as Array<NumericRow & { code: string; label: string; unit: string; domain: string }>;
  return db
    .prepare(
      `
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
  `
    )
    .all(...scope.teamAthleteIds, scope.to, scope.to) as Array<
    NumericRow & { code: string; label: string; unit: string; domain: string }
  >;
}

const AEROBIC_METRIC_PATTERN =
  /vo2|max.?oxygen|aerobic|endurance|lactate|threshold|摄氧|耐力|乳酸|阈值|测功仪|erg(?:ometer)?|long.?distance|长距离|配速|pace/i;

function aerobicMetricPriority(row: Pick<AerobicMeasurementRow, 'code' | 'label'>) {
  const identifier = `${row.code} ${row.label}`.toLowerCase();
  if (/vo2|max.?oxygen|摄氧/.test(identifier)) return 0;
  if (/threshold|阈值|lactate|乳酸/.test(identifier)) return 1;
  if (/endurance|耐力/.test(identifier)) return 2;
  if (/erg|测功仪|long.?distance|长距离|pace|配速/.test(identifier)) return 3;
  return 4;
}

function aerobicMeasurements(scope: ProfileScope) {
  if (!scope.teamAthleteIds.length) return [] as AerobicMeasurementRow[];
  const rows = db
    .prepare(
      `
      SELECT
        ts.id AS sessionId,
        ts.athlete_id AS athleteId,
        ts.test_date AS date,
        ts.test_type AS testType,
        tm.value_num AS value,
        tm.metric_code AS code,
        COALESCE(md.label, tm.metric_code) AS label,
        tm.unit AS unit
      FROM test_measurements tm
      JOIN test_sessions ts ON ts.id = tm.test_session_id
      LEFT JOIN metric_definitions md ON md.code = tm.metric_code
      WHERE ts.athlete_id IN (${scope.teamAthleteIds.map(() => '?').join(',')})
        AND ts.test_date BETWEEN ? AND ?
        AND ${usableSql('ts')}
        AND ${usableSql('tm')}
      ORDER BY ts.test_date DESC, ts.id DESC
    `
    )
    .all(...scope.teamAthleteIds, scope.from, scope.to) as AerobicMeasurementRow[];
  return rows.filter((row) => AEROBIC_METRIC_PATTERN.test(`${row.code} ${row.label}`));
}

function latestRowByAthlete(rows: AerobicMeasurementRow[]) {
  const latest = new Map<number, AerobicMeasurementRow>();
  for (const row of rows) {
    if (!latest.has(row.athleteId)) latest.set(row.athleteId, row);
  }
  return [...latest.values()];
}

function latestRowByDate(rows: AerobicMeasurementRow[]) {
  const latest = new Map<string, AerobicMeasurementRow>();
  for (const row of rows) {
    if (!latest.has(row.date)) latest.set(row.date, row);
  }
  return [...latest.values()];
}

/** 当前周期内的有氧测试摘要；仅返回真实、质量合格的测试记录。 */
export function buildAerobicEndurance(scope: ProfileScope) {
  const rows = aerobicMeasurements(scope);
  const personalRows = rows.filter((row) => row.athleteId === scope.athleteId);
  const personalLatestByMetric = new Map<string, AerobicMeasurementRow>();
  for (const row of personalRows) {
    const key = `${row.code}\u0000${row.unit}`;
    if (!personalLatestByMetric.has(key)) personalLatestByMetric.set(key, row);
  }
  const metrics = [...personalLatestByMetric.values()]
    .sort(
      (left, right) =>
        aerobicMetricPriority(left) - aerobicMetricPriority(right) ||
        right.date.localeCompare(left.date) ||
        right.sessionId - left.sessionId
    )
    .slice(0, 4)
    .map((personal) => {
      const sameCondition = rows.filter(
        (row) => row.code === personal.code && row.unit === personal.unit && row.date === personal.date
      );
      const comparable = latestRowByAthlete(sameCondition);
      const teamMean = comparable.length >= 2 ? mean(comparable.map((row) => row.value)) : null;
      return {
        code: personal.code,
        label: personal.label,
        unit: personal.unit,
        personalValue: personal.value,
        teamMean,
        difference: difference(personal.value, teamMean),
        teamSampleCount: teamMean === null ? null : comparable.length,
        measurementDate: personal.date,
        unavailableReason: teamMean === null ? '暂无可比团队数据' : null,
      };
    });
  const trendMetric = metrics[0];
  const trendRows = trendMetric
    ? personalRows.filter(
        (row) => row.code === trendMetric.code && row.unit === trendMetric.unit
      )
    : [];
  const trend = trendMetric
    ? {
        code: trendMetric.code,
        label: trendMetric.label,
        unit: trendMetric.unit,
        points: latestRowByDate(trendRows)
          .sort((left, right) => left.date.localeCompare(right.date))
          .map((row) => ({ date: row.date, value: row.value })),
      }
    : null;
  const recent = personalRows[0] ?? null;
  return {
    metrics,
    trend,
    latestTest: recent
      ? {
          testType: recent.testType,
          testDate: recent.date,
          label: recent.label,
          value: recent.value,
          unit: recent.unit,
        }
      : null,
  };
}

type TrainingOverview = ReturnType<typeof buildOverviewPayload>;

function profileTrainingOverviews(scope: ProfileScope) {
  return new Map<number, TrainingOverview>(
    [...new Set([scope.athleteId, ...scope.teamAthleteIds])].map((athleteId) => [
      athleteId,
      buildOverviewPayload({
        athleteIds: [athleteId],
        from: scope.from,
        to: scope.to,
        project: scope.project,
        individual: true,
      }),
    ])
  );
}

function trainingStatusTrend(input: {
  label: string;
  unit: string;
  athleteId: number;
  overviews: Map<number, TrainingOverview>;
  value: (overview: TrainingOverview, date: string) => number | null;
}) {
  const dates = [
    ...new Set(
      [...input.overviews.values()].flatMap((overview) =>
        overview.trainingAnalytics.days.map((day) => day.date)
      )
    ),
  ].sort();
  return {
    label: input.label,
    unit: input.unit,
    points: dates.map((date) => {
      const personal = input.overviews.get(input.athleteId);
      const personalValue = personal ? input.value(personal, date) : null;
      const teamValues = [...input.overviews.values()]
        .map((overview) => input.value(overview, date))
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const teamMean = teamValues.length >= 2 ? mean(teamValues) : null;
      return {
        date,
        personalValue,
        teamMean,
        teamSampleCount: teamMean === null ? null : teamValues.length,
      };
    }),
  };
}

function dailyTrainingValue(
  overview: TrainingOverview,
  date: string,
  key: 'physicalDurationMin' | 'specialDurationMin'
) {
  return overview.trainingAnalytics.days.find((day) => day.date === date)?.[key] ?? null;
}

export function buildProfileComparison(scope: ProfileScope) {
  const overviews = profileTrainingOverviews(scope);
  const personalOverview = overviews.get(scope.athleteId);
  const teamOverview = buildOverviewPayload({
    athleteIds: scope.teamAthleteIds,
    from: scope.from,
    to: scope.to,
    project: scope.project,
    individual: false,
  });
  const weightRows = latestBodyWeight(scope);
  const measurementRows = latestMeasurements(scope);
  const athleteValues = (select: (overview: TrainingOverview) => number | null) =>
    [...overviews.values()]
      .map(select)
      .filter((value): value is number => value !== null && Number.isFinite(value));
  const items = [
    comparisonItem({
      key: 'trainingDuration',
      label: '训练时长',
      unit: '分钟',
      personalValue: personalOverview?.trainingVolume.totalDurationMin ?? null,
      teamValues: athleteValues((overview) => overview.trainingVolume.totalDurationMin),
      dateLabel: `${scope.from} 至 ${scope.to}`,
    }),
    comparisonItem({
      key: 'trainingLoad',
      label: '训练负荷',
      unit: 'AU',
      personalValue: personalOverview?.trainingLoadRatio.totalLoad ?? null,
      teamValues: athleteValues((overview) => overview.trainingLoadRatio.totalLoad),
      dateLabel: `${scope.from} 至 ${scope.to}`,
    }),
    comparisonItem({
      key: 'specialDistance',
      label: '专项距离',
      unit: 'km',
      personalValue: personalOverview?.trainingAnalytics.summary.specialDistanceKm ?? null,
      teamValues: athleteValues((overview) => overview.trainingAnalytics.summary.specialDistanceKm),
      dateLabel: `${scope.from} 至 ${scope.to}`,
    }),
    comparisonItem({
      key: 'weightKg',
      label: '体重',
      unit: 'kg',
      personalValue: weightRows.find((row) => row.athleteId === scope.athleteId)?.value ?? null,
      teamValues: weightRows.map((row) => row.value),
      dateLabel: weightRows.find((row) => row.athleteId === scope.athleteId)?.date ?? null,
    }),
  ];
  for (const code of [...new Set(measurementRows.map((row) => row.code))]) {
    const rows = measurementRows.filter((row) => row.code === code);
    const personal = rows.find((row) => row.athleteId === scope.athleteId);
    if (!personal) continue;
    const comparable = rows.filter(
      (row) => row.date === personal.date && row.unit === personal.unit
    );
    items.push(
      comparisonItem({
        key: `measurement:${code}`,
        label: personal.label,
        unit: personal.unit,
        personalValue: personal.value,
        teamValues: comparable.map((row) => row.value),
        dateLabel: personal.date,
      })
    );
  }
  const comparisonScope = {
    athleteId: scope.athleteId,
    teamId: scope.teamId,
    project: scope.project,
    from: scope.from,
    to: scope.to,
    athleteCount: scope.teamAthleteIds.length,
  };
  const statusMetric = (
    key: 'duration' | 'load' | 'sessionCount' | 'distance',
    label: string,
    unit: string,
    select: (overview: TrainingOverview) => number | null
  ) =>
    trainingStatusMetric({
      key,
      label,
      unit,
      personalValue: personalOverview ? select(personalOverview) : null,
      teamValues: athleteValues(select),
    });
  const cards = [
    {
      kind: 'physical' as const,
      title: '体能训练',
      metrics: [
        statusMetric('duration', '训练时长', 'h', (overview) => {
          const value = overview.trainingAnalytics.summary.physicalDurationMin;
          return value === null ? null : Math.round((value / 60) * 10) / 10;
        }),
        statusMetric(
          'load',
          '训练负荷',
          'AU',
          (overview) => overview.trainingAnalytics.summary.physicalLoad
        ),
        statusMetric('sessionCount', '训练课次', '课次', (overview) => {
          const value = overview.trainingAnalytics.summary.physicalSessionCount;
          return value > 0 ? value : null;
        }),
      ],
      trend: trainingStatusTrend({
        label: '体能训练时长',
        unit: 'h',
        athleteId: scope.athleteId,
        overviews,
        value: (overview, date) => {
          const value = dailyTrainingValue(overview, date, 'physicalDurationMin');
          return value === null ? null : Math.round((value / 60) * 10) / 10;
        },
      }),
    },
    {
      kind: 'special' as const,
      title: '专项训练',
      metrics: [
        statusMetric('duration', '训练时长', 'h', (overview) => {
          const value = overview.trainingAnalytics.summary.specialDurationMin;
          return value === null ? null : Math.round((value / 60) * 10) / 10;
        }),
        statusMetric(
          'distance',
          '训练距离',
          'km',
          (overview) => overview.trainingAnalytics.summary.specialDistanceKm
        ),
        statusMetric(
          'load',
          '训练负荷',
          'AU',
          (overview) => overview.trainingAnalytics.summary.specialLoad
        ),
        statusMetric('sessionCount', '训练课次', '课次', (overview) => {
          const value = overview.trainingAnalytics.summary.specialSessionCount;
          return value > 0 ? value : null;
        }),
      ],
      trend: trainingStatusTrend({
        label: '专项训练时长',
        unit: 'h',
        athleteId: scope.athleteId,
        overviews,
        value: (overview, date) => {
          const value = dailyTrainingValue(overview, date, 'specialDurationMin');
          return value === null ? null : Math.round((value / 60) * 10) / 10;
        },
      }),
    },
  ];
  return {
    comparison: {
      scope: comparisonScope,
      items,
      teamSessionCount: teamOverview.meta.sessionCount,
    },
    trainingStatus: { scope: comparisonScope, cards },
  };
}
