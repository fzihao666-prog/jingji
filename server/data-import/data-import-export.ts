import ExcelJS from 'exceljs';
import { db } from '../core/db.ts';
import { buildImportWorkbook } from './template-workbook.ts';
import {
  UNIFIED_IMPORT_HEADERS,
  BODY_TEMPLATE_FIELDS,
  FITNESS_TEMPLATE_METRICS,
  FMS_TEMPLATE_METRICS,
  EVALUATION_SCORE_METRICS,
  canonicalImportMetricCode,
} from '../../shared/data-import-template.ts';

export function writeUnifiedExportRows(sheet: ExcelJS.Worksheet | undefined, rows: unknown[][]) {
  if (!sheet) return;
  rows.forEach((values, index) => {
    sheet.getRow(index + 4).values = values as ExcelJS.CellValue[];
  });
}

export async function buildUnifiedDataExport(project: string, athleteIds: number[]) {
  const workbook = buildImportWorkbook();
  if (!athleteIds.length) return workbook;
  const placeholders = athleteIds.map(() => '?').join(',');
  const profileRows = db
    .prepare(
      `
    SELECT a.id, a.name, a.project, COALESCE(pt.name, '') AS team, a.gender, a.birth_date, COALESCE(ao.province, '未设置') AS region, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county,
      ap.ethnicity, ap.phone, ap.blood_type, ap.emergency_contact, ap.emergency_phone,
      ap.education, ap.technical_level, ap.position, ap.health_status, ap.best_result, ap.native_place,
      ap.home_address, ap.athlete_status, ap.start_sport_date, ap.training_venue, ap.current_event,
      ap.training_phase, ap.camp_period, ap.origin_place, ap.origin_unit, ap.origin_coach, ap.specialties, ap.notes
    FROM athletes a LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
    LEFT JOIN project_teams pt ON pt.id = a.team_id LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
    WHERE a.id IN (${placeholders}) AND a.project = ? AND a.active = 1 ORDER BY pt.name, a.name
  `
    )
    .all(...athleteIds, project) as Array<Record<string, unknown>>;
  const profileIds = profileRows.map((row) => Number(row.id));
  if (!profileIds.length) return workbook;
  const ids = profileIds.map(() => '?').join(',');
  const nameById = new Map(profileRows.map((row) => [Number(row.id), String(row.name)]));
  writeUnifiedExportRows(
    workbook.getWorksheet('运动员基本资料'),
    profileRows.map((row) => [
      row.id,
      row.name,
      row.project,
      row.team,
      row.gender,
      row.birth_date,
      row.region,
      row.city,
      row.county,
      row.ethnicity,
      row.phone,
      row.blood_type,
      row.emergency_contact,
      row.emergency_phone,
      row.education,
      row.technical_level,
      row.position,
      row.health_status,
      row.best_result,
      row.native_place,
      row.home_address,
      row.athlete_status,
      row.start_sport_date,
      row.training_venue,
      row.current_event,
      row.training_phase,
      row.camp_period,
      row.origin_place,
      row.origin_unit,
      row.origin_coach,
      row.specialties,
      row.notes,
    ])
  );
  const bodyRows = db
    .prepare(
      `SELECT * FROM athlete_body_measurements WHERE athlete_id IN (${ids}) ORDER BY measurement_date, athlete_id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  const wellnessRows = db
    .prepare(
      `SELECT * FROM daily_wellness WHERE athlete_id IN (${ids}) ORDER BY wellness_date, athlete_id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('每日恢复'),
    wellnessRows.map((row) => [
      row.athlete_id,
      nameById.get(Number(row.athlete_id)),
      row.wellness_date,
      row.sleep_hours,
      row.sleep_quality,
      row.morning_pulse,
      row.weight_kg,
      row.fatigue_index,
      row.soreness_index,
      row.mood_index,
      row.status,
      '',
    ])
  );
  const sessionRows = db
    .prepare(
      `SELECT * FROM training_sessions WHERE athlete_id IN (${ids}) ORDER BY session_date, athlete_id, session_order`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('训练课次'),
    sessionRows
      .filter((row) => Number(row.duration_reported ?? 1) || Number(row.distance_reported ?? 1))
      .map((row) => [
        row.athlete_id,
        nameById.get(Number(row.athlete_id)),
        row.session_date,
        row.session_order,
        row.start_time,
        row.training_type,
        row.content,
        row.structure_type,
        row.intensity_zone,
        Number(row.duration_reported ?? 1) ? row.duration_min : null,
        Number(row.distance_reported ?? 1) ? row.distance_km : null,
        row.rpe,
        row.srpe,
        row.smvl,
        row.average_heart_rate,
        row.max_heart_rate,
        row.average_power_w,
        row.stroke_rate_spm,
      ])
  );
  const setRows = db
    .prepare(
      `SELECT srs.*, ts.athlete_id, ts.session_date, ts.content FROM strength_result_sets srs JOIN training_sessions ts ON ts.id = srs.training_session_id WHERE ts.athlete_id IN (${ids}) ORDER BY ts.session_date, ts.athlete_id, srs.id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('力量训练组次'),
    setRows.map((row) => [
      row.athlete_id,
      nameById.get(Number(row.athlete_id)),
      row.session_date,
      row.content,
      row.exercise_name,
      row.set_index,
      row.target_reps,
      row.actual_reps,
      row.actual_weight_kg,
      row.intensity_percent,
      row.rpe,
      row.training_category,
      row.body_position,
      row.note,
    ])
  );
  const testRows = db
    .prepare(
      `SELECT ts.id AS testSessionId, ts.athlete_id, ts.test_date, ts.test_type, ts.duration_min, ts.protocol, tm.metric_code, tm.value_num, tm.unit, tm.side, tm.note, md.label FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id LEFT JOIN metric_definitions md ON md.code = tm.metric_code WHERE ts.athlete_id IN (${ids}) ORDER BY ts.test_date, ts.athlete_id, tm.id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  // 按字段业务归属导出，不把身体指标重复放入通用测试表；历史数据只读，不改写。
  const bodyHeaders = UNIFIED_IMPORT_HEADERS.find(([name]) => name === '身体测量')![1];
  const bodyValues = bodyRows.map((row) => [
    row.athlete_id,
    nameById.get(Number(row.athlete_id)),
    row.measurement_date,
    ...BODY_TEMPLATE_FIELDS.map(([, key, code]) =>
      key === 'armSpanCm' ? null : (row[code] ?? null)
    ),
    row.note,
  ]);
  const groupedTests = new Map<string, { sheet: string; values: unknown[] }>();
  const otherRows: unknown[][] = [];
  for (const row of testRows) {
    const code = canonicalImportMetricCode(String(row.metric_code));
    const physical = BODY_TEMPLATE_FIELDS.find(([, , canonical]) => canonical === code);
    if (physical && !row.note && row.side === 'center' && String(row.unit || '') === physical[4]) {
      const column = bodyHeaders.indexOf(physical[0]);
      let target = bodyValues.find(
        (values) =>
          Number(values[0]) === Number(row.athlete_id) &&
          values[2] === row.test_date &&
          (values[column] === null ||
            values[column] === undefined ||
            Number(values[column]) === Number(row.value_num))
      );
      if (!target) {
        target = bodyHeaders.map(() => null) as unknown[];
        target[0] = row.athlete_id;
        target[1] = nameById.get(Number(row.athlete_id));
        target[2] = row.test_date;
        bodyValues.push(target);
      }
      target[column] = row.value_num;
      continue;
    }
    const fitness = FITNESS_TEMPLATE_METRICS.find(([, canonical]) => canonical === code);
    const fms = FMS_TEMPLATE_METRICS.find(([, canonical]) => canonical === code);
    const score = EVALUATION_SCORE_METRICS.find(([, canonical]) => canonical === code);
    const expectedUnit = fitness?.[3] || score?.[3] || (fms ? '分' : '');
    if (
      !physical && !row.note &&
      row.side === 'center' &&
      String(row.unit || '') === expectedUnit &&
      (fitness || fms || score)
    ) {
      const sheet = fitness ? '体能测试' : fms ? 'FMS测试' : '竞技评估';
      const headers = UNIFIED_IMPORT_HEADERS.find(([name]) => name === sheet)![1];
      const key = `${sheet}|${row.testSessionId}`;
      let group = groupedTests.get(key);
      if (!group) {
        const values: unknown[] = headers.map(() => null);
        values[0] = row.athlete_id;
        values[1] = nameById.get(Number(row.athlete_id));
        values[2] = row.test_date;
        const protocolColumn = headers.indexOf(score ? '评估协议' : '测试协议');
        if (protocolColumn >= 0) values[protocolColumn] = row.protocol;
        group = { sheet, values };
        groupedTests.set(key, group);
      }
      group.values[headers.indexOf((fitness || fms || score)![0])] = row.value_num;
    } else
      otherRows.push([
        row.athlete_id,
        nameById.get(Number(row.athlete_id)),
        row.test_date,
        row.test_type,
        code,
        row.label || code,
        row.value_num,
        row.unit,
        row.side,
        row.protocol,
        row.note || '',
        row.duration_min,
      ]);
  }
  writeUnifiedExportRows(workbook.getWorksheet('身体测量'), bodyValues);
  for (const name of ['体能测试', 'FMS测试'])
    writeUnifiedExportRows(
      workbook.getWorksheet(name),
      [...groupedTests.values()]
        .filter((group) => group.sheet === name)
        .map((group) => group.values)
    );
  writeUnifiedExportRows(workbook.getWorksheet('其他测试'), otherRows);
  const sideLabel: Record<string, string> = {
    left: '左',
    right: '右',
    bilateral: '双侧',
    center: '中央',
    unspecified: '未指定',
  };
  const statusLabel: Record<string, string> = {
    healthy: '健康',
    observation: '观察',
    restricted: '限训',
    rehab: '康复',
    suspended: '停训',
  };
  const injuryRows = db
    .prepare(
      `SELECT * FROM injury_records WHERE athlete_id IN (${ids}) ORDER BY onset_date, athlete_id, id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('伤病记录'),
    injuryRows.map((row) => [
      row.athlete_id,
      nameById.get(Number(row.athlete_id)),
      row.onset_date,
      row.injury_name,
      row.body_part,
      sideLabel[String(row.side)] || row.side,
      statusLabel[String(row.status)] || row.status,
      row.pain_score,
      row.restrictions,
      row.rehab_plan,
      row.review_date,
      row.note,
    ])
  );
  const stateLabel: Record<string, string> = {
    peak: '巅峰',
    good: '良好',
    build: '建设',
    adjust: '调整',
  };
  const stateRows = db
    .prepare(
      `SELECT * FROM competitive_state_assessments WHERE athlete_id IN (${ids}) ORDER BY assessment_date, athlete_id`
    )
    .all(...profileIds) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('竞技评估'),
    stateRows.map((row) => [
      row.athlete_id,
      nameById.get(Number(row.athlete_id)),
      row.assessment_date,
      row.overall_score,
      stateLabel[String(row.state_level)] || row.state_level,
      row.endurance_score,
      row.power_score,
      row.technique_score,
      row.load_adaptation_score,
      row.recovery_score,
      row.competition_score,
      null,
      null,
      null,
      row.note,
    ])
  );
  const assessmentSheet = workbook.getWorksheet('竞技评估')!;
  const scoreRows = [...groupedTests.values()]
    .filter((group) => group.sheet === '竞技评估')
    .map((group) => group.values);
  scoreRows.forEach((values, index) => {
    assessmentSheet.getRow(stateRows.length + index + 4).values = values as ExcelJS.CellValue[];
  });
  return workbook;
}
