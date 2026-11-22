import ExcelJS from 'exceljs';
import * as XLSX from '@e965/xlsx';
import { isValidIsoDate } from '../core/date-utils.ts';
import { teamPlanInput } from './team-plan-service.ts';

const columns = ['日期', '星期', '早操', '上午', '下午', '晚上'] as const;
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : String(value ?? '').trim();

export function buildTeamPlanWorkbook() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('队伍训练计划', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((header, index) => ({
    header,
    width: index < 2 ? 16 : 45,
    style: { numFmt: '@', alignment: { wrapText: true, vertical: 'top' } },
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(Array.from({ length: 7 }, () => []));
  const guide = book.addWorksheet('填写说明');
  guide.getColumn(2).width = 100;
  guide.addRows([
    ['日期', '按 YYYY-MM-DD 填写。每张工作表对应一个计划周期，单日一行。'],
    ['安排', '每个时段填写实际拟安排的内容。休息、调整可直接填写；无安排可留空。'],
    ['类别', '可在内容前加「专项：」「体能：」「恢复：」指定类别；未指定时按内容归类。'],
    ['多周', '复制首张工作表并重命名，按周填写。队伍由上传页面所选队伍决定。'],
  ]);
  return book;
}

function dateText(value: unknown, date1904: boolean) {
  if (typeof value !== 'number') return text(value);
  const date = XLSX.SSF.parse_date_code(value, { date1904 });
  return date
    ? [date.y, date.m, date.d].map((part) => String(part).padStart(2, '0')).join('-')
    : '';
}

export function readTeamPlanWorkbook(buffer: Buffer) {
  if (buffer.subarray(0, 4).toString('hex') !== '504b0304')
    throw new Error('文件不是有效的 .xlsx 工作簿。');
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(buffer, { type: 'buffer', sheetRows: 255 });
  } catch {
    throw new Error('无法读取 Excel 文件，请使用队伍训练计划模板。');
  }
  const names = book.SheetNames.filter((name) => !['填写说明', '周计划说明'].includes(name));
  if (!names.length || names.length > 12)
    throw new Error('请上传含 1 至 12 张队伍计划表的 Excel。');
  const overview = book.Sheets['周计划说明'];
  const context = overview
    ? XLSX.utils.sheet_to_json<unknown[]>(overview, { header: 1, raw: true }).slice(1)
    : [];
  const plans = names.map((name) => {
    const sheet = book.Sheets[name];
    if (sheet['!fullref']) throw new Error(`「${name}」的行数超出模板范围。`);
    const [header, ...rows] = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      blankrows: true,
    });
    if (columns.some((column, index) => text(header?.[index]) !== column))
      throw new Error(`「${name}」表头与队伍训练计划模板不一致。`);
    const dates = new Set<string>();
    const sessions = [];
    const dayNotes = [];
    for (const [index, row] of rows.entries()) {
      if (!row.some((value) => text(value))) continue;
      const date = dateText(row[0], book.Workbook?.WBProps?.date1904 === true);
      if (!isValidIsoDate(date) || dates.has(date))
        throw new Error(`「${name}」第 ${index + 2} 行的日期无效或重复。`);
      const periods = columns.slice(2);
      if (row.slice(columns.length).some((value) => text(value)))
        throw new Error(`「${name}」第 ${index + 2} 行有模板外的内容。`);
      dates.add(date);
      for (const [offset, period] of periods.entries()) {
        const value = text(row[offset + 2]);
        if (!value) continue;
        if (/^(休息|调整)[。！! ]*$/.test(value)) {
          dayNotes.push(`${date} ${period}：${value}`);
          continue;
        }
        const explicit = /^(专项|体能|恢复)[:：]\s*/.exec(value);
        const content = explicit ? value.slice(explicit[0].length) : value;
        const kind =
          explicit?.[1] ??
          (/水上|桨频|有氧划|技术划|阻力划/.test(content)
            ? '专项'
            : /力量|核心|有氧跑|俯卧撑|楼梯/.test(content)
              ? '体能'
              : '专项');
        const category = kind === '体能' ? 'physical' : kind === '恢复' ? 'recovery' : 'special';
        sessions.push({
          id: `${date}-${offset + 1}`,
          date,
          period: ['早操', 'morning', 'afternoon', 'evening'][offset],
          content,
          category,
        });
      }
    }
    if (!dates.size || !sessions.length) throw new Error(`「${name}」未填写有效训练安排。`);
    const ordered = [...dates].sort();
    const week = /^第(\d+)周$/.exec(name)?.[1];
    const meta = week ? context.find((row) => text(row[0]) === week) : undefined;
    const result = teamPlanInput.safeParse({
      title: text(meta?.[1]) || name,
      startDate: ordered[0],
      endDate: ordered.at(-1),
      data: {
        sessions,
        overrides: [],
        goal: text(meta?.[2]),
        focus: [text(meta?.[3]), text(meta?.[4]), ...dayNotes].filter(Boolean).join('\n'),
      },
    });
    if (!result.success) throw new Error(`「${name}」的计划内容超出允许范围或缺少内容。`);
    return { ...result.data, data: { ...result.data.data, overrides: [] } };
  });
  const periods = new Set<string>();
  for (const plan of plans) {
    const period = `${plan.startDate}:${plan.endDate}`;
    if (periods.has(period)) throw new Error('文件中有重复的计划周期。');
    periods.add(period);
  }
  return plans;
}
