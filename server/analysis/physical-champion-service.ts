import type { DatabaseSync } from 'node:sqlite';
import {
  PHYSICAL_CHAMPION_DIMENSIONS,
  mean,
  physicalComparison,
  type PhysicalChampionPayload,
  type PhysicalReference,
} from '../../shared/physical-champion.ts';

type ReferenceRow = PhysicalReference & {
  gender: string;
  event: string;
  weightClass: string;
  ageGroup: string;
};
type AthleteRow = {
  id: number;
  name: string;
  gender: string | null;
  birthDate: string | null;
  event: string;
};
type Measurement = {
  athleteId: number;
  sessionId: number;
  date: string;
  protocol: string;
  source: string;
  code: string;
  value: number;
  unit: string;
};

export const USER_PHYSICAL_SIMULATION_SOURCE = 'user_requested_simulation';
export const ADULT_REFERENCE_ASSUMPTION = '成人参考假定（用户模拟补充）';

function hasSimulationAgeAssumption(athlete: AthleteRow, row: Measurement) {
  return (
    !athlete.birthDate?.trim() &&
    row.source === USER_PHYSICAL_SIMULATION_SOURCE &&
    protocolMatches(row.protocol, ADULT_REFERENCE_ASSUMPTION)
  );
}

export function adultAt(birthDate: string | null, date: string) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const age =
    Number(date.slice(0, 4)) -
    Number(birthDate.slice(0, 4)) -
    (date.slice(5) < birthDate.slice(5) ? 1 : 0);
  return age >= 18;
}
export function protocolMatches(actual: string, expected: string) {
  return (
    expected.trim().length > 0 &&
    actual
      .split(/[；;\n]/)
      .map((part) => part.trim())
      .includes(expected.trim())
  );
}

export function buildPhysicalChampion(
  db: DatabaseSync,
  scope: { project: string; from: string; to: string; athleteIds: number[]; canEdit: boolean }
): PhysicalChampionPayload {
  const { project, from, to, canEdit } = scope;
  const referenceRows = db
    .prepare(
      `SELECT rv.id, rv.revision, rv.metric_key AS key, rv.unit, rv.value_num AS value,
    rv.protocol, rv.direction, rv.source_type AS sourceType, rs.name AS sourceNote,
    rv.gender, rv.event_group AS event, rv.weight_class AS weightClass, rv.age_group AS ageGroup
    FROM radar_reference_values rv JOIN radar_reference_sources rs ON rs.id = rv.source_id
    WHERE rv.project IN (?, ?) AND rv.radar_kind = 'physical' AND rv.active = 1 AND rs.active = 1
    AND trim(rv.protocol) <> '' ORDER BY rv.updated_at DESC, rv.id DESC`
    )
    .all(
      project,
      project === 'CANOE_SPRINT' ? 'CANOE' : project === 'CANOE_SLALOM' ? 'SLALOM' : project
    ) as ReferenceRow[];
  const refs = referenceRows.map((row) => ({
    ...row,
    label:
      PHYSICAL_CHAMPION_DIMENSIONS.find((dimension) => dimension.key === row.key)?.label || row.key,
  }));
  const ids = new Set(scope.athleteIds);
  const athletes = (
    db
      .prepare(
        `SELECT a.id, a.name, a.gender, a.birth_date AS birthDate,
    COALESCE(ap.current_event, '') AS event FROM athletes a LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
    WHERE a.project = ? AND a.active = 1`
      )
      .all(project) as AthleteRow[]
  ).filter((athlete) => ids.has(athlete.id));
  // 查询始终按已授权运动员裁剪，任何演示、估算、异常或无来源测试都不进入分析。
  const readMeasurements =
    db.prepare(`SELECT ts.athlete_id AS athleteId, ts.id AS sessionId, ts.test_date AS date, ts.protocol, ts.source,
    tm.metric_code AS code, tm.value_num AS value, tm.unit
    FROM test_sessions ts JOIN test_measurements tm ON tm.test_session_id = ts.id
    WHERE ts.athlete_id = ? AND ts.test_date BETWEEN ? AND ?
    AND ts.quality = 'valid' AND tm.quality = 'valid' AND ts.is_demo = 0 AND tm.is_demo = 0
    AND trim(ts.source) <> '' AND trim(tm.source) <> ''
    AND lower(ts.source) NOT LIKE '%demo%' AND lower(tm.source) NOT LIKE '%demo%'
    AND lower(ts.source) NOT LIKE '%seed%' AND lower(tm.source) NOT LIKE '%seed%'
    AND lower(ts.source) NOT LIKE '%estimated%' AND lower(tm.source) NOT LIKE '%estimated%'
    ORDER BY ts.test_date DESC, ts.id DESC, tm.id DESC`);
  const measurements = athletes.flatMap(
    (athlete) => readMeasurements.all(athlete.id, from, to) as Measurement[]
  );
  const groupRows = new Map<string, ReferenceRow[]>();
  for (const ref of refs) {
    if (
      !PHYSICAL_CHAMPION_DIMENSIONS.some(
        (dimension) => dimension.key === ref.key && dimension.unit === ref.unit
      )
    )
      continue;
    const id = JSON.stringify([ref.gender, ref.event, ref.weightClass, ref.ageGroup]);
    const group = groupRows.get(id) || [];
    if (!group.some((item) => item.key === ref.key)) group.push(ref);
    groupRows.set(id, group);
  }
  const matched = new Set<number>();
  const groups = [...groupRows].map(([id, references]) => {
    const first = references[0];
    // 开放体重参考采用相对力量；尚无体重级别事实字段时不猜测具体级别。
    const members = athletes.filter(
      (athlete) =>
        athlete.gender === first.gender &&
        first.ageGroup === 'adult' &&
        (adultAt(athlete.birthDate, to) ||
          measurements.some(
            (row) => row.athleteId === athlete.id && hasSimulationAgeAssumption(athlete, row)
          )) &&
        first.weightClass === 'open' &&
        !/(轻量级|lightweight|\bLW)/i.test(athlete.event) &&
        (first.event === 'open' || first.event === athlete.event)
    );
    members.forEach((athlete) => matched.add(athlete.id));
    const resultAt = (athlete: AthleteRow, cutoff: string) => {
      const rows = measurements.filter(
        (row) =>
          row.athleteId === athlete.id &&
          row.date <= cutoff &&
          (adultAt(athlete.birthDate, row.date) || hasSimulationAgeAssumption(athlete, row))
      );
      const dimensions = references.map((reference) => {
        const definition = PHYSICAL_CHAMPION_DIMENSIONS.find(
          (dimension) => dimension.key === reference.key
        )!;
        const row = rows.find(
          (measurement) =>
            (definition.codes as readonly string[]).includes(measurement.code) &&
            measurement.unit === definition.measurementUnit &&
            protocolMatches(measurement.protocol, reference.protocol) &&
            Number.isFinite(measurement.value) &&
            measurement.value >= 0
        );
        let value: number | null = row?.value ?? null;
        if (row && definition.weightRelative) {
          // 同一次测试的体重才能作为分母，避免跨日期体重改变相对力量。
          const weight = rows.find(
            (item) =>
              item.sessionId === row.sessionId &&
              ['weight_kg', 'weightKg'].includes(item.code) &&
              item.unit === 'kg' &&
              item.value > 0
          );
          value = weight ? Math.round((row.value / weight.value) * 1000) / 1000 : null;
        }
        return {
          key: reference.key,
          ...physicalComparison(value, reference),
          testDate: value === null ? null : (row?.date ?? null),
        };
      });
      const scores = dimensions.flatMap((dimension) =>
        dimension.achievedPercent === null ? [] : [dimension.achievedPercent]
      );
      return {
        athleteId: athlete.id,
        athleteName: athlete.name,
        dimensions,
        coverage: scores.length,
        score: scores.length === references.length ? mean(scores) : null,
      };
    };
    const results = members.map((athlete) => resultAt(athlete, to));
    const team = references.map((reference) => {
      const valid = results.flatMap((athlete) => {
        const value = athlete.dimensions.find(
          (dimension) => dimension.key === reference.key
        )?.value;
        return value == null ? [] : [value];
      });
      return {
        key: reference.key,
        ...physicalComparison(mean(valid), reference),
        testDate: null,
        sampleCount: valid.length,
      };
    });
    const dates = [
      ...new Set(
        measurements
          .filter((row) => members.some((member) => member.id === row.athleteId))
          .map((row) => row.date)
      ),
    ].sort();
    const trend = dates.flatMap((date) => {
      const daily = members.map((athlete) => resultAt(athlete, date));
      const scores = daily.flatMap((athlete) => (athlete.score === null ? [] : [athlete.score]));
      return [
        {
          date,
          score: mean(scores),
          sampleCount: scores.length,
          athleteId: null,
          coverage: daily.reduce((sum, athlete) => sum + athlete.coverage, 0),
        },
        ...daily.map((athlete) => ({
          date,
          score: athlete.score,
          sampleCount: athlete.score === null ? 0 : 1,
          athleteId: athlete.athleteId,
          coverage: athlete.coverage,
        })),
      ];
    });
    // 仅完整八维进入综合排名，缺测人员保留明细但不以稀疏样本参与排名。
    results.sort(
      (a, b) =>
        (b.coverage === references.length ? (b.score ?? -1) : -1) -
        (a.coverage === references.length ? (a.score ?? -1) : -1)
    );
    return {
      id,
      label: `${first.gender} · ${first.event === 'open' ? '通用体能' : first.event} · 成人开放组`,
      gender: first.gender,
      event: first.event,
      weightClass: first.weightClass,
      ageGroup: first.ageGroup,
      referenceLevel: '顶尖竞技水平参考（含估算，待校准）',
      references,
      team,
      athletes: results,
      trend,
    };
  });
  return { project, from, to, canEdit, excludedCount: athletes.length - matched.size, groups };
}
