import ExcelJS from 'exceljs';
import { importTemplateFields } from '../../shared/import-template-fields.ts';
import { createTemplateWorkbook, addTemplateSheet } from './template-layout.ts';
import {
  UNIFIED_IMPORT_HEADERS,
  BODY_TEMPLATE_FIELDS,
  FITNESS_TEMPLATE_METRICS,
  FMS_TEMPLATE_METRICS,
  EVALUATION_SCORE_METRICS,
  IMPORT_SHEET_NOTES,
  TEMPLATE_INSTRUCTIONS,
} from '../../shared/data-import-template.ts';

/** 下载、导出及静态模板使用同一构建器；不读取数据库或填入演示测量数据。 */
export function buildImportWorkbook(sheetNames = UNIFIED_IMPORT_HEADERS.map(([name]) => name), options: { mode?: 'export' } = {}) {
  const workbook = options.mode === 'export' ? new ExcelJS.Workbook() : createTemplateWorkbook('竞迹训练监控系统｜简化数据导入模板');
  workbook.creator = '竞迹训练监控系统';
  const instructions = workbook.getWorksheet('填写说明') || workbook.addWorksheet('填写说明');
  if (options.mode === 'export') {
    instructions.getCell('A1').value = '竞迹训练监控系统｜统一数据导入模板';
    instructions.getCell('A1').font = { bold: true, size: 18 };
    instructions.getColumn(1).width = 110;
    TEMPLATE_INSTRUCTIONS.forEach((line, index) => {
      instructions.getCell(index + 3, 1).value = `${index + 1}. ${line}`;
      instructions.getCell(index + 3, 1).alignment = { wrapText: true, vertical: 'middle' };
      instructions.getRow(index + 3).height = 36;
    });
  }
  for (const [name, headers] of UNIFIED_IMPORT_HEADERS) {
    if (!sheetNames.includes(name)) continue;
    if (options.mode !== 'export') {
      addTemplateSheet(workbook, name, importTemplateFields(name), IMPORT_SHEET_NOTES[name]);
      continue;
    }
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 3, xSplit: 2 }],
    });
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.getCell('A1').value = name;
    sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF246BFD' } };
    sheet.getRow(1).height = 30;
    sheet.mergeCells(2, 1, 2, headers.length);
    sheet.getCell('A2').value = IMPORT_SHEET_NOTES[name];
    sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(2).height = 36;
    sheet.getRow(3).values = headers;
    sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF193A44' } };
    sheet.getRow(3).alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(3).height = 32;
    headers.forEach((header, index) => {
      const column = sheet.getColumn(index + 1);
      column.width = /备注|协议|内容|地址/.test(header)
        ? 28
        : /日期|编号|姓名|队伍|项目/.test(header)
          ? 18
          : 16;
      if (/日期/.test(header)) column.numFmt = 'yyyy-mm-dd';
    });
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
  }
  const dictionary = workbook.addWorksheet('数据字典');
  dictionary.addRow(['指标代码', '指标名称', '单位', '填写工作表', '说明']);
  for (const [, , code, label, unit] of BODY_TEMPLATE_FIELDS)
    dictionary.addRow([code, label, unit, '身体测量', '实测数值，可留空；不在其它表重复填报']);
  for (const [, code, label, unit] of FITNESS_TEMPLATE_METRICS)
    dictionary.addRow([code, label, unit, '体能测试', '实测数值，注明测试协议或方法']);
  for (const [, code, label] of FMS_TEMPLATE_METRICS)
    dictionary.addRow([code, label, '分', 'FMS测试', '原始得分0—3；合计由系统计算']);
  for (const [, code, label, unit] of EVALUATION_SCORE_METRICS)
    dictionary.addRow([code, label, unit, '竞技评估', '仅在有明确评分协议时填写，不自动生成分数']);
  for (const [code, label, unit] of [
    ['squat_kg', '深蹲', 'kg'],
    ['deadlift_kg', '硬拉', 'kg'],
    ['bench_press_kg', '卧推', 'kg'],
    ['bench_pull_kg', '卧拉', 'kg'],
    ['vertical_jump_cm', '纵跳', 'cm'],
  ])
    dictionary.addRow([code, label, unit, '其他测试', '每项一行，不与专用表重复填写']);
  dictionary.columns.forEach((column) => {
    column.width = 28;
  });
  dictionary.getColumn(5).width = 55;
  dictionary.getRow(1).font = { bold: true };
  return workbook;
}
