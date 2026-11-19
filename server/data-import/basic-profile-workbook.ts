import ExcelJS from 'exceljs';
import { projectLabel } from '../../shared/projects.ts';

export const BASIC_PROFILE_SHEET = '运动员基础档案';
export const BASIC_PROFILE_HEADERS = [
  '运动员编号', '姓名', '运动项目', '所属队伍', '性别', '出生日期',
  '具体小项', '代表单位', '输送单位', '训练年限', '身高（cm）', '体重（kg）', '身体测量日期',
  '籍贯', '学历', '最好竞技成绩', '对应赛事', '成绩日期', '备注',
] as const;

export function buildBasicProfileWorkbook(
  project: string,
  team: string,
  athletes: ReadonlyArray<{ id: number; name: string }>,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控系统';
  const sheet = workbook.addWorksheet(BASIC_PROFILE_SHEET, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });
  sheet.columns = BASIC_PROFILE_HEADERS.map(header => ({
    header,
    width: ['运动项目', '所属队伍', '最好竞技成绩', '备注'].includes(header) ? 24 : 17,
    style: { numFmt: header.endsWith('日期') ? 'yyyy-mm-dd' : (header.includes('（') || header === '训练年限') ? '0.##' : '@' },
  }));
  sheet.getRow(1).height = 26;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183655' } };
  sheet.getCell('A1').note = '已有人员保留系统编号。新人员编号留空，填写姓名，项目及队伍沿用上传时的选择。';
  sheet.getRow(1).getCell(BASIC_PROFILE_HEADERS.indexOf('训练年限') + 1).note = '以年填写，可写 3.5 或 3年6个月，未提供时留空。';
  sheet.getRow(1).getCell(BASIC_PROFILE_HEADERS.indexOf('身体测量日期') + 1).note = '填写身高或体重时，须同时填写实际测量日期（YYYY-MM-DD）。';
  for (const athlete of athletes) {
    sheet.addRow([String(athlete.id), athlete.name, projectLabel(project), team]);
  }
  return workbook;
}
