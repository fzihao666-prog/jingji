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
  for (const [name, headers] of [[BASIC_TEST_SHEET, BASIC_TEST_HEADERS], [BASIC_SCREENING_SHEET, BASIC_SCREENING_HEADERS]] as const) {
    const tests = workbook.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    tests.columns = headers.map(header => ({
      header, width: 21,
      style: { numFmt: header.endsWith('日期') ? 'yyyy-mm-dd' : header === '运动员编号' ? '@' : 'General' },
    }));
    tests.getRow(1).height = 26;
    tests.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    tests.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183655' } };
    tests.getCell('A1').note = '填写系统运动员编号。为同批新建队员录入记录时，编号留空并手工填写同一姓名。';
    tests.getCell('B1').note = '按编号从运动员档案查找姓名，也可填写与档案一致的姓名。';
    for (let row = 2; row <= 501; row++) {
      tests.getCell(`B${row}`).value = {
        formula: `IF(A${row}="","",IFERROR(VLOOKUP(A${row},'${ATHLETE_PROFILE_SHEET}'!A:B,2,FALSE),""))`,
        result: '',
      };
      if (name === BASIC_SCREENING_SHEET) {
        const scores = ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'N', 'O', 'P', 'R', 'S'].map(column => `${column}${row}`);
        const pain = ['L', 'M', 'Q', 'T'].map(column => `${column}${row}`);
        const validScores = scores.map(cell => `AND(${cell}>=0,${cell}<=3,INT(${cell})=${cell})`);
        const validPain = pain.map(cell => `OR(${cell}="有痛",${cell}="无痛")`);
        tests.getCell(`U${row}`).value = {
          formula: `IFERROR(IF(AND(COUNT(${scores.join(',')})=12,${[...validScores, ...validPain].join(',')}),E${row}+MIN(F${row}:G${row})+MIN(H${row}:I${row})+IF(OR(L${row}="有痛",M${row}="有痛"),0,MIN(J${row}:K${row}))+MIN(N${row}:O${row})+IF(Q${row}="有痛",0,P${row})+IF(T${row}="有痛",0,MIN(R${row}:S${row})),""),"")`,
          result: '',
        };
      }
    }
  }
  workbook.getWorksheet(BASIC_TEST_SHEET)!.getCell('G1').note = '实测时作为测试备注导入。仅填写未测原因的记录不生成成绩。';
  workbook.getWorksheet(BASIC_SCREENING_SHEET)!.getCell('U1').note = '系统按动作成绩和疼痛筛查计算，上传时忽略此列。';
  return workbook;
}
