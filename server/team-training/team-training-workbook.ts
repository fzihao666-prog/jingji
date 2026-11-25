import * as XLSX from '@e965/xlsx';
import { projectCapability } from '../../shared/projects.ts';
import { isValidIsoDate } from '../core/date-utils.ts';
import type { TeamTrainingColumnMapping } from '../../shared/team-training-stats.ts';

const sheetNames = ['全队训练负荷', '队伍训练统计'];
const normalize = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '');
const derivedHeaders = new Set([
  '激流训练',
  '水上时间',
  '陆地时间',
  '总时间(min)',
  '总时间',
  '总距离(km)',
  '总距离',
]);
const nonDataHeaders = new Set(['序号', '日期', '星期', '队伍', '项目', '备注']);
const auxiliary = new Set(['耐力', '爆发力', '功能训练']);
const waterCategories = new Set([
  '3级有氧',
  '2级有氧',
  '1级有氧',
  '乳酸阈',
  '无氧能力',
  '无氧功率',
  '测功仪',
  '阻力划',
  '比赛',
  '测试',
]);
const landCategories = new Set([
  '陆上有氧/热身',
  '大力量',
  '耐力',
  '爆发力',
  '功能训练',
  '核心力量',
  '恢复再生',
]);
const waterSourceQualifiers: Record<string, string> = {
  '3级有氧': 'HR<75%',
  '2级有氧': 'HR=76%-85%',
  '1级有氧': 'HR>86%',
  乳酸阈: 'AT',
  无氧能力: 'AN',
  无氧功率: 'ATP',
  阻力划: 'SSE',
  '陆上有氧/热身': 'RT',
  大力量: 'SM',
  耐力: 'SE',
  爆发力: 'SP',
  功能训练: 'FT',
  核心力量: 'PP',
  恢复再生: 'RG',
};

export class TeamTrainingInputError extends Error {}

/** 避免日期跨出四位年份后破坏 ISO 周计算。 */
export function isTeamTrainingDate(value: string) {
  return value >= '0002-01-01' && value <= '9998-12-31' && isValidIsoDate(value);
}

type Column = {
  key: string;
  label: string;
  category: string;
  qualifier: string;
  unit: string;
  column: number;
};
type Entry = { date: string; column: Column; value: number; address: string };

export function normalizeTeamTrainingUnit(value: string) {
  const unit = normalize(value);
  if (['min', '分钟'].includes(unit.toLowerCase())) return 'min';
  if (['km', '千米', '公里'].includes(unit.toLowerCase())) return 'km';
  return unit;
}

/** 固定水上模板采用原始表头和原表分组，其他项目依照保存的列映射。 */
export function defaultTeamTrainingMapping(
  project: string,
  column: Column
): TeamTrainingColumnMapping | undefined {
  if (!projectCapability(project) || !['min', 'km'].includes(column.unit)) return;
  const { category, qualifier } = column;
  if (!waterCategories.has(category) && !landCategories.has(category)) return;
  if (qualifier !== (waterSourceQualifiers[category] ?? '')) return;
  return {
    category,
    unit: column.unit,
    waterGroup: waterCategories.has(category) ? 'water' : 'land',
    lessonGroup: auxiliary.has(category) ? 'auxiliary' : 'main',
  };
}

export function readTeamTrainingWorkbook(buffer: Buffer) {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellFormula: true,
      sheets: sheetNames,
      sheetRows: 10003,
    });
  } catch {
    throw new TeamTrainingInputError('无法读取 Excel 文件，请检查文件格式。');
  }
  const sheetName = sheetNames.find((name) => workbook.Sheets[name]);
  if (!sheetName) throw new TeamTrainingInputError('未找到“全队训练负荷”或“队伍训练统计”工作表。');
  const sheet = workbook.Sheets[sheetName];
  const bounds = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref'] ?? 'A1');
  if (bounds.e.r > 10002 || bounds.e.c > 127)
    throw new TeamTrainingInputError('工作表最多支持一万行数据和128列。');
  const cell = (r: number, c: number) =>
    sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  const headerText = (r: number, c: number) => {
    const merge = sheet['!merges']?.find(
      (range) => r >= range.s.r && r <= range.e.r && c >= range.s.c && c <= range.e.c
    );
    const entry = merge ? cell(merge.s.r, merge.s.c) : cell(r, c);
    return entry && !entry.f ? normalize(entry.v) : '';
  };
  const threeHeaderRows = Array.from({ length: bounds.e.c + 1 }, (_, c) => headerText(2, c)).some(
    (unit) => ['min', 'km'].includes(normalizeTeamTrainingUnit(unit))
  );
  const dateColumns: number[] = [];
  const columns: Column[] = [];
  const columnKeys = new Set<string>();
  for (let c = 0; c <= bounds.e.c; c++) {
    const title = headerText(0, c);
    if (title === '日期') dateColumns.push(c);
    if (
      !title ||
      nonDataHeaders.has(title) ||
      derivedHeaders.has(title) ||
      /^(?:合计|累计|占比|比例|平均)/.test(title)
    )
      continue;
    const secondary = threeHeaderRows ? headerText(1, c) : '';
    const inlineUnit = !threeHeaderRows ? /^(.*)\(([^()]+)\)$/.exec(title) : null;
    const category =
      title === '比赛/测试' && ['比赛', '测试'].includes(secondary)
        ? secondary
        : (inlineUnit?.[1] ?? title);
    const qualifier = category !== title && threeHeaderRows ? '' : secondary;
    const unit = normalizeTeamTrainingUnit(
      threeHeaderRows ? headerText(2, c) : (inlineUnit?.[2] ?? '')
    );
    const key = JSON.stringify([category, qualifier, unit]);
    const label = [category, qualifier, unit].filter(Boolean).join(' · ');
    if (columnKeys.has(key)) throw new TeamTrainingInputError(`“${label}”列重复，请保留一列。`);
    columnKeys.add(key);
    columns.push({ key, label, category, qualifier, unit, column: c });
  }
  if (dateColumns.length !== 1) throw new TeamTrainingInputError('请在第一行保留唯一的“日期”列。');

  const entries: Entry[] = [];
  let undatedRows = 0;
  for (let r = threeHeaderRows ? 3 : 1; r <= bounds.e.r; r++) {
    const values = columns.flatMap((column) => {
      const source = cell(r, column.column);
      return source && !source.f && !source.F && normalize(source.v) !== ''
        ? [{ column, source }]
        : [];
    });
    if (!values.length) continue;
    const dateCell = cell(r, dateColumns[0]);
    if (!dateCell || dateCell.f || dateCell.F || normalize(dateCell.v) === '') {
      undatedRows++;
      continue;
    }
    const rawDate = dateCell.v;
    const dateParts =
      typeof rawDate === 'number' && rawDate > 0 && Number.isInteger(rawDate)
        ? XLSX.SSF.parse_date_code(rawDate, {
            date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
          })
        : null;
    const date = dateParts
      ? `${String(dateParts.y).padStart(4, '0')}-${String(dateParts.m).padStart(2, '0')}-${String(dateParts.d).padStart(2, '0')}`
      : typeof rawDate === 'string'
        ? rawDate.trim()
        : '';
    if (!isTeamTrainingDate(date))
      throw new TeamTrainingInputError(
        `${sheetName}!${XLSX.utils.encode_cell({ r, c: dateColumns[0] })} 日期无效，请填写 YYYY-MM-DD。`
      );
    for (const { column, source } of values) {
      const address = XLSX.utils.encode_cell({ r, c: column.column });
      const raw = String(source.v ?? '')
        .normalize('NFKC')
        .trim();
      const value =
        typeof source.v === 'number'
          ? source.v
          : /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)
            ? Number(raw)
            : NaN;
      if (!Number.isFinite(value) || value < 0)
        throw new TeamTrainingInputError(
          `${sheetName}!${address}（${column.label}）须填写非负数。`
        );
      entries.push({ date, column, value, address });
    }
  }
  if (!entries.length) throw new TeamTrainingInputError('没有找到带有效日期的原始训练数值。');
  return { sheetName, entries, undatedRows };
}

export type TeamTrainingWorkbook = ReturnType<typeof readTeamTrainingWorkbook>;
