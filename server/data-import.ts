import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from '@e965/xlsx';
import { db } from './db.ts';
import { inferStrengthBodyPosition, inferStrengthCategory } from '../shared/strength-training.ts';

// v4：统一 CJK 兼容字形，避免“张欣⾬ / 张欣雨”被拆成两名运动员。
// 同一文件重新上传时会按新版本重新解析，而不是复用旧的待审核批次。
export const DATA_IMPORT_PARSER_VERSION = 'deterministic-v4-unified-template';

export type ImportAthlete = {
  id: number;
  name: string;
  project: string;
  team: string;
  gender: string;
};

export type DataImportItemType = 'athlete_profile' | 'wellness' | 'training_session' | 'training_set' | 'test_measurement' | 'body_measurement' | 'injury_record' | 'competitive_state' | 'scoring_rule';
export type DataImportQuality = 'valid' | 'warning' | 'error' | 'skipped';

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
  athleteCandidates: DataImportAthleteCandidate[];
  items: DataImportItemView[];
};

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
  status: 'pending' | 'matched' | 'created';
  matchedAthleteId: number | null;
  createdAthleteId: number | null;
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
  single_leg_squat_reps: { label: '单腿蹲', unit: '次', domain: 'strength_endurance', min: 0, max: 100 },
  pull_ups_reps: { label: '引体向上', unit: '次', domain: 'strength_endurance', min: 0, max: 100 },
  squat_kg: { label: '深蹲', unit: 'kg', domain: 'strength', min: 0, max: 450 },
  deadlift_kg: { label: '硬拉', unit: 'kg', domain: 'strength', min: 0, max: 500 },
  hip_thrust_kg: { label: '臀推', unit: 'kg', domain: 'strength', min: 0, max: 600 },
  bench_press_kg: { label: '卧推', unit: 'kg', domain: 'strength', min: 0, max: 350 },
  bench_pull_kg: { label: '卧拉', unit: 'kg', domain: 'strength', min: 0, max: 350 },
  clean_kg: { label: '高翻', unit: 'kg', domain: 'explosive', min: 0, max: 300 },
  vertical_jump_cm: { label: '纵跳', unit: 'cm', domain: 'explosive', min: 0, max: 120 }
} as const;

type MetricCode = keyof typeof METRICS;

const LEGACY_METRIC_KEYS: Partial<Record<MetricCode | `${MetricCode}:left` | `${MetricCode}:right`, string>> = {
  height_cm: 'heightCm',
  weight_kg: 'weightKg',
  training_years: 'trainingYears',
  arm_span_cm: 'armSpanCm',
  sit_reach_cm: 'sitReachCm',
  front_plank_sec: 'frontPlankSec',
  'side_plank_sec:left': 'leftPlankSec',
  'side_plank_sec:right': 'rightPlankSec',
  'single_leg_squat_reps:left': 'leftSingleLegSquatReps',
  'single_leg_squat_reps:right': 'rightSingleLegSquatReps',
  pull_ups_reps: 'pullUpsReps',
  squat_kg: 'squatKg',
  deadlift_kg: 'deadliftKg',
  bench_press_kg: 'benchPressKg',
  bench_pull_kg: 'benchPullKg',
  clean_kg: 'highPullKg',
  vertical_jump_cm: 'verticalJumpCm'
};

function text(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateToIso(value);
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizedText(value: unknown) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[\s_()（）/\\\-·]/g, '');
}

function normalizedName(value: unknown) {
  // 部分 Excel 会把“雨”等汉字写为 CJK 部首兼容字（例如“⾬”）。
  // NFKC 不会统一这类字符，须先映射，避免同一运动员被误判为新建档案。
  return text(value).normalize('NFKC').replaceAll('⾬', '雨').replace(/[\s·•]/g, '');
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(text(value).replace(/,/g, '').replace(/kg|cm|秒|次|年/gi, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateToIso(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function workbookYear(filename: string) {
  const matches = [...filename.matchAll(/(20\d{2})/g)].map((match) => Number(match[1]));
  return matches.find((year) => year >= 2000 && year <= 2100) || new Date().getFullYear();
}

function parseDate(value: unknown, yearHint: number): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateToIso(value);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = text(value).replace(/年|\//g, '-').replace(/月|\./g, '-').replace(/日/g, '');
  let match = raw.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (match) return `${yearHint}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return '';
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

function matchAthlete(name: string, project: string, athletes: ImportAthlete[]) {
  const normalized = normalizedName(name);
  const direct = athletes.filter((athlete) => athlete.project === project && normalizedName(athlete.name) === normalized);
  if (direct.length === 1) return direct[0];
  const alias = db.prepare(`
    SELECT a.id, a.name, a.project, a.team, a.gender
    FROM athlete_aliases aa JOIN athletes a ON a.id = aa.athlete_id
    WHERE aa.normalized_alias = ? AND aa.project = ? AND a.active = 1
  `).all(normalized, project) as ImportAthlete[];
  return alias.length === 1 ? alias[0] : null;
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
  if (value < metric.min || value > metric.max) messages.push(`警告：${metric.label}${value}${metric.unit}超出建议复核范围${metric.min}—${metric.max}${metric.unit}`);
}

function itemBase(input: Partial<ParsedImportItem> & Pick<ParsedImportItem, 'itemType' | 'sourceSheet' | 'sourceAddress'>): ParsedImportItem {
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
    businessKey: input.businessKey || ''
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
    businessKey: `${input.athlete?.id || 0}|${input.date}|strength-test|${input.code}|${side}`
  });
}

function parseSummarySheet(matrix: Matrix, sheet: string, project: string, filename: string, defaultDate: string, athletes: ImportAthlete[]) {
  const items: ParsedImportItem[] = [];
  const year = workbookYear(filename);
  const date = defaultDate || dateFromName(filename, year);
  const mapping: Array<[number, MetricCode, ParsedImportItem['side']?]> = [
    [4, 'height_cm'], [5, 'weight_kg'], [6, 'arm_span_cm'], [7, 'sit_reach_cm'],
    [8, 'supine_support_sec'], [9, 'front_plank_sec'], [10, 'side_plank_sec', 'left'],
    [11, 'side_plank_sec', 'right'], [12, 'single_leg_squat_reps', 'left'],
    [13, 'single_leg_squat_reps', 'right'], [14, 'pull_ups_reps'], [15, 'squat_kg'],
    [16, 'deadlift_kg'], [17, 'hip_thrust_kg'], [18, 'bench_press_kg'], [19, 'bench_pull_kg'],
    [20, 'clean_kg'], [21, 'vertical_jump_cm']
  ];
  for (let row = 4; row < matrix.length; row += 1) {
    const rawName = text(matrix[row]?.[1]);
    if (!rawName || /平均|合计|备注/.test(rawName)) continue;
    const athlete = matchAthlete(rawName, project, athletes);
    for (const [column, code, side] of mapping) {
      const value = numberValue(matrix[row]?.[column]);
      if (value === null) continue;
      items.push(testItem({ athlete, rawName, date, code, side, value, sheet, address: cellAddress(row, column) }));
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

function parseComparisonSheet(matrix: Matrix, sheet: string, project: string, filename: string, defaultDate: string, athletes: ImportAthlete[]) {
  const items: ParsedImportItem[] = [];
  const year = workbookYear(filename);
  let identityRow = matrix.slice(0, 6).findIndex((row) => row?.some((value) => normalizedText(value) === '姓名'));
  let nameColumn = identityRow >= 0 ? matrix[identityRow].findIndex((value) => normalizedText(value) === '姓名') : -1;
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
  const inferredCurrentDate = defaultDate || [...currentDates].sort().at(-1) || dateFromName(filename, year);
  const columnMetrics = new Map<number, MetricCode>();
  let activeMetric: MetricCode | null = null;
  const maxColumns = Math.max(...matrix.slice(0, 5).map((row) => row?.length || 0), 0);
  for (let column = 0; column < maxColumns; column += 1) {
    const tokens = [matrix[1]?.[column], matrix[2]?.[column], matrix[3]?.[column]];
    if (tokens.some((value) => /差值/.test(text(value)))) { activeMetric = null; continue; }
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
      const labelTokens = [matrix[1]?.[column], matrix[2]?.[column], matrix[3]?.[column]].map(text).join('|');
      if (/差值/.test(labelTokens)) continue;
      let side: ParsedImportItem['side'] = 'center';
      const sideToken = normalizedText(matrix[2]?.[column]) + normalizedText(matrix[3]?.[column]);
      if (sideToken.includes('左')) side = 'left';
      else if (sideToken.includes('右')) side = 'right';
      const date = headerDate(matrix, column, year, inferredCurrentDate);
      items.push(testItem({ athlete, rawName, date, code, side, value, sheet, address: cellAddress(row, column) }));
    }
  }
  return items;
}

function parseIntensity(value: unknown, index: number) {
  const values = text(value).match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return values[index] ?? values[0] ?? null;
}

function parseTrainingBlocks(matrix: Matrix, sheet: string, project: string, filename: string, athletes: ImportAthlete[]) {
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
    const blockEnd = next && next.row === anchor.row ? next.column : (matrix[anchor.row]?.length || anchor.column + 14);
    const rawName = text(matrix[anchor.row]?.slice(anchor.column + 1, blockEnd).find((value) => {
      const normalized = normalizedText(value);
      return normalized && normalized !== '性别' && normalized !== '男' && normalized !== '女';
    }));
    if (!rawName) continue;
    const athlete = matchAthlete(rawName, project, athletes);
    const dateValues = (matrix[anchor.row + 2] || []).slice(anchor.column, Math.min(blockEnd, anchor.column + 4));
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
      const plannedReps = [5, 6, 7].map((offset) => numberValue(matrix[row]?.[anchor.column + offset]));
      const weights = [9, 10, 11].map((offset) => numberValue(matrix[row]?.[anchor.column + offset]));
      const completedTotal = numberValue(matrix[row]?.[anchor.column + 12]);
      const available = weights.map((weight, index) => ({ weight, index })).filter((entry) => entry.weight !== null);
      if (!available.length) {
        const messages = ['未记录完成重量，本行保留在暂存区但不会写入正式训练结果'];
        if (!athlete) messages.unshift('警告：未匹配到已有运动员，提交时将创建无登录账号的待补全档案');
        items.push(itemBase({
          itemType: 'training_set', athleteId: athlete?.id || null, rawAthleteName: rawName,
          eventDate, sessionLabel: sheet, exerciseName, setIndex: 1, targetReps: plannedReps[0],
          sourceSheet: sheet, sourceAddress: cellAddress(row, anchor.column + 2), rawValue: exerciseName,
          quality: makeQuality(messages, true), messages, payload: { completedTotal, sourcePattern: 'athlete-block' }
        }));
        continue;
      }
      const expectedTotal = plannedReps.reduce<number>((sum, value) => sum + (value || 0), 0);
      for (const { weight, index } of available) {
        const messages: string[] = [];
        if (!athlete) messages.push('警告：未匹配到已有运动员，提交时将创建无登录账号的待补全档案');
        if (!validIsoDate(eventDate)) messages.push('错误：缺少有效训练日期，请在预览中补充');
        if (dateConflict) messages.push(`警告：工作表名称日期${sheetDate}与单元格日期${internalDate}不一致，当前采用单元格日期`);
        if (completedTotal === null) messages.push('警告：未逐组记录完成次数，暂按计划次数作为实际次数');
        else if (expectedTotal && Math.abs(completedTotal - expectedTotal) > 0.01) messages.push(`警告：完成总次数${completedTotal}与计划次数合计${expectedTotal}不一致`);
        if ((weight || 0) <= 2) messages.push(`警告：完成重量${weight}kg疑似勾选值，请人工复核`);
        const targetReps = plannedReps[index] ?? null;
        const actualReps = targetReps;
        const intensityPercent = parseIntensity(matrix[row]?.[anchor.column + 3], index);
        const sourceAddress = cellAddress(row, anchor.column + 9 + index);
        items.push(itemBase({
          itemType: 'training_set', athleteId: athlete?.id || null, rawAthleteName: rawName,
          eventDate, sessionLabel: sheet, exerciseName, setIndex: index + 1,
          targetReps, actualReps, actualWeightKg: weight, intensityPercent,
          payload: { completedTotal, sourcePattern: 'athlete-block', trainingCategory: inferStrengthCategory(exerciseName), bodyPosition: inferStrengthBodyPosition(exerciseName) },
          sourceSheet: sheet, sourceAddress, rawValue: String(weight), quality: makeQuality(messages), messages,
          businessKey: `${athlete?.id || 0}|${eventDate}|${sheet}|${exerciseName}|${index + 1}`
        }));
      }
    }
  }
  return items;
}

function parseScoringSheet(matrix: Matrix, sheet: string, project: string, batchVersion: string) {
  const items: ParsedImportItem[] = [];
  const headerRow = matrix.findIndex((row) => row?.some((value) => normalizedText(value) === '评分'));
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
      items.push(itemBase({
        itemType: 'scoring_rule', metricCode: activeMetric, metricLabel: metric.label, valueNum: threshold,
        unit: metric.unit, payload: { project, gender, score, comparison: 'gte', ruleVersion: batchVersion },
        sourceSheet: sheet, sourceAddress: cellAddress(row, column), rawValue: String(threshold), quality: 'valid',
        businessKey: `${project}|${gender}|${activeMetric}|${score}|${batchVersion}`
      }));
    }
  }
  return items;
}

const FMS_TEMPLATE_METRICS = [
  ['深蹲', 'fms_deep_squat', '深蹲'],
  ['跨栏步', 'fms_hurdle_step', '跨栏步'],
  ['直线弓步蹲', 'fms_inline_lunge', '直线弓步蹲'],
  ['肩部灵活性', 'fms_shoulder_mobility', '肩部灵活性'],
  ['主动直腿上抬', 'fms_active_straight_leg_raise', '主动直腿上抬'],
  ['躯干稳定俯卧撑', 'fms_trunk_stability_pushup', '躯干稳定俯卧撑'],
  ['旋转稳定性', 'fms_rotary_stability', '旋转稳定性']
] as const;

const CHAMPION_TEMPLATE_METRICS = [
  ['身高cm', 'heightCm', '身高', 'cm'],
  ['臂展cm', 'armSpanCm', '臂展', 'cm'],
  ['体脂率%', 'body_fat_pct', '体脂率', '%'],
  ['骨骼肌kg', 'skeletal_muscle_kg', '骨骼肌量', 'kg'],
  ['一般耐力评分', 'general_endurance_score', '一般耐力', '分'],
  ['VO2Max', 'vo2max_ml_kg_min', '最大摄氧量', 'ml/kg/min'],
  ['不对称指数%', 'asymmetry_index_pct', '不对称指数', '%'],
  ['CMJ峰值功率W', 'cmj_peak_power_w', 'CMJ峰值功率', 'W'],
  ['无氧功率W/kg', 'anaerobic_power_wkg', '无氧功率', 'W/kg'],
  ['IMTP峰值力量N', 'imtp_peak_force_n', 'IMTP峰值力量', 'N'],
  ['核心力量评分', 'core_strength_score', '核心力量', '分']
] as const;

const STANDARD_SHEETS = new Set(['运动员信息', '身体测量', '恢复状态', '训练课次', '力量训练组次', '测试指标', 'FMS测试', '冠军模型测试', '伤病记录', '竞技状态']);

function standardHeader(matrix: Matrix) {
  const rowIndex = matrix.slice(0, 12).findIndex((row) => row?.some((value) => normalizedText(value) === '姓名'));
  if (rowIndex < 0) return null;
  const columns = new Map<string, number>();
  for (let column = 0; column < (matrix[rowIndex]?.length || 0); column += 1) {
    const key = normalizedText(matrix[rowIndex]?.[column]);
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

function parseStandardSheet(matrix: Matrix, sheet: string, project: string, filename: string, defaultDate: string, athletes: ImportAthlete[]) {
  const header = standardHeader(matrix);
  if (!header) return [];
  const items: ParsedImportItem[] = [];
  const year = workbookYear(filename);
  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const rawName = standardText(row, header.columns, '姓名');
    if (!rawName || /^示例/.test(rawName)) continue;
    const athlete = matchAthlete(rawName, project, athletes);
    const rowDate = parseDate(standardValue(row, header.columns, '日期', '测量日期', '测试日期', '发生日期', '评估日期'), year) || defaultDate;
    const messages: string[] = [];
    if (!athlete) messages.push('警告：未匹配到已有运动员，提交时将创建无登录账号的待补全档案');
    const base = {
      athleteId: athlete?.id || null,
      rawAthleteName: rawName,
      sourceSheet: sheet,
      sourceAddress: cellAddress(rowIndex, header.columns.get(normalizedText('姓名')) || 0),
    };
    if (sheet !== '运动员信息' && !validIsoDate(rowDate)) messages.push('错误：缺少有效日期，请按YYYY-MM-DD填写');

    if (sheet === '运动员信息') {
      const identityNumber = standardText(row, header.columns, '身份证号');
      const gender = standardText(row, header.columns, '性别');
      if (identityNumber && !/^\d{17}[\dXx]$/.test(identityNumber)) messages.push('错误：身份证号应为18位，末位可为X');
      if (gender && !['男', '女'].includes(gender)) messages.push('错误：性别只能填写男或女');
      const payload = {
        project: standardText(row, header.columns, '运动项目') || project,
        team: standardText(row, header.columns, '所属队伍'), gender,
        birthDate: parseDate(standardValue(row, header.columns, '出生日期'), year), identityNumber,
        region: standardText(row, header.columns, '省份'), city: standardText(row, header.columns, '城市'), county: standardText(row, header.columns, '区县'),
        ethnicity: standardText(row, header.columns, '民族'), phone: standardText(row, header.columns, '手机号'), bloodType: standardText(row, header.columns, '血型'),
        emergencyContact: standardText(row, header.columns, '紧急联系人'), emergencyPhone: standardText(row, header.columns, '紧急电话'),
        education: standardText(row, header.columns, '学历'), technicalLevel: standardText(row, header.columns, '技术等级'), position: standardText(row, header.columns, '位置号位'),
        healthStatus: standardText(row, header.columns, '身体状态'), bestResult: standardText(row, header.columns, '最好成绩'), nativePlace: standardText(row, header.columns, '籍贯'),
        homeAddress: standardText(row, header.columns, '家庭住址'), athleteStatus: standardText(row, header.columns, '训练状态'), startSportDate: parseDate(standardValue(row, header.columns, '开始运动日期'), year),
        trainingVenue: standardText(row, header.columns, '训练场地'), currentEvent: standardText(row, header.columns, '备战赛事'), trainingPhase: standardText(row, header.columns, '备战阶段'),
        campPeriod: standardText(row, header.columns, '集训时间'), originPlace: standardText(row, header.columns, '输送地'), originUnit: standardText(row, header.columns, '输送单位'),
        originCoach: standardText(row, header.columns, '输送教练'), specialties: standardText(row, header.columns, '优势项'), notes: standardText(row, header.columns, '备注')
      };
      items.push(itemBase({ ...base, itemType: 'athlete_profile', payload, rawValue: rawName, quality: makeQuality(messages), messages, businessKey: `${normalizedName(rawName)}|profile` }));
      continue;
    }

    if (sheet === '身体测量') {
      const fields: Record<string, number | null> = {};
      const mappings = [['heightCm', '身高cm'], ['weightKg', '体重kg'], ['bodyFatPct', '体脂率%'], ['skeletalMuscleKg', '骨骼肌kg'], ['muscleMassKg', '肌肉量kg'], ['upperLimbMuscleKg', '上肢肌肉kg'], ['lowerLimbMuscleKg', '下肢肌肉kg'], ['trunkMuscleKg', '躯干肌肉kg'], ['visceralFatLevel', '内脏脂肪等级'], ['basalMetabolismKcal', '基础代谢kcal'], ['totalBodyWaterKg', '总水分kg'], ['ecwTbwRatio', '细胞外水比'], ['phaseAngleDeg', '相位角°']];
      for (const [key, label] of mappings) fields[key] = numberValue(standardValue(row, header.columns, label));
      if (!Object.values(fields).some((value) => value !== null)) messages.push('错误：身体测量至少填写一个数值');
      items.push(itemBase({ ...base, itemType: 'body_measurement', eventDate: rowDate, metricCode: 'body_composition', metricLabel: '身体成分', valueNum: fields.weightKg ?? fields.heightCm ?? 0, payload: { ...fields, note: standardText(row, header.columns, '备注') }, rawValue: JSON.stringify(fields), quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|body` }));
    } else if (sheet === '恢复状态') {
      const payload = { sleepHours: numberValue(standardValue(row, header.columns, '睡眠小时')), sleepQuality: numberValue(standardValue(row, header.columns, '睡眠质量')), morningPulse: numberValue(standardValue(row, header.columns, '晨脉')), weightKg: numberValue(standardValue(row, header.columns, '体重kg')), fatigueIndex: numberValue(standardValue(row, header.columns, '疲劳')), sorenessIndex: numberValue(standardValue(row, header.columns, '肌肉酸痛')), moodIndex: numberValue(standardValue(row, header.columns, '情绪')), status: standardText(row, header.columns, '状态') || 'normal', note: standardText(row, header.columns, '备注') };
      items.push(itemBase({ ...base, itemType: 'wellness', eventDate: rowDate, metricLabel: '每日恢复', valueNum: payload.sleepHours ?? 0, payload, rawValue: JSON.stringify(payload), quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|wellness` }));
    } else if (sheet === '训练课次') {
      const duration = numberValue(standardValue(row, header.columns, '时长分钟')) ?? 0;
      const rpe = numberValue(standardValue(row, header.columns, 'RPE'));
      const payload = { sessionOrder: numberValue(standardValue(row, header.columns, '课次序号')) ?? 1, startTime: standardText(row, header.columns, '开始时间'), trainingType: standardText(row, header.columns, '训练类型') || '专项训练', structureType: standardText(row, header.columns, '训练阶段') || '专项训练', intensityZone: standardText(row, header.columns, '强度区间') || 'AN', content: standardText(row, header.columns, '训练内容'), durationMin: duration, distanceKm: numberValue(standardValue(row, header.columns, '距离千米')) ?? 0, rpe, srpe: numberValue(standardValue(row, header.columns, 'SRPE')) ?? (rpe === null ? 0 : rpe * duration), smvl: numberValue(standardValue(row, header.columns, 'SMVL')) ?? 0, averageHeartRate: numberValue(standardValue(row, header.columns, '平均心率')), maxHeartRate: numberValue(standardValue(row, header.columns, '最大心率')), averagePowerW: numberValue(standardValue(row, header.columns, '平均功率W')), strokeRateSpm: numberValue(standardValue(row, header.columns, '桨频SPM')) };
      items.push(itemBase({ ...base, itemType: 'training_session', eventDate: rowDate, sessionLabel: payload.content, valueNum: duration, unit: 'min', payload, rawValue: JSON.stringify(payload), quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|session|${payload.sessionOrder}` }));
    } else if (sheet === '力量训练组次') {
      const exerciseName = standardText(row, header.columns, '动作');
      const actualReps = numberValue(standardValue(row, header.columns, '实际次数'));
      const actualWeightKg = numberValue(standardValue(row, header.columns, '实际重量kg'));
      if (!exerciseName) messages.push('错误：训练动作不能为空');
      if (actualReps === null || actualWeightKg === null) messages.push('错误：实际次数和实际重量不能为空');
      items.push(itemBase({ ...base, itemType: 'training_set', eventDate: rowDate, sessionLabel: standardText(row, header.columns, '课次名称') || '力量训练', exerciseName, setIndex: numberValue(standardValue(row, header.columns, '组序')) || 1, targetReps: numberValue(standardValue(row, header.columns, '计划次数')), actualReps, actualWeightKg, intensityPercent: numberValue(standardValue(row, header.columns, '强度百分比')), payload: { rpe: numberValue(standardValue(row, header.columns, 'RPE')), trainingCategory: standardText(row, header.columns, '类别') || inferStrengthCategory(exerciseName), bodyPosition: standardText(row, header.columns, '身体部位') || inferStrengthBodyPosition(exerciseName), note: standardText(row, header.columns, '备注') }, rawValue: `${actualWeightKg || ''}kg×${actualReps || ''}`, quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|${exerciseName}|${numberValue(standardValue(row, header.columns, '组序')) || 1}` }));
    } else if (sheet === 'FMS测试') {
      const fmsItems = FMS_TEMPLATE_METRICS.flatMap(([headerName, metricCode, metricLabel]) => {
        const valueNum = numberValue(standardValue(row, header.columns, headerName));
        if (valueNum === null) return [];
        const metricMessages = [...messages];
        if (!Number.isInteger(valueNum) || valueNum < 0 || valueNum > 3) metricMessages.push(`错误：${metricLabel}须填写0、1、2或3分`);
        return [itemBase({ ...base, itemType: 'test_measurement', eventDate: rowDate, testType: 'FMS测试', metricCode, metricLabel, valueNum, unit: '分', side: 'center', payload: { protocol: '功能动作筛查（FMS）', note: standardText(row, header.columns, '备注') }, rawValue: String(valueNum), quality: makeQuality(metricMessages), messages: metricMessages, businessKey: `${athlete?.id || 0}|${rowDate}|fms|${metricCode}` })];
      });
      if (!fmsItems.length) {
        messages.push('错误：FMS七项至少填写一项得分');
        items.push(itemBase({ ...base, itemType: 'test_measurement', eventDate: rowDate, testType: 'FMS测试', metricCode: 'fms_deep_squat', metricLabel: '深蹲', valueNum: null, unit: '分', payload: { protocol: '功能动作筛查（FMS）' }, rawValue: '', quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|fms|empty` }));
      } else {
        if (fmsItems.length < FMS_TEMPLATE_METRICS.length) fmsItems.forEach((item) => { item.messages.push('警告：建议一次录齐FMS七项，以便生成完整21分分析'); item.quality = makeQuality(item.messages); });
        items.push(...fmsItems);
      }
    } else if (sheet === '冠军模型测试') {
      const championItems = CHAMPION_TEMPLATE_METRICS.flatMap(([headerName, metricCode, metricLabel, unit]) => {
        const valueNum = numberValue(standardValue(row, header.columns, headerName));
        if (valueNum === null) return [];
        return [itemBase({ ...base, itemType: 'test_measurement', eventDate: rowDate, testType: '冠军模型综合评估', metricCode, metricLabel, valueNum, unit, side: 'center', payload: { protocol: standardText(row, header.columns, '测试协议') || '冠军模型八维评估', note: standardText(row, header.columns, '备注') }, rawValue: String(valueNum), quality: makeQuality(messages), messages: [...messages], businessKey: `${athlete?.id || 0}|${rowDate}|champion|${metricCode}` })];
      });
      if (!championItems.length) {
        messages.push('错误：冠军模型指标至少填写一项测试数值');
        items.push(itemBase({ ...base, itemType: 'test_measurement', eventDate: rowDate, testType: '冠军模型综合评估', metricCode: 'general_endurance_score', metricLabel: '一般耐力', valueNum: null, unit: '分', payload: { protocol: '冠军模型八维评估' }, rawValue: '', quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|champion|empty` }));
      } else {
        items.push(...championItems);
      }
    } else if (sheet === '测试指标') {
      const metricCode = standardText(row, header.columns, '指标代码');
      const valueNum = numberValue(standardValue(row, header.columns, '数值'));
      if (!metricCode) messages.push('错误：指标代码不能为空');
      if (valueNum === null) messages.push('错误：测试数值不能为空');
      const sideText = standardText(row, header.columns, '侧别');
      const side = ({ 左: 'left', 右: 'right', 双侧: 'bilateral', 中央: 'center' }[sideText] || sideText || 'center') as ParsedImportItem['side'];
      if (!['left', 'right', 'bilateral', 'center'].includes(side)) messages.push('错误：测试侧别只能使用center、left、right或bilateral');
      items.push(itemBase({ ...base, itemType: 'test_measurement', eventDate: rowDate, testType: standardText(row, header.columns, '测试类型') || '专项测试', metricCode, metricLabel: standardText(row, header.columns, '指标名称') || metricCode, valueNum, unit: standardText(row, header.columns, '单位'), side, payload: { protocol: standardText(row, header.columns, '协议'), note: standardText(row, header.columns, '备注') }, rawValue: String(valueNum ?? ''), quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|${metricCode}|${side}` }));
    } else if (sheet === '伤病记录') {
      const payload = { injuryName: standardText(row, header.columns, '伤病名称'), bodyPart: standardText(row, header.columns, '部位'), side: standardText(row, header.columns, '侧别') || 'unspecified', status: standardText(row, header.columns, '状态') || 'observation', painScore: numberValue(standardValue(row, header.columns, '疼痛评分')) ?? 0, restrictions: standardText(row, header.columns, '训练限制'), rehabPlan: standardText(row, header.columns, '康复计划'), reviewDate: parseDate(standardValue(row, header.columns, '复查日期'), year), note: standardText(row, header.columns, '备注') };
      if (!payload.injuryName || !payload.bodyPart) messages.push('错误：伤病名称和部位不能为空');
      if (!['未指定','左','右','双侧','中央','unspecified','left','right','bilateral','center'].includes(payload.side)) messages.push('错误：伤病侧别不在允许范围内');
      if (!['健康','观察','限训','康复','停训','healthy','observation','restricted','rehab','suspended'].includes(payload.status)) messages.push('错误：伤病状态不在允许范围内');
      if (payload.painScore < 0 || payload.painScore > 10) messages.push('错误：疼痛评分须在0—10之间');
      items.push(itemBase({ ...base, itemType: 'injury_record', eventDate: rowDate, metricLabel: payload.injuryName, valueNum: payload.painScore, payload, rawValue: payload.injuryName, quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|injury|${payload.injuryName}` }));
    } else if (sheet === '竞技状态') {
      const overallScore = numberValue(standardValue(row, header.columns, '总分'));
      if (overallScore === null || overallScore < 0 || overallScore > 100) messages.push('错误：竞技状态总分须在0—100之间');
      const payload = { overallScore, stateLevel: standardText(row, header.columns, '等级') || 'build', enduranceScore: numberValue(standardValue(row, header.columns, '专项耐力')), powerScore: numberValue(standardValue(row, header.columns, '力量爆发')), techniqueScore: numberValue(standardValue(row, header.columns, '技术效率')), loadAdaptationScore: numberValue(standardValue(row, header.columns, '负荷适应')), recoveryScore: numberValue(standardValue(row, header.columns, '恢复能力')), competitionScore: numberValue(standardValue(row, header.columns, '比赛能力')), note: standardText(row, header.columns, '备注') };
      if (!['巅峰','良好','建设','调整','peak','good','build','adjust'].includes(payload.stateLevel)) messages.push('错误：竞技状态等级不在允许范围内');
      for (const [label, score] of [['专项耐力', payload.enduranceScore], ['力量爆发', payload.powerScore], ['技术效率', payload.techniqueScore], ['负荷适应', payload.loadAdaptationScore], ['恢复能力', payload.recoveryScore], ['比赛能力', payload.competitionScore]] as const) {
        if (score !== null && (score < 0 || score > 100)) messages.push(`错误：${label}须在0—100之间`);
      }
      items.push(itemBase({ ...base, itemType: 'competitive_state', eventDate: rowDate, metricLabel: '竞技状态', valueNum: overallScore, unit: '分', payload, rawValue: String(overallScore ?? ''), quality: makeQuality(messages), messages, businessKey: `${athlete?.id || 0}|${rowDate}|competitive` }));
    }
  }
  return items;
}

function ensureMetricDefinitions() {
  const statement = db.prepare(`
    INSERT INTO metric_definitions (code, label, domain, unit, direction, frequency, projects_json, minimum, maximum, active)
    VALUES (?, ?, ?, ?, 'higher_better', 'phase', '["赛艇","皮划艇","激流"]', ?, ?, 1)
    ON CONFLICT(code) DO UPDATE SET label = excluded.label, domain = excluded.domain, unit = excluded.unit,
      minimum = excluded.minimum, maximum = excluded.maximum, active = 1, updated_at = CURRENT_TIMESTAMP
  `);
  for (const [code, metric] of Object.entries(METRICS)) statement.run(code, metric.label, metric.domain, metric.unit, metric.min, metric.max);
}

function matrixForSheet(workbook: XLSX.WorkBook, sheetName: string): Matrix {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: true }) as Matrix;
}

function summarizeItems(items: ParsedImportItem[]) {
  return {
    itemCount: items.length,
    validCount: items.filter((item) => item.quality === 'valid').length,
    warningCount: items.filter((item) => item.quality === 'warning').length,
    errorCount: items.filter((item) => item.quality === 'error').length
  };
}

function insertItems(batchId: string, items: ParsedImportItem[]) {
  const statement = db.prepare(`
    INSERT INTO data_import_items (
      batch_id, item_type, athlete_id, raw_athlete_name, event_date, session_label, test_type,
      metric_code, metric_label, side, value_num, unit, exercise_name, set_index, target_reps,
      actual_reps, actual_weight_kg, intensity_percent, payload_json, source_sheet, source_address,
      raw_value, quality, messages_json, business_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) statement.run(
    batchId, item.itemType, item.athleteId, item.rawAthleteName, item.eventDate, item.sessionLabel,
    item.testType, item.metricCode, item.metricLabel, item.side, item.valueNum, item.unit,
    item.exerciseName, item.setIndex, item.targetReps, item.actualReps, item.actualWeightKg,
    item.intensityPercent, JSON.stringify(item.payload), item.sourceSheet, item.sourceAddress,
    item.rawValue, item.quality, JSON.stringify(item.messages), item.businessKey
  );
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
}) {
  if (!/\.(xls|xlsx)$/i.test(input.filename)) throw new Error('统一数据导入当前支持 XLS 和 XLSX 文件。');
  if (input.defaultDate && !validIsoDate(input.defaultDate)) throw new Error('默认日期格式应为 YYYY-MM-DD。');
  ensureMetricDefinitions();
  const fileHash = createHash('sha256').update(input.buffer).digest('hex');
  const existing = db.prepare('SELECT id, parser_version AS parserVersion, status, created_by AS createdBy FROM data_import_batches WHERE file_hash = ? AND project = ?')
    .get(fileHash, input.project) as { id: string; parserVersion: string; status: string; createdBy: number } | undefined;
  if (existing?.parserVersion === DATA_IMPORT_PARSER_VERSION || existing?.status === 'committed') {
    return getDataImportBatch(existing.id, input.userId, true);
  }
  if (existing) {
    if (existing.createdBy !== input.userId) throw new Error('同一文件已有其他账号创建的待审核批次。');
    db.prepare('DELETE FROM data_import_batches WHERE id = ?').run(existing.id);
  }
  const workbook = XLSX.read(input.buffer, { type: 'buffer', cellDates: true, cellFormula: true, cellNF: false, cellStyles: false });
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
      parsed = parseStandardSheet(matrix, sheetName, input.project, input.filename, input.defaultDate || '', input.athletes);
      type = `统一模板·${sheetName}`;
      note = '按竞迹统一数据模板的固定列确定性解析';
    } else if (/个人档案/.test(sheetName)) {
      ignoredSheets.push({ name: sheetName, reason: '公式与图表展示页，不作为原始数据导入' });
      continue;
    } else if (/国家赛艇队体能训练负荷统计表/.test(firstRows) || (firstRows.includes('姓名') && firstRows.includes('完成负荷'))) {
      parsed = parseTrainingBlocks(matrix, sheetName, input.project, input.filename, input.athletes);
      type = '运动员训练执行记录';
      note = '按重复运动员小表拆分为课次和组次';
    } else if (/评分标准/.test(firstRows) || sheetName.includes('评分')) {
      parsed = parseScoringSheet(matrix, sheetName, input.project, batchVersion);
      type = '力量评分规则';
      note = '按性别、指标和分值保存为版本化规则';
    } else if ((sheetName === '女子' || sheetName === '男子') && firstRows.includes('身体形态') && firstRows.includes('基础力量')) {
      parsed = parseSummarySheet(matrix, sheetName, input.project, input.filename, input.defaultDate || '', input.athletes);
      type = '力量素质汇总';
      note = '身体测量和力量指标分别进入正式表';
    } else if ((firstRows.includes('姓名') || ((sheetName === '女子' || sheetName === '男子') && firstRows.includes('差值')))
      && (firstRows.includes('差值') || firstRows.includes('2025') || firstRows.includes('2.13') || sheetName === '数据源')) {
      parsed = parseComparisonSheet(matrix, sheetName, input.project, input.filename, input.defaultDate || '', input.athletes);
      type = '历史测试对比';
      note = '仅提取各日期原始值，忽略差值公式';
    }
    if (parsed.length) {
      items.push(...parsed);
      recognizedSheets.push({ name: sheetName, type, items: parsed.length, note });
    } else {
      const reason = !firstRows.replace(/\|/g, '') ? '空白工作表' : '未识别为支持的数据模板';
      ignoredSheets.push({ name: sheetName, reason });
    }
  }
  if (!items.length) throw new Error('没有识别到可导入的训练记录、力量测试或评分规则。');
  const unmatchedNames = new Map<string, { name: string; sourceSheet: string; gender: string; team: string; region: string; city: string; county: string }>();
  for (const item of items) {
    if (item.itemType === 'scoring_rule' || item.athleteId || !item.rawAthleteName) continue;
    const key = normalizedName(item.rawAthleteName);
    if (!key) continue;
    const gender = /女子|女队/.test(item.sourceSheet) ? '女' : /男子|男队/.test(item.sourceSheet) ? '男' : '';
    const profile = item.itemType === 'athlete_profile' ? item.payload : {};
    const current = unmatchedNames.get(key);
    unmatchedNames.set(key, { name: item.rawAthleteName, sourceSheet: current?.sourceSheet || item.sourceSheet,
      gender: text(profile.gender) || current?.gender || gender, team: text(profile.team) || current?.team || '',
      region: text(profile.region) || current?.region || '', city: text(profile.city) || current?.city || '', county: text(profile.county) || current?.county || '' });
  }
  const counts = summarizeItems(items);
  const summary = { recognizedSheets, ignoredSheets };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO data_import_batches (
        id, file_hash, source_filename, source_mimetype, file_size, project, parser_version, status,
        sheet_count, item_count, valid_count, warning_count, error_count, summary_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reviewing', ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, fileHash, input.filename, input.mimetype, input.buffer.length, input.project,
      DATA_IMPORT_PARSER_VERSION, workbook.SheetNames.length, counts.itemCount, counts.validCount,
      counts.warningCount, counts.errorCount, JSON.stringify(summary), input.userId);
    insertItems(batchId, items);
    const insertCandidate = db.prepare(`INSERT INTO data_import_athlete_candidates (
      batch_id, normalized_name, name, project, team, gender, region, city, county, source_sheet, messages_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [key, candidate] of unmatchedNames) {
      // 新运动员不自动采纳文件内队伍；必须在审核区由有权限的用户确认后分配。
      insertCandidate.run(batchId, key, candidate.name, input.project, '', candidate.gender,
        candidate.region || text(input.defaultArea?.region) || '未设置', candidate.city || text(input.defaultArea?.city) || '未设置',
        candidate.county || text(input.defaultArea?.county) || '未设置', candidate.sourceSheet,
        JSON.stringify(['将创建无登录账号的运动员档案，身份证、出生日期、联系方式等资料可稍后补充']));
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
    id: Number(row.id), batchId: text(row.batchId), itemType: row.itemType as DataImportItemType,
    athleteId: row.athleteId === null ? null : Number(row.athleteId), rawAthleteName: text(row.rawAthleteName),
    athleteName: text(row.athleteName), athleteProject: text(row.athleteProject), athleteTeam: text(row.athleteTeam),
    eventDate: text(row.eventDate), sessionLabel: text(row.sessionLabel), testType: text(row.testType),
    metricCode: text(row.metricCode), metricLabel: text(row.metricLabel), side: row.side as DataImportItemView['side'],
    valueNum: row.valueNum === null ? null : Number(row.valueNum), unit: text(row.unit), exerciseName: text(row.exerciseName),
    setIndex: Number(row.setIndex), targetReps: row.targetReps === null ? null : Number(row.targetReps),
    actualReps: row.actualReps === null ? null : Number(row.actualReps),
    actualWeightKg: row.actualWeightKg === null ? null : Number(row.actualWeightKg),
    intensityPercent: row.intensityPercent === null ? null : Number(row.intensityPercent),
    payload: JSON.parse(text(row.payloadJson) || '{}') as Record<string, unknown>, sourceSheet: text(row.sourceSheet),
    sourceAddress: text(row.sourceAddress), rawValue: text(row.rawValue), quality: row.quality as DataImportQuality,
    messages: JSON.parse(text(row.messagesJson) || '[]') as string[], businessKey: text(row.businessKey),
    committedEntityType: text(row.committedEntityType),
    committedEntityId: row.committedEntityId === null ? null : Number(row.committedEntityId)
  };
}

export function getDataImportBatch(batchId: string, userId: number, duplicateFile = false): DataImportPreview {
  const row = db.prepare(`
    SELECT id, source_filename AS filename, project, status, parser_version AS parserVersion,
      sheet_count AS sheetCount, item_count AS itemCount, valid_count AS validCount,
      warning_count AS warningCount, error_count AS errorCount, imported_count AS importedCount,
      skipped_count AS skippedCount, summary_json AS summaryJson, created_at AS createdAt,
      committed_at AS committedAt, created_by AS createdBy
    FROM data_import_batches WHERE id = ?
  `).get(batchId) as Record<string, unknown> | undefined;
  if (!row || Number(row.createdBy) !== userId) throw new Error('未找到该导入批次，或当前账号无权访问。');
  const itemRows = db.prepare(`
    SELECT di.id, di.batch_id AS batchId, di.item_type AS itemType, di.athlete_id AS athleteId,
      di.raw_athlete_name AS rawAthleteName, di.event_date AS eventDate, di.session_label AS sessionLabel,
      di.test_type AS testType, di.metric_code AS metricCode, di.metric_label AS metricLabel, di.side,
      di.value_num AS valueNum, di.unit, di.exercise_name AS exerciseName, di.set_index AS setIndex,
      di.target_reps AS targetReps, di.actual_reps AS actualReps, di.actual_weight_kg AS actualWeightKg,
      di.intensity_percent AS intensityPercent, di.payload_json AS payloadJson, di.source_sheet AS sourceSheet,
      di.source_address AS sourceAddress, di.raw_value AS rawValue, di.quality, di.messages_json AS messagesJson,
      di.business_key AS businessKey, di.committed_entity_type AS committedEntityType,
      di.committed_entity_id AS committedEntityId, a.name AS athleteName, a.project AS athleteProject, a.team AS athleteTeam
    FROM data_import_items di LEFT JOIN athletes a ON a.id = di.athlete_id
    WHERE di.batch_id = ? ORDER BY CASE di.quality WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'valid' THEN 3 ELSE 4 END,
      di.source_sheet, di.source_address, di.id
  `).all(batchId) as Record<string, unknown>[];
  const candidateRows = db.prepare(`SELECT id, batch_id AS batchId, normalized_name AS normalizedName,
    name, project, team, gender, region, city, county, status,
    matched_athlete_id AS matchedAthleteId, created_athlete_id AS createdAthleteId,
    source_sheet AS sourceSheet, messages_json AS messagesJson
    FROM data_import_athlete_candidates WHERE batch_id = ? ORDER BY name, id`).all(batchId) as Record<string, unknown>[];
  const summary = JSON.parse(text(row.summaryJson) || '{}') as DataImportPreview['summary'];
  if (duplicateFile) summary.duplicateFile = true;
  return {
    id: text(row.id), filename: text(row.filename), project: text(row.project),
    status: row.status as DataImportPreview['status'], parserVersion: text(row.parserVersion),
    sheetCount: Number(row.sheetCount), itemCount: Number(row.itemCount), validCount: Number(row.validCount),
    warningCount: Number(row.warningCount), errorCount: Number(row.errorCount), importedCount: Number(row.importedCount),
    skippedCount: Number(row.skippedCount), createdAt: text(row.createdAt), committedAt: row.committedAt ? text(row.committedAt) : null,
    summary,
    athleteCandidates: candidateRows.map((candidate) => ({
      id: Number(candidate.id), batchId: text(candidate.batchId), normalizedName: text(candidate.normalizedName),
      name: text(candidate.name), project: text(candidate.project), team: text(candidate.team), gender: text(candidate.gender),
      region: text(candidate.region), city: text(candidate.city), county: text(candidate.county),
      status: candidate.status as DataImportAthleteCandidate['status'],
      matchedAthleteId: candidate.matchedAthleteId === null ? null : Number(candidate.matchedAthleteId),
      createdAthleteId: candidate.createdAthleteId === null ? null : Number(candidate.createdAthleteId),
      sourceSheet: text(candidate.sourceSheet), messages: JSON.parse(text(candidate.messagesJson) || '[]') as string[]
    })),
    items: itemRows.map(mapItem)
  };
}

export function listDataImportBatches(project: string, userId: number) {
  return (db.prepare(`
    SELECT id, source_filename AS filename, project, status, parser_version AS parserVersion,
      item_count AS itemCount, valid_count AS validCount, warning_count AS warningCount,
      error_count AS errorCount, imported_count AS importedCount, skipped_count AS skippedCount,
      created_at AS createdAt, committed_at AS committedAt
    FROM data_import_batches WHERE project = ? AND created_by = ? ORDER BY created_at DESC LIMIT 30
  `).all(project, userId) as Record<string, unknown>[]).map((row) => ({
    id: text(row.id), filename: text(row.filename), project: text(row.project), status: text(row.status),
    parserVersion: text(row.parserVersion), itemCount: Number(row.itemCount), validCount: Number(row.validCount),
    warningCount: Number(row.warningCount), errorCount: Number(row.errorCount), importedCount: Number(row.importedCount),
    skippedCount: Number(row.skippedCount), createdAt: text(row.createdAt), committedAt: row.committedAt ? text(row.committedAt) : null
  }));
}

function refreshItemValidation(item: DataImportItemView, allowedAthletes: Set<number>, candidateNames = new Set<string>()) {
  const messages = item.messages.filter((message) => !message.includes('未匹配到已有运动员') && !message.startsWith('错误：未匹配') && !message.startsWith('错误：缺少有效'));
  if (item.itemType !== 'scoring_rule') {
    if (item.athleteId && !allowedAthletes.has(item.athleteId)) messages.push('错误：所选运动员不在当前权限范围内');
    else if (!item.athleteId && candidateNames.has(normalizedName(item.rawAthleteName))) {
      messages.push('警告：将创建无登录账号的待补全运动员档案');
    } else if (!item.athleteId) messages.push('错误：缺少可创建或可匹配的运动员姓名');
    if (item.itemType !== 'athlete_profile' && !validIsoDate(item.eventDate)) messages.push('错误：缺少有效日期，请在预览中补充');
  }
  if (item.itemType === 'training_set') {
    if (!item.exerciseName) messages.push('错误：训练动作不能为空');
    if (item.actualReps === null || item.actualReps < 0) messages.push('错误：实际次数不能为空且不能小于0');
    if (item.actualWeightKg === null || item.actualWeightKg < 0) messages.push('错误：实际重量不能为空且不能小于0');
  } else if (!['scoring_rule', 'athlete_profile'].includes(item.itemType) && (item.valueNum === null || !Number.isFinite(item.valueNum))) {
    messages.push('错误：测试值不能为空');
  }
  return { messages, quality: makeQuality(messages, item.quality === 'skipped') };
}

export function updateDataImportItems(input: {
  batchId: string;
  userId: number;
  athletes: ImportAthlete[];
  corrections: Array<{ id: number; athleteId?: number | null; eventDate?: string; valueNum?: number | null; actualReps?: number | null; actualWeightKg?: number | null }>;
}) {
  const batch = getDataImportBatch(input.batchId, input.userId);
  if (batch.status !== 'reviewing') throw new Error('只有待审核批次可以修改。');
  const allowed = new Set(input.athletes.map((athlete) => athlete.id));
  const candidateNames = new Set(batch.athleteCandidates.map((candidate) => candidate.normalizedName));
  const update = db.prepare(`UPDATE data_import_items SET athlete_id = ?, event_date = ?, value_num = ?, actual_reps = ?, actual_weight_kg = ?, quality = ?, messages_json = ? WHERE id = ? AND batch_id = ?`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const correction of input.corrections) {
      const current = batch.items.find((item) => item.id === correction.id);
      if (!current) continue;
      const next = { ...current };
      if ('athleteId' in correction) next.athleteId = correction.athleteId ?? null;
      if ('eventDate' in correction) next.eventDate = text(correction.eventDate);
      if ('valueNum' in correction) next.valueNum = correction.valueNum ?? null;
      if ('actualReps' in correction) next.actualReps = correction.actualReps ?? null;
      if ('actualWeightKg' in correction) next.actualWeightKg = correction.actualWeightKg ?? null;
      const validation = refreshItemValidation(next, allowed, candidateNames);
      update.run(next.athleteId, next.eventDate, next.valueNum, next.actualReps, next.actualWeightKg,
        validation.quality, JSON.stringify(validation.messages), next.id, input.batchId);
    }
    const counts = db.prepare(`SELECT COUNT(*) AS itemCount,
      SUM(quality = 'valid') AS validCount, SUM(quality = 'warning') AS warningCount, SUM(quality = 'error') AS errorCount
      FROM data_import_items WHERE batch_id = ?`).get(input.batchId) as Record<string, number>;
    db.prepare(`UPDATE data_import_batches SET item_count = ?, valid_count = ?, warning_count = ?, error_count = ? WHERE id = ?`)
      .run(Number(counts.itemCount), Number(counts.validCount || 0), Number(counts.warningCount || 0), Number(counts.errorCount || 0), input.batchId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getDataImportBatch(input.batchId, input.userId);
}

export function updateDataImportAthleteCandidates(input: {
  batchId: string;
  userId: number;
  allowedTeams: Set<string>;
  corrections: Array<{ id: number; name?: string; team?: string; gender?: string }>;
}) {
  const batch = getDataImportBatch(input.batchId, input.userId);
  if (batch.status !== 'reviewing') throw new Error('只有待审核批次可以修改新运动员资料。');
  const update = db.prepare(`UPDATE data_import_athlete_candidates SET name = ?, team = ?, gender = ?, messages_json = ?
    WHERE id = ? AND batch_id = ? AND status = 'pending'`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const correction of input.corrections) {
      const current = batch.athleteCandidates.find((candidate) => candidate.id === correction.id);
      if (!current || current.status !== 'pending') continue;
      const name = 'name' in correction ? text(correction.name) : current.name;
      const team = 'team' in correction ? text(correction.team) : current.team;
      const gender = 'gender' in correction ? text(correction.gender) : current.gender;
      const messages: string[] = [];
      if (!name || name.length > 40) messages.push('姓名不能为空且不能超过40个字符');
      if (!input.allowedTeams.has(team)) messages.push('所属队伍不在当前账号权限范围内');
      if (gender && !['男', '女'].includes(gender)) messages.push('性别应为男、女或暂不填写');
      if (messages.length) throw new Error(`${current.name}：${messages.join('；')}`);
      update.run(name, team, gender, JSON.stringify(['将创建无登录账号的运动员档案，其他资料可稍后在运动员管理中补充']), current.id, input.batchId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getDataImportBatch(input.batchId, input.userId);
}

function upsertTrainingItem(item: DataImportItemView, batchId: string, userId: number, policy: 'skip' | 'update') {
  const existingSession = db.prepare(`SELECT id FROM training_sessions WHERE athlete_id = ? AND session_date = ? AND training_type = '力量训练' AND content = ? ORDER BY session_order LIMIT 1`)
    .get(item.athleteId, item.eventDate, item.sessionLabel) as { id: number } | undefined;
  let sessionId = existingSession?.id;
  if (!sessionId) {
    const order = db.prepare('SELECT COALESCE(MAX(session_order), 0) AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?')
      .get(item.athleteId, item.eventDate) as { value: number };
    const inserted = db.prepare(`INSERT INTO training_sessions (
      athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content,
      duration_min, distance_km, rpe, srpe, smvl, source, quality, is_demo, created_by
    ) VALUES (?, ?, ?, '力量训练', '体能训练', 'AN', ?, 0, 0, NULL, 0, 0, 'file_import', ?, 0, ?)`)
      .run(item.athleteId, item.eventDate, Number(order.value) + 1, item.sessionLabel, item.quality === 'warning' ? 'partial' : 'valid', userId);
    sessionId = Number(inserted.lastInsertRowid);
  }
  const existing = db.prepare('SELECT id FROM strength_result_sets WHERE training_session_id = ? AND exercise_name = ? AND set_index = ?')
    .get(sessionId, item.exerciseName, item.setIndex) as { id: number } | undefined;
  if (existing && policy === 'skip') return { skipped: true, entityId: existing.id, sessionId };
  const payload = item.payload;
  if (existing) {
    db.prepare(`UPDATE strength_result_sets SET target_reps = ?, actual_reps = ?, actual_weight_kg = ?,
      training_category = ?, body_position = ?, training_environment = '陆上', intensity_percent = ?, intensity_zone = 'AN',
      note = ?, source = 'file_import', data_import_batch_id = ?, source_row = ?, original_text = ?, created_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(item.targetReps, item.actualReps, item.actualWeightKg, text(payload.trainingCategory) || inferStrengthCategory(item.exerciseName),
        text(payload.bodyPosition) || inferStrengthBodyPosition(item.exerciseName), item.intensityPercent,
        item.messages.join('；'), batchId, `${item.sourceSheet}!${item.sourceAddress}`, item.rawValue, userId, existing.id);
    return { skipped: false, entityId: existing.id, sessionId };
  }
  const inserted = db.prepare(`INSERT INTO strength_result_sets (
    training_session_id, exercise_name, set_index, target_reps, actual_reps, actual_weight_kg,
    training_category, body_position, training_environment, intensity_percent, intensity_zone, rpe,
    completed, note, source, data_import_batch_id, source_row, original_text, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '陆上', ?, 'AN', NULL, 1, ?, 'file_import', ?, ?, ?, ?)`)
    .run(sessionId, item.exerciseName, item.setIndex, item.targetReps, item.actualReps, item.actualWeightKg,
      text(payload.trainingCategory) || inferStrengthCategory(item.exerciseName), text(payload.bodyPosition) || inferStrengthBodyPosition(item.exerciseName),
      item.intensityPercent, item.messages.join('；'), batchId, `${item.sourceSheet}!${item.sourceAddress}`, item.rawValue, userId);
  return { skipped: false, entityId: Number(inserted.lastInsertRowid), sessionId };
}

function updateSessionTotals(sessionId: number) {
  const totals = db.prepare(`SELECT COALESCE(SUM(actual_reps * actual_weight_kg), 0) AS volume FROM strength_result_sets WHERE training_session_id = ?`)
    .get(sessionId) as { volume: number };
  db.prepare('UPDATE training_sessions SET smvl = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Math.round(Number(totals.volume) * 10) / 10, sessionId);
}

function upsertTestItem(item: DataImportItemView, batchId: string, userId: number, policy: 'skip' | 'update') {
  db.prepare(`INSERT INTO metric_definitions (code, label, domain, unit, direction, frequency, projects_json, active)
    VALUES (?, ?, 'custom', ?, 'neutral', 'phase', '["赛艇","皮划艇","激流"]', 1)
    ON CONFLICT(code) DO UPDATE SET label=excluded.label, unit=excluded.unit, active=1, updated_at=CURRENT_TIMESTAMP`)
    .run(item.metricCode, item.metricLabel || item.metricCode, item.unit);
  db.prepare(`INSERT INTO test_sessions (athlete_id, test_date, test_type, protocol, source, quality, is_demo, created_by)
    VALUES (?, ?, ?, '国家队力量素质测试', 'file_import', ?, 0, ?)
    ON CONFLICT(athlete_id, test_date, test_type) DO UPDATE SET quality = CASE WHEN excluded.quality = 'partial' THEN 'partial' ELSE test_sessions.quality END`)
    .run(item.athleteId, item.eventDate, item.testType || '力量素质测试', item.quality === 'warning' ? 'partial' : 'valid', userId);
  const session = db.prepare('SELECT id FROM test_sessions WHERE athlete_id = ? AND test_date = ? AND test_type = ?')
    .get(item.athleteId, item.eventDate, item.testType || '力量素质测试') as { id: number };
  const existing = db.prepare('SELECT id FROM test_measurements WHERE test_session_id = ? AND metric_code = ? AND side = ?')
    .get(session.id, item.metricCode, item.side) as { id: number } | undefined;
  if (existing && policy === 'skip') return { skipped: true, entityId: existing.id };
  if (existing) {
    db.prepare(`UPDATE test_measurements SET value_num = ?, unit = ?, quality = ?, source = 'file_import', is_demo = 0,
      data_import_batch_id = ?, source_ref = ? WHERE id = ?`)
      .run(item.valueNum, item.unit, item.quality === 'warning' ? 'partial' : 'valid', batchId, `${item.sourceSheet}!${item.sourceAddress}`, existing.id);
    return { skipped: false, entityId: existing.id };
  }
  const inserted = db.prepare(`INSERT INTO test_measurements (
    test_session_id, metric_code, value_num, unit, side, quality, source, is_demo, data_import_batch_id, source_ref
  ) VALUES (?, ?, ?, ?, ?, ?, 'file_import', 0, ?, ?)`)
    .run(session.id, item.metricCode, item.valueNum, item.unit, item.side, item.quality === 'warning' ? 'partial' : 'valid', batchId, `${item.sourceSheet}!${item.sourceAddress}`);
  return { skipped: false, entityId: Number(inserted.lastInsertRowid) };
}

function upsertBodyItem(item: DataImportItemView, batchId: string, policy: 'skip' | 'update') {
  if (item.metricCode === 'body_composition') {
    const payload = item.payload;
    const existing = db.prepare('SELECT id FROM athlete_body_measurements WHERE athlete_id = ? AND measurement_date = ?').get(item.athleteId, item.eventDate) as { id: number } | undefined;
    if (existing && policy === 'skip') return { skipped: true, entityId: existing.id };
    const values = ['heightCm', 'weightKg', 'bodyFatPct', 'skeletalMuscleKg', 'muscleMassKg', 'upperLimbMuscleKg', 'lowerLimbMuscleKg', 'trunkMuscleKg', 'visceralFatLevel', 'basalMetabolismKcal', 'totalBodyWaterKg', 'ecwTbwRatio', 'phaseAngleDeg'].map((key) => numberValue(payload[key]));
    db.prepare(`INSERT INTO athlete_body_measurements (athlete_id, measurement_date, height_cm, weight_kg, body_fat_pct, skeletal_muscle_kg, muscle_mass_kg, upper_limb_muscle_kg, lower_limb_muscle_kg, trunk_muscle_kg, visceral_fat_level, basal_metabolism_kcal, total_body_water_kg, ecw_tbw_ratio, phase_angle_deg, note, source, quality, is_demo, data_import_batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_import', ?, 0, ?)
      ON CONFLICT(athlete_id, measurement_date) DO UPDATE SET height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct, skeletal_muscle_kg=excluded.skeletal_muscle_kg, muscle_mass_kg=excluded.muscle_mass_kg, upper_limb_muscle_kg=excluded.upper_limb_muscle_kg, lower_limb_muscle_kg=excluded.lower_limb_muscle_kg, trunk_muscle_kg=excluded.trunk_muscle_kg, visceral_fat_level=excluded.visceral_fat_level, basal_metabolism_kcal=excluded.basal_metabolism_kcal, total_body_water_kg=excluded.total_body_water_kg, ecw_tbw_ratio=excluded.ecw_tbw_ratio, phase_angle_deg=excluded.phase_angle_deg, note=excluded.note, source='file_import', quality=excluded.quality, is_demo=0, data_import_batch_id=excluded.data_import_batch_id`)
      .run(item.athleteId, item.eventDate, ...values, text(payload.note), item.quality === 'warning' ? 'partial' : 'valid', batchId);
    const saved = db.prepare('SELECT id FROM athlete_body_measurements WHERE athlete_id = ? AND measurement_date = ?').get(item.athleteId, item.eventDate) as { id: number };
    return { skipped: false, entityId: saved.id };
  }
  const existing = db.prepare('SELECT id, height_cm AS heightCm, weight_kg AS weightKg FROM athlete_body_measurements WHERE athlete_id = ? AND measurement_date = ?')
    .get(item.athleteId, item.eventDate) as { id: number; heightCm: number | null; weightKg: number | null } | undefined;
  const column = item.metricCode === 'height_cm' ? 'height_cm' : 'weight_kg';
  const current = item.metricCode === 'height_cm' ? existing?.heightCm : existing?.weightKg;
  if (existing && current !== null && current !== undefined && policy === 'skip') return { skipped: true, entityId: existing.id };
  if (existing) {
    db.prepare(`UPDATE athlete_body_measurements SET ${column} = ?, source = 'file_import', quality = ?, is_demo = 0, data_import_batch_id = ? WHERE id = ?`)
      .run(item.valueNum, item.quality === 'warning' ? 'partial' : 'valid', batchId, existing.id);
    return { skipped: false, entityId: existing.id };
  }
  const inserted = db.prepare(`INSERT INTO athlete_body_measurements (athlete_id, measurement_date, ${column}, source, quality, is_demo, data_import_batch_id)
    VALUES (?, ?, ?, 'file_import', ?, 0, ?)`)
    .run(item.athleteId, item.eventDate, item.valueNum, item.quality === 'warning' ? 'partial' : 'valid', batchId);
  return { skipped: false, entityId: Number(inserted.lastInsertRowid) };
}

function upsertAthleteProfileItem(item: DataImportItemView, batchId: string) {
  const p = item.payload;
  db.prepare(`UPDATE athletes SET gender = COALESCE(NULLIF(?, ''), gender), team = COALESCE(NULLIF(?, ''), team),
    region = COALESCE(NULLIF(?, ''), region), city = COALESCE(NULLIF(?, ''), city), county = COALESCE(NULLIF(?, ''), county),
    birth_date = COALESCE(NULLIF(?, ''), birth_date), profile_status = CASE WHEN NULLIF(?, '') IS NOT NULL AND NULLIF(?, '') IS NOT NULL AND NULLIF(?, '') IS NOT NULL AND NULLIF(?, '') IS NOT NULL THEN 'complete' ELSE profile_status END,
    source = 'file_import', data_import_batch_id = ? WHERE id = ?`)
    .run(text(p.gender), text(p.team), text(p.region), text(p.city), text(p.county), text(p.birthDate), text(p.gender), text(p.region), text(p.city), text(p.county), batchId, item.athleteId);
  db.prepare(`INSERT INTO athlete_profiles (athlete_id, identity_number, ethnicity, phone, blood_type, emergency_contact, emergency_phone, education, technical_level, position, health_status, best_result, native_place, home_address, athlete_status, start_sport_date, training_venue, current_event, training_phase, camp_period, origin_place, origin_unit, origin_coach, specialties, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(athlete_id) DO UPDATE SET identity_number=COALESCE(NULLIF(excluded.identity_number,''),athlete_profiles.identity_number), ethnicity=COALESCE(NULLIF(excluded.ethnicity,''),athlete_profiles.ethnicity), phone=COALESCE(NULLIF(excluded.phone,''),athlete_profiles.phone), blood_type=COALESCE(NULLIF(excluded.blood_type,''),athlete_profiles.blood_type), emergency_contact=COALESCE(NULLIF(excluded.emergency_contact,''),athlete_profiles.emergency_contact), emergency_phone=COALESCE(NULLIF(excluded.emergency_phone,''),athlete_profiles.emergency_phone), education=COALESCE(NULLIF(excluded.education,''),athlete_profiles.education), technical_level=COALESCE(NULLIF(excluded.technical_level,''),athlete_profiles.technical_level), position=COALESCE(NULLIF(excluded.position,''),athlete_profiles.position), health_status=COALESCE(NULLIF(excluded.health_status,''),athlete_profiles.health_status), best_result=COALESCE(NULLIF(excluded.best_result,''),athlete_profiles.best_result), native_place=COALESCE(NULLIF(excluded.native_place,''),athlete_profiles.native_place), home_address=COALESCE(NULLIF(excluded.home_address,''),athlete_profiles.home_address), athlete_status=COALESCE(NULLIF(excluded.athlete_status,''),athlete_profiles.athlete_status), start_sport_date=COALESCE(NULLIF(excluded.start_sport_date,''),athlete_profiles.start_sport_date), training_venue=COALESCE(NULLIF(excluded.training_venue,''),athlete_profiles.training_venue), current_event=COALESCE(NULLIF(excluded.current_event,''),athlete_profiles.current_event), training_phase=COALESCE(NULLIF(excluded.training_phase,''),athlete_profiles.training_phase), camp_period=COALESCE(NULLIF(excluded.camp_period,''),athlete_profiles.camp_period), origin_place=COALESCE(NULLIF(excluded.origin_place,''),athlete_profiles.origin_place), origin_unit=COALESCE(NULLIF(excluded.origin_unit,''),athlete_profiles.origin_unit), origin_coach=COALESCE(NULLIF(excluded.origin_coach,''),athlete_profiles.origin_coach), specialties=COALESCE(NULLIF(excluded.specialties,''),athlete_profiles.specialties), notes=COALESCE(NULLIF(excluded.notes,''),athlete_profiles.notes), updated_at=CURRENT_TIMESTAMP`)
    .run(item.athleteId, text(p.identityNumber).toUpperCase(), text(p.ethnicity), text(p.phone), text(p.bloodType), text(p.emergencyContact), text(p.emergencyPhone), text(p.education), text(p.technicalLevel), text(p.position), text(p.healthStatus), text(p.bestResult), text(p.nativePlace), text(p.homeAddress), text(p.athleteStatus), text(p.startSportDate), text(p.trainingVenue), text(p.currentEvent), text(p.trainingPhase), text(p.campPeriod), text(p.originPlace), text(p.originUnit), text(p.originCoach), text(p.specialties), text(p.notes));
  if (text(p.region) && text(p.city)) db.prepare(`INSERT INTO athlete_origins (athlete_id, province, city, county, source, quality, is_demo) VALUES (?, ?, ?, ?, 'file_import', 'valid', 0) ON CONFLICT(athlete_id) DO UPDATE SET province=excluded.province, city=excluded.city, county=excluded.county, source='file_import', quality='valid', is_demo=0, updated_at=CURRENT_TIMESTAMP`).run(item.athleteId, text(p.region), text(p.city), text(p.county));
  return { skipped: false, entityId: Number(item.athleteId) };
}

function upsertWellnessItem(item: DataImportItemView, policy: 'skip' | 'update') {
  const p = item.payload;
  const existing = db.prepare('SELECT id FROM daily_wellness WHERE athlete_id=? AND wellness_date=?').get(item.athleteId, item.eventDate) as { id: number } | undefined;
  if (existing && policy === 'skip') return { skipped: true, entityId: existing.id };
  db.prepare(`INSERT INTO daily_wellness (athlete_id, wellness_date, sleep_hours, sleep_quality, morning_pulse, weight_kg, fatigue_index, soreness_index, mood_index, status, source, quality, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_import', ?, 0) ON CONFLICT(athlete_id, wellness_date) DO UPDATE SET sleep_hours=excluded.sleep_hours, sleep_quality=excluded.sleep_quality, morning_pulse=excluded.morning_pulse, weight_kg=excluded.weight_kg, fatigue_index=excluded.fatigue_index, soreness_index=excluded.soreness_index, mood_index=excluded.mood_index, status=excluded.status, source='file_import', quality=excluded.quality, is_demo=0, updated_at=CURRENT_TIMESTAMP`)
    .run(item.athleteId, item.eventDate, numberValue(p.sleepHours), numberValue(p.sleepQuality), numberValue(p.morningPulse), numberValue(p.weightKg), numberValue(p.fatigueIndex), numberValue(p.sorenessIndex), numberValue(p.moodIndex), ['normal','attention','alert','rest','missing'].includes(text(p.status)) ? text(p.status) : 'normal', item.quality === 'warning' ? 'partial' : 'valid');
  const saved = db.prepare('SELECT id FROM daily_wellness WHERE athlete_id=? AND wellness_date=?').get(item.athleteId, item.eventDate) as { id: number };
  return { skipped: false, entityId: saved.id };
}

function upsertSessionItem(item: DataImportItemView, userId: number, policy: 'skip' | 'update') {
  const p = item.payload; const order = Math.max(1, Math.round(numberValue(p.sessionOrder) || 1));
  const existing = db.prepare('SELECT id FROM training_sessions WHERE athlete_id=? AND session_date=? AND session_order=?').get(item.athleteId, item.eventDate, order) as { id: number } | undefined;
  if (existing && policy === 'skip') return { skipped: true, entityId: existing.id };
  db.prepare(`INSERT INTO training_sessions (athlete_id, session_date, session_order, start_time, training_type, structure_type, intensity_zone, content, duration_min, distance_km, rpe, srpe, smvl, average_heart_rate, max_heart_rate, average_power_w, stroke_rate_spm, source, quality, is_demo, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_import', ?, 0, ?) ON CONFLICT(athlete_id, session_date, session_order) DO UPDATE SET start_time=excluded.start_time, training_type=excluded.training_type, structure_type=excluded.structure_type, intensity_zone=excluded.intensity_zone, content=excluded.content, duration_min=excluded.duration_min, distance_km=excluded.distance_km, rpe=excluded.rpe, srpe=excluded.srpe, smvl=excluded.smvl, average_heart_rate=excluded.average_heart_rate, max_heart_rate=excluded.max_heart_rate, average_power_w=excluded.average_power_w, stroke_rate_spm=excluded.stroke_rate_spm, source='file_import', quality=excluded.quality, is_demo=0, updated_at=CURRENT_TIMESTAMP`)
    .run(item.athleteId, item.eventDate, order, text(p.startTime), text(p.trainingType), text(p.structureType), text(p.intensityZone), text(p.content), numberValue(p.durationMin) || 0, numberValue(p.distanceKm) || 0, numberValue(p.rpe), numberValue(p.srpe) || 0, numberValue(p.smvl) || 0, numberValue(p.averageHeartRate), numberValue(p.maxHeartRate), numberValue(p.averagePowerW), numberValue(p.strokeRateSpm), item.quality === 'warning' ? 'partial' : 'valid', userId);
  const saved = db.prepare('SELECT id FROM training_sessions WHERE athlete_id=? AND session_date=? AND session_order=?').get(item.athleteId, item.eventDate, order) as { id: number };
  return { skipped: false, entityId: saved.id };
}

function upsertInjuryItem(item: DataImportItemView, userId: number, policy: 'skip' | 'update') {
  const p = item.payload;
  const existing = db.prepare('SELECT id FROM injury_records WHERE athlete_id=? AND onset_date=? AND injury_name=?').get(item.athleteId, item.eventDate, text(p.injuryName)) as { id: number } | undefined;
  if (existing && policy === 'skip') return { skipped: true, entityId: existing.id };
  const side = ({ 左: 'left', 右: 'right', 双侧: 'bilateral', 中央: 'center', 未指定: 'unspecified' }[text(p.side)] || text(p.side) || 'unspecified');
  const status = ({ 健康: 'healthy', 观察: 'observation', 限训: 'restricted', 康复: 'rehab', 停训: 'suspended' }[text(p.status)] || text(p.status) || 'observation');
  if (existing) { db.prepare('UPDATE injury_records SET body_part=?, side=?, status=?, pain_score=?, restrictions=?, rehab_plan=?, review_date=?, note=? WHERE id=?').run(text(p.bodyPart), side, status, Math.min(10, Math.max(0, numberValue(p.painScore) || 0)), text(p.restrictions), text(p.rehabPlan), text(p.reviewDate), text(p.note), existing.id); return { skipped:false, entityId:existing.id }; }
  const inserted = db.prepare(`INSERT INTO injury_records (athlete_id, record_type, injury_name, body_part, side, status, pain_score, onset_date, restrictions, rehab_plan, review_date, note, created_by) VALUES (?, 'formal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(item.athleteId, text(p.injuryName), text(p.bodyPart), side, status, Math.min(10, Math.max(0, numberValue(p.painScore) || 0)), item.eventDate, text(p.restrictions), text(p.rehabPlan), text(p.reviewDate), text(p.note), userId);
  return { skipped:false, entityId:Number(inserted.lastInsertRowid) };
}

function upsertCompetitiveItem(item: DataImportItemView, policy: 'skip' | 'update') {
  const p=item.payload; const existing=db.prepare('SELECT id FROM competitive_state_assessments WHERE athlete_id=? AND assessment_date=?').get(item.athleteId,item.eventDate) as {id:number}|undefined;
  if(existing&&policy==='skip') return {skipped:true,entityId:existing.id};
  const level=({巅峰:'peak',良好:'good',建设:'build',调整:'adjust'}[text(p.stateLevel)]||text(p.stateLevel)||'build');
  db.prepare(`INSERT INTO competitive_state_assessments (athlete_id,assessment_date,overall_score,state_level,endurance_score,power_score,technique_score,load_adaptation_score,recovery_score,competition_score,note,source,quality,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,'file_import',?,0) ON CONFLICT(athlete_id,assessment_date) DO UPDATE SET overall_score=excluded.overall_score,state_level=excluded.state_level,endurance_score=excluded.endurance_score,power_score=excluded.power_score,technique_score=excluded.technique_score,load_adaptation_score=excluded.load_adaptation_score,recovery_score=excluded.recovery_score,competition_score=excluded.competition_score,note=excluded.note,source='file_import',quality=excluded.quality,is_demo=0`)
    .run(item.athleteId,item.eventDate,numberValue(p.overallScore),level,numberValue(p.enduranceScore),numberValue(p.powerScore),numberValue(p.techniqueScore),numberValue(p.loadAdaptationScore),numberValue(p.recoveryScore),numberValue(p.competitionScore),text(p.note),item.quality==='warning'?'partial':'valid');
  const saved=db.prepare('SELECT id FROM competitive_state_assessments WHERE athlete_id=? AND assessment_date=?').get(item.athleteId,item.eventDate) as {id:number}; return {skipped:false,entityId:saved.id};
}

function upsertScoringRule(item: DataImportItemView, batchId: string, policy: 'skip' | 'update') {
  const payload = item.payload;
  const project = text(payload.project);
  const gender = text(payload.gender);
  const score = numberValue(payload.score);
  const comparison = text(payload.comparison) || 'gte';
  const ruleVersion = text(payload.ruleVersion);
  const existing = db.prepare(`SELECT id FROM metric_scoring_rules WHERE project = ? AND gender = ? AND metric_code = ? AND score = ? AND rule_version = ?`)
    .get(project, gender, item.metricCode, score, ruleVersion) as { id: number } | undefined;
  if (existing && policy === 'skip') return { skipped: true, entityId: existing.id };
  if (existing) {
    db.prepare('UPDATE metric_scoring_rules SET threshold_value = ?, comparison = ?, source_batch_id = ?, active = 1 WHERE id = ?')
      .run(item.valueNum, comparison, batchId, existing.id);
    return { skipped: false, entityId: existing.id };
  }
  const inserted = db.prepare(`INSERT INTO metric_scoring_rules (project, gender, metric_code, score, threshold_value, comparison, rule_version, source_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(project, gender, item.metricCode, score, item.valueNum, comparison, ruleVersion, batchId);
  return { skipped: false, entityId: Number(inserted.lastInsertRowid) };
}

function syncLegacyStrengthTests(athleteDates: Set<string>, userId: number) {
  for (const key of athleteDates) {
    const [athleteIdText, date] = key.split('|');
    const athleteId = Number(athleteIdText);
    const metrics: Record<string, number> = {};
    const measurements = db.prepare(`SELECT tm.metric_code AS metricCode, tm.value_num AS valueNum, tm.side
      FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id
      WHERE ts.athlete_id = ? AND ts.test_date = ? AND ts.test_type = '力量素质测试'`).all(athleteId, date) as Array<{ metricCode: MetricCode; valueNum: number; side: string }>;
    for (const measurement of measurements) {
      const lookup = (measurement.side === 'center' ? measurement.metricCode : `${measurement.metricCode}:${measurement.side}`) as keyof typeof LEGACY_METRIC_KEYS;
      const legacyKey = LEGACY_METRIC_KEYS[lookup];
      if (legacyKey) metrics[legacyKey] = Number(measurement.valueNum);
    }
    const body = db.prepare('SELECT height_cm AS heightCm, weight_kg AS weightKg FROM athlete_body_measurements WHERE athlete_id = ? AND measurement_date = ?')
      .get(athleteId, date) as { heightCm: number | null; weightKg: number | null } | undefined;
    if (body?.heightCm !== null && body?.heightCm !== undefined) metrics.heightCm = Number(body.heightCm);
    if (body?.weightKg !== null && body?.weightKg !== undefined) metrics.weightKg = Number(body.weightKg);
    const existing = db.prepare('SELECT metrics_json AS metricsJson, targets_json AS targetsJson, notes FROM athlete_strength_tests WHERE athlete_id = ? AND test_date = ?')
      .get(athleteId, date) as { metricsJson: string; targetsJson: string; notes: string } | undefined;
    const merged = { ...(existing ? JSON.parse(existing.metricsJson || '{}') : {}), ...metrics };
    db.prepare(`INSERT INTO athlete_strength_tests (athlete_id, test_date, metrics_json, targets_json, notes, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(athlete_id, test_date) DO UPDATE SET metrics_json = excluded.metrics_json,
        notes = excluded.notes, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
      .run(athleteId, date, JSON.stringify(merged), existing?.targetsJson || '{}', existing?.notes || '统一数据导入', userId, userId);
  }
}

function resolvePendingAthletes(input: {
  batch: DataImportPreview;
  userId: number;
  creatorRole: string;
}) {
  const requiredNames = new Set(input.batch.items
    .filter((item) => item.itemType !== 'scoring_rule' && !item.athleteId && item.quality !== 'skipped')
    .map((item) => normalizedName(item.rawAthleteName)));
  const resolved = new Map<string, number>();
  const candidatesByName = new Map(input.batch.athleteCandidates.map((candidate) => [candidate.normalizedName, candidate]));
  let createdCount = 0;
  for (const candidate of input.batch.athleteCandidates) {
    if (!requiredNames.has(candidate.normalizedName)) continue;
    let athlete = db.prepare(`SELECT id FROM athletes WHERE name = ? AND project = ? AND team = ?`)
      .get(candidate.name, candidate.project, candidate.team) as { id: number } | undefined;
    const wasCreated = !athlete;
    if (!athlete) {
      const result = db.prepare(`INSERT INTO athletes (
        name, project, team, gender, region, city, county, profile_status, source, data_import_batch_id, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'incomplete', 'file_import', ?, 1)`)
        .run(candidate.name, candidate.project, candidate.team, candidate.gender, candidate.region, candidate.city,
          candidate.county, input.batch.id);
      athlete = { id: Number(result.lastInsertRowid) };
      db.prepare(`INSERT INTO athlete_profiles (athlete_id, notes) VALUES (?, ?)`)
        .run(athlete.id, '由统一数据导入自动创建，无登录账号，基本资料待补充。');
      createdCount += 1;
    } else {
      db.prepare('UPDATE athletes SET active = 1 WHERE id = ?').run(athlete.id);
      db.prepare('INSERT OR IGNORE INTO athlete_profiles (athlete_id) VALUES (?)').run(athlete.id);
    }
    if (input.creatorRole === 'SCC') {
      db.prepare('INSERT OR IGNORE INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(input.userId, athlete.id);
    }
    db.prepare(`UPDATE data_import_athlete_candidates SET status = ?, created_athlete_id = ?, matched_athlete_id = ? WHERE id = ?`)
      .run(wasCreated ? 'created' : 'matched', wasCreated ? athlete.id : null, wasCreated ? null : athlete.id, candidate.id);
    resolved.set(candidate.normalizedName, athlete.id);
  }
  for (const item of input.batch.items) {
    if (item.athleteId || item.itemType === 'scoring_rule') continue;
    const athleteId = resolved.get(normalizedName(item.rawAthleteName));
    if (!athleteId) continue;
    item.athleteId = athleteId;
    if (item.itemType === 'athlete_profile') {
      const candidate = candidatesByName.get(normalizedName(item.rawAthleteName));
      if (candidate) item.payload.team = candidate.team;
    }
    item.messages = item.messages.filter((message) => !message.includes('未匹配到已有运动员') && !message.includes('将创建无登录账号'));
    item.quality = makeQuality(item.messages, item.quality === 'skipped');
    db.prepare('UPDATE data_import_items SET athlete_id = ?, payload_json = ?, quality = ?, messages_json = ? WHERE id = ?')
      .run(athleteId, JSON.stringify(item.payload), item.quality, JSON.stringify(item.messages), item.id);
  }
  return { createdCount, resolvedIds: [...resolved.values()] };
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
  if (batch.status === 'committed') return { batch, imported: batch.importedCount, skipped: batch.skippedCount };
  if (batch.status !== 'reviewing') throw new Error('该批次当前不能提交。');
  const allowed = new Set(input.athletes.map((athlete) => athlete.id));
  const candidateNames = new Set(batch.athleteCandidates.map((candidate) => candidate.normalizedName));
  const importable = batch.items.filter((item) => item.quality !== 'skipped');
  const candidateWithoutTeam = batch.athleteCandidates.find((candidate) =>
    candidate.status === 'pending'
    && importable.some((item) => !item.athleteId && normalizedName(item.rawAthleteName) === candidate.normalizedName)
    && !text(candidate.team)
  );
  if (candidateWithoutTeam) throw new Error(`请先在新运动员审核区为“${candidateWithoutTeam.name}”选择所属队伍。`);
  const candidateTeamOutOfScope = batch.athleteCandidates.find((candidate) =>
    candidate.status === 'pending'
    && text(candidate.team)
    && input.allowedTeams
    && !input.allowedTeams.has(text(candidate.team))
  );
  if (candidateTeamOutOfScope) throw new Error(`“${candidateTeamOutOfScope.name}”选择的所属队伍不在当前账号权限范围内。`);
  const profileTeamOutOfScope = importable.find((item) =>
    item.itemType === 'athlete_profile'
    && Boolean(item.athleteId)
    && text(item.payload.team)
    && input.allowedTeams
    && !input.allowedTeams.has(text(item.payload.team))
  );
  if (profileTeamOutOfScope) throw new Error(`“${profileTeamOutOfScope.rawAthleteName}”填写的所属队伍不在当前账号权限范围内。`);
  const invalid = importable.filter((item) => refreshItemValidation(item, allowed, candidateNames).quality === 'error');
  if (invalid.length) throw new Error(`仍有${invalid.length}条数据未通过校验，请先修正红色字段。`);
  let imported = 0;
  let skipped = batch.items.filter((item) => item.quality === 'skipped').length;
  const sessionIds = new Set<number>();
  const athleteDates = new Set<string>();
  let createdAthletes = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const resolution = resolvePendingAthletes({ batch, userId: input.userId, creatorRole: input.creatorRole });
    createdAthletes = resolution.createdCount;
    for (const athleteId of resolution.resolvedIds) allowed.add(athleteId);
    for (const item of importable) {
      let result: { skipped: boolean; entityId: number; sessionId?: number };
      let entityType = '';
      if (item.itemType === 'athlete_profile') {
        result = upsertAthleteProfileItem(item, input.batchId);
        entityType = 'athlete';
      } else if (item.itemType === 'wellness') {
        result = upsertWellnessItem(item, input.conflictPolicy);
        entityType = 'daily_wellness';
      } else if (item.itemType === 'training_session') {
        result = upsertSessionItem(item, input.userId, input.conflictPolicy);
        entityType = 'training_session';
      } else if (item.itemType === 'training_set') {
        result = upsertTrainingItem(item, input.batchId, input.userId, input.conflictPolicy);
        entityType = 'strength_result_set';
        if (result.sessionId) sessionIds.add(result.sessionId);
      } else if (item.itemType === 'test_measurement') {
        result = upsertTestItem(item, input.batchId, input.userId, input.conflictPolicy);
        entityType = 'test_measurement';
        athleteDates.add(`${item.athleteId}|${item.eventDate}`);
      } else if (item.itemType === 'body_measurement') {
        result = upsertBodyItem(item, input.batchId, input.conflictPolicy);
        entityType = 'athlete_body_measurement';
        athleteDates.add(`${item.athleteId}|${item.eventDate}`);
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
      if (result.skipped) skipped += 1;
      else imported += 1;
      db.prepare('UPDATE data_import_items SET committed_entity_type = ?, committed_entity_id = ? WHERE id = ?')
        .run(entityType, result.entityId, item.id);
    }
    for (const sessionId of sessionIds) updateSessionTotals(sessionId);
    syncLegacyStrengthTests(athleteDates, input.userId);
    db.prepare(`UPDATE data_import_batches SET status = 'committed', imported_count = ?, skipped_count = ?, committed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(imported, skipped, input.batchId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(input.userId, 'COMMIT_DATA_IMPORT', 'data_import_batch', null, JSON.stringify({ batchId: input.batchId, imported, skipped, createdAthletes, conflictPolicy: input.conflictPolicy }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { batch: getDataImportBatch(input.batchId, input.userId), imported, skipped, createdAthletes };
}
