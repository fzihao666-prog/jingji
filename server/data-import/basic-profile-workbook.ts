import ExcelJS from 'exceljs';
import { COMMON_FITNESS_TEMPLATE_METRICS } from '../../shared/data-import-template.ts';

export const BASIC_PROFILE_SHEET = '运动员基础档案';
export const BASIC_PROFILE_HEADERS = [
  '姓名', '性别', '出生日期',
  '具体小项', '技术等级', '开始运动日期', '代表单位', '输送单位', '训练年限', '身高（cm）', '体重（kg）', '身体测量日期',
  '籍贯', '学历', '最大力量项目', '最大力量', '最好竞技成绩', '对应赛事', '成绩日期', '备注',
] as const;

export function buildBasicProfileWorkbook(
  athletes: ReadonlyArray<{ name: string }>,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控系统';
  const sheet = workbook.addWorksheet(BASIC_PROFILE_SHEET, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });
  sheet.columns = BASIC_PROFILE_HEADERS.map(header => ({
    header,
    width: ['最好竞技成绩', '备注'].includes(header) ? 24 : 17,
    style: { numFmt: header.endsWith('日期') ? 'yyyy-mm-dd' : (header.includes('（') || header === '训练年限' || header === '最大力量') ? '0.##' : '@' },
  }));
  sheet.getCell('A1').value = '姓名\n必填，其他按需填写';
  sheet.getColumn(1).width = 22;
  sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = 38;
  sheet.getRow(1).eachCell(cell => { cell.numFmt = '@'; });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183655' } };
  sheet.getCell('A1').note = '项目和队伍使用上传页面的选择。同队已有队员按姓名关联；新队员仅需填写姓名。';
  sheet.getRow(1).getCell(BASIC_PROFILE_HEADERS.indexOf('训练年限') + 1).note = '以年填写，可写 3.5 或 3年6个月，未提供时留空。';
  sheet.getRow(1).getCell(BASIC_PROFILE_HEADERS.indexOf('身体测量日期') + 1).note = '填写身高或体重时，须同时填写实际测量日期（YYYY-MM-DD）。';
  const strengthProjectColumn = BASIC_PROFILE_HEADERS.indexOf('最大力量项目') + 1;
  const strengthColumn = BASIC_PROFILE_HEADERS.indexOf('最大力量') + 1;
  sheet.getColumn(strengthProjectColumn).width = 22;
  sheet.getColumn(strengthColumn).width = 22;
  sheet.getRow(1).getCell(strengthProjectColumn).note = '填深蹲、卧推、卧拉、硬拉或高翻。同一人有多个项目时，可另起一行填写姓名和对应项目。';
  sheet.getRow(1).getCell(strengthColumn).value = '最大力量\n实测1RM（kg）';
  sheet.getRow(1).getCell(strengthColumn).numFmt = '@';
  sheet.getRow(1).getCell(strengthColumn).note = '填写实测公斤数，例如 95。系统按标准测试的默认导入日期记入成绩。';
  const actions = COMMON_FITNESS_TEMPLATE_METRICS.filter(metric => metric[5] === '实测1RM').map(([label]) => label.split('1RM')[0]);
  for (const athlete of athletes) {
    const row = sheet.addRow([athlete.name]);
    row.getCell(strengthProjectColumn).dataValidation = { type: 'list', allowBlank: true,
      formulae: [`"${actions.join(',')}"`], showErrorMessage: true };
  }
  return workbook;
}
