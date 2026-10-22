import ExcelJS from 'exceljs';
import {
  IMPORT_TEMPLATE_VERSION,
  IMPORT_TEMPLATE_VERSION_NAME,
  TEMPLATE_CALCULATION_NOTES,
  templateFieldHeader,
  type ImportTemplateField,
} from '../../shared/import-template-fields.ts';

export function createTemplateWorkbook(title: string): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控系统';
  const instructions = workbook.addWorksheet('填写说明');
  instructions.getColumn(1).width = 110;
  instructions.getColumn(2).hidden = true;
  instructions.getCell('A1').value = title;
  instructions.getCell('A1').font = { bold: true, size: 18 };
  instructions.getCell('B1').value = IMPORT_TEMPLATE_VERSION;
  workbook.definedNames.add("'填写说明'!$B$1", IMPORT_TEMPLATE_VERSION_NAME);
  TEMPLATE_CALCULATION_NOTES.forEach((line, index) => {
    const cell = instructions.getCell(index + 3, 1);
    cell.value = `${index + 1}. ${line}`;
    cell.alignment = { wrapText: true, vertical: 'middle' };
    instructions.getRow(index + 3).height = 42;
  });
  return workbook;
}

export function addTemplateSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  fields: ImportTemplateField[],
  note: string
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 3, xSplit: fields[0]?.key === '系统运动员编号' ? 2 : 1 }],
  });
  sheet.properties.outlineLevelCol = 1;
  sheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  sheet.mergeCells(1, 1, 1, fields.length);
  sheet.getCell('A1').value = name;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF246BFD' } };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, fields.length);
  sheet.getCell('A2').value =
    `${note} 专业选填列已收起，点左上角分组级别“2”展开；不支持分组时取消隐藏列。详情见列批注。`;
  sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(2).height = 48;
  sheet.getRow(3).height = 82;
  fields.forEach((field, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = /备注|协议|内容|地址|姓名|组合/.test(field.key) ? 28 : 22;
    column.outlineLevel = field.advanced ? 1 : 0;
    column.hidden = field.advanced;
    if (/日期/.test(field.key)) column.numFmt = 'yyyy-mm-dd';
    if (/编号|手机|电话/.test(field.key)) column.numFmt = '@';
    const cell = sheet.getCell(3, index + 1);
    cell.value = templateFieldHeader(field);
    cell.note = `${templateFieldHeader(field)}\n${field.hint}${field.choices ? `\n可选值：${field.choices.join('、')}` : ''}`;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb:
          field.requirement === '必填'
            ? 'FF193A44'
            : field.requirement === '条件必填'
              ? 'FF345D68'
              : 'FF52747C',
      },
    };
    cell.alignment = { wrapText: true, vertical: 'middle' };
    // 使用公开的单元格API；不放示例值，粘贴不能替代服务端校验。
    for (let row = 4; row <= 503; row += 1) {
      sheet.getCell(row, index + 1).dataValidation = {
        type: field.choices ? 'list' : 'custom',
        allowBlank: true,
        formulae: field.choices ? [`"${field.choices.join(',')}"`] : ['TRUE'],
        showInputMessage: true,
        promptTitle: `${field.requirement}｜${field.unit}`.slice(0, 32),
        prompt: `${field.hint} 例：${field.example}`.slice(0, 255),
        showErrorMessage: Boolean(field.choices),
        errorTitle: '请检查填写值',
        error: `请选择：${field.choices?.join('、') || '按列说明填写'}`,
      };
    }
  });
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: fields.length } };
  return sheet;
}
