import type { DatabaseSync } from 'node:sqlite';
import {
  mean,
  PHYSICAL_CHAMPION_DIMENSIONS,
  physicalComparison,
  type PhysicalChampionPayload,
  type PhysicalReference,
  type PhysicalModelDimension,
} from '../../shared/physical-champion.ts';

type AthleteRow = {
  id: number;
  name: string;
  gender: string | null;
  birthDate: string | null;
  event: string;
  position: string;
  level: string;
};
type Measurement = PhysicalChampionPayload['measurements'][number];
export const USER_PHYSICAL_SIMULATION_SOURCE = 'user_requested_simulation';
// 仅保留历史标记供审计，不再用于推断年龄。
export const ADULT_REFERENCE_ASSUMPTION = '成人参考假定（用户模拟补充）';
export function adultAt(birthDate: string | null, date: string) {
  if (
    !birthDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
    Number.isNaN(Date.parse(birthDate)) ||
    new Date(birthDate).toISOString().slice(0, 10) !== birthDate ||
    birthDate > date
  )
    return false;
  return (
    Number(date.slice(0, 4)) -
      Number(birthDate.slice(0, 4)) -
      (date.slice(5) < birthDate.slice(5) ? 1 : 0) >=
    18
  );
}
export function protocolMatches(actual: string | null, expected: string) {
  return (
    expected.trim().length > 0 &&
    actual !== null &&
    actual
      .split(/[；;\n]/)
      .map((part) => part.trim())
      .includes(expected.trim())
  );
}
// 空版本与空条件是明确默认上下文，不作为具名版本或条件的通配符。
function measurementContextMatches(
  row: Measurement,
  ref: Pick<PhysicalReference, 'protocol' | 'protocolVersion' | 'testContext' | 'side'>
) {
  return (
    protocolMatches(row.protocol, ref.protocol) &&
    row.protocolVersion === ref.protocolVersion &&
    row.testContext === ref.testContext &&
    row.side === ref.side
  );
}
export function readPhysicalReferences(db: DatabaseSync, project: string): PhysicalReference[] {
  const rows = db
    .prepare(
      `SELECT rv.id, rv.revision, rv.metric_key AS key, rv.unit, rv.value_num AS value,
    rv.protocol, rv.protocol_version AS protocolVersion, rv.test_context AS testContext, rv.side, rv.direction, rv.source_type AS sourceType, rs.name AS sourceNote, rv.project,
    rv.gender, rv.event_group AS event, rv.weight_class AS weightClass, rv.age_group AS ageGroup,
    rv.review_status AS reviewStatus, rv.source_nature AS sourceNature, rv.version,
    rv.effective_from AS effectiveFrom, rv.effective_to AS effectiveTo, rv.position,
    rv.reference_level AS referenceLevel, rv.reference_label AS referenceLabel,
    rv.dimension_version AS dimensionVersion, rv.measurement_codes AS measurementCodes,
    rv.measurement_unit AS measurementUnit, rv.weight_relative AS weightRelative,
    rv.active, rs.active AS sourceActive
    FROM radar_reference_values rv JOIN radar_reference_sources rs ON rs.id=rv.source_id
    WHERE rv.project IN (?,?) AND rv.radar_kind='physical' ORDER BY rv.id`
    )
    .all(
      project,
      project === 'CANOE_SPRINT' ? 'CANOE' : project === 'CANOE_SLALOM' ? 'SLALOM' : project
    ) as Array<
    Omit<PhysicalReference, 'measurementCodes' | 'weightRelative'> & {
      measurementCodes: string;
      weightRelative: number;
      active: number;
      sourceActive: number;
    }
  >;
  return rows.map((row) => {
    let codes: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.measurementCodes);
      if (Array.isArray(parsed) && parsed.every((code) => typeof code === 'string')) codes = parsed;
    } catch {
      /* 历史配置损坏时保持待配置，不猜测指标。 */
    }
    return {
      ...row,
      label: row.referenceLabel || row.key,
      reviewStatus: row.active && row.sourceActive ? row.reviewStatus : 'disabled',
      measurementCodes: codes,
      weightRelative: row.weightRelative === 1,
    };
  });
}
export function isDisplayPhysicalReference(ref: PhysicalReference, date: string) {
  return (
    ref.reviewStatus !== 'disabled' &&
    !!ref.effectiveFrom &&
    ref.effectiveFrom <= date &&
    (!ref.effectiveTo || ref.effectiveTo >= date) &&
    (ref.weightRelative
      ? ref.measurementUnit === 'kg' && ref.unit === '倍体重'
      : ref.measurementUnit === ref.unit || (ref.measurementUnit === '秒' && ref.unit === 's')) &&
    !!ref.dimensionVersion &&
    ref.measurementCodes.length > 0 &&
    !!ref.measurementUnit &&
    !!ref.protocol
  );
}
export function isUsablePhysicalReference(ref: PhysicalReference, date: string) {
  return (
    isDisplayPhysicalReference(ref, date) &&
    ref.reviewStatus === 'reviewed' &&
    ref.sourceType !== 'estimated' &&
    !['estimated', 'unverified'].includes(ref.sourceNature)
  );
}
function applies(
  ref: Pick<
    PhysicalReference,
    'gender' | 'ageGroup' | 'event' | 'weightClass' | 'position' | 'referenceLevel'
  >,
  athlete: AthleteRow,
  date: string
) {
  return (
    (ref.gender === 'open' || athlete.gender === ref.gender) &&
    (ref.ageGroup === 'open' || (ref.ageGroup === 'adult' && adultAt(athlete.birthDate, date))) &&
    (ref.event === 'open' || (!!athlete.event && ref.event === athlete.event)) &&
    ref.weightClass === 'open' &&
    !/(轻量级|lightweight|\bLW)/i.test(athlete.event) &&
    (ref.position === 'open' || (!!athlete.position && ref.position === athlete.position)) &&
    (ref.referenceLevel === 'open' || (!!athlete.level && ref.referenceLevel === athlete.level))
  );
}
const priority = (ref: PhysicalReference) =>
  [ref.gender, ref.ageGroup, ref.event, ref.weightClass, ref.position, ref.referenceLevel].filter(
    (value) => value !== 'open'
  ).length;
export function buildPhysicalChampion(
  db: DatabaseSync,
  scope: { project: string; from: string; to: string; athleteIds: number[]; canEdit: boolean }
): PhysicalChampionPayload {
  const { project, from, to, canEdit } = scope;
  const references = readPhysicalReferences(db, project);
  const ids = new Set(scope.athleteIds);
  const athletes = (
    db
      .prepare(
        `SELECT a.id,a.name,a.gender,a.birth_date AS birthDate, COALESCE(ap.current_event,'') AS event,
    COALESCE(ap.position,'') AS position,COALESCE(ap.technical_level,'') AS level FROM athletes a LEFT JOIN athlete_profiles ap ON ap.athlete_id=a.id
    WHERE a.project=? AND a.active=1`
      )
      .all(project) as AthleteRow[]
  ).filter((athlete) => ids.has(athlete.id));
  const read =
    db.prepare(`SELECT tm.id AS measurementId,ts.athlete_id AS athleteId,ts.id AS sessionId,ts.test_date AS date,ts.protocol,
    ts.protocol_version AS protocolVersion,ts.context_key AS testContext,tm.side,
    tm.metric_code AS code,tm.value_num AS value,tm.unit FROM test_sessions ts JOIN test_measurements tm ON tm.test_session_id=ts.id
    WHERE ts.athlete_id=? AND ts.project_code=? AND ts.project_status='confirmed' AND ts.test_date BETWEEN ? AND ?
    AND ts.quality='valid' AND tm.quality='valid' AND ts.is_demo=0 AND tm.is_demo=0
    AND trim(ts.source)<>'' AND trim(tm.source)<>''
    AND lower(ts.source) NOT LIKE '%demo%' AND lower(tm.source) NOT LIKE '%demo%'
    AND lower(ts.source) NOT LIKE '%seed%' AND lower(tm.source) NOT LIKE '%seed%'
    AND lower(ts.source) NOT LIKE '%estimated%' AND lower(tm.source) NOT LIKE '%estimated%'
    AND lower(ts.source) NOT LIKE '%synthetic%' AND lower(tm.source) NOT LIKE '%synthetic%'
    AND lower(ts.source) NOT LIKE '%simulation%' AND lower(tm.source) NOT LIKE '%simulation%'
    AND ts.source<>? AND tm.source<>? ORDER BY ts.test_date DESC,ts.id DESC,tm.id DESC`);
  const measurements = athletes.flatMap(
    (athlete) =>
      read.all(
        athlete.id,
        project,
        from,
        to,
        USER_PHYSICAL_SIMULATION_SOURCE,
        USER_PHYSICAL_SIMULATION_SOURCE
      ) as Measurement[]
  );
  const effective = references.filter(
    (ref) =>
      isDisplayPhysicalReference(
        ref,
        ref.effectiveFrom && ref.effectiveFrom > from ? ref.effectiveFrom : from
      ) &&
      (!ref.effectiveTo || ref.effectiveTo >= from) &&
      !!ref.effectiveFrom &&
      ref.effectiveFrom <= to
  );
  // 分组保留适用范围；同维度多个版本由逐事实匹配检测冲突，不能按更新时间覆盖。
  const buckets = new Map<string, PhysicalReference[]>();
  for (const ref of effective) {
    const id = JSON.stringify([
      ref.gender,
      ref.event,
      ref.weightClass,
      ref.ageGroup,
      ref.position,
      ref.referenceLevel,
    ]);
    buckets.set(id, [...(buckets.get(id) || []), ref]);
  }
  const matched = new Set<number>();
  const groups: PhysicalChampionPayload['groups'] = [...buckets].map(([id, candidates]) => {
    const first = candidates[0];
    const refs = [...new Map(candidates.map((ref) => [ref.key, ref])).values()];
    const members = athletes.filter((athlete) => applies(first, athlete, to));
    members.forEach((athlete) => matched.add(athlete.id));
    const resultAt = (athlete: AthleteRow, cutoff: string) => {
      const dimensions = refs.map((displayRef) => {
        const rows = measurements.filter(
          (row) => row.athleteId === athlete.id && row.date <= cutoff
        );
        const all = references.filter((ref) => ref.key === displayRef.key);
        const row = rows.find((item) =>
          all.some(
            (ref) =>
              isDisplayPhysicalReference(ref, item.date) &&
              applies(ref, athlete, item.date) &&
              ref.measurementCodes.includes(item.code) &&
              item.unit === ref.measurementUnit &&
              measurementContextMatches(item, ref)
          )
        );
        const compatible = row
          ? all.filter(
              (ref) =>
                isDisplayPhysicalReference(ref, row.date) &&
                applies(ref, athlete, row.date) &&
                ref.measurementCodes.includes(row.code) &&
                row.unit === ref.measurementUnit &&
                measurementContextMatches(row, ref)
            )
          : [];
        const rank = Math.max(-1, ...compatible.map(priority));
        const best = compatible.filter((ref) => priority(ref) === rank);
        const ref = best.length === 1 ? best[0] : null;
        let value = row && Number.isFinite(row.value) && row.value >= 0 ? row.value : null;
        const definition = ref || displayRef;
        if (row && definition.weightRelative) {
          const weight = rows.find(
            (item) =>
              item.sessionId === row.sessionId &&
              ['weight_kg', 'weightKg'].includes(item.code) &&
              item.unit === 'kg' &&
              item.value > 0
          );
          value =
            weight && value !== null ? Math.round((value / weight.value) * 1000) / 1000 : null;
        }
        const pendingReason =
          best.length > 1
            ? '同优先级标准冲突，暂停评价'
            : !ref
              ? '无匹配日期、人群、协议版本、测试条件、侧别和单位的冠军参考'
              : value === null
                ? '缺少同协议实测或同课次体重'
                : null;
        return {
          key: displayRef.key,
          ...(ref
            ? physicalComparison(value, ref)
            : { value, achievedPercent: null, difference: null, scoringEligible: false }),
          testDate: row?.date || null,
          pendingReason,
          referenceId: ref?.id || null,
          referenceVersion: ref?.version || null,
          factMeasurementId: row?.measurementId || null,
          calculationVersion: 'physical-display-v3',
          appliedReference: ref,
        };
      });
      return {
        athleteId: athlete.id,
        athleteName: athlete.name,
        dimensions,
        coverage: dimensions.filter((item) => item.achievedPercent !== null).length,
        score:
          dimensions.length && dimensions.every((item) => item.achievedPercent !== null)
            ? mean(dimensions.map((item) => item.achievedPercent!))
            : null,
        scoringEligible:
          dimensions.length > 0 &&
          dimensions.every((item) => item.achievedPercent !== null && item.scoringEligible),
      };
    };
    const results = members.map((athlete) => resultAt(athlete, to));
    const team = refs.map((ref) => {
      const values = results.flatMap((athlete) => {
        const result = athlete.dimensions.find((item) => item.key === ref.key);
        return result?.value == null ? [] : [result.value];
      });
      const entries = results.flatMap((athlete) => {
        const result = athlete.dimensions.find((item) => item.key === ref.key);
        return result?.achievedPercent != null ? [result] : [];
      });
      // 只汇总已逐事实匹配的达成度；不同参考版本不把原始均值再套入某一个阈值。
      return {
        key: ref.key,
        value: mean(values),
        achievedPercent: mean(entries.map((item) => item.achievedPercent!)),
        difference:
          new Set(entries.map((item) => item.referenceId)).size === 1
            ? mean(entries.flatMap((item) => (item.difference == null ? [] : [item.difference])))
            : null,
        scoringEligible: entries.length > 0 && entries.every((item) => item.scoringEligible),
        testDate: null,
        sampleCount: entries.length,
        pendingReason: entries.length ? null : '缺少同条件有效实测',
        referenceId: null,
        referenceVersion: null,
        factMeasurementId: null,
        calculationVersion: 'physical-display-v3',
        appliedReference: null,
      };
    });
    const trend: PhysicalChampionPayload['groups'][number]['trend'] = [];
    const dates = [
      ...new Set(
        measurements
          .filter((row) => members.some((member) => member.id === row.athleteId))
          .map((row) => row.date)
      ),
    ].sort();
    for (const date of dates) {
      const daily = members.map((athlete) => resultAt(athlete, date));
      for (const result of daily)
        if (result.score !== null)
          trend.push({
            date,
            athleteId: result.athleteId,
            score: result.score,
            scoringEligible: result.scoringEligible,
            coverage: result.coverage,
            sampleCount: 1,
          });
      const complete = daily.filter((item) => item.score !== null);
      if (complete.length)
        trend.push({
          date,
          athleteId: null,
          score: mean(complete.map((item) => item.score!)),
          scoringEligible: complete.every((item) => item.scoringEligible),
          coverage: refs.length,
          sampleCount: complete.length,
        });
    }
    return {
      id,
      label: [
        first.gender === '男' ? '男子' : first.gender === '女' ? '女子' : '不限性别',
        first.event === 'open' ? '' : first.event,
        first.ageGroup === 'adult'
          ? '成人组'
          : first.ageGroup === 'open'
            ? '不限年龄'
            : first.ageGroup,
      ]
        .filter(Boolean)
        .join(' · '),
      gender: first.gender,
      event: first.event,
      weightClass: first.weightClass,
      ageGroup: first.ageGroup,
      referenceLevel: first.referenceLabel || '冠军参考模型',
      references: refs,
      team,
      athletes: results,
      trend,
    };
  });
  // 共用指标框架不依赖已配置冠军值，不向数据库写入占位标准。
  for (const gender of ['男', '女']) {
    if (groups.some((group) => group.gender === gender || group.gender === 'open')) continue;
    groups.push({
      id: JSON.stringify([gender, 'open', 'open', 'adult', 'open', 'open']),
      label: `${gender}子成人组`,
      gender,
      event: 'open',
      weightClass: 'open',
      ageGroup: 'adult',
      referenceLevel: 'open',
      references: [],
      team: [],
      athletes: [],
      trend: [],
    });
  }
  for (const group of groups) {
    const members = athletes.filter((athlete) =>
      applies(
        {
          gender: group.gender,
          ageGroup: group.ageGroup,
          event: group.event,
          weightClass: group.weightClass,
          position: group.references[0]?.position || 'open',
          referenceLevel: group.references[0]?.referenceLevel || 'open',
        },
        athlete,
        to
      )
    );
    const columns: PhysicalModelDimension[] = group.references.map((ref) => ({
      id: ref.id,
      revision: ref.revision,
      key: ref.key,
      label: ref.label,
      unit: ref.unit,
      value: ref.value,
      estimated: ref.sourceType === 'estimated',
    }));
    for (const dimension of PHYSICAL_CHAMPION_DIMENSIONS) {
      if (columns.some((column) => column.key === dimension.key)) continue;
      columns.push({
        id: null,
        revision: 0,
        key: dimension.key,
        label: dimension.label,
        unit: dimension.unit,
        value: null,
        estimated: false,
      });
      const values = members.flatMap((athlete) => {
        const rows = measurements.filter((row) => row.athleteId === athlete.id);
        const row = rows.find(
          (row) =>
            dimension.codes.some((code) => code === row.code) &&
            row.unit === dimension.measurementUnit &&
            measurementContextMatches(row, {
              protocol: dimension.protocol,
              protocolVersion: '',
              testContext: '',
              side: 'center',
            })
        );
        if (!row || !Number.isFinite(row.value) || row.value < 0) return [];
        if (!dimension.weightRelative) return [row.value];
        const weight = rows.find(
          (item) =>
            item.sessionId === row.sessionId &&
            ['weight_kg', 'weightKg'].includes(item.code) &&
            item.unit === 'kg' &&
            item.value > 0
        );
        return weight ? [Math.round((row.value / weight.value) * 1000) / 1000] : [];
      });
      group.team.push({
        key: dimension.key,
        value: mean(values),
        sampleCount: values.length,
        achievedPercent: null,
        difference: null,
        scoringEligible: false,
        testDate: null,
        pendingReason: '冠军值待配置',
        referenceId: null,
        referenceVersion: null,
        factMeasurementId: null,
        calculationVersion: 'physical-raw-v1',
        appliedReference: null,
      });
    }
    group.modelDimensions = columns;
  }
  const athletePendingReasons = athletes
    .filter((athlete) => !matched.has(athlete.id))
    .map((athlete) => ({
      athleteId: athlete.id,
      reason: !effective.length
        ? '冠军参考模型维度待配置'
        : !athlete.birthDate && effective.some((ref) => ref.ageGroup === 'adult')
          ? '无法匹配年龄组：出生日期缺失，不假定成人'
          : !athlete.gender
            ? '无法匹配性别：档案信息缺失'
            : !athlete.position && effective.some((ref) => ref.position !== 'open')
              ? '无法匹配位置：档案信息缺失'
              : !athlete.level && effective.some((ref) => ref.referenceLevel !== 'open')
                ? '无法匹配级别：档案信息缺失'
                : '暂无满足全部项目、人群、分项和级别条件的参考',
    }));
  return {
    athletePendingReasons,
    project,
    from,
    to,
    canEdit,
    excludedCount: athletes.length - matched.size,
    groups,
    managementReferences: canEdit ? references : [],
    measurements,
    pendingReason: effective.length
      ? '冠军参考模型展示逐维与完整维度达成度；含估算参考不参与正式评分，不显示排名；缺项不补零'
      : '当前项目暂无匹配的冠军参考维度；保留实测与同协议记录',
  };
}
