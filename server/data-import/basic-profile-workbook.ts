import { formatAthleteNumber } from '../../shared/athlete-number.ts';
import ExcelJS from 'exceljs';

export const BASIC_PROFILE_SHEET = '运动员基础档案';
export const BASIC_PROFILE_HEADERS = [
  '姓名', '性别', '出生日期',
  '具体小项', '技术等级', '开始运动日期', '代表单位', '输送单位', '训练年限', '身高（cm）', '体重（kg）', '身体测量日期',
  '籍贯', '学历', '最大力量项目', '最大力量', '最好竞技成绩', '对应赛事', '成绩日期', '备注', '系统运动员编号',
] as const;


export const ATHLETE_PROFILE_SHEET = '运动员档案';
export const ATHLETE_PROFILE_HEADERS = [
  '运动员编号', '姓名', '录入检查', '性别', '出生年月', '身高（cm）', '体重（kg）',
  '运动项目', '代表队伍', '小项／场上位置', '技术等级', '最好成绩', '最好成绩对应赛事',
  '成绩日期', '备战赛事', '当前训练限制', '身体测量日期',
] as const;

export function buildBasicProfileWorkbook(athletes: ReadonlyArray<{ id: number; name: string }>) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控系统';
  const sheet = workbook.addWorksheet(ATHLETE_PROFILE_SHEET, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });
  sheet.columns = ATHLETE_PROFILE_HEADERS.map((header, index) => ({
    header,
    width: index >= 11 ? 23 : 17,
    style: { numFmt: header.endsWith('日期') ? 'yyyy-mm-dd' : /（/.test(header) ? '0.##' : '@' },
  }));
  sheet.getRow(1).height = 26;
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183655' } };
  sheet.getCell('A1').note = '已有队员使用系统编号。新增队员请留空。';
  sheet.getCell('B1').note = '姓名必填。新队员按上传时所选的项目和队伍建档。';
  sheet.getCell('C1').note = '此列可留空，上传后由系统校验。';
  sheet.getCell('E1').note = '按 YYYY-MM 填写，保存在档案备注中。';
  sheet.getCell('H1').note = '可留空，填写时应与上传所选项目一致。';
  sheet.getCell('I1').note = '写入档案的代表单位，队伍归属以导入页面所选队伍为准。';
  sheet.getCell('P1').note = '写入档案备注。';
  sheet.getCell('Q1').note = '填写身高或体重时，请同时填写实际测量日期。';
  for (const athlete of athletes) sheet.addRow([formatAthleteNumber(athlete.id), athlete.name]);
  return workbook;
}
