import ExcelJS from 'exceljs';
import { projectLabel } from '../../shared/projects.ts';

export const BASIC_PROFILE_SHEET = '运动员基础档案';
export const BASIC_PROFILE_HEADERS = [
  '运动员编号', '姓名', '运动项目', '所属队伍', '性别', '出生日期',
  '具体小项', '技术等级', '开始运动日期', '代表单位', '输送单位', '训练年限', '身高（cm）', '体重（kg）', '身体测量日期',
  '籍贯', '学历', '最大力量', '最好竞技成绩', '对应赛事', '成绩日期', '备注',
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
  sheet.getCell('A1').value = '运动员编号\n系统预填';
  sheet.getCell('B1').value = '姓名\n必填，其他按需填写';
  sheet.getCell('C1').value = '运动项目\n系统预填';
  sheet.getCell('D1').value = '所属队伍\n系统预填';
  sheet.getColumn(2).width = 22;
  sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = 38;
  sheet.getRow(1).eachCell(cell => { cell.numFmt = '@'; });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183655' } };
  sheet.getCell('A1').note = '编号由系统预填，可留空。按上传所选队伍和姓名关联已有队员；新增队员只需填写姓名。';
  sheet.getRow(1).getCell(BASIC_PROFILE_HEADERS.indexOf('训练年限') + 1).note = '以年填写，可写 3.5 或 3年6个月，未提供时留空。';
  sheet.getRow(1).getCell(BASIC_PROFILE_HEADERS.indexOf('身体测量日期') + 1).note = '填写身高或体重时，须同时填写实际测量日期（YYYY-MM-DD）。';
  const strengthColumn = BASIC_PROFILE_HEADERS.indexOf('最大力量') + 1;
  sheet.getColumn(strengthColumn).width = 38;
  sheet.getRow(1).getCell(strengthColumn).value = '最大力量\n选填，日期 动作 重量kg';
  sheet.getRow(1).getCell(strengthColumn).note =
    '填实测1RM，例如 2026-11-20 深蹲 95kg。支持深蹲、卧推、卧拉、硬拉、高翻；多项用分号或换行隔开。';
  sheet.getCell('B1').note = '姓名必填，其他资料按需补充。同一项目和队伍内，已有队员姓名唯一时自动关联。';
  sheet.getCell('C1').note = '系统预填，上传时以所选项目为准。';
  sheet.getCell('D1').note = '系统预填，上传时以所选队伍为准。';
  for (const athlete of athletes) {
    sheet.addRow([String(athlete.id), athlete.name, projectLabel(project), team]);
  }
  return workbook;
}
