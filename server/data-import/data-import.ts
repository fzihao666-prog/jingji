import { resolveImportMetricName } from '../../shared/import-metric-choice.ts';
import { readImportMetricDefinitions } from './import-metric-catalog.ts';
import { IMPORT_TEMPLATE_VERSION, IMPORT_TEMPLATE_VERSION_NAME, templateHeaderKey } from '../../shared/import-template-fields.ts';
import { TECHNICAL_LEVELS, normalizeTechnicalLevel } from '../../shared/athlete-technical-level.ts';
import { importRecordPolicy, importReviewValuesEqual, reviewFields, reviewValues, writeReviewValues, databaseReviewRecords, reviewMetricKey, importReviewGroups, reviewTitle, type ReviewValue, importReviewKey, importFieldValues } from '../../shared/import-conflict-review.ts';
import { BODY_TEMPLATE_FIELDS, FITNESS_TEMPLATE_METRICS, EVALUATION_SCORE_METRICS, FMS_TEMPLATE_METRICS, IMPORT_SHEET_ALIASES, UNIFIED_IMPORT_HEADERS, canonicalImportMetricCode } from '../../shared/data-import-template.ts';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from '@e965/xlsx';
import { db } from '../core/db.ts';
import { dataImportPersonKey, normalizeImportPersonName } from '../../shared/data-import-person.ts';
import { normalizeImportFilename } from './import-filename.ts';
import { validateRegistrationDemographics } from '../../shared/registration-demographics.ts';
import {
  inferStrengthBodyPosition,
  inferStrengthCategory,
  isStrengthIntensityZone,
  isStrengthTrainingEnvironment,
} from '../../shared/strength-training.ts';

// v29：中文测试项目按当前项目字典解析；旧草稿需重解析。
export const DATA_IMPORT_PARSER_VERSION = 'deterministic-v29-chinese-test-names';

export type ImportAthlete = {
  id: number;
  name: string;
  project: string;
  team: string;
  gender: string;
  birthDate?: string;
  active?: boolean;
};

export type DataImportItemType =
  | 'athlete_profile'
  | 'wellness'
  | 'training_session'
  | 'training_set'
  | 'test_measurement'
  | 'body_measurement'
  | 'injury_record'
  | 'competitive_state'
  | 'scoring_rule'
  | 'invalid_row';
export type DataImportQuality = 'valid' | 'warning' | 'error' | 'skipped';
export type DataImportResolution = '' | 'skip' | 'update';

export type DataImportConflictField = {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
  /** 现值非空且与新值不同，提交时自动按本次导入更新 */
  overwrites: boolean;
};

export type DataImportConflict = {
  /** 业务键上已存在正式记录 */
  exists: boolean;
  entityType: string;
  entityId: number | null;
  /** 提供的字段与现值一致，无需写入 */
  identical: boolean;
  fields: DataImportConflictField[];
};

export type ParsedImportItem = {
  itemType: DataImportItemType;
  athleteId: number | null;
  rawAthleteName: string;
  eventDate: string;
  sessionLabel: string;
  testType: string;
  metricCode: string;
  metricLabel: string;
  side: 'left' | 'right' | 'bilateral' | 'center';
  valueNum: number | null;
  unit: string;
  exerciseName: string;
  setIndex: number;
  targetReps: number | null;
  actualReps: number | null;
  actualWeightKg: number | null;
  intensityPercent: number | null;
  payload: Record<string, unknown>;
  sourceSheet: string;
  sourceAddress: string;
  rawValue: string;
  quality: DataImportQuality;
  messages: string[];
  businessKey: string;
  resolution: DataImportResolution;
  conflict: DataImportConflict | null;
};

export type DataImportPreview = {
  id: string;
  filename: string;
  project: string;
  status: 'reviewing' | 'committed' | 'failed' | 'rolled_back';
  parserVersion: string;
  sheetCount: number;
  itemCount: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  importedCount: number;
  skippedCount: number;
  createdAt: string;
  committedAt: string | null;
  summary: {
    recognizedSheets: Array<{ name: string; type: string; items: number; note: string }>;
    ignoredSheets: Array<{ name: string; reason: string }>;
    duplicateFile?: boolean;
  };
  counts: {
    newCount: number;
    duplicateCount: number;
    overwriteCount: number;
    invalidCount: number;
    personMatched: number;
    personPending: number;
    personAmbiguous: number;
  };
  athleteCandidates: DataImportAthleteCandidate[];
  items: DataImportItemView[];
};

export type DataImportPersonSuggestion = {
  id: number;
  name: string;
  team: string;
  gender: string;
  birthDate: string;
};

export type DataImportAthleteCandidateStatus = 'pending' | 'matched' | 'created';

export type DataImportAthleteCandidate = {
  id: number;
  batchId: string;
  normalizedName: string;
  name: string;
  project: string;
  team: string;
  gender: string;
  region: string;
  city: string;
  county: string;
  status: DataImportAthleteCandidateStatus;
  matchedAthleteId: number | null;
  createdAthleteId: number | null;
  /** 身份歧义时的候选已有运动员，供人工选择 */
  suggested: DataImportPersonSuggestion[];
  /** 人员确认弹窗中已确认（仅保存映射草稿，不写正式表） */
  confirmed: boolean;
  /** 已移除：该人员及其关联业务记录不导入 */
  excluded: boolean;
  sourceSheet: string;
  messages: string[];
};

export type DataImportItemView = Omit<ParsedImportItem, 'payload'> & {
  id: number;
  batchId: string;
  payload: Record<string, unknown>;
  athleteName: string;
  athleteProject: string;
  athleteTeam: string;
  committedEntityType: string;
  committedEntityId: number | null;
};

type Matrix = unknown[][];

const METRICS = {
  height_cm: { label: '身高', unit: 'cm', domain: 'morphology', min: 100, max: 230 },
  weight_kg: { label: '体重', unit: 'kg', domain: 'morphology', min: 30, max: 200 },
  training_years: { label: '训练年限', unit: '年', domain: 'morphology', min: 0, max: 50 },
  arm_span_cm: { label: '臂展', unit: 'cm', domain: 'morphology', min: 100, max: 250 },
  sit_reach_cm: { label: '坐位体前屈', unit: 'cm', domain: 'flexibility', min: -30, max: 60 },
  supine_support_sec: { label: '仰卧支撑', unit: '秒', domain: 'core', min: 0, max: 900 },
  front_plank_sec: { label: '俯卧支撑', unit: '秒', domain: 'core', min: 0, max: 900 },
  side_plank_sec: { label: '侧支撑', unit: '秒', domain: 'core', min: 0, max: 900 },
  single_leg_squat_reps: {
    label: '单腿蹲',
    unit: '次',
    domain: 'strength_endurance',
    min: 0,
    max: 100,
  },
  pull_ups_reps: { label: '引体向上', unit: '次', domain: 'strength_endurance', min: 0, max: 100 },
  squat_kg: { label: '深蹲', unit: 'kg', domain: 'strength', min: 0, max: 450 },
  deadlift_kg: { label: '硬拉', unit: 'kg', domain: 'strength', min: 0, max: 500 },
  hip_thrust_kg: { label: '臀推', unit: 'kg', domain: 'strength', min: 0, max: 600 },
  bench_press_kg: { label: '卧推', unit: 'kg', domain: 'strength', min: 0, max: 350 },
  bench_pull_kg: { label: '卧拉', unit: 'kg', domain: 'strength', min: 0, max: 350 },
  clean_kg: { label: '高翻', unit: 'kg', domain: 'explosive', min: 0, max: 300 },
  vertical_jump_cm: { label: '纵跳', unit: 'cm', domain: 'explosive', min: 0, max: 120 },
} as const;

type MetricCode = keyof typeof METRICS;

function text(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateToIso(value);
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizedText(value: unknown) {
  return text(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_()（）/\\\-·]/g, '');
}

function normalizedName(value: unknown) {
  return normalizeImportPersonName(text(value));
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(
    text(value)
      .replace(/,/g, '')
      .replace(/kg|cm|秒|次|年/gi, '')
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function dateToIso(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validIsoDate(value: string) {
  // 严格校验真实存在的日期：2025-02-30、1900-02-29 等均拒绝。
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function isProvided(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function optionalNumber(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : parsed;
}

type SqlValue = string | number | bigint | null | Uint8Array;

function sqlList(values: unknown[]): SqlValue[] {
  return values.map((value) =>
    value === null || value === undefined
      ? null
      : typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'bigint' ||
          value instanceof Uint8Array
        ? value
        : String(value)
  );
}

function workbookYear(filename: string) {
  const matches = [...filename.matchAll(/(20\d{2})/g)].map((match) => Number(match[1]));
  return matches.find((year) => year >= 2000 && year <= 2100) || new Date().getFullYear();
}

function parseDate(value: unknown, yearHint: number): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateToIso(value);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed)
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = text(value).replace(/年|\//g, '-').replace(/月|\./g, '-').replace(/日/g, '');
  let match = raw.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (match) return `${yearHint}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return '';
}

export function parseImportBirthDate(
  value: unknown,
  today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
): string {
  let candidate = '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    candidate = dateToIso(value);
  } else if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      candidate = `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  } else {
    const normalized = text(value).replace(/年|\//g, '-').replace(/月|\./g, '-').replace(/日/g, '');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) candidate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  return validateRegistrationDemographics({ gender: '男', birthDate: candidate }, today).birthDate
    ? ''
    : candidate;
}

function dateFromName(value: string, yearHint: number) {
  const compact = value.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const chinese = value.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (chinese) return `${chinese[1]}-${chinese[2].padStart(2, '0')}-${chinese[3].padStart(2, '0')}`;
  const short = value.match(/(\d{1,2})月(\d{1,2})日/);
  if (short) return `${yearHint}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
  return '';
}

function cellAddress(row: number, column: number) {
  return XLSX.utils.encode_cell({ r: row, c: column });
}

/**
 * 别名匹配限定在调用方传入的可访问运动员集合内。
 * 别名表查询只用于发现候选 id，最终结果必须落在 athletes 参数（accessibleAthleteIds 派生）里，
 * 防止通过别名把导入数据自动关联到当前账号权限范围外的运动员。
 */
function athletesByAlias(
  normalized: string,
  project: string,
  athletes: ImportAthlete[]
): ImportAthlete[] {
  const rows = db
    .prepare(
      `SELECT aa.athlete_id AS id FROM athlete_aliases aa JOIN athletes a ON a.id = aa.athlete_id
       WHERE aa.normalized_alias = ? AND aa.project = ? AND a.active = 1`
    )
    .all(normalized, project) as Array<{ id: number }>;
  const ids = new Set(rows.map((row) => row.id));
  return athletes.filter((athlete) => athlete.project === project && ids.has(athlete.id));
}

function matchAthlete(name: string, project: string, athletes: ImportAthlete[]) {
  // 解析期的粗匹配：仅在“项目 + 姓名”唯一时自动关联；
  // 队伍冲突、同名多人等情况留给人员确认阶段的 resolvePerson 处理。
  const normalized = normalizedName(name);
  const direct = athletes.filter(
    (athlete) => athlete.project === project && normalizedName(athlete.name) === normalized
  );
  if (direct.length === 1) return direct[0];
  const alias = athletesByAlias(normalized, project, athletes);
  return alias.length === 1 ? alias[0] : null;
}

export type PersonResolution =
  | { kind: 'matched'; athlete: ImportAthlete; method: string }
  | { kind: 'ambiguous'; suggested: DataImportPersonSuggestion[]; message: string }
  | { kind: 'conflict'; suggested: DataImportPersonSuggestion[]; message: string }
  | { kind: 'none' };

function toSuggestion(athlete: ImportAthlete & { birthDate?: string }): DataImportPersonSuggestion {
  return {
    id: athlete.id,
    name: athlete.name,
    team: athlete.team,
    gender: text(athlete.gender),
    birthDate: athlete.birthDate || '',
  };
}

/**
 * 人员识别与匹配（SPEC 四）：
 * 1. 系统运动员编号精确匹配（与姓名冲突时不忽略冲突，转人工确认）；
 * 2. 项目 + 队伍 + 姓名；
 * 3. 出生日期辅助消歧；
 * 4. 仍不唯一则人工确认；不使用身份证号，不跨项目、跨队伍仅凭姓名合并。
 */
function resolvePerson(
  hint: {
    name: string;
    project: string;
    team?: string;
    birthDate?: string;
    athleteCode?: string;
  },
  athletes: ImportAthlete[]
): PersonResolution {
  const normalized = normalizedName(hint.name);
  const code = text(hint.athleteCode);
  if (code) {
    const byCode = athletes.find((athlete) => String(athlete.id) === code);
    if (byCode && byCode.project === hint.project) {
      if (!normalized || normalizedName(byCode.name) === normalized)
        return { kind: 'matched', athlete: byCode, method: '运动员编号' };
      return {
        kind: 'conflict',
        suggested: [toSuggestion(byCode)],
        message: `系统运动员编号${code}对应“${byCode.name}”，与文件姓名“${hint.name}”不一致，请人工确认`,
      };
    }
    if (byCode)
      return {
        kind: 'conflict',
        suggested: [toSuggestion(byCode)],
        message: `系统运动员编号${code}属于其他运动项目，请人工确认`,
      };
    return {
      kind: 'conflict',
      suggested: athletes.filter(athlete => athlete.project === hint.project && normalizedName(athlete.name) === normalized).map(toSuggestion),
      message: `系统运动员编号${code}不存在或不在当前权限范围内，请人工确认`,
    };
  }
  const pool = athletes.filter(
    (athlete) =>
      athlete.project === hint.project && normalizedName(athlete.name) === normalized
  );
  const team = text(hint.team);
  const withBirth = (list: ImportAthlete[]) =>
    hint.birthDate && validIsoDate(hint.birthDate)
      ? list.filter((athlete) => athlete.birthDate && athlete.birthDate === hint.birthDate)
      : list;
  if (team) {
    const sameTeam = pool.filter((athlete) => text(athlete.team) === team);
    if (sameTeam.length === 1) return { kind: 'matched', athlete: sameTeam[0], method: '项目+队伍+姓名' };
    if (sameTeam.length > 1) {
      const narrowed = withBirth(sameTeam);
      if (narrowed.length === 1)
        return { kind: 'matched', athlete: narrowed[0], method: '出生日期消歧' };
      return {
        kind: 'ambiguous',
        suggested: sameTeam.map(toSuggestion),
        message: `“${hint.name}”（${team}）匹配到多名已有运动员，请选择要关联的人员`,
      };
    }
    if (pool.length)
      return {
        kind: 'conflict',
        suggested: pool.map(toSuggestion),
        message: `文件中“${hint.name}”填写的所属队伍“${team}”与已有同名运动员不一致，请确认关联人员或新建档案`,
      };
    return { kind: 'none' };
  }
  if (pool.length === 1) return { kind: 'matched', athlete: pool[0], method: '项目+姓名' };
  if (pool.length > 1) {
    const narrowed = withBirth(pool);
    if (narrowed.length === 1) return { kind: 'matched', athlete: narrowed[0], method: '出生日期消歧' };
    return {
      kind: 'ambiguous',
      suggested: pool.map(toSuggestion),
      message: `“${hint.name}”匹配到多名已有运动员（请结合队伍或出生日期选择）`,
    };
  }
  const alias = athletesByAlias(normalized, hint.project, athletes);
  if (alias.length === 1) return { kind: 'matched', athlete: alias[0], method: '历史别名' };
  if (alias.length > 1)
    return {
      kind: 'ambiguous',
      suggested: alias.map(toSuggestion),
      message: `“${hint.name}”的别名匹配到多名已有运动员，请选择要关联的人员`,
    };
  return { kind: 'none' };
}

function metricFromLabel(value: unknown): MetricCode | null {
  const label = normalizedText(value);
  if (!label || /差值|评分|序号|备注|完成/.test(label)) return null;
  if (/训练年限|年限/.test(label)) return 'training_years';
  if (/身高|height/.test(label)) return 'height_cm';
  if (/体重|weight/.test(label)) return 'weight_kg';
  if (/臂展/.test(label)) return 'arm_span_cm';
  if (/体前屈/.test(label)) return 'sit_reach_cm';
  if (/仰卧支撑/.test(label)) return 'supine_support_sec';
  if (/俯卧支撑|前平板支撑/.test(label)) return 'front_plank_sec';
  if (/侧支撑/.test(label)) return 'side_plank_sec';
  if (/单腿蹲/.test(label)) return 'single_leg_squat_reps';
  if (/引体/.test(label)) return 'pull_ups_reps';
  if (/深蹲|squat/.test(label)) return 'squat_kg';
  if (/硬拉/.test(label)) return 'deadlift_kg';
  if (/臀推/.test(label)) return 'hip_thrust_kg';
  if (/卧推/.test(label)) return 'bench_press_kg';
  if (/卧拉/.test(label)) return 'bench_pull_kg';
  if (/高翻|高拉/.test(label)) return 'clean_kg';
  if (/纵跳|垂直跳/.test(label)) return 'vertical_jump_cm';
  return null;
}

function makeQuality(messages: string[], skipped = false): DataImportQuality {
  if (skipped) return 'skipped';
  if (messages.some((message) => message.startsWith('错误：'))) return 'error';
  return messages.length ? 'warning' : 'valid';
}

function validateMetric(code: MetricCode, value: number, messages: string[]) {
  const metric = METRICS[code];
  if (value < metric.min || value > metric.max)
    messages.push(
      `警告：${metric.label}${value}${metric.unit}超出建议复核范围${metric.min}—${metric.max}${metric.unit}`
    );
}

function itemBase(
  input: Partial<ParsedImportItem> &
    Pick<ParsedImportItem, 'itemType' | 'sourceSheet' | 'sourceAddress'>
): ParsedImportItem {
  return {
    itemType: input.itemType,
    athleteId: input.athleteId ?? null,
    rawAthleteName: input.rawAthleteName || '',
    eventDate: input.eventDate || '',
    sessionLabel: input.sessionLabel || '',
    testType: input.testType || '',
    metricCode: input.metricCode || '',
    metricLabel: input.metricLabel || '',
    side: input.side || 'center',
    valueNum: input.valueNum ?? null,
    unit: input.unit || '',
    exerciseName: input.exerciseName || '',
    setIndex: input.setIndex || 1,
    targetReps: input.targetReps ?? null,
    actualReps: input.actualReps ?? null,
    actualWeightKg: input.actualWeightKg ?? null,
    intensityPercent: input.intensityPercent ?? null,
    payload: input.payload || {},
    sourceSheet: input.sourceSheet,
    sourceAddress: input.sourceAddress,
    rawValue: input.rawValue || '',
    quality: input.quality || 'valid',
    messages: input.messages || [],
    businessKey: input.businessKey || '',
    resolution: input.resolution || '',
    conflict: input.conflict ?? null,
  };
}

function testItem(input: {
  athlete: ImportAthlete | null;
  rawName: string;
  date: string;
  code: MetricCode;
  side?: ParsedImportItem['side'];
  value: number;
  sheet: string;
  address: string;
  messages?: string[];
}) {
  const metric = METRICS[input.code];
  const messages = [...(input.messages || [])];
  if (!input.athlete) messages.push('警告：未匹配到已有运动员，提交时将创建无登录账号的待补全档案');
  if (!validIsoDate(input.date)) messages.push('错误：缺少有效测试日期，请在预览中补充');
  validateMetric(input.code, input.value, messages);
  const body = input.code === 'height_cm' || input.code === 'weight_kg';
  const side = input.side || 'center';
  return itemBase({
    itemType: body ? 'body_measurement' : 'test_measurement',
    athleteId: input.athlete?.id || null,
    rawAthleteName: input.rawName,
    eventDate: input.date,
    testType: '力量素质测试',
    metricCode: input.code,
    metricLabel: metric.label,
    side,
    valueNum: input.value,
    unit: metric.unit,
    sourceSheet: input.sheet,
    sourceAddress: input.address,
    rawValue: String(input.value),
    quality: makeQuality(messages),
    messages,
    businessKey: `${input.athlete?.id || 0}|${input.date}|strength-test|${input.code}|${side}`,
  });
}

function parseSummarySheet(
  matrix: Matrix,
  sheet: string,
  project: string,
  filename: string,
  defaultDate: string,
  athletes: ImportAthlete[]
) {
  const items: ParsedImportItem[] = [];
  const year = workbookYear(filename);
  const date = defaultDate || dateFromName(filename, year);
  const mapping: Array<[number, MetricCode, ParsedImportItem['side']?]> = [
    [4, 'height_cm'],
    [5, 'weight_kg'],
    [6, 'arm_span_cm'],
    [7, 'sit_reach_cm'],
    [8, 'supine_support_sec'],
    [9, 'front_plank_sec'],
    [10, 'side_plank_sec', 'left'],
    [11, 'side_plank_sec', 'right'],
    [12, 'single_leg_squat_reps', 'left'],
    [13, 'single_leg_squat_reps', 'right'],
    [14, 'pull_ups_reps'],
    [15, 'squat_kg'],
    [16, 'deadlift_kg'],
    [17, 'hip_thrust_kg'],
    [18, 'bench_press_kg'],
    [19, 'bench_pull_kg'],
    [20, 'clean_kg'],
    [21, 'vertical_jump_cm'],
  ];
  for (let row = 4; row < matrix.length; row += 1) {
    const rawName = text(matrix[row]?.[1]);
    if (!rawName || /平均|合计|备注/.test(rawName)) continue;
    const athlete = matchAthlete(rawName, project, athletes);
    for (const [column, code, side] of mapping) {
      const value = numberValue(matrix[row]?.[column]);
      if (value === null) continue;
      items.push(
        testItem({
          athlete,
          rawName,
          date,
          code,
          side,
          value,
          sheet,
          address: cellAddress(row, column),
        })
      );
    }
  }
  return items;
}

function headerDate(matrix: Matrix, column: number, year: number, fallback: string) {
  for (let row = 1; row <= 4; row += 1) {
    const parsed = parseDate(matrix[row]?.[column], year);
    if (parsed) return parsed;
  }
  return fallback;
}

function parseComparisonSheet(
  matrix: Matrix,
  sheet: string,
  project: string,
  filename: string,
  defaultDate: string,
  athletes: ImportAthlete[]
) {
  const items: ParsedImportItem[] = [];
  const year = workbookYear(filename);
  let identityRow = matrix
    .slice(0, 6)
    .findIndex((row) => row?.some((value) => normalizedText(value) === '姓名'));
  let nameColumn =
    identityRow >= 0
      ? matrix[identityRow].findIndex((value) => normalizedText(value) === '姓名')
      : -1;
  if (identityRow < 0 && (sheet === '女子' || sheet === '男子')) {
    identityRow = 2;
    nameColumn = 1;
  }
  if (identityRow < 0 || nameColumn < 0) return items;
  const startRow = identityRow + 2;
  const currentDates: string[] = [];
  for (let row = 1; row <= 4; row += 1) {
    for (const value of matrix[row] || []) {
      const parsed = parseDate(value, year);
      if (parsed) currentDates.push(parsed);
    }
  }
  const inferredCurrentDate =
    defaultDate || [...currentDates].sort().at(-1) || dateFromName(filename, year);
  const columnMetrics = new Map<number, MetricCode>();
  let activeMetric: MetricCode | null = null;
  const maxColumns = Math.max(...matrix.slice(0, 5).map((row) => row?.length || 0), 0);
  for (let column = 0; column < maxColumns; column += 1) {
    const tokens = [matrix[1]?.[column], matrix[2]?.[column], matrix[3]?.[column]];
    if (tokens.some((value) => /差值/.test(text(value)))) {
      activeMetric = null;
      continue;
    }
    const explicit = tokens.map(metricFromLabel).find(Boolean) as MetricCode | undefined;
    if (explicit) activeMetric = explicit;
    if (activeMetric) columnMetrics.set(column, activeMetric);
  }
  for (let row = startRow; row < matrix.length; row += 1) {
    const rawName = text(matrix[row]?.[nameColumn]);
    if (!rawName || /平均|合计|备注|评分/.test(rawName)) continue;
    const athlete = matchAthlete(rawName, project, athletes);
    for (const [column, code] of columnMetrics) {
      if (column <= nameColumn + 4) continue;
      const value = numberValue(matrix[row]?.[column]);
      if (value === null) continue;
      const labelTokens = [matrix[1]?.[column], matrix[2]?.[column], matrix[3]?.[column]]
        .map(text)
        .join('|');
      if (/差值/.test(labelTokens)) continue;
      let side: ParsedImportItem['side'] = 'center';
      const sideToken = normalizedText(matrix[2]?.[column]) + normalizedText(matrix[3]?.[column]);
      if (sideToken.includes('左')) side = 'left';
      else if (sideToken.includes('右')) side = 'right';
      const date = headerDate(matrix, column, year, inferredCurrentDate);
      items.push(
        testItem({
          athlete,
          rawName,
          date,
          code,
          side,
          value,
          sheet,
          address: cellAddress(row, column),
        })
      );
    }
  }
  return items;
}

function parseIntensity(value: unknown, index: number) {
  const values =
    text(value)
      .match(/\d+(?:\.\d+)?/g)
      ?.map(Number) || [];
  return values[index] ?? values[0] ?? null;
}

function parseTrainingBlocks(
  matrix: Matrix,
  sheet: string,
  project: string,
  filename: string,
  athletes: ImportAthlete[]
) {
  const items: ParsedImportItem[] = [];
  const year = workbookYear(filename);
  const sheetDate = dateFromName(sheet, year);
  const anchors: Array<{ row: number; column: number }> = [];
  for (let row = 0; row < Math.min(8, matrix.length); row += 1) {
    for (let column = 0; column < (matrix[row]?.length || 0); column += 1) {
      if (normalizedText(matrix[row]?.[column]) === '姓名') anchors.push({ row, column });
    }
  }
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const next = anchors[anchorIndex + 1];
    const blockEnd =
      next && next.row === anchor.row
        ? next.column
        : matrix[anchor.row]?.length || anchor.column + 14;
    const rawName = text(
      matrix[anchor.row]?.slice(anchor.column + 1, blockEnd).find((value) => {
        const normalized = normalizedText(value);
        return normalized && normalized !== '性别' && normalized !== '男' && normalized !== '女';
      })
    );
    if (!rawName) continue;
    const athlete = matchAthlete(rawName, project, athletes);
    const dateValues = (matrix[anchor.row + 2] || []).slice(
      anchor.column,
      Math.min(blockEnd, anchor.column + 4)
    );
    const internalDate = dateValues.map((value) => parseDate(value, year)).find(Boolean) || '';
    const eventDate = internalDate || sheetDate;
    const dateConflict = Boolean(internalDate && sheetDate && internalDate !== sheetDate);
    const headerRow = anchor.row + 3;
    for (let row = headerRow + 1; row < matrix.length; row += 1) {
      const exerciseName = text(matrix[row]?.[anchor.column + 2]);
      if (!exerciseName) {
        if (row > headerRow + 16) break;
        continue;
      }
      if (/总负荷|完成率|小计|合计|备注|姓名|动作/.test(exerciseName)) break;
      const plannedReps = [5, 6, 7].map((offset) =>
        numberValue(matrix[row]?.[anchor.column + offset])
      );
      const weights = [9, 10, 11].map((offset) =>
        numberValue(matrix[row]?.[anchor.column + offset])
      );
      const completedTotal = numberValue(matrix[row]?.[anchor.column + 12]);
      const available = weights
        .map((weight, index) => ({ weight, index }))
        .filter((entry) => entry.weight !== null);
      if (!available.length) {
        const messages = ['未记录完成重量，本行保留在暂存区但不会写入正式训练结果'];
        if (!athlete)
          messages.unshift('警告：未匹配到已有运动员，提交时将创建无登录账号的待补全档案');
        items.push(
          itemBase({
            itemType: 'training_set',
            athleteId: athlete?.id || null,
            rawAthleteName: rawName,
            eventDate,
            sessionLabel: sheet,
            exerciseName,
            setIndex: 1,
            targetReps: plannedReps[0],
            sourceSheet: sheet,
            sourceAddress: cellAddress(row, anchor.column + 2),
            rawValue: exerciseName,
            quality: makeQuality(messages, true),
            messages,
            payload: { completedTotal, sourcePattern: 'athlete-block' },
          })
        );
        continue;
      }
      const expectedTotal = plannedReps.reduce<number>((sum, value) => sum + (value || 0), 0);
      for (const { weight, index } of available) {
        const messages: string[] = [];
        if (!athlete) messages.push('警告：未匹配到已有运动员，提交时将创建无登录账号的待补全档案');
        if (!validIsoDate(eventDate)) messages.push('错误：缺少有效训练日期，请在预览中补充');
        if (dateConflict)
          messages.push(
            `警告：工作表名称日期${sheetDate}与单元格日期${internalDate}不一致，当前采用单元格日期`
          );
        if (completedTotal === null)
          messages.push('警告：未逐组记录完成次数，暂按计划次数作为实际次数');
        else if (expectedTotal && Math.abs(completedTotal - expectedTotal) > 0.01)
          messages.push(`警告：完成总次数${completedTotal}与计划次数合计${expectedTotal}不一致`);
        if ((weight || 0) <= 2) messages.push(`警告：完成重量${weight}kg疑似勾选值，请人工复核`);
        const targetReps = plannedReps[index] ?? null;
        const actualReps = targetReps;
        const intensityPercent = parseIntensity(matrix[row]?.[anchor.column + 3], index);
        const sourceAddress = cellAddress(row, anchor.column + 9 + index);
        items.push(
          itemBase({
            itemType: 'training_set',
            athleteId: athlete?.id || null,
            rawAthleteName: rawName,
            eventDate,
            sessionLabel: sheet,
            exerciseName,
            setIndex: index + 1,
            targetReps,
            actualReps,
            actualWeightKg: weight,
            intensityPercent,
            payload: {
              completedTotal,
              sourcePattern: 'athlete-block',
              trainingCategory: inferStrengthCategory(exerciseName),
              bodyPosition: inferStrengthBodyPosition(exerciseName),
            },
            sourceSheet: sheet,
            sourceAddress,
            rawValue: String(weight),
            quality: makeQuality(messages),
            messages,
            businessKey: `${athlete?.id || 0}|${eventDate}|${sheet}|${exerciseName}|${index + 1}`,
          })
        );
      }
    }
  }
  return items;
}

function parseScoringSheet(matrix: Matrix, sheet: string, project: string, batchVersion: string) {
  const items: ParsedImportItem[] = [];
  const headerRow = matrix.findIndex((row) =>
    row?.some((value) => normalizedText(value) === '评分')
  );
  if (headerRow < 0) return items;
  const genderRow = headerRow + 1;
  let activeMetric: MetricCode | null = null;
  for (let column = 1; column < (matrix[headerRow]?.length || 0); column += 1) {
    const explicit = metricFromLabel(matrix[headerRow]?.[column]);
    if (explicit) activeMetric = explicit;
    if (!activeMetric) continue;
    const gender = text(matrix[genderRow]?.[column]);
    if (gender !== '男' && gender !== '女') continue;
    for (let row = genderRow + 1; row < matrix.length; row += 1) {
      const score = numberValue(matrix[row]?.[0]);
      const threshold = numberValue(matrix[row]?.[column]);
      if (score === null || threshold === null) continue;
      const metric = METRICS[activeMetric];
      items.push(
        itemBase({
          itemType: 'scoring_rule',
          metricCode: activeMetric,
          metricLabel: metric.label,
          valueNum: threshold,
          unit: metric.unit,
          payload: { project, gender, score, comparison: 'gte', ruleVersion: batchVersion },
          sourceSheet: sheet,
          sourceAddress: cellAddress(row, column),
          rawValue: String(threshold),
          quality: 'valid',
          businessKey: `${project}|${gender}|${activeMetric}|${score}|${batchVersion}`,
        })
      );
    }
  }
  return items;
}

const STANDARD_SHEETS = new Set([
  ...UNIFIED_IMPORT_HEADERS.map(([name]) => name),
  '运动员信息',
  '竞技水平评估',
  '身体测量',
  '恢复状态',
  '训练课次',
  '力量训练组次',
  '测试指标',
  'FMS测试',
  '冠军模型测试',
  '伤病记录',
  '竞技状态',
]);

function standardHeader(matrix: Matrix) {
  const rowIndex = matrix
    .slice(0, 12)
    .findIndex((row) => row?.some((value) => ['姓名', '系统运动员编号'].includes(normalizedText(templateHeaderKey(String(value ?? ''))))));
  if (rowIndex < 0) return null;
  const columns = new Map<string, number>();
  for (let column = 0; column < (matrix[rowIndex]?.length || 0); column += 1) {
    const key = normalizedText(templateHeaderKey(String(matrix[rowIndex]?.[column] ?? '')));
    if (key) columns.set(key, column);
  }
  return { rowIndex, columns };
}

function standardValue(row: unknown[], columns: Map<string, number>, ...labels: string[]) {
  for (const label of labels) {
    const column = columns.get(normalizedText(label));
    if (column !== undefined) return row[column];
  }
  return null;
}

function standardText(row: unknown[], columns: Map<string, number>, ...labels: string[]) {
  return text(standardValue(row, columns, ...labels));
}

/** 标准模板与校对共用：空白保持缺失，非数字文本不得当作数值。 */
function standardNumberValue(value: unknown): number | null {
  if (text(value) === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' ||
    !/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text(value)))
    return null;
  return numberValue(value);
}

/** 非空非法日期保留原文供校对；默认日期仅用于真正空白的单元格。 */
function parseStandardDate(value: unknown, year: number): string {
  const raw = text(value);
  if (typeof value === 'string') {
    const normalized = raw.replace(/年|\//g, '-').replace(/月|\./g, '-').replace(/日/g, '');
    if (!/^(?:\d{4}-)?\d{1,2}-\d{1,2}$/.test(normalized)) return raw;
  }
  const parsed = parseDate(value, year);
  return validIsoDate(parsed) ? parsed : raw;
}

/** 模板枚举可读中文、数据库存规范代码；解析期即归一，冲突比较、校对与入库共用同一口径。 */
const WELLNESS_STATUS_CODES: Record<string, string> = { 正常: 'normal', 休息: 'rest', 关注: 'attention', 警报: 'alert', 缺失: 'missing' };
const TEST_SIDE_CODES: Record<string, string> = {
  左: 'left', 右: 'right', 双侧: 'bilateral', 中央: 'center',
};
const INJURY_SIDE_CODES: Record<string, string> = { 未指定: 'unspecified', ...TEST_SIDE_CODES };
const INJURY_STATUS_CODES: Record<string, string> = {
  健康: 'healthy',
  观察: 'observation',
  限训: 'restricted',
  康复: 'rehab',
  停训: 'suspended',
};
const STATE_LEVEL_CODES: Record<string, string> = {
  巅峰: 'peak',
  良好: 'good',
  建设: 'build',
  调整: 'adjust',
};
function canonicalCode(value: unknown, codes: Record<string, string>, fallback: string) {
  const raw = text(value);
  return Object.hasOwn(codes, raw) ? codes[raw] : raw || fallback;
}

function canonicalEnumField(itemType: string, field: string, value: ReviewValue): ReviewValue {
  if (itemType === 'wellness' && field === 'status') return canonicalCode(value, WELLNESS_STATUS_CODES, '');
  if (itemType === 'injury_record' && field === 'side') return canonicalCode(value, INJURY_SIDE_CODES, 'unspecified');
  if (itemType === 'injury_record' && field === 'status') return canonicalCode(value, INJURY_STATUS_CODES, 'observation');
  if (itemType === 'competitive_state' && field === 'stateLevel') return canonicalCode(value, STATE_LEVEL_CODES, '');
  return value;
}
function normalizeImportEnums(item: ParsedImportItem | DataImportItemView) {
  if (item.itemType === 'wellness') {
    item.payload.status = canonicalCode(item.payload.status, WELLNESS_STATUS_CODES, '');
  } else if (item.itemType === 'injury_record') {
    item.payload.side = canonicalCode(item.payload.side, INJURY_SIDE_CODES, 'unspecified');
    item.payload.status = canonicalCode(item.payload.status, INJURY_STATUS_CODES, 'observation');
  } else if (item.itemType === 'competitive_state') {
    item.payload.stateLevel = canonicalCode(item.payload.stateLevel, STATE_LEVEL_CODES, '');
  } else if (item.itemType === 'test_measurement') {
    item.side = canonicalCode(item.side, TEST_SIDE_CODES, 'center') as ParsedImportItem['side'];
  }
}

function parseStandardSheet(
  matrix: Matrix,
  rawSheet: string,
  project: string,
  filename: string,
  defaultDate: string,
  athletes: ImportAthlete[],
  simplified = false
) {
  const sheet = IMPORT_SHEET_ALIASES[rawSheet] || rawSheet;
  const header = standardHeader(matrix);
  if (!header) return [];
  const items: ParsedImportItem[] = [];
  const metricCatalog = sheet === '测试指标' ? readImportMetricDefinitions(project) : [];
  const year = workbookYear(filename);
  const fallbackDate = defaultDate || (simplified ? '' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()));
  const nameColumn = header.columns.get(normalizedText('姓名')) ?? 0;
  const identityHeaders = new Set(['系统运动员编号', '运动员编号', '编号', '姓名', '所属队伍', '运动项目', '日期', '测量日期', '测试日期', '发生日期', '评估日期']);
  const dateLabels = ['日期', '测量日期', '测试日期', '发生日期', '评估日期'];
  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const athleteCode = standardText(row, header.columns, '系统运动员编号', '运动员编号', '编号');
    const numberedAthlete = athletes.find(athlete => String(athlete.id) === athleteCode);
    const rawName = standardText(row, header.columns, '姓名') || numberedAthlete?.name || '';
    const hasBusiness = [...header.columns].some(([label, column]) => !identityHeaders.has(label) && text(row[column]) !== '');
    if (sheet !== '运动员信息' && !hasBusiness) continue;
    if (simplified && sheet === '运动员信息' && numberedAthlete && !hasBusiness) continue;
    if (/^示例/.test(rawName)) continue;
    const rowHasContent = row.some((value) => text(value) !== '');
    if (!rawName) {
      // 有内容但缺少姓名的行必须提示错误，不得静默丢弃业务数据。
      if (rowHasContent)
        items.push(
          itemBase({
            itemType: 'invalid_row',
            sourceSheet: rawSheet,
            sourceAddress: cellAddress(rowIndex, nameColumn),
            rawValue: row.map((value) => text(value)).filter(Boolean).slice(0, 6).join(' | '),
            quality: 'error',
            messages: [
              `错误：${rawSheet}!${cellAddress(rowIndex, nameColumn)} 该行有内容但缺少姓名，无法关联运动员；请补充姓名或移除该行后重新导入`,
            ],
            businessKey: `invalid|${sheet}|${rowIndex}`,
          })
        );
      continue;
    }
    const rowStart = items.length;
    const numericErrors = new Map<string, { address: string; raw: string; message: string }>();
    const readNumber = (label: string): number | null => {
      const raw = standardValue(row, header.columns, label);
      if (text(raw) === '') return null;
      const value = standardNumberValue(raw);
      if (value === null) {
        const address = cellAddress(rowIndex, header.columns.get(normalizedText(label)) ?? 0);
        numericErrors.set(label, {
          address,
          raw: text(raw),
          message: `错误：${rawSheet}!${address} ${label}“${text(raw)}”不是有效数字；请修正原文件后重新上传，或明确排除整行`,
        });
      }
      return value;
    };
    const athlete = matchAthlete(rawName, project, athletes);
    const rawDate = standardValue(row, header.columns, ...dateLabels);
    const dateColumn = dateLabels.map(label => header.columns.get(normalizedText(label))).find(column => column !== undefined);
    const rowDate = text(rawDate) === '' ? fallbackDate : parseStandardDate(rawDate, year);
    const messages: string[] = [];
    const base = {
      athleteId: athlete?.id || null,
      rawAthleteName: rawName,
      sourceSheet: rawSheet,
      sourceAddress: cellAddress(rowIndex, nameColumn),
      payload: {
        athleteCode: standardText(row, header.columns, '系统运动员编号', '运动员编号', '编号'),
        team: standardText(row, header.columns, '所属队伍'),
        templateVersion: simplified ? IMPORT_TEMPLATE_VERSION : '',
        rawDate: text(rawDate),
        dateSource: text(rawDate) ? 'row' : defaultDate ? 'selected' : simplified ? 'missing' : 'legacy_today',
        defaultedDate: text(rawDate) ? '' : rowDate,
        dateAddress: cellAddress(rowIndex, dateColumn ?? nameColumn),
        ...(simplified ? { fieldAddresses: Object.fromEntries([...header.columns].map(([label, column]) => [label, cellAddress(rowIndex, column)])) } : {}),
      } as Record<string, unknown>,
    };
    const appendMetric = (headerName: string, metricCode: string, metricLabel: string, unit: string, type: string, protocol: string) => {
      const value = readNumber(headerName);
      if (value === null) return;
      items.push(itemBase({ ...base, itemType: 'test_measurement', eventDate: rowDate,
        testType: type, metricCode, metricLabel, valueNum: value, unit, side: 'center',
        payload: { ...base.payload, protocol,
          protocolRequired: rawSheet === '体能测试' && metricCode === 'asymmetry_index_pct',
          note: standardText(row, header.columns, '备注') },
        rawValue: String(value), messages: [], quality: 'valid',
        businessKey: `${rawName}|${rowDate}|${type}|${metricCode}`,
      }));
    };
    if (sheet !== '运动员信息' && !validIsoDate(rowDate))
      messages.push('错误：缺少有效日期，请按YYYY-MM-DD填写');

    if (sheet === '运动员信息') {
      const gender = standardText(row, header.columns, '性别');
      const rawBirthDate = standardValue(row, header.columns, '出生日期');
      const parsedBirthDate = parseImportBirthDate(rawBirthDate);
      // 非法生日保留原始文本在校验中报错，避免修正后被静默丢失；合法时存规范值。
      const birthDate = parsedBirthDate || text(rawBirthDate);
      if (gender && !['男', '女'].includes(gender)) messages.push('错误：性别只能填写男或女');
      const payload = {
        ...base.payload,
        project: standardText(row, header.columns, '运动项目') || project,
        team: standardText(row, header.columns, '所属队伍'),
        gender,
        birthDate,
        region: standardText(row, header.columns, '省份'),
        city: standardText(row, header.columns, '城市'),
        county: standardText(row, header.columns, '区县'),
        ethnicity: standardText(row, header.columns, '民族'),
        phone: standardText(row, header.columns, '手机号'),
        bloodType: standardText(row, header.columns, '血型'),
        emergencyContact: standardText(row, header.columns, '紧急联系人'),
        emergencyPhone: standardText(row, header.columns, '紧急电话'),
        education: standardText(row, header.columns, '学历'),
        technicalLevel: normalizeTechnicalLevel(standardValue(row, header.columns, '技术等级')),
        position: standardText(row, header.columns, '位置号位'),
        healthStatus: standardText(row, header.columns, '身体状态'),
        bestResult: standardText(row, header.columns, '最好成绩'),
        nativePlace: standardText(row, header.columns, '籍贯'),
        homeAddress: standardText(row, header.columns, '家庭住址'),
        athleteStatus: standardText(row, header.columns, '训练状态'),
        startSportDate: parseDate(standardValue(row, header.columns, '开始运动日期'), year),
        trainingVenue: standardText(row, header.columns, '训练场地'),
        currentEvent: standardText(row, header.columns, '备战赛事'),
        trainingPhase: standardText(row, header.columns, '备战阶段'),
        campPeriod: standardText(row, header.columns, '集训时间'),
        originPlace: standardText(row, header.columns, '输送地'),
        originUnit: standardText(row, header.columns, '输送单位'),
        originCoach: standardText(row, header.columns, '输送教练'),
        specialties: standardText(row, header.columns, '优势项'),
        notes: standardText(row, header.columns, '备注'),
      };
      items.push(
        itemBase({
          ...base,
          itemType: 'athlete_profile',
          payload,
          rawValue: rawName,
          quality: makeQuality(messages),
          messages,
          businessKey: `${normalizedName(rawName)}|profile`,
        })
      );
      continue;
    }

    if (sheet === '竞技水平评估') {
      const technicalLevel = normalizeTechnicalLevel(
        standardValue(row, header.columns, '技术等级')
      );
      const bestResult = standardText(row, header.columns, '最好成绩');
      // 等级、最好成绩属于档案资料，无需附带按日期的评估记录。
      if (technicalLevel || bestResult) {
        items.push(itemBase({
          ...base,
          itemType: 'athlete_profile',
          payload: { ...base.payload, technicalLevel, bestResult },
          rawValue: technicalLevel || bestResult,
          quality: 'valid',
          messages: [],
          businessKey: `${athlete?.id || normalizedName(rawName)}|competitive-profile`,
        }));
      }
      const assessmentLabels = ['竞技总分', '竞技状态', '专项耐力', '力量爆发', '技术效率',
        '负荷适应', '恢复能力', '比赛能力'];
      const hasAssessment = text(rawDate) !== '' || assessmentLabels.some(
        label => text(standardValue(row, header.columns, label)) !== ''
      );
      if (!hasAssessment) continue;
      const overallScore = readNumber('竞技总分');
      const stateLevel = canonicalCode(standardText(row, header.columns, '竞技状态'), STATE_LEVEL_CODES, '');
      const payload = {
        ...base.payload,
        overallScore,
        stateLevel,
        enduranceScore: readNumber('专项耐力'),
        powerScore: readNumber('力量爆发'),
        techniqueScore: readNumber('技术效率'),
        loadAdaptationScore: readNumber('负荷适应'),
        recoveryScore: readNumber('恢复能力'),
        competitionScore: readNumber('比赛能力'),
        note: standardText(row, header.columns, '备注'),
      };
      items.push(
        itemBase({
          ...base,
          itemType: 'competitive_state',
          eventDate: rowDate,
          metricLabel: '竞技状态',
          valueNum: overallScore,
          unit: '分',
          payload,
          rawValue: String(overallScore ?? ''),
          quality: makeQuality(messages),
          messages,
          businessKey: `${athlete?.id || 0}|${rowDate}|competitive`,
        })
      );
    } else if (sheet === '身体测量' || sheet === '冠军模型测试') {
      const fields: Record<string, number | null> = {};
      for (const [headerName, key] of BODY_TEMPLATE_FIELDS) {
        if (key !== 'armSpanCm') fields[key] = readNumber(headerName);
      }
      const armSpan = readNumber('臂展cm');
      const hasBody = Object.values(fields).some(value => value !== null);
      if (hasBody) items.push(itemBase({ ...base, itemType: 'body_measurement', eventDate: rowDate,
        metricCode: 'body_composition', metricLabel: '身体测量', valueNum: fields.weightKg ?? fields.heightCm ?? null,
        payload: { ...base.payload, ...fields, note: standardText(row, header.columns, '备注') },
        rawValue: JSON.stringify(fields), messages: [...messages], quality: makeQuality(messages),
        businessKey: `${rawName}|${rowDate}|body`,
      }));
      if (armSpan !== null) appendMetric('臂展cm', 'arm_span_cm', '臂展', 'cm', '身体测量', standardText(row, header.columns, '测试协议'));
      if (sheet === '身体测量' && !hasBody && armSpan === null)
        items.push(itemBase({ ...base, itemType: 'body_measurement', eventDate: rowDate,
          metricCode: 'body_composition', payload: base.payload, quality: 'error', messages: ['错误：身体测量至少填写一个数值'],
        }));
      if (sheet === '冠军模型测试') {
        const protocol = standardText(row, header.columns, '测试协议');
        for (const [headerName, code, label, unit] of [...FITNESS_TEMPLATE_METRICS, ...EVALUATION_SCORE_METRICS])
          appendMetric(headerName, code, label, unit, '体能测试', protocol);
      }
    } else if (sheet === '恢复状态') {
      const payload = {
        ...base.payload,
        sleepHours: readNumber('睡眠小时'),
        sleepQuality: readNumber('睡眠质量'),
        morningPulse: readNumber('晨脉'),
        weightKg: readNumber('体重kg'),
        fatigueIndex: readNumber('疲劳'),
        sorenessIndex: readNumber('肌肉酸痛'),
        moodIndex: readNumber('情绪'),
        // 空白状态不伪造取值；入库时仅在文件明确填写时写入。
        status: canonicalCode(standardText(row, header.columns, '状态'), WELLNESS_STATUS_CODES, ''),
        note: standardText(row, header.columns, '备注'),
      };
      items.push(
        itemBase({
          ...base,
          itemType: 'wellness',
          eventDate: rowDate,
          metricLabel: '每日恢复',
          valueNum: payload.sleepHours ?? null,
          payload,
          rawValue: JSON.stringify(payload),
          quality: makeQuality(messages),
          messages,
          businessKey: `${athlete?.id || 0}|${rowDate}|wellness`,
        })
      );
    } else if (sheet === '训练课次') {
      const durationCell = standardValue(row, header.columns, '时长分钟');
      const distanceCell = standardValue(row, header.columns, '距离千米');
      const durationReported = text(durationCell) !== '';
      const distanceReported = text(distanceCell) !== '';
      const duration = readNumber('时长分钟');
      const distance = readNumber('距离千米');
      if (!durationReported && !distanceReported)
        messages.push('错误：时长分钟、距离千米至少填写一项；留空不等于 0。');
      if (durationReported && (duration === null || duration < 0 || duration > 1440))
        messages.push('错误：时长分钟须为 0—1440 的数字。');
      if (distanceReported && (distance === null || distance < 0 || distance > 500))
        messages.push('错误：距离千米须为 0—500 的数字。');
      const rpe = readNumber('RPE');
      const payload = {
        ...base.payload,
        sessionOrder: readNumber('课次序号') ?? 1,
        sessionOrderProvided: text(standardValue(row, header.columns, '课次序号')) !== '',
        startTime: standardText(row, header.columns, '开始时间'),
        trainingType: standardText(row, header.columns, '训练类型'),
        structureType: standardText(row, header.columns, '训练阶段'),
        intensityZone: standardText(row, header.columns, '强度区间'),
        content: standardText(row, header.columns, '训练内容'),
        durationMin: duration,
        distanceKm: distance,
        durationReported,
        distanceReported,
        rpe,
        // 空白 SRPE/SMVL 保持未提供；仅在文件明确填写时写入，避免伪造 0 值。
        srpe: readNumber('SRPE') ?? (rpe === null || duration === null ? null : rpe * duration),
        srpeCalculated: text(standardValue(row, header.columns, 'SRPE')) === '',
        smvl: readNumber('SMVL'),
        averageHeartRate: readNumber('平均心率'),
        maxHeartRate: readNumber('最大心率'),
        averagePowerW: readNumber('平均功率W'),
        strokeRateSpm: readNumber('桨频SPM'),
      };
      items.push(
        itemBase({
          ...base,
          itemType: 'training_session',
          eventDate: rowDate,
          sessionLabel: payload.content,
          valueNum: duration,
          unit: 'min',
          payload,
          rawValue: JSON.stringify(payload),
          quality: makeQuality(messages),
          messages,
          businessKey: `${athlete?.id || 0}|${rowDate}|session|${payload.sessionOrder}`,
        })
      );
    } else if (sheet === '力量训练组次') {
      const exerciseName = standardText(row, header.columns, '动作');
      const actualReps = readNumber('实际次数');
      const actualWeightKg = readNumber('实际重量kg');
      if (!exerciseName) messages.push('错误：训练动作不能为空');
      if (actualReps === null || actualWeightKg === null)
        messages.push('错误：实际次数和实际重量不能为空');
      items.push(
        itemBase({
          ...base,
          itemType: 'training_set',
          eventDate: rowDate,
          sessionLabel: standardText(row, header.columns, '课次名称') || '力量训练',
          exerciseName,
          setIndex: readNumber('组序') || 1,
          targetReps: readNumber('计划次数'),
          actualReps,
          actualWeightKg,
          intensityPercent: readNumber('强度百分比'),
          payload: {
            ...base.payload,
            sessionOrder: readNumber('课次序号'),
            setIndexProvided: text(standardValue(row, header.columns, '组序')) !== '',
            exerciseCode: standardText(row, header.columns, '动作代码'),
            plannedWeightKg: readNumber('计划重量kg'),
            completed: ({ '已完成': 1, '未完成': 0, '是': 1, '否': 0 } as Record<string, number>)[standardText(row, header.columns, '完成状态')] ?? readNumber('完成状态'),
            trainingEnvironment: standardText(row, header.columns, '训练环境'),
            durationMin: readNumber('组次时长分钟'),
            distanceKm: readNumber('组次距离千米'),
            intensityZone: standardText(row, header.columns, '强度区间'),
            rpe: readNumber('RPE'),
            trainingCategory:
              standardText(row, header.columns, '类别') || inferStrengthCategory(exerciseName),
            bodyPosition:
              standardText(row, header.columns, '身体部位') ||
              inferStrengthBodyPosition(exerciseName),
            note: standardText(row, header.columns, '备注'),
          },
          rawValue: `${actualWeightKg || ''}kg×${actualReps || ''}`,
          quality: makeQuality(messages),
          messages,
          businessKey: `${athlete?.id || 0}|${rowDate}|${exerciseName}|${readNumber('组序') || 1}`,
        })
      );
    } else if (sheet === 'FMS测试') {
      const fmsItems = FMS_TEMPLATE_METRICS.flatMap(([headerName, metricCode, metricLabel]) => {
        const valueNum = readNumber(headerName);
        if (valueNum === null) return [];
        const metricMessages = [...messages];
        if (!Number.isInteger(valueNum) || valueNum < 0 || valueNum > 3)
          metricMessages.push(`错误：${metricLabel}须填写0、1、2或3分`);
        return [
          itemBase({
            ...base,
            itemType: 'test_measurement',
            eventDate: rowDate,
            testType: 'FMS测试',
            metricCode,
            metricLabel,
            valueNum,
            unit: '分',
            side: 'center',
            payload: {
              ...base.payload,
              protocol: '功能动作筛查（FMS）',
              note: standardText(row, header.columns, '备注'),
            },
            rawValue: String(valueNum),
            quality: makeQuality(metricMessages),
            messages: metricMessages,
            businessKey: `${athlete?.id || 0}|${rowDate}|fms|${metricCode}`,
          }),
        ];
      });
      if (!fmsItems.length) {
        messages.push('错误：FMS七项至少填写一项得分');
        items.push(
          itemBase({
            ...base,
            itemType: 'test_measurement',
            eventDate: rowDate,
            testType: 'FMS测试',
            metricCode: 'fms_deep_squat',
            metricLabel: '深蹲',
            valueNum: null,
            unit: '分',
            payload: { ...base.payload, protocol: '功能动作筛查（FMS）' },
            rawValue: '',
            quality: makeQuality(messages),
            messages,
            businessKey: `${athlete?.id || 0}|${rowDate}|fms|empty`,
          })
        );
      } else {
        if (fmsItems.length < FMS_TEMPLATE_METRICS.length)
          fmsItems.forEach((item) => {
            item.messages.push('警告：建议一次录齐FMS七项，以便生成完整21分分析');
            item.quality = makeQuality(item.messages);
          });
        items.push(...fmsItems);
      }
    } else if (sheet === '体能测试') {
      const protocol = standardText(row, header.columns, '测试协议');
      for (const [headerName, code, label, unit] of FITNESS_TEMPLATE_METRICS)
        appendMetric(headerName, code, label, unit, '体能测试', protocol);
      if (items.length === rowStart && !numericErrors.size)
        items.push(itemBase({ ...base, itemType: 'invalid_row', eventDate: rowDate, quality: 'error',
          messages: ['错误：体能测试至少填写一项实测数值'], rawValue: row.map(text).join(' | ') }));
    } else if (sheet === '测试指标') {
      const explicitTestType = standardText(row, header.columns, '测试类型');
      const rawCode = standardText(row, header.columns, '指标代码');
      // 明确指定测试类型的逐项记录保留原指标代码，兼容历史事实，不改写其归属。
      const selected = rawCode ? undefined : resolveImportMetricName(standardText(row, header.columns, '指标名称'), standardText(row, header.columns, '单位'), metricCatalog);
      const metricCode = rawCode ? (explicitTestType ? rawCode : canonicalImportMetricCode(rawCode)) : selected?.metric?.code || '';
      const valueNum = readNumber('数值');
      const metricDefinition = db.prepare('SELECT unit FROM metric_definitions WHERE code = ? AND active = 1').get(metricCode) as { unit: string } | undefined;
      const providedUnit = standardText(row, header.columns, '单位');
      const metricUnit = providedUnit || metricDefinition?.unit || '';
      const durationMin = readNumber('测试时长分钟');
      if (selected?.error) messages.push(selected.error);
      if (valueNum === null) messages.push('错误：测试数值不能为空');
      if (durationMin !== null && durationMin <= 0) messages.push('错误：测试时长分钟须大于0');
      const sideText = standardText(row, header.columns, '侧别');
      const side = canonicalCode(sideText, TEST_SIDE_CODES, 'center') as ParsedImportItem['side'];
      if (!['left', 'right', 'bilateral', 'center'].includes(side))
        messages.push('错误：测试侧别只能使用center、left、right或bilateral');
      const bodyField = BODY_TEMPLATE_FIELDS.find(([, , code]) => code === metricCode);
      if (!explicitTestType && bodyField && bodyField[1] !== 'armSpanCm' && side === 'center') {
        items.push(itemBase({ ...base, itemType: 'body_measurement', eventDate: rowDate,
          metricCode: 'body_composition', metricLabel: '身体测量', valueNum,
          payload: { ...base.payload, [bodyField[1]]: valueNum, note: standardText(row, header.columns, '备注'),
            unitConflict: standardText(row, header.columns, '单位') && standardText(row, header.columns, '单位') !== bodyField[4]
              ? `错误：${rawSheet}!${base.sourceAddress} 单位须为${bodyField[4]}，不能自动换算` : '' },
          rawValue: String(valueNum ?? ''), messages, quality: makeQuality(messages),
          businessKey: `${rawName}|${rowDate}|body`,
        }));
      } else items.push(
        itemBase({
          ...base,
          itemType: 'test_measurement',
          eventDate: rowDate,
          testType: explicitTestType || (metricCode === 'arm_span_cm' && side === 'center' ? '身体测量' : '专项测试'),
          metricCode,
          metricLabel: selected?.metric?.label || standardText(row, header.columns, '指标名称') || metricCode,
          valueNum,
          unit: metricUnit,
          side,
          payload: {
            ...base.payload,
            metricSelectionError: selected?.error || '',
            protocol: standardText(row, header.columns, '协议'),
            durationMin,
            targetValue: readNumber('目标值'),
            unitConflict: providedUnit && metricDefinition?.unit && providedUnit !== metricDefinition.unit ? `错误：单位须为${metricDefinition.unit}，不能静默换算` : '',
            note: standardText(row, header.columns, '备注'),
          },
          rawValue: String(valueNum ?? ''),
          quality: makeQuality(messages),
          messages,
          businessKey: `${athlete?.id || 0}|${rowDate}|${metricCode}|${side}`,
        })
      );
    } else if (sheet === '伤病记录') {
      const payload = {
        ...base.payload,
        injuryName: standardText(row, header.columns, '伤病名称'),
        bodyPart: standardText(row, header.columns, '部位'),
        side: canonicalCode(standardText(row, header.columns, '侧别'), INJURY_SIDE_CODES, 'unspecified'),
        status: canonicalCode(standardText(row, header.columns, '状态'), INJURY_STATUS_CODES, 'observation'),
        // 空白疼痛评分保持未提供（不伪造 0）；写入时仅在明确填写时落库。
        painScore: readNumber('疼痛评分'),
        restrictions: standardText(row, header.columns, '训练限制'),
        rehabPlan: standardText(row, header.columns, '康复计划'),
        reviewDate: parseDate(standardValue(row, header.columns, '复查日期'), year),
        note: standardText(row, header.columns, '备注'),
      };
      items.push(
        itemBase({
          ...base,
          itemType: 'injury_record',
          eventDate: rowDate,
          metricLabel: payload.injuryName,
          valueNum: payload.painScore ?? null,
          payload,
          rawValue: payload.injuryName,
          quality: makeQuality(messages),
          messages,
          businessKey: `${athlete?.id || 0}|${rowDate}|injury|${payload.injuryName}`,
        })
      );
    } else if (sheet === '竞技状态') {
      const protocol = standardText(row, header.columns, '评估协议');
      for (const [headerName, code, label, unit] of EVALUATION_SCORE_METRICS) {
        appendMetric(headerName, code, label, unit, '竞技评估', protocol);
        if (text(standardValue(row, header.columns, headerName)) && !protocol && !numericErrors.size) {
          const item = items.at(-1);
          if (item) item.payload.protocolRequired = true;
        }
      }
      const stateHeaders = ['总分', '等级', '专项耐力', '力量爆发', '技术效率', '负荷适应', '恢复能力', '比赛能力'];
      const hasState = stateHeaders.some(label => text(standardValue(row, header.columns, label)) !== '');
      if (hasState) {
      const overallScore = readNumber('总分');
      const payload = {
        ...base.payload,
        overallScore,
        // 空白等级保持未提供；入库新增时才落到默认档位。
        stateLevel: canonicalCode(standardText(row, header.columns, '等级'), STATE_LEVEL_CODES, ''),
        enduranceScore: readNumber('专项耐力'),
        powerScore: readNumber('力量爆发'),
        techniqueScore: readNumber('技术效率'),
        loadAdaptationScore: readNumber('负荷适应'),
        recoveryScore: readNumber('恢复能力'),
        competitionScore: readNumber('比赛能力'),
        note: standardText(row, header.columns, '备注'),
      };
      items.push(
        itemBase({
          ...base,
          itemType: 'competitive_state',
          eventDate: rowDate,
          metricLabel: '竞技状态',
          valueNum: overallScore,
          unit: '分',
          payload,
          rawValue: String(overallScore ?? ''),
          quality: makeQuality(messages),
          messages,
          businessKey: `${athlete?.id || 0}|${rowDate}|competitive`,
        })
      );
      }
    }
    if (numericErrors.size) {
      const errors = [...numericErrors.entries()];
      items.splice(rowStart);
      items.push(itemBase({
        ...base,
        itemType: 'invalid_row',
        eventDate: rowDate,
        sourceAddress: errors[0][1].address,
        metricLabel: errors.map(([label]) => label).join('、'),
        rawValue: errors.map(([label, error]) => `${label}=${error.raw}`).join('；'),
        quality: 'error',
        messages: errors.map(([, error]) => error.message),
        businessKey: `invalid|${sheet}|${rowIndex}`,
      }));
    }
  }
  return items;
}

type ImportStrengthSession = { id: number; sessionOrder: number; label: string };
function importStrengthSessions(item: ParsedImportItem | DataImportItemView): ImportStrengthSession[] {
  if (!item.athleteId) return [];
  const order = optionalNumber(item.payload.sessionOrder);
  return db.prepare(`SELECT ts.id, ts.session_order AS sessionOrder, ts.content AS label FROM training_sessions ts
    WHERE ts.athlete_id = ? AND ts.session_date = ? AND ${order !== null ? 'ts.session_order = ?' : `(ts.training_type = '力量训练' OR EXISTS (SELECT 1 FROM strength_result_sets srs WHERE srs.training_session_id = ts.id)) AND ts.content = ?`}
    ORDER BY ts.session_order`).all(item.athleteId, item.eventDate, order ?? item.sessionLabel) as ImportStrengthSession[];
}
function findImportStrengthSession(item: ParsedImportItem | DataImportItemView) {
  const candidates = importStrengthSessions(item);
  if (candidates.length > 1) throw new Error('同日存在同名力量课，请先选择课次序号');
  return candidates[0];
}
function resolveImportStrengthSessions(items: Array<ParsedImportItem | DataImportItemView>) {
  const key = (item: ParsedImportItem | DataImportItemView, label: string) => JSON.stringify([item.athleteId ?? dataImportPersonKey(item), item.eventDate, label]);
  const staged = new Map<string, ImportStrengthSession[]>();
  for (const session of items) {
    if (session.itemType !== 'training_session' || session.resolution === 'skip') continue;
    const label = text(session.payload.content);
    const identity = key(session, label);
    const entries = staged.get(identity) || [];
    entries.push({ id: 0, sessionOrder: optionalNumber(session.payload.sessionOrder) ?? 1, label });
    staged.set(identity, entries);
  }
  const resolved = new Map<string, Map<number, ImportStrengthSession>>();
  for (const item of items) {
    if (item.itemType !== 'training_set' || item.resolution === 'skip') continue;
    delete item.payload.sessionChoices;
    if (isProvided(item.payload.sessionOrder)) continue;
    const identity = key(item, item.sessionLabel);
    let candidates = resolved.get(identity);
    if (!candidates) {
      candidates = new Map([...importStrengthSessions(item), ...(staged.get(identity) || [])].map(session => [session.sessionOrder, session]));
      resolved.set(identity, candidates);
    }
    if (candidates.size === 1) item.payload.sessionOrder = [...candidates.keys()][0];
    else if (candidates.size > 1) item.payload.sessionChoices = [...candidates.values()];
  }
  const sessionIdentity = (item: ParsedImportItem | DataImportItemView) => JSON.stringify([item.athleteId ?? dataImportPersonKey(item), item.eventDate, optionalNumber(item.payload.sessionOrder) ?? 1]);
  const withSets = new Set(items.filter(item => item.itemType === 'training_set' && item.resolution !== 'skip' && isProvided(item.payload.sessionOrder)).map(sessionIdentity));
  for (const session of items) {
    if (session.itemType !== 'training_session') continue;
    if (withSets.has(sessionIdentity(session))) session.payload.hasStrengthSets = true;
    else delete session.payload.hasStrengthSets;
  }

}

function validateTemplateOrders(items: Array<ParsedImportItem | DataImportItemView>) {
  const groups = new Map<string, Array<ParsedImportItem | DataImportItemView>>();
  for (const item of items) {
    delete item.payload.missingSessionOrder;
    delete item.payload.missingSetIndex;
    if (item.resolution === 'skip' || item.quality === 'skipped') continue;
    if (item.payload.templateVersion !== IMPORT_TEMPLATE_VERSION || !['training_session', 'training_set'].includes(item.itemType)) continue;
    const key = JSON.stringify([item.itemType, item.athleteId ?? dataImportPersonKey(item), item.eventDate, item.itemType === 'training_set' ? [item.payload.sessionOrder, item.sessionLabel, item.exerciseName] : '']);
    const group = groups.get(key) || []; group.push(item); groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      if (item.itemType === 'training_session' && !item.payload.sessionOrderProvided) item.payload.missingSessionOrder = true;
      if (item.itemType === 'training_set' && !item.payload.setIndexProvided) item.payload.missingSetIndex = true;
    }
  }
}

/** 相同及互补事实自动合并；不同值继续使用统一字段审查。 */
function refreshImportConflicts(items: Array<ParsedImportItem | DataImportItemView>) {
  for (const item of items) normalizeImportEnums(item);
  validateTemplateOrders(items);
  resolveImportStrengthSessions(items);
  for (const item of items) {
    delete item.payload.valueImportConflicts;
    delete item.payload.valueReviewPending;
  }
  const active = items.filter(item => item.resolution !== 'skip' && item.quality !== 'skipped');
  // 解析期尚无暂存行号，使用稳定的临时序号参与统一分组。
  const indexed = active.map((item, index) => ({ ...item, id: 'id' in item ? item.id : -(index + 1) }));
  const originals = new Map(indexed.map((item, index) => [item.id, active[index]]));
  const grouped = importReviewGroups(indexed);
  for (const group of grouped) {
    if (group.length < 2) continue;
    const decision = group.find(item => item.payload.valueReviewDecision)?.payload.valueReviewDecision as { sources: Array<{ id: number }> } | undefined;
    if (decision && group.every(item => decision.sources.some(source => source.id === item.id))) continue;
    const conflicts: string[] = [];
    for (const [, field, , label, unit] of reviewFields(group)) {
      if (importFieldValues(group, field).length < 2) continue;
      const values = group.filter(item => reviewValues(item, group)[field] !== undefined);
      conflicts.push(`错误：${reviewTitle(group[0])}${group[0].eventDate ? `在${group[0].eventDate}` : ''}的${label}冲突：${values.map(item => `${item.sourceSheet}!${item.sourceAddress} = ${reviewValues(item, group)[field]}${unit}`).join('；')}。请在集中审查中选择最终值或填写真实日期后分别保留`);
    }
    for (const item of group) {
      if (conflicts.length) item.payload.valueImportConflicts = conflicts;
    }
    if (!conflicts.length && !group.some(item => item.payload.unitConflict || item.payload.valueReviewDecision || item.payload.sessionChoices || item.payload.missingSessionOrder || item.payload.missingSetIndex)) {
      const values: Record<string, ReviewValue> = {};
      for (const [, field] of reviewFields(group)) {
        const available = importFieldValues(group, field);
        if (available.length === 1) values[field] = available[0];
      }
      const sources = group.flatMap(item => Array.isArray(item.payload.valueAutoMergeSources)
        ? item.payload.valueAutoMergeSources
        : [{ sourceSheet: item.sourceSheet, sourceAddress: item.sourceAddress, values: reviewValues(item, group) }]);
      const representatives = new Set<string>();
      for (const entry of group) {
        const item = originals.get(entry.id)!;
        const key = item.itemType === 'test_measurement' ? reviewMetricKey(entry) : 'record';
        if (representatives.has(key)) {
          item.resolution = 'skip';
          item.quality = 'skipped';
          item.payload.valueAutoMerged = true;
        } else {
          representatives.add(key);
          const explicitSrpe = group.some(source => source.itemType === 'training_session' && source.payload.srpeCalculated === false && isProvided(source.payload.srpe));
          writeReviewValues(entry, values, group);
          if (explicitSrpe) entry.payload.srpeCalculated = false;
          const { id: _reviewId, ...merged } = entry;
          Object.assign(item, merged);
          item.payload.valueAutoMergeSources = sources;
        }
      }
    }
  }
}

function consolidateImportFacts(items: ParsedImportItem[]) {
  for (const item of items) {
    if (item.itemType === 'body_measurement' && item.metricCode !== 'body_composition') {
      const field = item.metricCode === 'height_cm' ? 'heightCm' : item.metricCode === 'weight_kg' ? 'weightKg' : null;
      if (field) { item.payload[field] = item.valueNum; item.metricCode = 'body_composition'; item.metricLabel = '身体测量'; }
    }
  }
  // 所有可审查记录保留原始行，不在解析期丢弃冲突来源。
  refreshImportConflicts(items);
  return items;
}

function ensureMetricDefinitions() {
  const statement = db.prepare(`
    INSERT INTO metric_definitions (code, label, domain, unit, direction, frequency, projects_json, minimum, maximum, active)
    VALUES (?, ?, ?, ?, 'higher_better', 'phase', '["赛艇","皮划艇","激流"]', ?, ?, 1)
    ON CONFLICT(code) DO UPDATE SET label = excluded.label, domain = excluded.domain, unit = excluded.unit,
      minimum = excluded.minimum, maximum = excluded.maximum, active = 1, updated_at = CURRENT_TIMESTAMP
    WHERE metric_definitions.label IS NOT excluded.label OR metric_definitions.domain IS NOT excluded.domain
      OR metric_definitions.unit IS NOT excluded.unit OR metric_definitions.minimum IS NOT excluded.minimum
      OR metric_definitions.maximum IS NOT excluded.maximum OR metric_definitions.active IS NOT 1
  `);
  for (const [code, metric] of Object.entries(METRICS))
    statement.run(code, metric.label, metric.domain, metric.unit, metric.min, metric.max);
}

function matrixForSheet(workbook: XLSX.WorkBook, sheetName: string): Matrix {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  }) as Matrix;
}

function summarizeItems(items: ParsedImportItem[]) {
  return {
    itemCount: items.length,
    validCount: items.filter((item) => item.quality === 'valid').length,
    warningCount: items.filter((item) => item.quality === 'warning').length,
    errorCount: items.filter((item) => item.quality === 'error').length,
  };
}

function insertItems(batchId: string, items: ParsedImportItem[]) {
  const statement = db.prepare(`
    INSERT INTO data_import_items (
      batch_id, item_type, athlete_id, raw_athlete_name, event_date, session_label, test_type,
      metric_code, metric_label, side, value_num, unit, exercise_name, set_index, target_reps,
      actual_reps, actual_weight_kg, intensity_percent, payload_json, source_sheet, source_address,
      raw_value, quality, messages_json, business_key, resolution, conflict_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items)
    statement.run(
      batchId,
      item.itemType,
      item.athleteId,
      item.rawAthleteName,
      item.eventDate,
      item.sessionLabel,
      item.testType,
      item.metricCode,
      item.metricLabel,
      item.side,
      item.valueNum,
      item.unit,
      item.exerciseName,
      item.setIndex,
      item.targetReps,
      item.actualReps,
      item.actualWeightKg,
      item.intensityPercent,
      JSON.stringify(item.payload),
      item.sourceSheet,
      item.sourceAddress,
      item.rawValue,
      item.quality,
      JSON.stringify(item.messages),
      item.businessKey,
      item.resolution,
      JSON.stringify(item.conflict ?? {})
    );
}

function formatConflictValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function conflictField(
  field: string,
  label: string,
  oldValue: unknown,
  newValue: unknown
): DataImportConflictField | null {
  const oldText = formatConflictValue(oldValue);
  const newText = formatConflictValue(newValue);
  if (newText === '') return null; // 空白=未提供，不构成覆盖
  return {
    field,
    label,
    oldValue: oldText,
    newValue: newText,
    overwrites: oldText !== '' && !importReviewValuesEqual(oldValue, newValue) && oldText !== newText,
  };
}

/** 数据库比较与文件比较使用相同字段定义，只在这里适配数据库列名。 */
function databaseConflictFields(item: DataImportItemView, row: Record<string, unknown>) {
  const values = reviewValues(item);
  return reviewFields([item]).flatMap(([, field, , label]) => {
    const column = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    if (!(field in row) && !(column in row)) return [];
    const conflict = conflictField(field, label, field in row ? row[field] : row[column], values[field]);
    return conflict ? [conflict] : [];
  });
}

/**
 * 预览期重复与覆盖检测：按正式业务唯一键查找已有记录，
 * 仅比较文件明确提供的字段；空白字段不参与覆盖判定。
 */
function detectItemConflict(item: DataImportItemView): DataImportConflict {
  const p = item.payload || {};
  const empty: DataImportConflict = {
    exists: false,
    entityType: '',
    entityId: null,
    identical: false,
    fields: [],
  };
  if (item.itemType === 'invalid_row') return empty;
  if (!item.athleteId && item.itemType !== 'scoring_rule') return empty;
  const push = (list: Array<DataImportConflictField | null>) =>
    list.filter((entry): entry is DataImportConflictField => entry !== null);
  if (item.itemType === 'athlete_profile') {
    const athlete = db
      .prepare(
        `SELECT ap.*, a.gender, a.birth_date AS birthDate, COALESCE(pt.name, '') AS team,
          ap.technical_level AS technicalLevel, ap.best_result AS bestResult,
          COALESCE(ao.province, '') AS region, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county
        FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
        LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
        LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id
        WHERE a.id = ?`
      )
      .get(item.athleteId) as Record<string, unknown> | undefined;
    if (!athlete) return empty;
    const fields = databaseConflictFields(item, athlete);
    return {
      exists: true,
      entityType: 'athlete',
      entityId: item.athleteId,
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'wellness') {
    const existing = db
      .prepare('SELECT * FROM daily_wellness WHERE athlete_id=? AND wellness_date=?')
      .get(item.athleteId, item.eventDate) as Record<string, unknown> | undefined;
    if (!existing) return empty;
    const fields = databaseConflictFields(item, existing);
    return {
      exists: true,
      entityType: 'daily_wellness',
      entityId: Number(existing.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'training_session') {
    const order = Math.max(1, Math.round(optionalNumber(p.sessionOrder) || 1));
    const existing = db
      .prepare(
        'SELECT * FROM training_sessions WHERE athlete_id=? AND session_date=? AND session_order=?'
      )
      .get(item.athleteId, item.eventDate, order) as Record<string, unknown> | undefined;
    if (!existing) return empty;
    const fields = databaseConflictFields(item, existing);
    return {
      exists: true,
      entityType: 'training_session',
      entityId: Number(existing.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'training_set') {
    const session = Array.isArray(p.sessionChoices) ? undefined : findImportStrengthSession(item);
    const existing = session
      ? (db
          .prepare(
            'SELECT * FROM strength_result_sets WHERE training_session_id = ? AND exercise_name = ? AND set_index = ?'
          )
          .get(session.id, item.exerciseName, item.setIndex) as
          | Record<string, unknown>
          | undefined)
      : undefined;
    if (!existing) return empty;
    const fields = databaseConflictFields(item, { ...existing });
    return {
      exists: true,
      entityType: 'strength_result_set',
      entityId: Number(existing.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'test_measurement') {
    const session = db
      .prepare('SELECT id, protocol, duration_min AS durationMin FROM test_sessions WHERE athlete_id = ? AND test_date = ? AND test_type = ?')
      .get(item.athleteId, item.eventDate, item.testType || '力量素质测试') as
      | { id: number; protocol: string; durationMin: number | null }
      | undefined;
    const existing = session
      ? (db
          .prepare(
            'SELECT * FROM test_measurements WHERE test_session_id = ? AND metric_code = ? AND side = ?'
          )
          .get(session.id, item.metricCode, item.side) as Record<string, unknown> | undefined)
      : undefined;
    if (!session) return empty;
    const fields = push([
      ...(existing ? [conflictField('valueNum', item.metricLabel || item.metricCode, existing.value_num, item.valueNum), conflictField('targetValue', '目标值', existing.target_value, p.targetValue), conflictField('unit', '单位', existing.unit, item.unit), conflictField('note', '备注', existing.note, p.note)] : []),
      conflictField('protocol', '测试协议', session.protocol, p.protocol),
      conflictField('durationMin', '测试时长分钟', session.durationMin, p.durationMin),
    ]);
    if (!existing && !fields.some(field => field.overwrites)) return empty;
    return {
      exists: true,
      entityType: existing ? 'test_measurement' : 'test_session',
      entityId: Number(existing?.id ?? session.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'body_measurement') {
    const existing = db
      .prepare('SELECT * FROM athlete_body_measurements WHERE athlete_id = ? AND measurement_date = ?')
      .get(item.athleteId, item.eventDate) as Record<string, unknown> | undefined;
    if (!existing) return empty;
    if (item.metricCode === 'body_composition') {
      const fields = databaseConflictFields(item, existing);
      return {
        exists: true,
        entityType: 'athlete_body_measurement',
        entityId: Number(existing.id),
        identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
        fields,
      };
    }
    const column = item.metricCode === 'height_cm' ? 'height_cm' : 'weight_kg';
    const label = item.metricCode === 'height_cm' ? '身高' : '体重';
    const fields = push([conflictField(item.metricCode, label, existing[column], item.valueNum)]);
    return {
      exists: true,
      entityType: 'athlete_body_measurement',
      entityId: Number(existing.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'injury_record') {
    const existing = db
      .prepare('SELECT * FROM injury_records WHERE athlete_id=? AND onset_date=? AND injury_name=?')
      .get(item.athleteId, item.eventDate, text(p.injuryName)) as Record<string, unknown> | undefined;
    if (!existing) return empty;
    const fields = databaseConflictFields(item, { ...existing });
    return {
      exists: true,
      entityType: 'injury_record',
      entityId: Number(existing.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'competitive_state') {
    const existing = db
      .prepare('SELECT * FROM competitive_state_assessments WHERE athlete_id=? AND assessment_date=?')
      .get(item.athleteId, item.eventDate) as Record<string, unknown> | undefined;
    if (!existing) return empty;
    const fields = databaseConflictFields(item, existing);
    return {
      exists: true,
      entityType: 'competitive_state_assessment',
      entityId: Number(existing.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  if (item.itemType === 'scoring_rule') {
    const project = text(p.project);
    const gender = text(p.gender);
    const score = optionalNumber(p.score);
    const ruleVersion = text(p.ruleVersion);
    const existing = db
      .prepare(
        `SELECT id, threshold_value AS thresholdValue, comparison FROM metric_scoring_rules WHERE project = ? AND gender = ? AND metric_code = ? AND score = ? AND rule_version = ?`
      )
      .get(project, gender, item.metricCode, score, ruleVersion) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return empty;
    const fields = databaseConflictFields(item, { ...existing, valueNum: existing.thresholdValue });
    return {
      exists: true,
      entityType: 'metric_scoring_rule',
      entityId: Number(existing.id),
      identical: fields.every((field) => !field.overwrites && field.oldValue !== ''),
      fields,
    };
  }
  return empty;
}

type PersonRecord = {
  key: string;
  name: string;
  sourceSheet: string;
  gender: string;
  team: string;
  birthDate: string;
  athleteCode: string;
  region: string;
  city: string;
  county: string;
  matchedAthleteId: number | null;
  suggested: DataImportPersonSuggestion[];
  messages: string[];
  matched: boolean;
};

function collectPersons(items: ParsedImportItem[]): Map<string, PersonRecord> {
  const persons = new Map<string, PersonRecord>();
  for (const item of items) {
    if (item.itemType === 'scoring_rule' || item.itemType === 'invalid_row') continue;
    const name = normalizedName(item.rawAthleteName);
    if (!name) continue;
    const payload = item.payload || {};
    const code = text(payload.athleteCode);
    const team = text(payload.team);
    const birth = text(payload.birthDate);
    const key = code
      ? JSON.stringify(['code', code, name])
      : team || birth
        ? JSON.stringify(['person', name, team, birth])
        : name;
    item.payload = { ...payload, personKey: key };
    const genderFromSheet = /女子|女队/.test(item.sourceSheet)
      ? '女'
      : /男子|男队/.test(item.sourceSheet)
        ? '男'
        : '';
    const current = persons.get(key);
    const person: PersonRecord = current || {
      key,
      name: item.rawAthleteName,
      sourceSheet: item.sourceSheet,
      gender: '',
      team: '',
      birthDate: '',
      athleteCode: '',
      region: '',
      city: '',
      county: '',
      matchedAthleteId: null,
      suggested: [],
      messages: [],
      matched: false,
    };
    person.gender = person.gender || text(payload.gender) || genderFromSheet;
    person.team = person.team || text(payload.team);
    person.birthDate = person.birthDate || text(payload.birthDate);
    person.athleteCode = person.athleteCode || text(payload.athleteCode);
    person.region = person.region || text(payload.region);
    person.city = person.city || text(payload.city);
    person.county = person.county || text(payload.county);
    persons.set(key, person);
  }
  // 只有姓名的业务表可复用文件中唯一且无冲突的身份；多队伍、多个编号不得按姓名合并。
  const byName = new Map<string, PersonRecord[]>();
  for (const person of persons.values()) {
    const name = normalizedName(person.name);
    byName.set(name, [...(byName.get(name) || []), person]);
  }
  for (const [name, group] of byName) {
    const bare = persons.get(name);
    const qualified = group.filter(person => person.key !== name);
    if (!bare || qualified.length !== 1) continue;
    const target = qualified[0];
    if (bare.gender && target.gender && bare.gender !== target.gender) continue;
    for (const field of ['gender', 'region', 'city', 'county'] as const)
      target[field] = target[field] || bare[field];
    for (const item of items) {
      if (item.itemType === 'scoring_rule' || item.itemType === 'invalid_row') continue;
      if (dataImportPersonKey(item) === bare.key)
        item.payload = { ...item.payload, personKey: target.key };
    }
    persons.delete(bare.key);
  }
  return persons;
}

export function analyzeDataImport(input: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  project: string;
  defaultDate?: string;
  defaultArea?: { region: string; city: string; county: string };
  userId: number;
  athletes: ImportAthlete[];
  allowedTeams?: Set<string>;
  /** 重复上传时选择“重新解析文件”，按当前参数删除旧草稿并重新解析 */
  reparse?: boolean;
}) {
  input = { ...input, filename: normalizeImportFilename(input.filename) };
  if (!/\.(xls|xlsx)$/i.test(input.filename))
    throw new Error('统一数据导入当前支持 XLS 和 XLSX 文件。');
  if (input.defaultDate && !validIsoDate(input.defaultDate))
    throw new Error('默认日期格式应为 YYYY-MM-DD。');
  ensureMetricDefinitions();
  const originalHash = createHash('sha256').update(input.buffer).digest('hex');
  let fileHash = originalHash;
  const existing = db
    .prepare(
      `SELECT id, file_hash AS fileHash, parser_version AS parserVersion, status, created_by AS createdBy
       FROM data_import_batches WHERE (file_hash = ? OR file_hash LIKE ?) AND project = ?
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(originalHash, `${originalHash}:%`, input.project) as
    { id: string; fileHash: string; parserVersion: string; status: string; createdBy: number } | undefined;
  if (existing && existing.createdBy !== input.userId)
    throw new Error('同一文件已有其他账号创建的导入批次。');
  if (existing?.status === 'committed') {
    // 保留已提交批次和审计链，新批次重新检测当前正式表中的缺失与重复。
    fileHash = `${originalHash}:${randomUUID()}`;
  } else if (existing) {
    if (existing.parserVersion === DATA_IMPORT_PARSER_VERSION && !input.reparse)
      return getDataImportBatch(existing.id, input.userId, true);
    fileHash = existing.fileHash;
    db.prepare('DELETE FROM data_import_batches WHERE id = ?').run(existing.id);
  }
  const workbook = XLSX.read(input.buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: true,
    cellNF: false,
    cellStyles: false,
  });
  if (workbook.SheetNames.length > 100) throw new Error('工作表数量超过100张，已拒绝解析。');
  const items: ParsedImportItem[] = [];
  const recognizedSheets: Array<{ name: string; type: string; items: number; note: string }> = [];
  const ignoredSheets: Array<{ name: string; reason: string }> = [];
  const batchId = randomUUID();
  const batchVersion = `IMPORT-${new Date().toISOString().slice(0, 10)}-${batchId.slice(0, 8)}`;
  for (const sheetName of workbook.SheetNames) {
    const matrix = matrixForSheet(workbook, sheetName);
    const cellCount = matrix.reduce((sum, row) => sum + row.length, 0);
    if (cellCount > 400_000) throw new Error(`工作表“${sheetName}”单元格范围过大，已拒绝解析。`);
    const firstRows = matrix.slice(0, 6).flat().map(text).join('|');
    let parsed: ParsedImportItem[] = [];
    let type = '';
    let note = '';
    if (STANDARD_SHEETS.has(sheetName)) {
      parsed = parseStandardSheet(
        matrix,
        sheetName,
        input.project,
        input.filename,
        input.defaultDate || '',
        input.athletes,
        (workbook.Workbook?.Names?.some(name => name.Name === IMPORT_TEMPLATE_VERSION_NAME) === true
          && workbook.Sheets['填写说明']?.B1?.v === IMPORT_TEMPLATE_VERSION)
          || matrix.slice(0, 12).some(row => row.some(value => /\n(?:必填|条件必填|选填|系统预填)(?:：[^\n]*)?(?:｜|\n)/.test(String(value ?? ''))))
      );
      type = `统一模板·${sheetName}`;
      note = '按稳定字段名识别模板，支持字段说明及列重排';
    } else if (/个人档案/.test(sheetName)) {
      ignoredSheets.push({ name: sheetName, reason: '公式与图表展示页，不作为原始数据导入' });
      continue;
    } else if (
      /国家赛艇队体能训练负荷统计表/.test(firstRows) ||
      (firstRows.includes('姓名') && firstRows.includes('完成负荷'))
    ) {
      parsed = parseTrainingBlocks(
        matrix,
        sheetName,
        input.project,
        input.filename,
        input.athletes
      );
      type = '运动员训练执行记录';
      note = '按重复运动员小表拆分为课次和组次';
    } else if (/评分标准/.test(firstRows) || sheetName.includes('评分')) {
      parsed = parseScoringSheet(matrix, sheetName, input.project, batchVersion);
      type = '力量评分规则';
      note = '按性别、指标和分值保存为版本化规则';
    } else if (
      (sheetName === '女子' || sheetName === '男子') &&
      firstRows.includes('身体形态') &&
      firstRows.includes('基础力量')
    ) {
      parsed = parseSummarySheet(
        matrix,
        sheetName,
        input.project,
        input.filename,
        input.defaultDate || '',
        input.athletes
      );
      type = '力量素质汇总';
      note = '身体测量和力量指标分别进入正式表';
    } else if (
      (firstRows.includes('姓名') ||
        ((sheetName === '女子' || sheetName === '男子') && firstRows.includes('差值'))) &&
      (firstRows.includes('差值') ||
        firstRows.includes('2025') ||
        firstRows.includes('2.13') ||
        sheetName === '数据源')
    ) {
      parsed = parseComparisonSheet(
        matrix,
        sheetName,
        input.project,
        input.filename,
        input.defaultDate || '',
        input.athletes
      );
      type = '历史测试对比';
      note = '仅提取各日期原始值，忽略差值公式';
    }
    if (parsed.length) {
      items.push(...parsed);
      recognizedSheets.push({ name: sheetName, type, items: parsed.length, note });
    } else {
      const reason = STANDARD_SHEETS.has(sheetName) && standardHeader(matrix)
        ? '未填写业务数据（仅有表头或预填人员信息）'
        : !firstRows.replace(/\|/g, '') ? '空白工作表' : '未识别为支持的数据模板';
      ignoredSheets.push({ name: sheetName, reason });
    }
  }
  if (!items.length) throw new Error('未填写业务数据或未识别到支持的数据模板，请填写实际记录后重新上传。');
  // ---- 运动员识别与人员映射（先人员、后数据）----
  const persons = collectPersons(items);
  // 仅复用同账号、同项目、同一文件最近一次已提交的真实关联，草稿不能作为身份依据。
  const previous = db.prepare(`SELECT id FROM data_import_batches
    WHERE (file_hash = ? OR file_hash LIKE ?) AND project = ? AND created_by = ? AND status = 'committed'
    ORDER BY rowid DESC LIMIT 1`).get(originalHash, `${originalHash}:%`, input.project, input.userId) as { id: string } | undefined;
  const priorIds = new Map<string, Set<number>>();
  if (previous) {
    const priorItems = db.prepare(`SELECT raw_athlete_name AS name, payload_json AS payload, athlete_id AS athleteId
      FROM data_import_items WHERE batch_id = ? AND athlete_id IS NOT NULL AND committed_entity_id IS NOT NULL`)
      .all(previous.id) as Array<{ name: string; payload: string; athleteId: number }>;
    for (const prior of priorItems) {
      const key = dataImportPersonKey({ rawAthleteName: prior.name, payload: JSON.parse(prior.payload) as Record<string, unknown> });
      const ids = priorIds.get(key) || new Set<number>();
      ids.add(prior.athleteId);
      priorIds.set(key, ids);
    }
  }
  const allowedTeams = input.allowedTeams;
  for (const person of persons.values()) {
    const prior = priorIds.get(person.key);
    const priorId = prior?.size === 1 ? [...prior][0] : null;
    const priorAthlete = input.athletes.find(athlete => athlete.id === priorId && athlete.project === input.project);
    let resolution: PersonResolution = priorAthlete
      ? { kind: 'matched', athlete: priorAthlete, method: '同文件已提交关联' }
      : resolvePerson(
      {
        name: person.name,
        project: input.project,
        team: person.team,
        birthDate: person.birthDate,
        athleteCode: person.athleteCode,
      },
      input.athletes
    );
    // 弹窗打开前完成唯一队伍内的匹配，无需等待用户再次选择队伍。
    if (resolution.kind === 'ambiguous' && !person.team && allowedTeams?.size === 1) {
      const team = [...allowedTeams][0];
      const scoped = resolvePerson({ name: person.name, project: input.project, team,
        birthDate: person.birthDate, athleteCode: person.athleteCode }, input.athletes);
      if (scoped.kind === 'matched') resolution = scoped;
    }
    if (resolution.kind === 'matched' && resolution.athlete.active === false) {
      person.suggested = [toSuggestion(resolution.athlete)];
      person.team = person.team || resolution.athlete.team;
      person.messages.push('该运动员档案已停用，确认关联后将恢复原档案及其历史数据，不启用登录账号');
    } else if (resolution.kind === 'matched') {
      person.matched = true;
      person.matchedAthleteId = resolution.athlete.id;
      person.team = resolution.athlete.team;
      person.gender = person.gender || text(resolution.athlete.gender);
    } else if (resolution.kind === 'ambiguous' || resolution.kind === 'conflict') {
      person.suggested = resolution.suggested;
      person.messages.push(resolution.message);
    } else {
      person.messages.push('待建档：仅需姓名与所属队伍即可最小建档，其他资料可稍后在运动员档案中补充');
    }
    // 队伍自动带入：文件队伍合法时采纳；仅有一个可管理队伍时默认选择；冲突时提示人工确认。
    const teamOutOfScope = !person.matched && Boolean(person.team) && allowedTeams && !allowedTeams.has(person.team);
    if (teamOutOfScope) {
      person.messages.push(
        `文件中填写的所属队伍“${person.team}”不在当前账号权限范围内，请重新选择`
      );
      person.team = '';
    }
    if (!teamOutOfScope && !person.matched && !person.team && allowedTeams && allowedTeams.size === 1) {
      person.team = [...allowedTeams][0];
    }
    if (!person.matched && !person.team)
      person.messages.push('请在人员确认中选择所属队伍');
  }
  const personOf = (item: ParsedImportItem) => {
    if (item.itemType === 'scoring_rule' || item.itemType === 'invalid_row') return null;
    return persons.get(dataImportPersonKey(item)) || null;
  };
  for (const item of items) {
    const person = personOf(item);
    if (!person) continue;
    item.athleteId = person.matched ? person.matchedAthleteId : null;
    if (item.itemType === 'athlete_profile' && person.team && !text(item.payload.team))
      item.payload = { ...item.payload, team: person.team };
  }
  const mergedItems = consolidateImportFacts(items);
  items.splice(0, items.length, ...mergedItems);
  // ---- 统一校验（与校对、提交同一规则）----
  const candidateNames = new Set(persons.keys());
  // 权限集合只来自当前账号可访问的运动员列表，不从解析/匹配结果反推，防止越权 id 通过校验。
  const allowedAthleteIds = new Set(input.athletes.map((athlete) => athlete.id));
  for (const item of items) {
    if (item.itemType === 'invalid_row') {
      item.quality = 'error';
      continue;
    }
    item.messages = validateImportItem(item, { allowedAthletes: allowedAthleteIds, candidateNames });
    item.quality = makeQuality(item.messages, item.resolution === 'skip');
    item.conflict = item.quality === 'skipped' ? null : detectItemConflict(item as DataImportItemView);
  }
  const counts = summarizeItems(items);
  const summary = { recognizedSheets, ignoredSheets };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `
      INSERT INTO data_import_batches (
        id, file_hash, source_filename, source_mimetype, file_size, project, parser_version, status,
        sheet_count, item_count, valid_count, warning_count, error_count, summary_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reviewing', ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      batchId,
      fileHash,
      input.filename,
      input.mimetype,
      input.buffer.length,
      input.project,
      DATA_IMPORT_PARSER_VERSION,
      workbook.SheetNames.length,
      counts.itemCount,
      counts.validCount,
      counts.warningCount,
      counts.errorCount,
      JSON.stringify(summary),
      input.userId
    );
    insertItems(batchId, items);
    const insertCandidate = db.prepare(`INSERT INTO data_import_athlete_candidates (
      batch_id, normalized_name, name, project, team, gender, region, city, county,
      status, matched_athlete_id, suggested_json, confirmed, source_sheet, messages_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [key, person] of persons) {
      insertCandidate.run(
        batchId,
        key,
        person.name,
        input.project,
        person.team,
        person.gender,
        person.region || text(input.defaultArea?.region) || '未设置',
        person.city || text(input.defaultArea?.city) || '未设置',
        person.county || text(input.defaultArea?.county) || '未设置',
        person.matched ? 'matched' : 'pending',
        person.matchedAthleteId,
        JSON.stringify(person.suggested),
        person.matched ? 1 : 0,
        person.sourceSheet,
        JSON.stringify(
          person.messages.length
            ? person.messages
            : ['将创建无登录账号的运动员档案，出生日期、联系方式等资料可稍后补充']
        )
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getDataImportBatch(batchId, input.userId);
}

function mapItem(row: Record<string, unknown>): DataImportItemView {
  return {
    id: Number(row.id),
    batchId: text(row.batchId),
    itemType: row.itemType as DataImportItemType,
    athleteId: row.athleteId === null ? null : Number(row.athleteId),
    rawAthleteName: text(row.rawAthleteName),
    athleteName: text(row.athleteName),
    athleteProject: text(row.athleteProject),
    athleteTeam: text(row.athleteTeam),
    eventDate: text(row.eventDate),
    sessionLabel: text(row.sessionLabel),
    testType: text(row.testType),
    metricCode: text(row.metricCode),
    metricLabel: text(row.metricLabel),
    side: row.side as DataImportItemView['side'],
    valueNum: row.valueNum === null ? null : Number(row.valueNum),
    unit: text(row.unit),
    exerciseName: text(row.exerciseName),
    setIndex: Number(row.setIndex),
    targetReps: row.targetReps === null ? null : Number(row.targetReps),
    actualReps: row.actualReps === null ? null : Number(row.actualReps),
    actualWeightKg: row.actualWeightKg === null ? null : Number(row.actualWeightKg),
    intensityPercent: row.intensityPercent === null ? null : Number(row.intensityPercent),
    payload: JSON.parse(text(row.payloadJson) || '{}') as Record<string, unknown>,
    sourceSheet: text(row.sourceSheet),
    sourceAddress: text(row.sourceAddress),
    rawValue: text(row.rawValue),
    quality: row.quality as DataImportQuality,
    messages: JSON.parse(text(row.messagesJson) || '[]') as string[],
    businessKey: text(row.businessKey),
    resolution: (text(row.resolution) || '') as DataImportResolution,
    conflict: (() => {
      const parsed = JSON.parse(text(row.conflictJson) || 'null') as DataImportConflict | null;
      return parsed && parsed.exists !== undefined ? parsed : null;
    })(),
    committedEntityType: text(row.committedEntityType),
    committedEntityId: row.committedEntityId === null ? null : Number(row.committedEntityId),
  };
}

function computeCounts(
  items: DataImportItemView[],
  athleteCandidates: DataImportAthleteCandidate[]
): DataImportPreview['counts'] {
  const active = items.filter((item) => item.quality !== 'skipped' && item.itemType !== 'invalid_row');
  return {
    newCount: active.filter((item) => !item.conflict?.exists).length,
    duplicateCount: active.filter((item) => item.conflict?.exists).length,
    overwriteCount: active.filter(item => item.conflict?.fields.some(field => field.overwrites)).length,
    invalidCount: items.filter(
      (item) => item.resolution !== 'skip' && item.quality !== 'skipped' && (item.itemType === 'invalid_row' || item.quality === 'error')
    ).length,
    personMatched: athleteCandidates.filter((candidate) => candidate.status === 'matched').length,
    personPending: athleteCandidates.filter(
      (candidate) =>
        candidate.status === 'pending' && !candidate.excluded && !candidate.suggested.length
    ).length,
    personAmbiguous: athleteCandidates.filter(
      (candidate) =>
        candidate.status === 'pending' && !candidate.excluded && candidate.suggested.length > 0
    ).length,
  };
}

export function getDataImportBatch(
  batchId: string,
  userId: number,
  duplicateFile = false,
  reviewTargetId?: number
): DataImportPreview {
  const row = db
    .prepare(
      `
    SELECT id, source_filename AS filename, project, status, parser_version AS parserVersion,
      sheet_count AS sheetCount, item_count AS itemCount, valid_count AS validCount,
      warning_count AS warningCount, error_count AS errorCount, imported_count AS importedCount,
      skipped_count AS skippedCount, summary_json AS summaryJson, created_at AS createdAt,
      committed_at AS committedAt, created_by AS createdBy
    FROM data_import_batches WHERE id = ?
  `
    )
    .get(batchId) as Record<string, unknown> | undefined;
  if (!row || Number(row.createdBy) !== userId)
    throw new Error('未找到该导入批次，或当前账号无权访问。');
  const itemRows = db
    .prepare(
      `
    SELECT di.id, di.batch_id AS batchId, di.item_type AS itemType, di.athlete_id AS athleteId,
      di.raw_athlete_name AS rawAthleteName, di.event_date AS eventDate, di.session_label AS sessionLabel,
      di.test_type AS testType, di.metric_code AS metricCode, di.metric_label AS metricLabel, di.side,
      di.value_num AS valueNum, di.unit, di.exercise_name AS exerciseName, di.set_index AS setIndex,
      di.target_reps AS targetReps, di.actual_reps AS actualReps, di.actual_weight_kg AS actualWeightKg,
      di.intensity_percent AS intensityPercent, di.payload_json AS payloadJson, di.source_sheet AS sourceSheet,
      di.source_address AS sourceAddress, di.raw_value AS rawValue, di.quality, di.messages_json AS messagesJson,
      di.business_key AS businessKey, di.resolution, di.conflict_json AS conflictJson,
      di.committed_entity_type AS committedEntityType,
      di.committed_entity_id AS committedEntityId, a.name AS athleteName, a.project AS athleteProject, a.team AS athleteTeam
    FROM data_import_items di LEFT JOIN athletes a ON a.id = di.athlete_id
    WHERE di.batch_id = ? ${reviewTargetId === undefined ? '' : `AND EXISTS (
      SELECT 1 FROM data_import_items target WHERE target.id = ? AND target.batch_id = di.batch_id
        AND target.item_type = di.item_type
        AND (target.item_type = 'scoring_rule' OR (
          (target.athlete_id IS NOT NULL AND target.athlete_id = di.athlete_id OR target.athlete_id IS NULL AND di.athlete_id IS NULL AND (json_extract(target.payload_json, '$.personKey') IS NULL OR json_extract(di.payload_json, '$.personKey') IS NULL OR json_extract(target.payload_json, '$.personKey') = json_extract(di.payload_json, '$.personKey')))
          AND (target.item_type = 'athlete_profile' OR target.event_date = di.event_date)
        ))
    )`} ORDER BY CASE di.quality WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'valid' THEN 3 ELSE 4 END,
      di.source_sheet, di.source_address, di.id
  `
    )
    .all(...(reviewTargetId === undefined ? [batchId] : [batchId, reviewTargetId])) as Record<string, unknown>[];
  const candidateRows = db
    .prepare(
      `SELECT id, batch_id AS batchId, normalized_name AS normalizedName,
    name, project, team, gender, region, city, county, status,
    matched_athlete_id AS matchedAthleteId, created_athlete_id AS createdAthleteId,
    suggested_json AS suggestedJson, confirmed, excluded,
    source_sheet AS sourceSheet, messages_json AS messagesJson
    FROM data_import_athlete_candidates WHERE batch_id = ? ORDER BY
      CASE status WHEN 'pending' THEN 0 ELSE 1 END, excluded, name, id`
    )
    .all(batchId) as Record<string, unknown>[];
  const summary = JSON.parse(text(row.summaryJson) || '{}') as DataImportPreview['summary'];
  if (duplicateFile) summary.duplicateFile = true;
  let items = itemRows.map(mapItem);
  if (reviewTargetId !== undefined) {
    const target = items.find(item => item.id === reviewTargetId);
    if (!target) throw new Error('未找到该组导入记录');
    const key = importReviewKey(target);
    items = items.filter(item => importReviewKey(item) === key);
  }
  // 兼容当前解析器已保存的待确认草稿；读取时即时整理，正式写入仍走提交校验与事务。
  if (row.status === 'reviewing') {
    refreshImportConflicts(items);
    for (const item of items) {
      if (!item.payload.valueAutoMergeSources && !item.payload.valueAutoMerged) continue;
      item.messages = item.messages.filter(message => !message.includes('存在重复业务数据，请在集中审查卡片'));
      item.quality = makeQuality(item.messages, item.resolution === 'skip');
      item.conflict = item.quality === 'skipped' ? null : detectItemConflict(item);
    }
  }
  const athleteCandidates: DataImportAthleteCandidate[] = candidateRows.map((candidate) => ({
    id: Number(candidate.id),
    batchId: text(candidate.batchId),
    normalizedName: text(candidate.normalizedName),
    name: text(candidate.name),
    project: text(candidate.project),
    team: text(candidate.team),
    gender: text(candidate.gender),
    region: text(candidate.region),
    city: text(candidate.city),
    county: text(candidate.county),
    status: candidate.status as DataImportAthleteCandidate['status'],
    matchedAthleteId:
      candidate.matchedAthleteId === null ? null : Number(candidate.matchedAthleteId),
    createdAthleteId:
      candidate.createdAthleteId === null ? null : Number(candidate.createdAthleteId),
    suggested: JSON.parse(text(candidate.suggestedJson) || '[]') as DataImportPersonSuggestion[],
    confirmed: Number(candidate.confirmed) === 1,
    excluded: Number(candidate.excluded) === 1,
    sourceSheet: text(candidate.sourceSheet),
    messages: JSON.parse(text(candidate.messagesJson) || '[]') as string[],
  }));
  return {
    id: text(row.id),
    filename: normalizeImportFilename(text(row.filename)),
    project: text(row.project),
    status: row.status as DataImportPreview['status'],
    parserVersion: text(row.parserVersion),
    sheetCount: Number(row.sheetCount),
    itemCount: Number(row.itemCount),
    validCount: reviewTargetId === undefined ? items.filter(item => item.quality === 'valid').length : Number(row.validCount),
    warningCount: reviewTargetId === undefined ? items.filter(item => item.quality === 'warning').length : Number(row.warningCount),
    errorCount: reviewTargetId === undefined ? items.filter(item => item.quality === 'error').length : Number(row.errorCount),
    importedCount: Number(row.importedCount),
    skippedCount: Number(row.skippedCount),
    createdAt: text(row.createdAt),
    committedAt: row.committedAt ? text(row.committedAt) : null,
    summary,
    counts: computeCounts(items, athleteCandidates),
    athleteCandidates,
    items,
  };
}

export function listDataImportBatches(project: string, userId: number) {
  return (
    db
      .prepare(
        `
    SELECT id, source_filename AS filename, project, status, parser_version AS parserVersion,
      item_count AS itemCount, valid_count AS validCount, warning_count AS warningCount,
      error_count AS errorCount, imported_count AS importedCount, skipped_count AS skippedCount,
      created_at AS createdAt, committed_at AS committedAt
    FROM data_import_batches WHERE project = ? AND created_by = ? ORDER BY created_at DESC LIMIT 30
  `
      )
      .all(project, userId) as Record<string, unknown>[]
  ).map((row) => ({
    id: text(row.id),
    filename: normalizeImportFilename(text(row.filename)),
    project: text(row.project),
    status: text(row.status),
    parserVersion: text(row.parserVersion),
    itemCount: Number(row.itemCount),
    validCount: Number(row.validCount),
    warningCount: Number(row.warningCount),
    errorCount: Number(row.errorCount),
    importedCount: Number(row.importedCount),
    skippedCount: Number(row.skippedCount),
    createdAt: text(row.createdAt),
    committedAt: row.committedAt ? text(row.committedAt) : null,
  }));
}

const BODY_COMPOSITION_FIELDS: Array<readonly [string, string]> = BODY_TEMPLATE_FIELDS
  .filter(([, key]) => key !== 'armSpanCm')
  .map(([, key, , label]) => [key, label] as const);

const WELLNESS_NUMBER_FIELDS = [
  'sleepHours',
  'sleepQuality',
  'morningPulse',
  'weightKg',
  'fatigueIndex',
  'sorenessIndex',
  'moodIndex',
] as const;

const WELLNESS_STATUSES = ['', 'normal', 'attention', 'alert', 'rest', 'missing'];

const INJURY_SIDES = Object.values(INJURY_SIDE_CODES);
const INJURY_STATUSES = Object.values(INJURY_STATUS_CODES);
const STATE_LEVELS = [...Object.values(STATE_LEVEL_CODES), ''];

const NUMERIC_PAYLOAD_FIELDS: Partial<Record<DataImportItemType, readonly string[]>> = {
  wellness: WELLNESS_NUMBER_FIELDS,
  training_session: ['sessionOrder', 'durationMin', 'distanceKm', 'rpe', 'srpe', 'smvl',
    'averageHeartRate', 'maxHeartRate', 'averagePowerW', 'strokeRateSpm'],
  training_set: ['rpe', 'sessionOrder', 'plannedWeightKg', 'completed', 'durationMin', 'distanceKm'],
  test_measurement: ['durationMin', 'targetValue'],
  body_measurement: BODY_COMPOSITION_FIELDS.map(([key]) => key),
  injury_record: ['painScore'],
  competitive_state: ['overallScore', 'enduranceScore', 'powerScore', 'techniqueScore',
    'loadAdaptationScore', 'recoveryScore', 'competitionScore'],
};

/**
 * 统一业务校验：解析预览、校对修改与最终提交共用同一规则，
 * 保证“预览通过即可提交、预览报错必须修正”，不一致即视为缺陷。
 */
function validateImportItem(
  item: DataImportItemView | ParsedImportItem,
  ctx: { allowedAthletes: Set<number>; candidateNames: Set<string> }
): string[] {
  normalizeImportEnums(item);
  const messages: string[] = [];
  if (item.itemType === 'invalid_row') {
    // 无法解析的非空行：保留原始行错误说明，始终阻断提交，直至用户排除或修正。
    return item.messages.filter((message) => message.startsWith('错误：'));
  }
  const payload = item.payload || {};
  if (payload.dateSource === 'legacy_today' && item.eventDate === payload.defaultedDate)
    messages.push(`警告：旧模板日期留空，使用北京时间当天${item.eventDate}；请核对后确认导入，历史记录请修改日期`);
  if (payload.dateSource === 'selected' && item.eventDate === payload.defaultedDate)
    messages.push(`提示：日期使用上传页所选统一日期${item.eventDate}`);
  if (payload.missingSessionOrder) messages.push('错误：同人同日有多课，请在原文件补充不同课次序号后重新上传');
  if (payload.missingSetIndex) messages.push('错误：同动作有多组，请在原文件补充不同组序后重新上传');
  if (payload.valueReviewPending) messages.push('错误：存在重复业务数据，请在集中审查卡片确认最终值或填写真实日期后分别保留');
  if (Array.isArray(payload.valueImportConflicts))
    messages.push(...payload.valueImportConflicts.filter((value): value is string => typeof value === 'string').map(value => item.itemType === 'training_session' ? `${value}；若为同日不同课次，请填写不同课次序号` : value));
  if (Array.isArray(payload.importConflicts))
    messages.push(...payload.importConflicts.filter((value): value is string => typeof value === 'string').map(value => item.itemType === 'training_session' ? `${value}；若为同日不同课次，请填写不同课次序号` : value));
  if (payload.protocolRequired && !text(payload.protocol))
    messages.push(item.testType === '竞技评估' ? '错误：人工评分必须填写评估协议' : '错误：不对称指数必须填写测试协议或测试方法');
  if (typeof payload.unitConflict === 'string' && payload.unitConflict) messages.push(payload.unitConflict);
  for (const field of NUMERIC_PAYLOAD_FIELDS[item.itemType] || []) {
    if (isProvided(payload[field]) && standardNumberValue(payload[field]) === null)
      messages.push(`错误：${field}“${text(payload[field])}”必须是有效数字`);
  }
  if (item.itemType !== 'scoring_rule') {
    if (item.athleteId && !ctx.allowedAthletes.has(item.athleteId))
      messages.push('错误：所选运动员不在当前权限范围内');
    else if (!item.athleteId && !ctx.candidateNames.has(dataImportPersonKey(item)))
      messages.push('错误：缺少可创建或可匹配的运动员姓名');
    if (item.itemType !== 'athlete_profile' && !validIsoDate(item.eventDate))
      messages.push(`错误：${item.sourceSheet}!${text(payload.dateAddress) || item.sourceAddress} 日期“${text(payload.rawDate) || item.eventDate}”无效或缺失，请按YYYY-MM-DD填写；默认日期仅补空白`);
  }
  if (item.itemType === 'athlete_profile') {
    if (item.athleteId && text(payload.team)) {
      const current = db.prepare(`SELECT COALESCE(pt.name, a.team, '') AS team FROM athletes a
        LEFT JOIN project_teams pt ON pt.id = a.team_id WHERE a.id = ?`).get(item.athleteId) as { team: string } | undefined;
      if (current && current.team !== text(payload.team))
        messages.push(`警告：文件队伍“${text(payload.team)}”与档案不一致，保留已有队伍“${current.team}”，导入不执行调队`);
    }
    const gender = text(payload.gender);
    if (gender && !['男', '女'].includes(gender)) messages.push('错误：性别只能填写男或女');
    const birthDate = text(payload.birthDate);
    if (birthDate && !validIsoDate(birthDate))
      messages.push('错误：出生日期须为有效日期且不能晚于今天');
    const technicalLevel = text(payload.technicalLevel);
    if (
      technicalLevel &&
      !TECHNICAL_LEVELS.includes(technicalLevel as (typeof TECHNICAL_LEVELS)[number])
    )
      messages.push(
        '错误：技术等级须为未定级、国际级运动健将、运动健将、一级运动员、二级运动员或三级运动员'
      );
  } else if (item.itemType === 'wellness') {
    for (const field of WELLNESS_NUMBER_FIELDS) {
      const value = payload[field];
      if (isProvided(value) && numberValue(value) === null)
        messages.push('错误：恢复状态数值字段必须是数字');
    }
    if (payload.templateVersion === IMPORT_TEMPLATE_VERSION && !WELLNESS_NUMBER_FIELDS.some(field => isProvided(payload[field])) && !text(payload.status))
      messages.push('错误：每日恢复至少填写一项实际数值或明确状态，不能仅填写备注');
    const status = text(payload.status);
    if (!WELLNESS_STATUSES.includes(status))
      messages.push('错误：恢复状态不在允许范围内');
    if (payload.templateVersion === IMPORT_TEMPLATE_VERSION) {
      // 复用现行恢复日报的采集量表和单位边界，不增加科学判定阈值。
      for (const [field, label, min, max] of [
        ['sleepHours', '睡眠小时', 0, 24], ['sleepQuality', '睡眠质量', 0, 10],
        ['morningPulse', '晨脉', 25, 250], ['weightKg', '体重kg', 20, 250],
        ['fatigueIndex', '疲劳', 0, 10], ['sorenessIndex', '肌肉酸痛', 0, 10], ['moodIndex', '情绪', 0, 10],
      ] as const) {
        const value = optionalNumber(payload[field]);
        if (value !== null && (value < min || value > max)) messages.push(`错误：${label}须在${min}—${max}之间`);
      }
    }
  } else if (item.itemType === 'training_session') {
    if (payload.srpeCalculated) {
      const duration = optionalNumber(payload.durationMin);
      const rpe = optionalNumber(payload.rpe);
      payload.srpe = duration === null || rpe === null ? null : duration * rpe;
    }
    const rpe = optionalNumber(payload.rpe);
    if (rpe === null) messages.push('提示：未提供RPE，无法计算SRPE；训练记录仍可导入');
    else if (rpe < 0 || rpe > 10) messages.push('错误：RPE须在0—10之间');
    const order = optionalNumber(payload.sessionOrder);
    if (order === null || !Number.isInteger(order) || order < 1) messages.push('错误：课次序号须为正整数');
    const durationReported = Boolean(payload.durationReported) || isProvided(payload.durationMin);
    const distanceReported = Boolean(payload.distanceReported) || isProvided(payload.distanceKm);
    if (!durationReported && !distanceReported && !payload.hasStrengthSets)
      messages.push('错误：时长分钟、距离千米至少填写一项；留空不等于 0。');
    const duration = optionalNumber(payload.durationMin);
    if (durationReported && (duration === null || duration < 0 || duration > 1440))
      messages.push('错误：时长分钟须为 0—1440 的数字。');
    const distance = optionalNumber(payload.distanceKm);
    if (distanceReported && (distance === null || distance < 0 || distance > 500))
      messages.push('错误：距离千米须为 0—500 的数字。');
  } else if (item.itemType === 'training_set') {
    if (!item.exerciseName) messages.push('错误：训练动作不能为空');
    if (item.actualReps === null || item.actualReps < 0)
      messages.push('错误：实际次数不能为空且不能小于0');
    if (item.actualWeightKg === null || item.actualWeightKg < 0)
      messages.push('错误：实际重量不能为空且不能小于0');

    const order = optionalNumber(payload.sessionOrder);
    if (isProvided(payload.sessionOrder) && (order === null || !Number.isInteger(order) || order < 1)) messages.push('错误：课次序号须为正整数');
    if (Array.isArray(payload.sessionChoices) && payload.sessionChoices.length > 1) messages.push('错误：同日存在多个同名力量课，请选择所属课次序号');
    for (const field of ['plannedWeightKg', 'durationMin', 'distanceKm']) {
      const value = optionalNumber(payload[field]);
      if (value !== null && value < 0) messages.push('错误：计划重量、组次时长和距离不能小于0');
    }
    if (text(payload.trainingEnvironment) && !isStrengthTrainingEnvironment(text(payload.trainingEnvironment))) messages.push('错误：训练环境不在允许范围内');
    if (text(payload.intensityZone) && !isStrengthIntensityZone(text(payload.intensityZone))) messages.push('错误：强度区间不在允许范围内');
    const completed = optionalNumber(payload.completed);
    if (completed !== null && ![0, 1].includes(completed)) messages.push('错误：完成状态须为已完成、未完成或0、1');
  } else if (item.itemType === 'test_measurement') {
    if (payload.metricSelectionError) messages.push(String(payload.metricSelectionError));
    if (!item.metricCode && !payload.metricSelectionError) messages.push('错误：请选择测试项目');
    if (!item.unit && !payload.metricSelectionError) {
      const definition = db.prepare('SELECT unit FROM metric_definitions WHERE code = ? AND active = 1').get(item.metricCode) as { unit: string } | undefined;
      if (!definition || definition.unit !== '') messages.push('错误：指标单位无法由字典确定，请填写单位');
    }
    if (item.valueNum === null || !Number.isFinite(item.valueNum))
      messages.push('错误：测试值不能为空');
    if (item.testType === 'FMS测试' && item.valueNum !== null) {
      if (!Number.isInteger(item.valueNum) || item.valueNum < 0 || item.valueNum > 3)
        messages.push('错误：FMS各项须填写0、1、2或3分');
    }
    const durationMin = optionalNumber(payload.durationMin);
    if (durationMin !== null && durationMin <= 0) messages.push('错误：测试时长分钟须大于0');
    if (!['left', 'right', 'bilateral', 'center'].includes(item.side))
      messages.push('错误：测试侧别只能使用center、left、right或bilateral');
    if (item.valueNum !== null && item.metricCode in METRICS)
      validateMetric(item.metricCode as MetricCode, item.valueNum, messages);
  } else if (item.itemType === 'body_measurement') {
    if (item.metricCode === 'body_composition') {
      if (!BODY_COMPOSITION_FIELDS.some(([key]) => isProvided(payload[key])))
        messages.push('错误：身体测量至少填写一个数值');
      for (const [key, label] of BODY_COMPOSITION_FIELDS) {
        const value = payload[key];
        if (isProvided(value) && numberValue(value) === null)
          messages.push(`错误：${label}必须是数字`);
      }
    } else if (item.valueNum === null || !Number.isFinite(item.valueNum)) {
      messages.push('错误：测试值不能为空');
    } else if (item.metricCode in METRICS) {
      validateMetric(item.metricCode as MetricCode, item.valueNum, messages);
    }
  } else if (item.itemType === 'injury_record') {
    if (!text(payload.injuryName) || !text(payload.bodyPart))
      messages.push('错误：伤病名称和部位不能为空');
    if (!INJURY_SIDES.includes(text(payload.side))) messages.push('错误：伤病侧别不在允许范围内');
    if (!INJURY_STATUSES.includes(text(payload.status)))
      messages.push('错误：伤病状态不在允许范围内');
    const painScore = optionalNumber(payload.painScore);
    if (painScore !== null && (painScore < 0 || painScore > 10))
      messages.push('错误：疼痛评分须在0—10之间');
  } else if (item.itemType === 'competitive_state') {
    const overallScore = optionalNumber(payload.overallScore);
    if (overallScore === null || overallScore < 0 || overallScore > 100)
      messages.push('错误：新增或补录竞技状态须提供0—100的原始总分；单项一般耐力/核心力量评分可独立填写，不编造总分');
    if (!STATE_LEVELS.includes(text(payload.stateLevel)))
      messages.push('错误：竞技状态等级不在允许范围内');
    for (const [label, key] of [
      ['专项耐力', 'enduranceScore'],
      ['力量爆发', 'powerScore'],
      ['技术效率', 'techniqueScore'],
      ['负荷适应', 'loadAdaptationScore'],
      ['恢复能力', 'recoveryScore'],
      ['比赛能力', 'competitionScore'],
    ] as const) {
      const score = optionalNumber(payload[key]);
      if (score !== null && (score < 0 || score > 100))
        messages.push(`错误：${label}须在0—100之间`);
    }
  } else if (item.itemType === 'scoring_rule') {
    if (item.valueNum === null || !Number.isFinite(item.valueNum))
      messages.push('错误：评分阈值不能为空');
  }
  if (payload.templateVersion === IMPORT_TEMPLATE_VERSION && payload.fieldAddresses && typeof payload.fieldAddresses === 'object') {
    const addresses = Object.entries(payload.fieldAddresses);
    return messages.map(message => {
      if (!message.startsWith('错误：') || message.includes(`${item.sourceSheet}!`)) return message;
      const address = addresses.find(([label]) => normalizedText(message).includes(label))?.[1];
      return `错误：${item.sourceSheet}!${typeof address === 'string' ? address : item.sourceAddress} ${message.slice(3)}`;
    });
  }
  return messages;
}

function revalidateItem(
  item: DataImportItemView,
  allowedAthletes: Set<number>,
  candidateNames = new Set<string>()
) {
  const messages = validateImportItem(item, { allowedAthletes, candidateNames });
  return { messages, quality: makeQuality(messages, item.resolution === 'skip' || item.quality === 'skipped') };
}

const PAYLOAD_EDITABLE: Record<DataImportItemType, Set<string>> = {
  athlete_profile: new Set([
    'gender',
    'birthDate',
    'team',
    'region',
    'city',
    'county',
    'technicalLevel',
    'bestResult',
  ]),
  wellness: new Set([...WELLNESS_NUMBER_FIELDS, 'status', 'note']),
  training_session: new Set([
    'sessionOrder',
    'startTime',
    'trainingType',
    'structureType',
    'intensityZone',
    'content',
    'durationMin',
    'distanceKm',
    'rpe',
    'averageHeartRate',
    'maxHeartRate',
    'averagePowerW',
    'strokeRateSpm',
  ]),
  training_set: new Set(['rpe', 'sessionOrder', 'exerciseCode', 'plannedWeightKg', 'completed', 'trainingEnvironment', 'durationMin', 'distanceKm', 'intensityZone', 'trainingCategory', 'bodyPosition', 'note']),
  test_measurement: new Set(['durationMin', 'targetValue', 'protocol', 'note']),
  body_measurement: new Set([...BODY_COMPOSITION_FIELDS.map(([key]) => key), 'note']),
  injury_record: new Set([
    'injuryName',
    'bodyPart',
    'side',
    'status',
    'painScore',
    'restrictions',
    'rehabPlan',
    'reviewDate',
    'note',
  ]),
  competitive_state: new Set([
    'overallScore',
    'stateLevel',
    'enduranceScore',
    'powerScore',
    'techniqueScore',
    'loadAdaptationScore',
    'recoveryScore',
    'competitionScore',
    'note',
  ]),
  scoring_rule: new Set<string>(),
  invalid_row: new Set<string>(),
};

/** 校对修改写入真实业务字段；valueNum 与 payload 中的同一业务值保持双向同步。 */
function applyCorrection(
  current: DataImportItemView,
  correction: {
    id: number;
    athleteId?: number | null;
    eventDate?: string;
    valueNum?: number | null;
    actualReps?: number | null;
    actualWeightKg?: number | null;
    payload?: Record<string, unknown>;
    resolution?: DataImportResolution | null;
  }
): DataImportItemView {
  const next: DataImportItemView = {
    ...current,
    payload: { ...current.payload },
  };
  if ((current.payload.valueReviewDecision || current.payload.valueMergedInto || current.payload.valueReviewMemberOf) && !correction.payload?.valueReview
    && (correction.payload || 'eventDate' in correction || 'athleteId' in correction || 'valueNum' in correction))
    throw new Error('请先点击重新编辑，展开合并来源后再修改');
  if ('athleteId' in correction) next.athleteId = correction.athleteId ?? null;
  if ('eventDate' in correction) next.eventDate = text(correction.eventDate);
  if ('actualReps' in correction) next.actualReps = correction.actualReps ?? null;
  if ('actualWeightKg' in correction) next.actualWeightKg = correction.actualWeightKg ?? null;
  if ('resolution' in correction && correction.resolution !== undefined) {
    next.resolution = correction.resolution ?? '';
    if (next.resolution !== 'skip' && next.quality === 'skipped') next.quality = 'valid';
  }
  const editable = PAYLOAD_EDITABLE[next.itemType] || new Set<string>();
  if (correction.payload) {
    for (const [key, value] of Object.entries(correction.payload)) {
      if (!editable.has(key)) continue;
      if (key === 'technicalLevel') { next.payload[key] = normalizeTechnicalLevel(value); continue; }
      if (value === null) delete next.payload[key];
      else next.payload[key] = typeof value === 'string' || typeof value === 'number' ? canonicalEnumField(next.itemType, key, value) : value;
    }
  }
  if ('valueNum' in correction) {
    const value = correction.valueNum ?? null;
    next.valueNum = value;
    if (next.itemType === 'training_session') {
      next.payload = { ...next.payload, durationMin: value, durationReported: value !== null };
    } else if (next.itemType === 'wellness') {
      next.payload = { ...next.payload, sleepHours: value };
    } else if (next.itemType === 'injury_record') {
      next.payload = { ...next.payload, painScore: value };
    } else if (next.itemType === 'competitive_state') {
      next.payload = { ...next.payload, overallScore: value };
    }
  } else if (correction.payload) {
    if (next.itemType === 'training_session' && 'durationMin' in correction.payload)
      next.valueNum = optionalNumber(next.payload.durationMin);
    else if (next.itemType === 'wellness' && 'sleepHours' in correction.payload)
      next.valueNum = optionalNumber(next.payload.sleepHours);
    else if (next.itemType === 'injury_record' && 'painScore' in correction.payload)
      next.valueNum = optionalNumber(next.payload.painScore);
    else if (next.itemType === 'competitive_state' && 'overallScore' in correction.payload)
      next.valueNum = optionalNumber(next.payload.overallScore);
    else if (next.itemType === 'body_measurement' && next.metricCode === 'body_composition')
      next.valueNum = optionalNumber(next.payload.weightKg ?? next.payload.heightCm);
  }
  return next;
}

/** 合并只改暂存记录；来源及选择由服务端生成，正式入库仍走原事务与校验。 */
function applyValueReview(items: DataImportItemView[], targetId: number, raw: unknown, allowed: Set<number>, userId: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('数据审查请求无效');
  const review = raw as Record<string, unknown>;
  const target = items.find(item => item.id === targetId);
  if (!target || !reviewFields([target]).length) throw new Error('该记录不支持数据审查');
  const checkAccess = (item: DataImportItemView) => {
    if (item.athleteId && !allowed.has(item.athleteId)) throw new Error('所选运动员不在当前权限范围内');
  };
  checkAccess(target);
  if (review.action === 'draft') {
    if (target.payload.valueReviewDecision || target.payload.valueMergedInto) throw new Error('请先重新编辑合并结果');
    const draft: Record<string, Record<string, string>> = {};
    for (const key of ['choices', 'manual']) {
      const rawValues = review[key];
      if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) throw new Error('审查草稿格式无效');
      draft[key] = {};
      for (const [field, value] of Object.entries(rawValues)) {
        if (!reviewFields(items.filter(item => importReviewKey(item) === importReviewKey(target))).some(([, code]) => code === field) || typeof value !== 'string' || value.length > 10000) throw new Error('审查草稿字段无效');
        draft[key][field] = String(canonicalEnumField(target.itemType, field, value));
      }
    }
    target.payload.valueReviewDraft = draft;
    return;
  }
  if (review.action === 'reopen') {
    const decision = target.payload.valueReviewDecision as { sources?: Array<{ id: number; values: Record<string, ReviewValue> }> } | undefined;
    if (!decision?.sources) throw new Error('该组尚未合并');
    for (const source of decision.sources) {
      const item = items.find(entry => entry.id === source.id);
      if (!item || (item.id !== target.id && item.payload.valueMergedInto !== target.id && item.payload.valueReviewMemberOf !== target.id)) throw new Error('合并来源已变化，请刷新后重试');
      checkAccess(item);
      writeReviewValues(item, source.values, items.filter(entry => importReviewKey(entry) === importReviewKey(target)));
      delete item.payload.valueMergedInto;
      delete item.payload.valueReviewMemberOf;
      delete item.payload.valueReviewProtocol;
      delete item.payload.valueReviewDecision;
      item.resolution = '';
      item.quality = 'valid';

    }
    const history = Array.isArray(target.payload.valueReviewHistory) ? target.payload.valueReviewHistory : [];
    target.payload.valueReviewHistory = [...history, { ...decision, reopenedBy: userId, reopenedAt: new Date().toISOString() }];
    return;
  }
  if (review.action !== 'merge' || !Array.isArray(review.memberIds) || !review.values || typeof review.values !== 'object' || Array.isArray(review.values)) throw new Error('合并参数无效');
  const memberIds = review.memberIds;
  if (memberIds.length < (review.includeDatabase === true ? 1 : 2) || new Set(memberIds).size !== memberIds.length || !memberIds.includes(targetId)) throw new Error('请至少选择两条不同来源');
  const members = memberIds.map(id => items.find(item => item.id === id));
  if (members.some(item => !item || !reviewFields([item]).length || importReviewKey(item) !== importReviewKey(target))) throw new Error('只能合并同一业务记录的重复来源');
  const sources = members.filter((item): item is DataImportItemView => Boolean(item));
  for (const item of sources) {
    checkAccess(item);
    if (Array.isArray(item.payload.sessionChoices) && item.payload.sessionChoices.length > 1) throw new Error('请先选择所属课次，再选择冲突值');
    if (item.payload.unitConflict) throw new Error(`原始记录单位不一致，请先排除或修正来源：${item.sourceSheet}!${item.sourceAddress}`);
    if (item.resolution === 'skip' || item.payload.valueReviewDecision || item.payload.valueMergedInto || item.payload.valueReviewMemberOf) throw new Error('请先重新编辑已合并的记录');
  }
  const databaseSnapshots = review.includeDatabase === true ? sources.map(item => {
    const fresh = detectItemConflict(item);
    assertConflictUnchanged(item, fresh);
    if (item.conflict?.exists && !fresh.exists) throw new Error('数据库已有记录已变化，请刷新后重新审查');
    return { id: item.id, conflict: fresh };
  }) : [];
  const database = databaseReviewRecords(sources.map(item => ({ ...item, conflict: databaseSnapshots.find(snapshot => snapshot.id === item.id)?.conflict ?? null })));
  if (review.includeDatabase === true && !database.length) throw new Error('没有可比较的数据库已有值，请刷新后重试');
  const comparison = [...sources, ...database];
  const selected = { ...review.values } as Record<string, unknown>;
  const fields = reviewFields(comparison);
  if (Object.keys(selected).some(field => !fields.some(([, key]) => key === field))) throw new Error('合并包含不支持的字段');
  const values: Record<string, ReviewValue> = {};
  for (const [, field, , label, , kind] of fields) {
    const available = importFieldValues(comparison, field);
    if (Object.prototype.hasOwnProperty.call(selected, field)) {
      const value = selected[field];
      if (kind === 'text' ? typeof value !== 'string' || value.length > 10000 : typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}格式无效`);
      values[field] = canonicalEnumField(target.itemType, field, value as ReviewValue);
      selected[field] = values[field];
    } else if (available.length === 1) values[field] = available[0];
    else if (available.length > 1) throw new Error(`请为${label}选择最终值`);
  }
  const snapshots = sources.map(item => ({ id: item.id, sourceSheet: item.sourceSheet, sourceAddress: item.sourceAddress,
    eventDate: item.eventDate, rawDate: item.payload.rawDate,
    values: reviewValues(item, sources) }));
  const representatives = new Set<string>();
  for (const item of [target, ...sources.filter(item => item.id !== target.id)]) {
    const fact = item.itemType === 'test_measurement' ? reviewMetricKey(item) : 'record';
    if (representatives.has(fact)) {
      item.resolution = 'skip';
      item.payload.valueMergedInto = target.id;
    } else {
      representatives.add(fact);
      writeReviewValues(item, values, sources);
      if (review.includeDatabase === true) {
        item.resolution = 'update';
        if (item.itemType === 'test_measurement' && typeof values.protocol === 'string') {
          const existing = db.prepare('SELECT protocol FROM test_sessions WHERE athlete_id = ? AND test_date = ? AND test_type = ?')
            .get(item.athleteId, item.eventDate, item.testType || '力量素质测试') as { protocol: string } | undefined;
          if (text(existing?.protocol) && text(existing?.protocol) !== values.protocol)
            item.payload.valueReviewProtocol = { previous: text(existing?.protocol), next: values.protocol };
        }
      }
      if (item.id !== target.id) item.payload.valueReviewMemberOf = target.id;
    }
  }
  if (target.itemType === 'training_session' && Object.hasOwn(values, 'srpe')) target.payload.srpeCalculated = false;
  delete target.payload.valueReviewDraft;
  target.payload.valueReviewDecision = { confirmed: true, sources: snapshots, databaseSnapshots, databaseSources: database.map(item => ({ id: -item.id, values: reviewValues(item, comparison) })), choices: selected, finalValues: values, confirmedBy: userId, confirmedAt: new Date().toISOString() };

}

/** 校对与人员映射共用重新校验、冲突快照及暂存计数；调用方负责事务。 */
function persistValidatedImportItems(
  batchId: string, items: DataImportItemView[], allowed: Set<number>, candidateNames: Set<string>
) {
  const update = db.prepare(
    `UPDATE data_import_items SET athlete_id = ?, event_date = ?, value_num = ?, actual_reps = ?, actual_weight_kg = ?, unit = ?, target_reps = ?, intensity_percent = ?,
      payload_json = ?, resolution = ?, conflict_json = ?, quality = ?, messages_json = ? WHERE id = ? AND batch_id = ?`
  );
  refreshImportConflicts(items);
  for (const next of items) {
    const validation = revalidateItem(next, allowed, candidateNames);
    next.quality = validation.quality;
    next.messages = validation.messages;
    // 校对后按最终值重新检测重复与覆盖，保证预览展示的就是提交时会写入的数据。
    next.conflict = next.quality === 'skipped' ? null : detectItemConflict(next);
    update.run(
      next.athleteId,
      next.eventDate,
      next.valueNum,
      next.actualReps,
      next.actualWeightKg,
      next.unit,
      next.targetReps,
      next.intensityPercent,
      JSON.stringify(next.payload),
      next.resolution,
      JSON.stringify(next.conflict ?? {}),
      next.quality,
      JSON.stringify(next.messages),
      next.id,
      batchId
    );
  }
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS itemCount,
    SUM(quality = 'valid') AS validCount, SUM(quality = 'warning') AS warningCount, SUM(quality = 'error') AS errorCount
    FROM data_import_items WHERE batch_id = ?`
    )
    .get(batchId) as Record<string, number>;
  db.prepare(
    `UPDATE data_import_batches SET item_count = ?, valid_count = ?, warning_count = ?, error_count = ? WHERE id = ?`
  ).run(
    Number(counts.itemCount),
    Number(counts.validCount || 0),
    Number(counts.warningCount || 0),
    Number(counts.errorCount || 0),
    batchId
  );
}

export function updateDataImportItems(input: {
  batchId: string;
  reviewTargetId?: number;
  userId: number;
  athletes: ImportAthlete[];
  corrections: Array<{
    id: number;
    athleteId?: number | null;
    eventDate?: string;
    valueNum?: number | null;
    actualReps?: number | null;
    actualWeightKg?: number | null;
    payload?: Record<string, unknown>;
    resolution?: DataImportResolution | null;
  }>;
}) {
  // 超限显式拒绝而不是静默截断：截断会让用户以为全部修改已保存。
  if (input.corrections.length > 5000)
    throw new Error('单次最多保存 5000 条校对修改，请分批保存后重试。');
  if (input.reviewTargetId !== undefined && (!Number.isSafeInteger(input.reviewTargetId) || !input.corrections.length || input.corrections.some(correction =>
    correction.id !== input.reviewTargetId || Object.keys(correction).some(key => !['id', 'payload'].includes(key)) ||
    !correction.payload || Object.keys(correction.payload).some(key => key !== 'valueReview') || !correction.payload.valueReview
  ))) throw new Error('单组审查只能保存当前组的选择');
  const batch = getDataImportBatch(input.batchId, input.userId, false, input.reviewTargetId);
  if (batch.status !== 'reviewing') throw new Error('只有待审核批次可以修改。');
  const allowed = new Set(input.athletes.map((athlete) => athlete.id));
  const candidateNames = new Set(
    batch.athleteCandidates.map((candidate) => candidate.normalizedName)
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    const corrected = new Map(input.corrections.map(correction => [correction.id, correction]));
    const nextItems = batch.items.map(item => {
      const correction = corrected.get(item.id);
      const next = correction ? applyCorrection(item, correction) : { ...item, payload: { ...item.payload } };
      if (correction?.payload && Object.hasOwn(correction.payload, 'sessionOrder')) next.payload.sessionOrderProvided = true;
      if (correction?.payload && Object.hasOwn(correction.payload, 'srpe')) next.payload.srpeCalculated = false;
      if (next.itemType !== 'scoring_rule' && !next.athleteId && !correction?.athleteId) {
        const candidate = batch.athleteCandidates.find(candidate => candidate.normalizedName === dataImportPersonKey(next) && !candidate.excluded);
        if (candidate?.matchedAthleteId) next.athleteId = candidate.matchedAthleteId;
      }
      return next;
    });
    for (const correction of input.corrections) {
      if (correction.resolution === undefined) continue;
      for (const item of nextItems) if (item.payload.valueReviewMemberOf === correction.id) {
        item.resolution = correction.resolution ?? '';
        if (item.resolution !== 'skip' && item.quality === 'skipped') item.quality = 'valid';
      }
    }
    for (const correction of input.corrections) {
      if (!correction.payload || !('valueReview' in correction.payload)) continue;
      applyValueReview(nextItems, correction.id, correction.payload.valueReview, allowed, input.userId);
    }
    persistValidatedImportItems(input.batchId, nextItems, allowed, candidateNames);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getDataImportBatch(input.batchId, input.userId, false, input.reviewTargetId);
}

export function updateDataImportAthleteCandidates(input: {
  batchId: string;
  userId: number;
  allowedTeams: Set<string>;
  athletes: ImportAthlete[];
  corrections: Array<{
    id: number;
    name?: string;
    team?: string;
    gender?: string;
    /** 关联已有运动员；null 表示解除关联回到待建档 */
    matchedAthleteId?: number | null;
    /** 移除该人员，其关联业务记录一并排除 */
    excluded?: boolean;
    /** 人员确认弹窗中的确认状态（仅映射草稿，不写正式表） */
    confirmed?: boolean;
  }>;
}) {
  // 超限显式拒绝而不是静默截断：截断会让用户以为全部修改已保存。
  if (input.corrections.length > 500)
    throw new Error('单次最多保存 500 条人员修改，请分批保存后重试。');
  const batch = getDataImportBatch(input.batchId, input.userId);
  if (batch.status !== 'reviewing') throw new Error('只有待审核批次可以修改新运动员资料。');
  const update =
    db.prepare(`UPDATE data_import_athlete_candidates SET name = ?, team = ?, gender = ?,
    matched_athlete_id = ?, confirmed = ?, excluded = ?, messages_json = ?
    WHERE id = ? AND batch_id = ? AND status = 'pending'`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const correction of input.corrections) {
      const current = batch.athleteCandidates.find((candidate) => candidate.id === correction.id);
      if (!current || current.status !== 'pending') continue;
      const name = 'name' in correction ? text(correction.name) : current.name;
      const team = 'team' in correction ? text(correction.team) : current.team;
      const gender = 'gender' in correction ? text(correction.gender) : current.gender;
      const excluded = 'excluded' in correction ? Boolean(correction.excluded) : current.excluded;
      let confirmed = 'confirmed' in correction ? Boolean(correction.confirmed) : current.confirmed;
      let matchedAthleteId =
        'matchedAthleteId' in correction
          ? correction.matchedAthleteId ?? null
          : current.matchedAthleteId;
      const messages: string[] = [];
      if (!excluded && !matchedAthleteId && team) {
        const existing = input.athletes.filter(athlete => athlete.project === current.project
          && text(athlete.team) === team && normalizedName(athlete.name) === normalizedName(name)
          && athlete.active !== false);
        if (existing.length === 1) {
          matchedAthleteId = existing[0].id;
          confirmed = true;
        }
      }
      if (!excluded) {
        if (!name || name.length > 40) messages.push('姓名不能为空且不能超过40个字符');
        if (gender && !['男', '女'].includes(gender)) messages.push('性别应为男、女或暂不填写');
        if (matchedAthleteId) {
          // 关联已有运动员必须真实存在、在当前权限范围内且项目一致；不允许仅凭参数越权关联。
          const target = input.athletes.find((athlete) => athlete.id === matchedAthleteId);
          if (!target || target.project !== current.project) {
            matchedAthleteId = null;
            messages.push('所选已有运动员不存在或不在当前权限范围内');
          }
        } else if (!input.allowedTeams.has(team)) {
          messages.push('所属队伍不在当前账号权限范围内');
        }
        if (messages.length) throw new Error(`${current.name}：${messages.join('；')}`);
      }
      update.run(
        name,
        team,
        gender,
        matchedAthleteId,
        confirmed ? 1 : 0,
        excluded ? 1 : 0,
        JSON.stringify(
          excluded
            ? ['已移除该人员，其关联业务记录将一并排除']
            : matchedAthleteId
              ? ['将关联已有运动员，非空档案资料按本次导入更新']
              : ['将创建无登录账号的最小运动员档案，姓名与所属队伍以外的资料可稍后补充']
        ),
        current.id,
        input.batchId
      );
    }
    const updated = getDataImportBatch(input.batchId, input.userId);
    const candidates = new Map(updated.athleteCandidates.map(candidate => [candidate.normalizedName, candidate]));
    const allowed = new Set(input.athletes.map(athlete => athlete.id));
    const changedKeys = new Set(updated.athleteCandidates.filter(candidate => {
      const previous = batch.athleteCandidates.find(entry => entry.id === candidate.id);
      return previous && (previous.matchedAthleteId !== candidate.matchedAthleteId || previous.excluded !== candidate.excluded);
    }).map(candidate => candidate.normalizedName));
    // 身份变化使既有合并选择失效，先恢复来源，再按新身份检测冲突。
    for (const item of updated.items) {
      const decision = item.payload.valueReviewDecision as { sources?: Array<{ id: number }> } | undefined;
      if (decision?.sources?.some(source => updated.items.some(entry => entry.id === source.id && changedKeys.has(dataImportPersonKey(entry)))))
        applyValueReview(updated.items, item.id, { action: 'reopen' }, allowed, input.userId);
    }
    for (const item of updated.items) {
      const candidate = candidates.get(dataImportPersonKey(item));
      if (!candidate || candidate.status !== 'pending' || item.itemType === 'invalid_row' || item.itemType === 'scoring_rule') continue;
      item.athleteId = candidate.excluded ? null : candidate.matchedAthleteId;
      item.quality = item.resolution === 'skip' || candidate.excluded ? 'skipped' : 'valid';
    }
    persistValidatedImportItems(input.batchId, updated.items, allowed, new Set(candidates.keys()));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getDataImportBatch(input.batchId, input.userId);
}

export type UpsertResult = {
  skipped: boolean;
  entityId: number;
  sessionId?: number;
  created: boolean;
  /** 补全已有空字段的数量 */
  filled: number;
  /** 覆盖已有非空字段的数量 */
  overwritten: number;
};

function resolveItemPolicy(
  item: DataImportItemView,
  batchPolicy: 'skip' | 'update'
): 'skip' | 'update' {
  return importRecordPolicy(item, batchPolicy);
}

function upsertTrainingItem(
  item: DataImportItemView,
  batchId: string,
  userId: number,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const existingSession = findImportStrengthSession(item);
  let sessionId = existingSession?.id;
  const payload = item.payload;
  const existing = sessionId
    ? (db
        .prepare(
          'SELECT * FROM strength_result_sets WHERE training_session_id = ? AND exercise_name = ? AND set_index = ?'
        )
        .get(sessionId, item.exerciseName, item.setIndex) as Record<string, unknown> | undefined)
    : undefined;
  const category = text(payload.trainingCategory) || inferStrengthCategory(item.exerciseName);
  const position = text(payload.bodyPosition) || inferStrengthBodyPosition(item.exerciseName);
  const note = text(payload.note);
  const sourceRow = `${item.sourceSheet}!${item.sourceAddress}`;
  if (existing) {
    // 统一合并语义：最新导入的非空值更新已有记录，空白保留原值。
    const patch: Array<[string, unknown]> = [
      ['exercise_code', text(payload.exerciseCode)],
      ['planned_weight_kg', optionalNumber(payload.plannedWeightKg)],
      ['completed', optionalNumber(payload.completed)],
      ['training_environment', text(payload.trainingEnvironment)],
      ['duration_min', optionalNumber(payload.durationMin)],
      ['distance_km', optionalNumber(payload.distanceKm)],
      ['intensity_zone', text(payload.intensityZone)],
      ['target_reps', item.targetReps],
      ['actual_reps', item.actualReps],
      ['actual_weight_kg', item.actualWeightKg],
      ['intensity_percent', item.intensityPercent],
      ['training_category', category],
      ['body_position', position],
      ['rpe', optionalNumber(payload.rpe)],
      ['note', note],
    ];
    const proposed = patch.filter(
      ([column, value]) => isProvided(value) && !importReviewValuesEqual(existing[column], value)
    );
    const changed = proposed.filter(
      ([column]) => policy === 'update' || !isProvided(existing[column])
    );
    const filled = changed.filter(([column]) => !isProvided(existing[column])).length;
    const overwritten = changed.length - filled;
    if (!changed.length)
      return { skipped: true, entityId: Number(existing.id), sessionId, created: false, filled: 0, overwritten: 0 };
    const setSql = changed.map(([column]) => `${column} = ?`).join(', ');
    db.prepare(
      `UPDATE strength_result_sets SET ${setSql}, source = 'file_import', data_import_batch_id = ?, source_row = ?, original_text = ?, created_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(
      ...sqlList(changed.map(([, value]) => value)),
      batchId,
      sourceRow,
      item.rawValue,
      userId,
      Number(existing.id)
    );
    return { skipped: false, entityId: Number(existing.id), sessionId, created: false, filled, overwritten };
  }
  if (!sessionId) {
    const order = db
      .prepare(
        'SELECT COALESCE(MAX(session_order), 0) AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?'
      )
      .get(item.athleteId, item.eventDate) as { value: number };
    const inserted = db
      .prepare(
        `INSERT INTO training_sessions (
      athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content,
      duration_min, distance_km, duration_reported, distance_reported, rpe, srpe, smvl, source, quality, is_demo, created_by
    ) VALUES (?, ?, ?, '力量训练', '体能训练', 'AN', ?, 0, 0, 0, 0, NULL, 0, 0, 'file_import', ?, 0, ?)`
      )
      .run(
        item.athleteId,
        item.eventDate,
        optionalNumber(payload.sessionOrder) ?? Number(order.value) + 1,
        item.sessionLabel,
        item.quality === 'warning' ? 'partial' : 'valid',
        userId
      );
    sessionId = Number(inserted.lastInsertRowid);
  }
  const inserted = db
    .prepare(
      `INSERT INTO strength_result_sets (
    training_session_id, exercise_name, set_index, target_reps, actual_reps, actual_weight_kg,
    exercise_code, planned_weight_kg, duration_min, distance_km, training_category, body_position, training_environment, intensity_percent, intensity_zone, rpe,
    completed, note, source, data_import_batch_id, source_row, original_text, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_import', ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      item.exerciseName,
      item.setIndex,
      item.targetReps,
      item.actualReps,
      item.actualWeightKg,
      text(payload.exerciseCode),
      optionalNumber(payload.plannedWeightKg),
      optionalNumber(payload.durationMin) ?? 0,
      optionalNumber(payload.distanceKm) ?? 0,
      category,
      position,
      text(payload.trainingEnvironment) || '陆上',
      item.intensityPercent,
      text(payload.intensityZone) || 'AN',
      optionalNumber(payload.rpe),
      optionalNumber(payload.completed) ?? 1,
      note,
      batchId,
      sourceRow,
      item.rawValue,
      userId
    );
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    sessionId,
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

function updateSessionTotals(sessionId: number) {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(actual_reps * actual_weight_kg), 0) AS volume FROM strength_result_sets WHERE training_session_id = ?`
    )
    .get(sessionId) as { volume: number };
  db.prepare(
    'UPDATE training_sessions SET smvl = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(Math.round(Number(totals.volume) * 10) / 10, sessionId);
}

function upsertTestItem(
  item: DataImportItemView,
  batchId: string,
  userId: number,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const existingConflict = detectItemConflict(item);
  if (existingConflict.identical && existingConflict.entityType === 'test_measurement' && existingConflict.entityId !== null)
    return { skipped: true, entityId: existingConflict.entityId, created: false, filled: 0, overwritten: 0 };
  const storedSession = db.prepare('SELECT protocol FROM test_sessions WHERE athlete_id = ? AND test_date = ? AND test_type = ?')
    .get(item.athleteId, item.eventDate, item.testType || '力量素质测试') as { protocol: string } | undefined;
  if (text(storedSession?.protocol) && text(item.payload.protocol) && text(storedSession?.protocol) !== text(item.payload.protocol)) {
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, detail) VALUES (?, ?, ?, ?)')
      .run(userId, 'UPDATE_IMPORT_TEST_PROTOCOL', 'test_session', JSON.stringify({ batchId, athleteId: item.athleteId, date: item.eventDate, testType: item.testType, previous: storedSession?.protocol, next: text(item.payload.protocol) }));
  }
  const sessionFields = existingConflict.fields.filter(field => ['protocol', 'durationMin'].includes(field.field) && (field.overwrites || field.oldValue === ''));
  const policy = resolveItemPolicy(item, batchPolicy);
  db.prepare(
    `INSERT INTO metric_definitions (code, label, domain, unit, direction, frequency, projects_json, active)
    VALUES (?, ?, 'custom', ?, 'neutral', 'phase', '["赛艇","皮划艇","激流"]', 1)
    ON CONFLICT(code) DO UPDATE SET label=excluded.label, unit=excluded.unit, active=1, updated_at=CURRENT_TIMESTAMP`
  ).run(item.metricCode, item.metricLabel || item.metricCode, item.unit);
  const durationMin = optionalNumber(item.payload.durationMin);
  const validDurationMin = durationMin !== null && durationMin > 0 ? durationMin : null;
  db.prepare(
    `INSERT INTO test_sessions (athlete_id, test_date, test_type, duration_min, protocol, source, quality, is_demo, created_by)
    VALUES (?, ?, ?, ?, ?, 'file_import', ?, 0, ?)
    ON CONFLICT(athlete_id, test_date, test_type) DO UPDATE SET
      duration_min = COALESCE(excluded.duration_min, test_sessions.duration_min),
      protocol = CASE WHEN TRIM(excluded.protocol) <> '' THEN excluded.protocol ELSE test_sessions.protocol END,
      quality = CASE WHEN excluded.quality = 'partial' THEN 'partial' ELSE test_sessions.quality END`
  ).run(
    item.athleteId,
    item.eventDate,
    item.testType || '力量素质测试',
    validDurationMin,
    text(item.payload.protocol),
    item.quality === 'warning' ? 'partial' : 'valid',
    userId
  );
  const session = db
    .prepare(
      'SELECT id FROM test_sessions WHERE athlete_id = ? AND test_date = ? AND test_type = ?'
    )
    .get(item.athleteId, item.eventDate, item.testType || '力量素质测试') as { id: number };
  const existing = db
    .prepare(
      'SELECT id, value_num AS valueNum, target_value AS targetValue, unit, note FROM test_measurements WHERE test_session_id = ? AND metric_code = ? AND side = ?'
    )
    .get(session.id, item.metricCode, item.side) as
    | { id: number; valueNum: number | null; targetValue: number | null; unit: string; note: string }
    | undefined;
  const note = text(item.payload.note);
  if (existing) {
    const proposed = { valueNum: item.valueNum, targetValue: optionalNumber(item.payload.targetValue), unit: item.unit, note };
    const keys = ['valueNum', 'targetValue', 'unit', 'note'] as const;
    const changed = keys.filter(key => isProvided(proposed[key]) && !importReviewValuesEqual(proposed[key], existing[key])
      && (policy === 'update' || !isProvided(existing[key])));
    if (!changed.length) return { skipped: sessionFields.length === 0, entityId: existing.id, created: false, filled: sessionFields.filter(field => field.oldValue === '').length, overwritten: sessionFields.filter(field => field.overwrites).length };
    const next = { ...existing };
    for (const key of changed) Object.assign(next, { [key]: proposed[key] });
    db.prepare(`UPDATE test_measurements SET value_num = ?, target_value = ?, unit = ?, note = ?, quality = ?, source = 'file_import', is_demo = 0,
      data_import_batch_id = ?, source_ref = ? WHERE id = ?`).run(next.valueNum, next.targetValue, next.unit, next.note,
      item.quality === 'warning' ? 'partial' : 'valid', batchId, `${item.sourceSheet}!${item.sourceAddress}`, existing.id);
    const filled = changed.filter(key => !isProvided(existing[key])).length;
    return { skipped: false, entityId: existing.id, created: false, filled, overwritten: changed.length - filled };
  }
  const inserted = db
    .prepare(
      `INSERT INTO test_measurements (
    test_session_id, metric_code, value_num, target_value, unit, side, quality, source, is_demo, data_import_batch_id, source_ref, note
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'file_import', 0, ?, ?, ?)`
    )
    .run(
      session.id,
      item.metricCode,
      item.valueNum,
      optionalNumber(item.payload.targetValue),
      item.unit,
      item.side,
      item.quality === 'warning' ? 'partial' : 'valid',
      batchId,
      `${item.sourceSheet}!${item.sourceAddress}`,
      note
    );
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

function bodyColumnOf(field: string) {
  return field.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function upsertBodyItem(
  item: DataImportItemView,
  batchId: string,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const quality = item.quality === 'warning' ? 'partial' : 'valid';
  if (item.metricCode === 'body_composition') {
    const payload = item.payload;
    const existing = db
      .prepare('SELECT * FROM athlete_body_measurements WHERE athlete_id = ? AND measurement_date = ?')
      .get(item.athleteId, item.eventDate) as Record<string, unknown> | undefined;
    const provided = BODY_COMPOSITION_FIELDS.map(([key]) => [key, optionalNumber(payload[key])] as const)
      .filter(([, value]) => value !== null);
    const note = text(payload.note);
    if (existing) {
      // 统一合并语义：最新导入的非空值更新已有记录，空白保留原值。
      const isBlank = (key: string) => {
        const value = existing[bodyColumnOf(key)];
        return value === null || value === undefined;
      };
      const proposed = provided.filter(([key, value]) => {
        const column = bodyColumnOf(key);
        return !importReviewValuesEqual(existing[column], value);
      });
      const changed = proposed.filter(([key]) => policy === 'update' || isBlank(key));
      const noteChanged = isProvided(note) && text(existing.note) !== note;
      const noteApplied = noteChanged && (policy === 'update' || !text(existing.note));
      const blanks = changed.filter(([key]) => isBlank(key)).length;
      const filled = blanks + (noteApplied && !text(existing.note) ? 1 : 0);
      const overwritten =
        changed.length - blanks + (noteApplied && text(existing.note) ? 1 : 0);
      if (!changed.length && !noteApplied)
        return { skipped: true, entityId: Number(existing.id), created: false, filled: 0, overwritten: 0 };
      const setParts = changed.map(([key]) => `${bodyColumnOf(key)} = ?`);
      const params = sqlList(changed.map(([, value]) => value));
      if (noteApplied) {
        setParts.push('note = ?');
        params.push(note);
      }
      db.prepare(
        `UPDATE athlete_body_measurements SET ${setParts.join(', ')}, source = 'file_import', quality = ?, is_demo = 0, data_import_batch_id = ? WHERE id = ?`
      ).run(...params, quality, batchId, Number(existing.id));
      return { skipped: false, entityId: Number(existing.id), created: false, filled, overwritten };
    }
    const columns = ['athlete_id', 'measurement_date', ...provided.map(([key]) => bodyColumnOf(key))];
    const values: SqlValue[] = [
      item.athleteId,
      item.eventDate,
      ...sqlList(provided.map(([, value]) => value)),
    ];
    if (isProvided(note)) {
      columns.push('note');
      values.push(note);
    }
    const inserted = db
      .prepare(
        `INSERT INTO athlete_body_measurements (${columns.join(', ')}, source, quality, is_demo, data_import_batch_id)
      VALUES (${columns.map(() => '?').join(', ')}, 'file_import', ?, 0, ?)`
      )
      .run(...values, quality, batchId);
    return {
      skipped: false,
      entityId: Number(inserted.lastInsertRowid),
      created: true,
      filled: 0,
      overwritten: 0,
    };
  }
  const existing = db
    .prepare(
      'SELECT id, height_cm AS heightCm, weight_kg AS weightKg FROM athlete_body_measurements WHERE athlete_id = ? AND measurement_date = ?'
    )
    .get(item.athleteId, item.eventDate) as
    | { id: number; heightCm: number | null; weightKg: number | null }
    | undefined;
  const column = item.metricCode === 'height_cm' ? 'height_cm' : 'weight_kg';
  const current = item.metricCode === 'height_cm' ? existing?.heightCm : existing?.weightKg;
  if (existing) {
    if (current !== null && current !== undefined) {
      // 该字段已有值：跳过策略不更新已有数据；更新策略才覆盖。
      if (policy === 'skip' || importReviewValuesEqual(current, item.valueNum))
        return { skipped: true, entityId: existing.id, created: false, filled: 0, overwritten: 0 };
      db.prepare(
        `UPDATE athlete_body_measurements SET ${column} = ?, source = 'file_import', quality = ?, is_demo = 0, data_import_batch_id = ? WHERE id = ?`
      ).run(item.valueNum, quality, batchId, existing.id);
      return { skipped: false, entityId: existing.id, created: false, filled: 0, overwritten: 1 };
    }
    // 字段为空：属于补全空字段，不破坏该行其他数据。
    db.prepare(
      `UPDATE athlete_body_measurements SET ${column} = ?, source = 'file_import', quality = ?, is_demo = 0, data_import_batch_id = ? WHERE id = ?`
    ).run(item.valueNum, quality, batchId, existing.id);
    return { skipped: false, entityId: existing.id, created: false, filled: 1, overwritten: 0 };
  }
  const inserted = db
    .prepare(
      `INSERT INTO athlete_body_measurements (athlete_id, measurement_date, ${column}, source, quality, is_demo, data_import_batch_id)
    VALUES (?, ?, ?, 'file_import', ?, 0, ?)`
    )
    .run(item.athleteId, item.eventDate, item.valueNum, quality, batchId);
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

const PROFILE_DETAIL_FIELDS: Array<[string, string, string]> = [
  ['ethnicity', '民族', 'ethnicity'],
  ['phone', '手机号', 'phone'],
  ['bloodType', '血型', 'blood_type'],
  ['emergencyContact', '紧急联系人', 'emergency_contact'],
  ['emergencyPhone', '紧急电话', 'emergency_phone'],
  ['education', '学历', 'education'],
  ['technicalLevel', '技术等级', 'technical_level'],
  ['position', '位置号位', 'position'],
  ['healthStatus', '身体状态', 'health_status'],
  ['bestResult', '最好成绩', 'best_result'],
  ['nativePlace', '籍贯', 'native_place'],
  ['homeAddress', '家庭住址', 'home_address'],
  ['athleteStatus', '训练状态', 'athlete_status'],
  ['startSportDate', '开始运动日期', 'start_sport_date'],
  ['trainingVenue', '训练场地', 'training_venue'],
  ['currentEvent', '备战赛事', 'current_event'],
  ['trainingPhase', '备战阶段', 'training_phase'],
  ['campPeriod', '集训时间', 'camp_period'],
  ['originPlace', '输送地', 'origin_place'],
  ['originUnit', '输送单位', 'origin_unit'],
  ['originCoach', '输送教练', 'origin_coach'],
  ['specialties', '优势项', 'specialties'],
  ['notes', '备注', 'notes'],
];

/**
 * 运动员档案写入：区分新建 / 补全空字段 / 覆盖已有字段。
 * 空白一律视为未提供；档案非空资料按本次导入自动更新；
 * 队伍不通过导入变更，覆盖计数供结果摘要展示。
 */
function upsertAthleteProfileItem(
  item: DataImportItemView,
  batchId: string,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const p = item.payload;
  const existing = db
    .prepare(
      `SELECT a.gender, a.team_id AS teamId, a.birth_date AS birthDate,
        ap.technical_level AS technicalLevel, ap.best_result AS bestResult
      FROM athletes a LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id WHERE a.id = ?`
    )
    .get(item.athleteId) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('运动员档案不存在，无法写入档案信息。');
  const details = db
    .prepare('SELECT * FROM athlete_profiles WHERE athlete_id = ?')
    .get(item.athleteId) as Record<string, unknown> | undefined;
  const origins = db
    .prepare('SELECT * FROM athlete_origins WHERE athlete_id = ?')
    .get(item.athleteId) as Record<string, unknown> | undefined;
  let filled = 0;
  let overwritten = 0;
  const athleteSets: string[] = [];
  const athleteParams: SqlValue[] = [];
  const consider = (
    currentValue: unknown,
    newValue: string | number | null,
    apply: (value: string | number) => void,
    keepOnSkip: boolean = true
  ) => {
    const provided = isProvided(newValue);
    const current = currentValue === null || currentValue === undefined ? '' : String(currentValue);
    if (!provided) return;
    const next = String(newValue);
    if (current === next) return;
    if (!current) {
      filled += 1;
      apply(newValue as string | number);
      return;
    }
    if (policy === 'update') {
      overwritten += 1;
      apply(newValue as string | number);
      return;
    }
    if (!keepOnSkip) apply(newValue as string | number);
  };
  const birthDateText = text(p.birthDate);
  consider(existing.gender, text(p.gender), (value) => {
    athleteSets.push('gender = ?');
    athleteParams.push(value);
  });
  consider(existing.birthDate, validIsoDate(birthDateText) ? birthDateText : null, (value) => {
    athleteSets.push('birth_date = ?');
    athleteParams.push(value);
  });
  // 队伍是身份与权限归属，已有档案不通过数据导入调队。
  if (athleteSets.length) {
    db.prepare(
      `UPDATE athletes SET ${athleteSets.join(', ')}, source = 'file_import', data_import_batch_id = ? WHERE id = ?`
    ).run(...athleteParams, batchId, item.athleteId);
  }
  // 档案明细字段共用自动更新策略，空白不覆盖已有值。
  const detailSets: string[] = [];
  const detailParams: SqlValue[] = [];
  for (const [key, , column] of PROFILE_DETAIL_FIELDS) {
    const newValue = text(p[key]);
    if (!isProvided(newValue)) continue;
    const currentValue = details?.[column];
    const current = currentValue === null || currentValue === undefined ? '' : String(currentValue);
    if (current === newValue) continue;
    if (!current) {
      filled += 1;
      detailSets.push(`${column} = ?`);
      detailParams.push(newValue);
    } else if (policy === 'update') {
      overwritten += 1;
      detailSets.push(`${column} = ?`);
      detailParams.push(newValue);
    }
  }
  if (details) {
    if (detailSets.length) {
      db.prepare(
        `UPDATE athlete_profiles SET ${detailSets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE athlete_id = ?`
      ).run(...detailParams, item.athleteId);
    }
  } else {
    db.prepare(
      `INSERT INTO athlete_profiles (athlete_id, ${PROFILE_DETAIL_FIELDS.map(([, , column]) => column).join(', ')})
      VALUES (?, ${PROFILE_DETAIL_FIELDS.map(() => '?').join(', ')})`
    ).run(
      item.athleteId,
      ...PROFILE_DETAIL_FIELDS.map(([key]) => {
        const value = text(p[key]);
        return isProvided(value) ? value : '';
      })
    );
    filled += PROFILE_DETAIL_FIELDS.filter(([key]) => isProvided(text(p[key]))).length;
  }
  const region = text(p.region);
  const city = text(p.city);
  const county = text(p.county);
  if (isProvided(region) && isProvided(city)) {
    const currentProvince = origins ? String(origins.province ?? '') : '';
    const currentCity = origins ? String(origins.city ?? '') : '';
    const currentCounty = origins ? String(origins.county ?? '') : '';
    const willFill = !currentProvince || !currentCity;
    const willOverwrite =
      (currentProvince && currentProvince !== region) ||
      (currentCity && currentCity !== city) ||
      (currentCounty && isProvided(county) && currentCounty !== county);
    if (willOverwrite && policy === 'skip' && !willFill) {
      // 保留原值，不隐式更新。
    } else if (origins) {
      if (willFill) filled += 1;
      else if (willOverwrite) overwritten += 1;
      db.prepare(
        `UPDATE athlete_origins SET province = ?, city = ?, county = ?, source = 'file_import', quality = 'valid', is_demo = 0, updated_at = CURRENT_TIMESTAMP WHERE athlete_id = ?`
      ).run(region, city, county || currentCounty, item.athleteId);
    } else {
      db.prepare(
        `INSERT INTO athlete_origins (athlete_id, province, city, county, source, quality, is_demo) VALUES (?, ?, ?, ?, 'file_import', 'valid', 0)`
      ).run(item.athleteId, region, city, county);
      filled += 1;
    }
  }
  if (text(p.gender) && region && city && county)
    db.prepare(
      `UPDATE athletes SET profile_status = 'complete' WHERE id = ? AND profile_status = 'incomplete'`
    ).run(item.athleteId);
  return {
    skipped: filled + overwritten === 0,
    entityId: Number(item.athleteId),
    created: false,
    filled,
    overwritten,
  };
}

function upsertWellnessItem(
  item: DataImportItemView,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const p = item.payload;
  const existing = db
    .prepare('SELECT * FROM daily_wellness WHERE athlete_id=? AND wellness_date=?')
    .get(item.athleteId, item.eventDate) as Record<string, unknown> | undefined;
  const quality = item.quality === 'warning' ? 'partial' : 'valid';
  const map: Array<[string, string]> = [
    ['sleepHours', 'sleep_hours'],
    ['sleepQuality', 'sleep_quality'],
    ['morningPulse', 'morning_pulse'],
    ['weightKg', 'weight_kg'],
    ['fatigueIndex', 'fatigue_index'],
    ['sorenessIndex', 'soreness_index'],
    ['moodIndex', 'mood_index'],
  ];
  const provided = map
    .map(([key, column]) => [column, optionalNumber(p[key])] as const)
    .filter(([, value]) => value !== null);
  const status = text(p.status);
  const statusProvided = ['normal', 'attention', 'alert', 'rest', 'missing'].includes(status);
  if (existing) {
    // 统一合并语义：最新导入的非空值更新已有记录，空白保留原值。
    const isBlank = (column: string) => existing[column] === null || existing[column] === undefined;
    const proposed = provided.filter(
      ([column, value]) => !importReviewValuesEqual(existing[column], value)
    );
    const changed = proposed.filter(([column]) => policy === 'update' || isBlank(column));
    const statusChanged = statusProvided && text(existing.status) !== status;
    const statusApplied = statusChanged && (policy === 'update' || !text(existing.status));
    const note = text(p.note);
    const noteApplied = Boolean(note) && note !== text(existing.note) && (policy === 'update' || !text(existing.note));
    const blanks = changed.filter(([column]) => isBlank(column)).length;
    const filled = blanks + (statusApplied && !text(existing.status) ? 1 : 0) + (noteApplied && !text(existing.note) ? 1 : 0);
    const overwritten =
      changed.length - blanks + (statusApplied && text(existing.status) ? 1 : 0) + (noteApplied && text(existing.note) ? 1 : 0);
    if (!changed.length && !statusApplied && !noteApplied)
      return { skipped: true, entityId: Number(existing.id), created: false, filled: 0, overwritten: 0 };
    const setParts = changed.map(([column]) => `${column} = ?`);
    const params: SqlValue[] = sqlList(changed.map(([, value]) => value));
    if (statusApplied) {
      setParts.push('status = ?');
      params.push(status);
    }
    if (noteApplied) { setParts.push('note = ?'); params.push(note); }
    db.prepare(
      `UPDATE daily_wellness SET ${setParts.join(', ')}, source = 'file_import', quality = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...params, quality, Number(existing.id));
    return { skipped: false, entityId: Number(existing.id), created: false, filled, overwritten };
  }
  const columns = ['athlete_id', 'wellness_date', ...provided.map(([column]) => column)];
  const values: SqlValue[] = [
    item.athleteId,
    item.eventDate,
    ...sqlList(provided.map(([, value]) => value)),
  ];
  columns.push('note');
  values.push(text(p.note));
  columns.push('status');
  // 新记录才使用默认状态；已有记录绝不因空白被改写。
  values.push(statusProvided ? status : 'normal');
  const inserted = db
    .prepare(
      `INSERT INTO daily_wellness (${columns.join(', ')}, source, quality, is_demo)
      VALUES (${columns.map(() => '?').join(', ')}, 'file_import', ?, 0)`
    )
    .run(...values, quality);
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

function upsertSessionItem(
  item: DataImportItemView,
  userId: number,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const p = item.payload;
  const order = Math.max(1, Math.round(optionalNumber(p.sessionOrder) || 1));
  const existing = db
    .prepare('SELECT * FROM training_sessions WHERE athlete_id=? AND session_date=? AND session_order=?')
    .get(item.athleteId, item.eventDate, order) as Record<string, unknown> | undefined;
  const quality = item.quality === 'warning' ? 'partial' : 'valid';
  const duration = optionalNumber(p.durationMin);
  const distance = optionalNumber(p.distanceKm);
  // 时长/距离：仅在文件或校对明确提供（含真实 0）时写入；空白不改已有值。
  const durationProvided = Boolean(p.durationReported) || duration !== null;
  const distanceProvided = Boolean(p.distanceReported) || distance !== null;
  const numberFields: Array<[string, string]> = [
    ['rpe', 'rpe'],
    ['srpe', 'srpe'],
    ['smvl', 'smvl'],
    ['averageHeartRate', 'average_heart_rate'],
    ['maxHeartRate', 'max_heart_rate'],
    ['averagePowerW', 'average_power_w'],
    ['strokeRateSpm', 'stroke_rate_spm'],
  ];
  const textFields: Array<[string, string]> = [
    ['startTime', 'start_time'],
    ['trainingType', 'training_type'],
    ['structureType', 'structure_type'],
    ['intensityZone', 'intensity_zone'],
    ['content', 'content'],
  ];
  const providedNumbers = numberFields
    .map(([key, column]) => [column, optionalNumber(p[key])] as const)
    .filter(([, value]) => value !== null);
  const providedTexts = textFields
    .map(([key, column]) => [column, text(p[key])] as const)
    .filter(([, value]) => isProvided(value));
  if (existing) {
    // 统一合并语义：最新导入的非空值更新已有记录，空白保留原值。
    const changes: Array<[string, unknown]> = [];
    const proposals: Array<[string, unknown, boolean]> = [];
    const consider = (column: string, value: unknown, provided: boolean) => {
      if (!provided || value === null) return;
      const current = existing[column];
      const currentText = current === null || current === undefined ? '' : String(current);
      if (importReviewValuesEqual(current, value) || currentText === String(value)) return;
      // 时长/距离列 NOT NULL 默认 0，是否空缺以 reported 标记为准；其余字段 0 视为真实值。
      const blank =
        column === 'duration_min'
          ? Number(existing.duration_reported ?? 1) !== 1
          : column === 'distance_km'
            ? Number(existing.distance_reported ?? 1) !== 1
            : !currentText && current !== 0;
      proposals.push([column, value, blank]);
    };
    consider('duration_min', duration, durationProvided);
    consider('distance_km', distance, distanceProvided);
    for (const [column, value] of providedNumbers) consider(column, value, true);
    for (const [column, value] of providedTexts) consider(column, value, true);
    let filled = 0;
    let overwritten = 0;
    for (const [column, value, blank] of proposals) {
      if (policy === 'skip' && !blank) continue;
      if (blank) filled += 1;
      else overwritten += 1;
      changes.push([column, value]);
    }
    // 已报标记跟随字段写入：仅在实际写入时长/距离或更新策略下同步，避免 skip 改写已有元数据。
    const appliedColumn = (column: string) => changes.some(([key]) => key === column);
    if (
      durationProvided &&
      (policy === 'update' || appliedColumn('duration_min')) &&
      Number(existing.duration_reported ?? 1) !== 1
    )
      changes.push(['duration_reported', 1]);
    if (
      distanceProvided &&
      (policy === 'update' || appliedColumn('distance_km')) &&
      Number(existing.distance_reported ?? 1) !== 1
    )
      changes.push(['distance_reported', 1]);
    if (!changes.length)
      return { skipped: true, entityId: Number(existing.id), created: false, filled: 0, overwritten: 0 };
    db.prepare(
      `UPDATE training_sessions SET ${changes.map(([column]) => `${column} = ?`).join(', ')}, source = 'file_import', quality = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...sqlList(changes.map(([, value]) => value)), quality, Number(existing.id));
    return { skipped: false, entityId: Number(existing.id), created: false, filled, overwritten };
  }
  const inserted = db
    .prepare(
      `INSERT INTO training_sessions (athlete_id, session_date, session_order, start_time, training_type, structure_type, intensity_zone, content, duration_min, distance_km, duration_reported, distance_reported, rpe, srpe, smvl, average_heart_rate, max_heart_rate, average_power_w, stroke_rate_spm, source, quality, is_demo, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_import', ?, 0, ?)`
    )
    .run(
      item.athleteId,
      item.eventDate,
      order,
      text(p.startTime),
      text(p.trainingType),
      text(p.structureType),
      text(p.intensityZone),
      text(p.content),
      duration ?? 0,
      distance ?? 0,
      durationProvided ? 1 : 0,
      distanceProvided ? 1 : 0,
      optionalNumber(p.rpe),
      optionalNumber(p.srpe) ?? 0,
      optionalNumber(p.smvl) ?? 0,
      optionalNumber(p.averageHeartRate),
      optionalNumber(p.maxHeartRate),
      optionalNumber(p.averagePowerW),
      optionalNumber(p.strokeRateSpm),
      quality,
      userId
    );
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

function upsertInjuryItem(
  item: DataImportItemView,
  userId: number,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const p = item.payload;
  const existing = db
    .prepare('SELECT * FROM injury_records WHERE athlete_id=? AND onset_date=? AND injury_name=?')
    .get(item.athleteId, item.eventDate, text(p.injuryName)) as Record<string, unknown> | undefined;
  const side = canonicalCode(p.side, INJURY_SIDE_CODES, 'unspecified');
  const status = canonicalCode(p.status, INJURY_STATUS_CODES, 'observation');
  const painScore = optionalNumber(p.painScore);
  const fields: Array<[string, unknown]> = [
    ['body_part', text(p.bodyPart)],
    ['side', side],
    ['status', status],
    ['pain_score', painScore === null ? null : Math.min(10, Math.max(0, painScore))],
    ['restrictions', text(p.restrictions)],
    ['rehab_plan', text(p.rehabPlan)],
    ['review_date', text(p.reviewDate)],
    ['note', text(p.note)],
  ];
  if (existing) {
    // 统一合并语义：最新导入的非空值更新已有记录，空白保留原值。
    const isBlank = (column: string) => {
      const current = existing[column];
      return current === null || current === undefined || current === '';
    };
    const proposed = fields.filter(([column, value]) => {
      if (!isProvided(value)) return false; // 空白=未提供，不清空已有文本或数值
      const current = existing[column];
      const currentText = current === null || current === undefined ? '' : String(current);
      return !importReviewValuesEqual(current, value) && currentText !== String(value);
    });
    const changed = proposed.filter(([column]) => policy === 'update' || isBlank(column));
    const filled = changed.filter(([column]) => isBlank(column)).length;
    const overwritten = changed.length - filled;
    if (!changed.length)
      return { skipped: true, entityId: Number(existing.id), created: false, filled: 0, overwritten: 0 };
    db.prepare(
      `UPDATE injury_records SET ${changed.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`
    ).run(...sqlList(changed.map(([, value]) => value)), Number(existing.id));
    return { skipped: false, entityId: Number(existing.id), created: false, filled, overwritten };
  }
  const inserted = db
    .prepare(
      `INSERT INTO injury_records (athlete_id, record_type, injury_name, body_part, side, status, pain_score, onset_date, restrictions, rehab_plan, review_date, note, created_by) VALUES (?, 'formal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      item.athleteId,
      text(p.injuryName),
      text(p.bodyPart),
      side,
      status,
      painScore,
      item.eventDate,
      text(p.restrictions),
      text(p.rehabPlan),
      text(p.reviewDate),
      text(p.note),
      userId
    );
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

function upsertCompetitiveItem(
  item: DataImportItemView,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const p = item.payload;
  const existing = db
    .prepare('SELECT * FROM competitive_state_assessments WHERE athlete_id=? AND assessment_date=?')
    .get(item.athleteId, item.eventDate) as Record<string, unknown> | undefined;
  const quality = item.quality === 'warning' ? 'partial' : 'valid';
  const level = canonicalCode(p.stateLevel, STATE_LEVEL_CODES, '');
  const map: Array<[string, string]> = [
    ['overallScore', 'overall_score'],
    ['enduranceScore', 'endurance_score'],
    ['powerScore', 'power_score'],
    ['techniqueScore', 'technique_score'],
    ['loadAdaptationScore', 'load_adaptation_score'],
    ['recoveryScore', 'recovery_score'],
    ['competitionScore', 'competition_score'],
  ];
  const provided = map
    .map(([key, column]) => [column, optionalNumber(p[key])] as const)
    .filter(([, value]) => value !== null);
  const note = text(p.note);
  if (existing) {
    // 统一合并语义：最新导入的非空值更新已有记录，空白保留原值。
    const isBlank = (column: string) => existing[column] === null || existing[column] === undefined;
    const proposed = provided.filter(
      ([column, value]) => !importReviewValuesEqual(existing[column], value)
    );
    const changed = proposed.filter(([column]) => policy === 'update' || isBlank(column));
    const levelChanged =
      isProvided(level) && text(existing.state_level) !== level &&
      (policy === 'update' || !text(existing.state_level));
    const noteChanged =
      isProvided(note) && text(existing.note) !== note &&
      (policy === 'update' || !text(existing.note));
    const blanks = changed.filter(([column]) => isBlank(column)).length;
    const filled =
      blanks +
      (levelChanged && !text(existing.state_level) ? 1 : 0) +
      (noteChanged && !text(existing.note) ? 1 : 0);
    const overwritten =
      changed.length -
      blanks +
      (levelChanged && text(existing.state_level) ? 1 : 0) +
      (noteChanged && text(existing.note) ? 1 : 0);
    if (!changed.length && !levelChanged && !noteChanged)
      return { skipped: true, entityId: Number(existing.id), created: false, filled: 0, overwritten: 0 };
    const setParts = changed.map(([column]) => `${column} = ?`);
    const params: SqlValue[] = sqlList(changed.map(([, value]) => value));
    if (levelChanged) {
      setParts.push('state_level = ?');
      params.push(level);
    }
    if (noteChanged) {
      setParts.push('note = ?');
      params.push(note);
    }
    db.prepare(
      `UPDATE competitive_state_assessments SET ${setParts.join(', ')}, source = 'file_import', quality = ?, is_demo = 0 WHERE id = ?`
    ).run(...params, quality, Number(existing.id));
    return { skipped: false, entityId: Number(existing.id), created: false, filled, overwritten };
  }
  // 新记录：overall_score/state_level 为 NOT NULL，仅在缺失时使用既有默认档位。
  const overallScore = optionalNumber(p.overallScore);
  const inserted = db
    .prepare(
      `INSERT INTO competitive_state_assessments (athlete_id,assessment_date,overall_score,state_level,endurance_score,power_score,technique_score,load_adaptation_score,recovery_score,competition_score,note,source,quality,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,'file_import',?,0)`
    )
    .run(
      item.athleteId,
      item.eventDate,
      overallScore ?? 0,
      level || 'build',
      optionalNumber(p.enduranceScore),
      optionalNumber(p.powerScore),
      optionalNumber(p.techniqueScore),
      optionalNumber(p.loadAdaptationScore),
      optionalNumber(p.recoveryScore),
      optionalNumber(p.competitionScore),
      note,
      quality
    );
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

function upsertScoringRule(
  item: DataImportItemView,
  batchId: string,
  batchPolicy: 'skip' | 'update'
): UpsertResult {
  const policy = resolveItemPolicy(item, batchPolicy);
  const payload = item.payload;
  const project = text(payload.project);
  const gender = text(payload.gender);
  const score = optionalNumber(payload.score);
  const comparison = text(payload.comparison) || 'gte';
  const ruleVersion = text(payload.ruleVersion);
  const existing = db
    .prepare(
      `SELECT id, threshold_value AS thresholdValue, comparison FROM metric_scoring_rules WHERE project = ? AND gender = ? AND metric_code = ? AND score = ? AND rule_version = ?`
    )
    .get(project, gender, item.metricCode, score, ruleVersion) as
    | { id: number; thresholdValue: number; comparison: string }
    | undefined;
  if (existing) {
    // 统一合并语义：最新导入的非空值更新已有记录，空白保留原值。
    const blank = existing.thresholdValue === null || existing.thresholdValue === undefined;
    if (!blank && importReviewValuesEqual(existing.thresholdValue, item.valueNum) && existing.comparison === comparison)
      return { skipped: true, entityId: existing.id, created: false, filled: 0, overwritten: 0 };
    if (policy === 'skip' && !blank)
      return { skipped: true, entityId: existing.id, created: false, filled: 0, overwritten: 0 };
    db.prepare(
      'UPDATE metric_scoring_rules SET threshold_value = ?, comparison = ?, source_batch_id = ?, active = 1 WHERE id = ?'
    ).run(item.valueNum, comparison, batchId, existing.id);
    return {
      skipped: false,
      entityId: existing.id,
      created: false,
      filled: blank ? 1 : 0,
      overwritten: blank ? 0 : 1,
    };
  }
  const inserted = db
    .prepare(
      `INSERT INTO metric_scoring_rules (project, gender, metric_code, score, threshold_value, comparison, rule_version, source_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(project, gender, item.metricCode, score, item.valueNum, comparison, ruleVersion, batchId);
  return {
    skipped: false,
    entityId: Number(inserted.lastInsertRowid),
    created: true,
    filled: 0,
    overwritten: 0,
  };
}

function resolvePendingAthletes(input: {
  batch: DataImportPreview;
  userId: number;
  allowedAthletes: Set<number>;
}): {
  createdCount: number;
  linkedCount: number;
  resolvedIds: number[];
  excludedKeys: Set<string>;
} {
  const requiredNames = new Set(
    input.batch.items
      .filter(
        (item) =>
          item.itemType !== 'scoring_rule' &&
          item.itemType !== 'invalid_row' &&
          item.quality !== 'skipped' &&
          item.resolution !== 'skip'
      )
      .map((item) => dataImportPersonKey(item))
  );
  const resolved = new Map<string, number>();
  const excludedKeys = new Set<string>();
  const candidatesByName = new Map(
    input.batch.athleteCandidates.map((candidate) => [candidate.normalizedName, candidate])
  );
  let createdCount = 0;
  let linkedCount = 0;
  for (const candidate of input.batch.athleteCandidates) {
    if (candidate.excluded) {
      excludedKeys.add(candidate.normalizedName);
      continue;
    }
    if (candidate.status !== 'pending' || !requiredNames.has(candidate.normalizedName)) continue;
    if (!candidate.confirmed)
      throw new Error(`请先在人员确认中确认“${candidate.name}”的建档或关联方式。`);
    if (candidate.matchedAthleteId) {
      // 关联已有运动员：服务端重新验证存在性与权限，不覆盖已有档案。
      const target = db
        .prepare('SELECT id, name, project, active FROM athletes WHERE id = ?')
        .get(candidate.matchedAthleteId) as { id: number; name: string; project: string; active: number } | undefined;
      if (!target || target.project !== candidate.project || !input.allowedAthletes.has(target.id))
        throw new Error(`“${candidate.name}”关联的已有运动员无效或不在当前权限范围内。`);
      if (target.active === 0) {
        db.prepare('UPDATE athletes SET active = 1 WHERE id = ?').run(target.id);
        db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)')
          .run(input.userId, 'RESTORE_ATHLETE_FROM_IMPORT', 'athlete', target.id);
      }
      db.prepare(
        `UPDATE data_import_athlete_candidates SET status = 'matched', matched_athlete_id = ?, created_athlete_id = NULL WHERE id = ?`
      ).run(target.id, candidate.id);
      resolved.set(candidate.normalizedName, target.id);
      linkedCount += 1;
      continue;
    }
    const team = db
      .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
      .get(candidate.project, candidate.team) as { id: number } | undefined;
    if (!team)
      throw new Error(
        `请先在人员确认中为“${candidate.name}”选择所属队伍（${candidate.project}下未找到“${candidate.team}”）。`
      );
    const existing = db
      .prepare(`SELECT id FROM athletes WHERE name = ? AND project = ? AND team_id = ?`)
      .get(candidate.name, candidate.project, team.id);
    if (existing)
      throw new Error(`“${candidate.name}”在该队伍已有同名档案，请在人员确认中明确选择关联人员，不能自动合并。`);
    // 最小建档：仅姓名、项目、队伍与可选性别；不伪造生日等身份信息，不创建登录账号。
    const result = db
      .prepare(
        `INSERT INTO athletes (
      name, project, team, team_id, gender, region, city, county, profile_status, source, data_import_batch_id, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'incomplete', 'file_import', ?, 1)`
      )
      .run(
        candidate.name,
        candidate.project,
        candidate.team,
        team.id,
        candidate.gender || null,
        candidate.region || '未设置',
        candidate.city || '未设置',
        candidate.county || '未设置',
        input.batch.id
      );
    const athlete = { id: Number(result.lastInsertRowid) };
    db.prepare(
      `INSERT INTO athlete_origins (athlete_id, province, city, county, source, quality, is_demo)
      VALUES (?, ?, ?, ?, 'file_import', 'valid', 0)`
    ).run(athlete.id, candidate.region, candidate.city, candidate.county);
    db.prepare(`INSERT INTO athlete_profiles (athlete_id, notes) VALUES (?, ?)`).run(
      athlete.id,
      '由数据导入最小建档创建，无登录账号；出生日期等资料可稍后在运动员档案中补充。'
    );
    createdCount += 1;
    db.prepare(
      `UPDATE data_import_athlete_candidates SET status = 'created', created_athlete_id = ?, matched_athlete_id = NULL WHERE id = ?`
    ).run(athlete.id, candidate.id);
    resolved.set(candidate.normalizedName, athlete.id);
  }
  for (const item of input.batch.items) {
    if (item.itemType === 'scoring_rule' || item.itemType === 'invalid_row') continue;
    const key = dataImportPersonKey(item);
    if (excludedKeys.has(key)) {
      item.quality = 'skipped';
      db.prepare('UPDATE data_import_items SET quality = ? WHERE id = ?').run('skipped', item.id);
      continue;
    }
    if (item.athleteId) continue;
    const athleteId = resolved.get(key);
    if (!athleteId) continue;
    item.athleteId = athleteId;
    if (item.itemType === 'athlete_profile') {
      const candidate = candidatesByName.get(key);
      if (candidate && !text(item.payload.team) && candidate.team)
        item.payload = { ...item.payload, team: candidate.team };
    }
    item.messages = validateImportItem(item, {
      allowedAthletes: new Set([athleteId, ...input.allowedAthletes]),
      candidateNames: new Set(candidatesByName.keys()),
    });
    item.quality = makeQuality(item.messages, item.quality === 'skipped');
    db.prepare(
      'UPDATE data_import_items SET athlete_id = ?, payload_json = ?, quality = ?, messages_json = ? WHERE id = ?'
    ).run(
      athleteId,
      JSON.stringify(item.payload),
      item.quality,
      JSON.stringify(item.messages),
      item.id
    );
  }
  return {
    createdCount,
    linkedCount,
    resolvedIds: [...resolved.values()],
    excludedKeys,
  };
}

function assertConflictUnchanged(item: DataImportItemView, fresh: DataImportConflict) {
  const recorded = item.conflict;
  if (!recorded) return;
  if (Boolean(recorded.exists) !== Boolean(fresh.exists) || (recorded.exists && (recorded.entityId !== fresh.entityId || recorded.entityType !== fresh.entityType)))
    throw new Error('数据库已有记录已变化，请保存校对并重新确认后再提交。');
  if (!recorded.exists) return;
  for (const field of recorded.fields) {
    const freshField = fresh.fields.find((entry) => entry.field === field.field);
    if (freshField && freshField.oldValue !== field.oldValue)
      throw new Error(
        `“${item.rawAthleteName}”的${field.label}在预览后被其他操作修改（${field.oldValue || '空'}→${freshField.oldValue || '空'}），请点击保存校对，核实更新后的差异后再提交。`
      );
  }
}

export function commitDataImport(input: {
  batchId: string;
  userId: number;
  creatorRole: string;
  athletes: ImportAthlete[];
  allowedTeams?: Set<string>;
  conflictPolicy: 'skip' | 'update';
}) {
  ensureMetricDefinitions();
  const batch = getDataImportBatch(input.batchId, input.userId);
  if (batch.status === 'committed') {
    const audit = db.prepare("SELECT detail FROM audit_logs WHERE action = 'COMMIT_DATA_IMPORT' AND user_id = ? AND json_extract(detail, '$.batchId') = ? ORDER BY id DESC LIMIT 1")
      .get(input.userId, input.batchId) as { detail: string } | undefined;
    const saved = audit ? JSON.parse(audit.detail) as Record<string, number> : {};
    return {
      batch, imported: batch.importedCount, skipped: batch.skippedCount,
      createdAthletes: saved.createdAthletes ?? 0, linkedAthletes: saved.linkedAthletes ?? 0,
      createdRecords: saved.createdRecords ?? 0, updatedRecords: saved.updatedRecords ?? 0,
      filledProfileFields: saved.filledProfileFields ?? 0, overwrittenProfileFields: saved.overwrittenProfileFields ?? 0,
    };
  }
  if (batch.status !== 'reviewing') throw new Error('该批次当前不能提交。');
  if (batch.parserVersion !== DATA_IMPORT_PARSER_VERSION)
    throw new Error('该草稿使用旧版导入规则，请重新上传原文件解析并确认后再提交。');
  const allowed = new Set(input.athletes.map((athlete) => athlete.id));
  const candidateNames = new Set(
    batch.athleteCandidates.map((candidate) => candidate.normalizedName)
  );
  // 手工关联的运动员必须已在当前可访问集合内（保存关联时已校验）；
  // 不把草稿里的 matched_athlete_id 无条件并入权限集合，否则越权 id 会绕过二次验证。
  const excludedKeys = new Set(
    batch.athleteCandidates.filter((candidate) => candidate.excluded).map((c) => c.normalizedName)
  );
  const importable = batch.items.filter(
    (item) =>
      item.quality !== 'skipped' &&
      item.resolution !== 'skip' &&
      item.itemType !== 'invalid_row' &&
      !excludedKeys.has(dataImportPersonKey(item))
  );
  const invalidRows = batch.items.filter(
    (item) => item.itemType === 'invalid_row' && item.resolution !== 'skip'
  );
  if (invalidRows.length)
    throw new Error(
      `仍有${invalidRows.length}个非空错误行（缺少姓名、非法数值等）未处理；这类行无法在页面修改，请在列表中排除后重新提交，需保留该数据时请在原文件中修正并重新上传。`
    );
  const candidateWithoutTeam = batch.athleteCandidates.find(
    (candidate) =>
      candidate.status === 'pending' &&
      !candidate.excluded &&
      !candidate.matchedAthleteId &&
      importable.some(
        (item) =>
          !item.athleteId && dataImportPersonKey(item) === candidate.normalizedName
      ) &&
      !text(candidate.team)
  );
  if (candidateWithoutTeam)
    throw new Error(`请先在人员确认中为“${candidateWithoutTeam.name}”选择所属队伍。`);
  const candidateTeamOutOfScope = batch.athleteCandidates.find(
    (candidate) =>
      candidate.status === 'pending' &&
      !candidate.excluded &&
      !candidate.matchedAthleteId &&
      text(candidate.team) &&
      input.allowedTeams &&
      !input.allowedTeams.has(text(candidate.team))
  );
  if (candidateTeamOutOfScope)
    throw new Error(`“${candidateTeamOutOfScope.name}”选择的所属队伍不在当前账号权限范围内。`);
  refreshImportConflicts(importable);
  const invalid = importable.filter(
    (item) =>
      revalidateItem(item, allowed, candidateNames).quality === 'error'
  );
  if (invalid.length)
    throw new Error(
      `仍有${invalid.length}条数据未通过校验（如${invalid[0].sourceSheet}!${invalid[0].sourceAddress}），请先修正红色字段。`
    );
  let imported = 0;
  let skipped = batch.items.filter((item) => item.quality === 'skipped').length;
  let createdRecords = 0;
  let updatedRecords = 0;
  let filledProfileFields = 0;
  let overwrittenProfileFields = 0;
  const previewAthleteIds = new Set(batch.items.filter(item => item.athleteId).map(item => item.id));
  const sessionIds = new Set<number>();
  const explicitTotalIds = new Set<number>();
  // 赋值发生在事务内且失败即回滚抛出，后续返回必然已赋值。
  let createdAthletes!: number;
  let linkedAthletes!: number;
  db.exec('BEGIN IMMEDIATE');
  try {
    const resolution = resolvePendingAthletes({
      batch,
      userId: input.userId,
      allowedAthletes: allowed,
    });
    createdAthletes = resolution.createdCount;
    linkedAthletes = resolution.linkedCount;
    for (const athleteId of resolution.resolvedIds) allowed.add(athleteId);
    refreshImportConflicts(importable.filter(item => !resolution.excludedKeys.has(dataImportPersonKey(item))));
    if (importable.some(item => !resolution.excludedKeys.has(dataImportPersonKey(item)) && (item.payload.valueReviewPending || Array.isArray(item.payload.valueImportConflicts))))
      throw new Error('人员关联后出现重复业务数据，请保存校对并重新审查后提交');
    const savedConflicts = new Map((db.prepare('SELECT id, conflict_json AS conflictJson FROM data_import_items WHERE batch_id = ?')
      .all(input.batchId) as Array<{ id: number; conflictJson: string }>).map(row => [row.id, JSON.parse(row.conflictJson || '{}') as DataImportConflict]));
    const freshConflicts = new Map(importable.map(item => [item.id, detectItemConflict(item)]));
    for (const item of [...importable].sort((a, b) => Number(b.itemType === 'training_session') - Number(a.itemType === 'training_session'))) {
      if (item.payload.valueAutoMerged || resolution.excludedKeys.has(dataImportPersonKey(item))) {
        skipped += 1;
        continue;
      }
      // 提交时基于最新数据库状态重新判定重复与覆盖；预览后被并发修改的覆盖必须重新确认。
      const fresh = freshConflicts.get(item.id)!;
      const anchor = batch.items.find(entry => entry.id === item.payload.valueReviewMemberOf) || item;
      const decision = anchor.payload.valueReviewDecision as { databaseSnapshots?: Array<{ id: number; conflict: DataImportConflict }> } | undefined;
      const snapshot = decision?.databaseSnapshots?.find(snapshot => snapshot.id === item.id);
      // 新建档案在本事务产生，不与建档前的空快照比较。
      const recorded = snapshot?.conflict ?? savedConflicts.get(item.id);
      if ((item.itemType === 'scoring_rule' || previewAthleteIds.has(item.id)) && recorded)
        assertConflictUnchanged({ ...item, conflict: recorded }, fresh);
      let result: UpsertResult;
      let entityType = '';
      if (item.itemType === 'athlete_profile') {
        result = upsertAthleteProfileItem(item, input.batchId, input.conflictPolicy);
        entityType = 'athlete';
      } else if (item.itemType === 'wellness') {
        result = upsertWellnessItem(item, input.conflictPolicy);
        entityType = 'daily_wellness';
      } else if (item.itemType === 'training_session') {
        result = upsertSessionItem(item, input.userId, input.conflictPolicy);
        if (optionalNumber(item.payload.smvl) !== null) explicitTotalIds.add(result.entityId);
        entityType = 'training_session';
      } else if (item.itemType === 'training_set') {
        result = upsertTrainingItem(item, input.batchId, input.userId, input.conflictPolicy);
        entityType = 'strength_result_set';
        if (result.sessionId && !result.skipped) sessionIds.add(result.sessionId);
      } else if (item.itemType === 'test_measurement') {
        result = upsertTestItem(item, input.batchId, input.userId, input.conflictPolicy);
        entityType = 'test_measurement';
      } else if (item.itemType === 'body_measurement') {
        result = upsertBodyItem(item, input.batchId, input.conflictPolicy);
        entityType = 'athlete_body_measurement';
      } else if (item.itemType === 'injury_record') {
        result = upsertInjuryItem(item, input.userId, input.conflictPolicy);
        entityType = 'injury_record';
      } else if (item.itemType === 'competitive_state') {
        result = upsertCompetitiveItem(item, input.conflictPolicy);
        entityType = 'competitive_state_assessment';
      } else {
        result = upsertScoringRule(item, input.batchId, input.conflictPolicy);
        entityType = 'metric_scoring_rule';
      }
      if (result.skipped) {
        skipped += 1;
      } else {
        imported += 1;
        if (result.created) createdRecords += 1;
        else updatedRecords += 1;
        filledProfileFields += result.filled;
        overwrittenProfileFields += result.overwritten;
      }
      db.prepare(
        'UPDATE data_import_items SET committed_entity_type = ?, committed_entity_id = ? WHERE id = ?'
      ).run(entityType, result.entityId, item.id);
    }
    for (const sessionId of sessionIds) if (!explicitTotalIds.has(sessionId)) updateSessionTotals(sessionId);
    db.prepare(
      `UPDATE data_import_batches SET status = 'committed', imported_count = ?, skipped_count = ?, committed_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(imported, skipped, input.batchId);
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(
      input.userId,
      'COMMIT_DATA_IMPORT',
      'data_import_batch',
      null,
      JSON.stringify({
        batchId: input.batchId,
        imported,
        skipped,
        createdRecords,
        updatedRecords,
        filledProfileFields,
        overwrittenProfileFields,
        createdAthletes,
        linkedAthletes,
        conflictPolicy: 'update',
      })
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    batch: getDataImportBatch(input.batchId, input.userId),
    imported,
    skipped,
    createdAthletes,
    linkedAthletes,
    createdRecords,
    updatedRecords,
    filledProfileFields,
    overwrittenProfileFields,
  };
}
