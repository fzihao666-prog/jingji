import ExcelJS from 'exceljs';
import {
  IMPORT_TEMPLATE_VERSION,
  IMPORT_TEMPLATE_VERSION_NAME,
  TEMPLATE_CALCULATION_NOTES,
  templateFieldHeader,
  type ImportTemplateField,
  type TemplateRequirement,
} from '../../shared/import-template-fields.ts';

// 配色与必填文字同时展示，避免只依赖色差判断填写要求。
const requirementColors: Record<TemplateRequirement, { background: string; text: string }> = {
  必填: { background: 'FF991B1B', text: 'FFFFFFFF' },
  条件必填: { background: 'FFF59E0B', text: 'FF422006' },
  选填: { background: 'FF1D4ED8', text: 'FFFFFFFF' },
  系统预填: { background: 'FFE2E8F0', text: 'FF334155' },
  系统计算: { background: 'FFEDE9FE', text: 'FF5B21B6' },
};

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
  sheet.mergeCells(1, 1, 1, fields.length);
  sheet.getCell('A1').value = name;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF246BFD' } };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, fields.length);
  sheet.getCell('A2').value =
    `${note} 必填项在前，选填项在后；所有数据列直接显示，按需填写。填写要求见表头。`;
  sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(2).height = 48;
  sheet.getRow(3).height = 82;
  fields.forEach((field, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = /备注|协议|内容|地址|姓名|组合/.test(field.key) ? 28 : 22;
    if (/日期/.test(field.key)) column.numFmt = 'yyyy-mm-dd';
    if (/编号|手机|电话/.test(field.key)) column.numFmt = '@';
    const cell = sheet.getCell(3, index + 1);
    cell.value = templateFieldHeader(field);
    const wrappedLines = String(cell.value)
      .split('\n')
      .reduce(
        (count, line) =>
          count +
          Math.max(
            1,
            Math.ceil(
              [...line].reduce(
                (width, character) => width + (character.charCodeAt(0) > 255 ? 2 : 1),
                0
              ) /
                (column.width! - 2)
            )
          ),
        0
      );
    sheet.getRow(3).height = Math.max(sheet.getRow(3).height || 82, wrappedLines * 15 + 14);
    const colors = requirementColors[field.requirement];
    cell.font = { bold: true, color: { argb: colors.text } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.background },
    };
    cell.alignment = { wrapText: true, vertical: 'middle' };
    // Excel内联列表限255字符；长字典放可见选项表并通过命名区域引用。
    let choiceFormula = field.choiceFormula;
    if (!choiceFormula && field.choices?.length && field.choices.join(',').length > 250) {
      const optionsSheet = workbook.getWorksheet('选项列表') || workbook.addWorksheet('选项列表');
      const optionsColumn = optionsSheet.columnCount + 1;
      optionsSheet.getCell(1, optionsColumn).value = `${name}：${field.displayName || field.key}`;
      field.choices.forEach((value, offset) => { optionsSheet.getCell(offset + 2, optionsColumn).value = value; });
      optionsSheet.getColumn(optionsColumn).width = 28;
      const letter = optionsSheet.getColumn(optionsColumn).letter;
      choiceFormula = `_JINGJI_OPTIONS_${workbook.worksheets.length}_${optionsColumn}`;
      workbook.definedNames.add(`'选项列表'!$${letter}$2:$${letter}$${field.choices.length + 1}`, choiceFormula);
    }
    // 使用公开的单元格API；不放示例值，粘贴不能替代服务端校验。
    for (let row = 4; row <= 503; row += 1) {
      sheet.getCell(row, index + 1).dataValidation = {
        type: field.choices ? 'list' : 'custom',
        allowBlank: true,
        formulae: choiceFormula ? [choiceFormula] : field.choices ? [`"${field.choices.join(',')}"`] : ['TRUE'],
        showInputMessage: false,
        showErrorMessage: Boolean(field.choices),
        errorStyle: 'stop',
        errorTitle: '请检查填写值',
        error: choiceFormula ? '请从下拉列表选择；找不到选项时请核对项目或联系管理员。' : `请选择：${field.choices?.join('、') || '按列说明填写'}`,
      };
    }
  });
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: fields.length } };
  return sheet;
}
