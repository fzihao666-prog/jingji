import { formatAthleteNumber } from '../../shared/athlete-number.ts';
import { normalizeProject } from '../../shared/projects.ts';
import ExcelJS from 'exceljs';
import { fmsInputFields, type FmsObservation } from '../../shared/fms-import.ts';
import { ATHLETE_PROFILE_SHEET, BASIC_DOWNLOAD_SHEETS, BASIC_SCREENING_SHEET, BASIC_TEST_SHEET, buildBasicProfileWorkbook } from './basic-profile-workbook.ts';
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
  const numberColumn = sheet.getRow(3).values as ExcelJS.CellValue[];
  const numberIndex = numberColumn.indexOf('系统运动员编号') - 1;
  rows.forEach((values, index) => {
    const row = [...values] as ExcelJS.CellValue[];
    if (numberIndex >= 0 && typeof row[numberIndex] === 'number')
      row[numberIndex] = formatAthleteNumber(Number(row[numberIndex]));
    sheet.getRow(index + 4).values = row;
  });
}

export async function buildUnifiedDataExport(project: string, athleteIds: number[]) {
  const projectCode = normalizeProject(project);
  const workbook = buildImportWorkbook(undefined, { mode: 'export' });
  if (!athleteIds.length) return workbook;
  const placeholders = athleteIds.map(() => '?').join(',');
  const profileRows = db
    .prepare(
      `
    SELECT a.id, a.name, a.project, COALESCE(pt.name, '') AS team, a.gender, a.birth_date, COALESCE(ao.province, '未设置') AS region, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county,
      ap.ethnicity, ap.phone, ap.blood_type, ap.emergency_contact, ap.emergency_phone,
      ap.education, ap.technical_level, ap.position, ap.health_status, ap.best_result, ap.native_place,
      ap.home_address, ap.athlete_status, ap.start_sport_date, ap.training_venue, ap.current_event,
      ap.training_phase, ap.camp_period, ap.origin_place, ap.origin_unit, ap.origin_coach, ap.specialties, ap.notes,
      ap.event_item, ap.representative_unit, ap.training_years, ap.best_result_event, ap.best_result_date
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
      row.event_item,
      row.representative_unit,
      row.training_years,
      row.best_result_event,
      row.best_result_date,
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
      row.note,
    ])
  );
  const sessionRows = db
    .prepare(
      `SELECT ts.*, (SELECT value_num FROM training_session_metrics WHERE training_session_id=ts.id AND metric_code='cadenceRpm') AS cadence_rpm, EXISTS (SELECT 1 FROM strength_result_sets srs WHERE srs.training_session_id = ts.id) AS has_strength_sets FROM training_sessions ts WHERE athlete_id IN (${ids}) AND (ts.project_code IS NULL OR ts.project_code=?) ORDER BY session_date, athlete_id, session_order`
    )
    .all(...profileIds, projectCode) as Array<Record<string, unknown>>;
  writeUnifiedExportRows(
    workbook.getWorksheet('训练课次'),
    sessionRows
      .filter((row) => Number(row.duration_reported ?? 1) || Number(row.distance_reported ?? 1) || Number(row.has_strength_sets))
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
        row.activity_code, row.intensity_system, row.cadence_rpm,
        row.project_code, row.project_status,
      ])
  );
  const setRows = db
    .prepare(
      `SELECT srs.*, ts.project_code, ts.project_status, ts.athlete_id, ts.session_date, ts.session_order, ts.content FROM strength_result_sets srs JOIN training_sessions ts ON ts.id = srs.training_session_id WHERE ts.athlete_id IN (${ids}) AND (ts.project_code IS NULL OR ts.project_code=?) ORDER BY ts.session_date, ts.athlete_id, srs.id`
    )
    .all(...profileIds, projectCode) as Array<Record<string, unknown>>;
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
      row.session_order,
      row.exercise_code,
      row.planned_weight_kg,
      row.completed,
      row.training_environment,
      row.duration_min,
      row.distance_km,
      row.intensity_zone,
      row.project_code, row.project_status,
    ])
  );
  const testRows = db
    .prepare(
      `SELECT ts.id AS testSessionId, ts.athlete_id, ts.test_date, ts.test_type, ts.duration_min, ts.protocol, ts.protocol_version, ts.context_key, ts.attempt_order, ts.project_code, ts.project_status, tm.metric_code, tm.value_num, tm.target_value, tm.unit, tm.side, tm.note, md.label FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id LEFT JOIN metric_definitions md ON md.code = tm.metric_code WHERE ts.athlete_id IN (${ids}) AND (ts.project_code IS NULL OR ts.project_code=?) ORDER BY ts.test_date, ts.athlete_id, tm.id`
    )
    .all(...profileIds, projectCode) as Array<Record<string, unknown>>;
  // 专用表仅接收能完整还原原课次的记录，其余保留在其他测试，避免往返时改变事实归属。
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
    const originalCode = String(row.metric_code);
    const code = canonicalImportMetricCode(originalCode);
    const physical = BODY_TEMPLATE_FIELDS.find(([, , canonical]) => canonical === code);
    if (!row.project_status && !row.project_code && originalCode === code && physical?.[1] === 'armSpanCm' && row.test_type === '身体测量' && !row.protocol && !row.protocol_version && !row.context_key && Number(row.attempt_order || 1) === 1 && row.duration_min == null && row.target_value == null && !row.note && row.side === 'center' && String(row.unit || '') === physical[4]) {
      const column = bodyHeaders.indexOf(physical[0]);
      let target = bodyValues.find(
        (values) =>
          Number(values[0]) === Number(row.athlete_id) &&
          values[2] === row.test_date &&
          !values[bodyHeaders.indexOf('备注')] &&
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
      !physical && !row.protocol_version && !row.context_key && Number(row.attempt_order || 1) === 1 && !row.note && row.duration_min == null && row.target_value == null &&
      row.test_type === (fitness ? '体能测试' : fms ? 'FMS测试' : '竞技评估') &&
      (!fms || row.protocol === '功能动作筛查（FMS）') &&
      (!score || Boolean(row.protocol)) &&
      (!fitness || code !== 'asymmetry_index_pct' || Boolean(row.protocol)) &&
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
        values[headers.indexOf('事实项目')] = row.project_code;
        values[headers.indexOf('项目归属状态')] = row.project_status;
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
        originalCode,
        row.label || originalCode,
        row.value_num,
        row.unit,
        row.side,
        row.protocol,
        row.note || '',
        row.duration_min,
        row.target_value,
        row.protocol_version, row.context_key, row.attempt_order,
        row.project_code, row.project_status,
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


export function buildBasicDataExport(project: string, athleteIds: number[]) {
  const workbook = buildBasicProfileWorkbook([]);
  if (!athleteIds.length) return workbook;
  const ids = athleteIds.map(() => '?').join(',');
  const profiles = db.prepare(`SELECT a.id AS roster_id,a.name,a.birth_date,a.gender,a.project,ap.*,
    b.height_cm,b.weight_kg,b.measurement_date FROM athletes a
    LEFT JOIN athlete_profiles ap ON ap.athlete_id=a.id
    LEFT JOIN athlete_body_measurements b ON b.id=(SELECT id FROM athlete_body_measurements
      WHERE athlete_id=a.id AND (height_cm IS NOT NULL OR weight_kg IS NOT NULL)
      ORDER BY measurement_date DESC,id DESC LIMIT 1)
    WHERE a.active=1 AND a.project=? AND a.id IN (${ids}) ORDER BY a.name,a.id`).all(project, ...athleteIds);
  const names = new Map(profiles.map(row => [row.roster_id, String(row.name)]));
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`) : null;
  const write = (sheet: string, row: number, values: Record<string, ExcelJS.CellValue>) => {
    const headers = BASIC_DOWNLOAD_SHEETS.find(([name]) => name === sheet)![1];
    const target = workbook.getWorksheet(sheet)!.getRow(row);
    headers.forEach((header, index) => {
      if (Object.hasOwn(values, header)) target.getCell(index + 1).value = values[header];
    });
  };
  profiles.forEach((row, index) => {
    const notes = String(row.notes ?? '');
    write(ATHLETE_PROFILE_SHEET, index + 4, {
      姓名: String(row.name), 性别: String(row.gender ?? ''),
      出生年月: /^出生年月：(.+)$/m.exec(notes)?.[1] ?? String(row.birth_date ?? '').slice(0, 7),
      '身高（cm）': row.height_cm == null ? null : Number(row.height_cm),
      '体重（kg）': row.weight_kg == null ? null : Number(row.weight_kg),
      运动项目: String(row.project), 代表队伍: String(row.representative_unit ?? ''),
      '小项／场上位置': String(row.event_item || row.position || ''),
      技术等级: String(row.technical_level ?? ''), 最好成绩: String(row.best_result ?? ''),
      最好成绩对应赛事: String(row.best_result_event ?? ''), 成绩日期: date(row.best_result_date),
      备战赛事: String(row.current_event ?? ''), 当前训练限制: /^当前训练限制：(.+)$/m.exec(notes)?.[1] ?? '',
      身体测量日期: date(row.measurement_date),
    });
  });
  const tests = db.prepare(`SELECT s.athlete_id,s.test_date,m.metric_code,m.value_num,m.unit,m.note
    FROM test_measurements m JOIN test_sessions s ON s.id=m.test_session_id
    WHERE s.athlete_id IN (${ids}) AND (s.project_code=? OR s.project_code IS NULL)
      AND s.test_type<>'FMS测试' AND m.value_num IS NOT NULL
    ORDER BY s.test_date,s.id,m.id`).all(...athleteIds, project);
  let testRow = 4;
  for (const row of tests) {
    const name = names.get(row.athlete_id);
    if (!name) continue;
    write(BASIC_TEST_SHEET, testRow++, {
      姓名: name, 测试日期: date(row.test_date), 测试项目: String(row.metric_code),
      实测值: Number(row.value_num), 单位: String(row.unit ?? ''), '备注／未测原因': String(row.note ?? ''),
    });
  }
  const observations = db.prepare(`SELECT s.id,s.athlete_id,s.test_date,o.metric_code,o.observation_json
    FROM fms_import_observations o JOIN test_sessions s ON s.id=o.test_session_id
    WHERE s.athlete_id IN (${ids}) AND (s.project_code=? OR s.project_code IS NULL)
    ORDER BY s.test_date,s.id`).all(...athleteIds, project);
  const screening = new Map<unknown, Record<string, ExcelJS.CellValue>>();
  for (const row of observations) {
    const name = names.get(row.athlete_id);
    const metricIndex = FMS_TEMPLATE_METRICS.findIndex(([, code]) => code === row.metric_code);
    if (!name || metricIndex < 0) continue;
    const label = ['深蹲', '跨栏步', '直线弓步', '肩灵活性', '主动直腿抬高', '躯干稳定俯卧撑', '旋转稳定'][metricIndex];
    const values = screening.get(row.id) ?? { 姓名: name, 筛查日期: date(row.test_date) };
    const observation = JSON.parse(String(row.observation_json)) as FmsObservation;
    for (const { key, header } of fmsInputFields(String(row.metric_code), label)) {
      const target = header.replace(/（(左|右)）$/, ' $1').replace(/（(左|右)侧疼痛排查）$/, ' $1筛查').replace(/（疼痛排查）$/, ' 筛查');
      const value = observation[key];
      values[target] = value === '阳性' ? '有痛' : value === '阴性' ? '无痛' : value ?? null;
    }
    screening.set(row.id, values);
  }
  [...screening.values()].forEach((row, index) => write(BASIC_SCREENING_SHEET, index + 4, row));
  return workbook;
}
