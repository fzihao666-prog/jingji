import { BASIC_PROFILE_LAYOUT } from './basic-profile-layout.ts';
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

export const BASIC_TEST_SHEET = '体能与专项测试';
export const BASIC_SCREENING_SHEET = '功能筛查';
export const BASIC_TEST_HEADERS = [
  '运动员编号', '姓名（自动）', '测试日期', '测试项目', '实测值', '单位', '备注／未测原因', '录入检查',
] as const;
export const BASIC_SCREENING_HEADERS = [
  '运动员编号', '姓名（自动）', '筛查日期', '录入检查', '深蹲', '跨栏步 左', '跨栏步 右',
  '直线弓步 左', '直线弓步 右', '肩灵活性 左', '肩灵活性 右', '肩灵活性 左筛查', '肩灵活性 右筛查',
  '主动直腿抬高 左', '主动直腿抬高 右', '躯干稳定俯卧撑', '躯干稳定俯卧撑 筛查',
  '旋转稳定 左', '旋转稳定 右', '旋转稳定 筛查', 'FMS 总分',
] as const;

export const BASIC_DOWNLOAD_SHEETS = [
  [ATHLETE_PROFILE_SHEET, ATHLETE_PROFILE_HEADERS.filter(header => header !== '运动员编号')],
  [BASIC_TEST_SHEET, ['姓名', ...BASIC_TEST_HEADERS.slice(2)]],
  [BASIC_SCREENING_SHEET, ['姓名', ...BASIC_SCREENING_HEADERS.slice(2)]],
] as const;

export function buildBasicProfileWorkbook(athletes: ReadonlyArray<{ name: string }>) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控系统';
  BASIC_DOWNLOAD_SHEETS.forEach(([name, headers], index) => {
    const layout = BASIC_PROFILE_LAYOUT[index];
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
    sheet.columns = headers.map(header => ({
      header, width: header.includes('备注') || header.includes('限制') ? 29 : 20,
      style: { numFmt: header.endsWith('日期') ? 'yyyy-mm-dd' : 'General' },
    }));
    const instructions = layout.notes.map(note => note.split("\n示例：")[0]);
    const examples = layout.notes.map(note => `示例：${note.split("\n示例：")[1]}`);
    const notes = [...layout.notes];
    if (name === ATHLETE_PROFILE_SHEET) {
      instructions[0] = '填写姓名；本队同名自动匹配，新队员由系统分配编号。';
      instructions[6] = '以导入页面所选项目为准；此列可留空。';
      instructions.push('填写身高或体重时，请填写实际测量日期。');
      examples.push('示例：2026-11-20');
      for (const index of [0, 6, 15]) notes[index] = `${instructions[index]}\n${examples[index]}`;
    }
    sheet.addRow(instructions);
    sheet.addRow(examples);
    sheet.getRow(1).height = 26;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183655' } };
    sheet.getRow(2).height = 48;
    sheet.getRow(2).alignment = { vertical: 'middle', wrapText: true };
    notes.forEach((note, column) => { sheet.getCell(1, column + 1).note = note; });
    for (const [column, formula] of Object.entries(layout.formulas)) {
      if (!formula) continue;
      // 项目由导入页面选择，档案检查无需要求教练再填一次。
      const source = name === ATHLETE_PROFILE_SHEET ? formula.replace('IF(G4="","缺运动项目",', '').slice(0, -1) : formula;
      sheet.fillFormula(`${column}4:${column}503`, source, () => '');
    }
    if (name === ATHLETE_PROFILE_SHEET)
      athletes.forEach((athlete, index) => { sheet.getCell(index + 4, 1).value = athlete.name; });
  });
  return workbook;
}
