import ExcelJS from 'exceljs';
import { IMPORT_BASE_METRICS as METRICS } from '../../shared/import-base-metrics.ts';
import {
  COMPACT_ATHLETE_SHEET,
  COMPACT_ATHLETE_COLUMNS,
  compactAthleteHeader,
} from '../../shared/compact-athlete-template.ts';

/** 单表模板复用现有授权人员查询与上传服务，不写演示成绩或添加说明工作表。 */
export function buildCompactAthleteWorkbook(
  athletes: Array<{ id: number; name: string; team: string }> = [],
  today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
  }).format(new Date()),
) {
  const book = new ExcelJS.Workbook();
  book.creator = '竞迹训练监控系统';
  const sheet = book.addWorksheet(COMPACT_ATHLETE_SHEET, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
  });
  const colors = {
    identity: 'FFEAF0F5',
    body: 'FFE3F2EF',
    strength: 'FFE4EEFA',
    fitness: 'FFFFF0DB',
    note: 'FFF1F3F6',
  };
  sheet.getRow(1).height = 44;
  COMPACT_ATHLETE_COLUMNS.forEach((field, index) => {
    const column = sheet.getColumn(index + 1);
    column.width =
      field.kind === 'note'
        ? 32
        : field.key === '姓名' || field.key === '所属队伍'
          ? 24
          : field.kind === 'date'
            ? 22
            : 18;
    column.numFmt =
      field.kind === 'identity'
        ? '@'
        : field.kind === 'date'
          ? 'yyyy-mm-dd'
          : 'integer' in field
            ? '0'
            : '0.##';
    const cell = sheet.getCell(1, index + 1);
    cell.value = compactAthleteHeader(field);
    cell.font = { bold: true, size: 11, color: { argb: 'FF183655' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors[field.group] },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCD8E3' } } };
    cell.note =
      field.kind === 'test' && field.protocol === '实测1RM'
        ? '只填实测1RM；日常训练重量、估算值不能作为实测最大力量。'
        : field.kind === 'identity'
          ? '已有人员由系统预填，编号请勿修改；新人员编号留空，填写姓名和已有队伍。'
          : field.kind === 'date'
            ? '本次测试日期必填，可修改默认日期。'
            : '未测留空，不填占位文字；真实0保留。';
    for (let row = 2; row <= Math.max(501, athletes.length + 1); row++) {
      if (field.kind === 'date')
        sheet.getCell(row, index + 1).dataValidation = {
          type: 'date',
          operator: 'between',
          formulae: [
            new Date('1900-01-01T00:00:00Z'),
            new Date('2100-12-31T00:00:00Z'),
          ],
          allowBlank: true,
          showErrorMessage: true,
          error: '请输入有效测试日期。',
        };
      if (field.kind === 'body' || field.kind === 'test')
        sheet.getCell(row, index + 1).dataValidation = {
          type: 'integer' in field ? 'whole' : 'decimal',
          operator: 'between',
          formulae: [METRICS[field.code].min, METRICS[field.code].max],
          allowBlank: true,
          showErrorMessage: true,
          error: '只填写实测数值，未测留空。',
        };
    }
  });
  athletes.forEach((athlete, index) => {
    sheet.getRow(index + 2).values = [
      String(athlete.id),
      athlete.name,
      athlete.team,
      today,
    ];
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 16 },
  };
  return book;
}
