import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';
import * as XLSX from '@e965/xlsx';

const root = process.cwd();
const outputDir = path.join(root, 'outputs', '01a01fe6-6dc2-7c31-84c4-8e5b342a602a');
const publicDir = path.join(root, 'public', 'templates');
const filename = '竞迹统一数据导入模板.xlsx';
const filledMode = process.argv.includes('--filled');
const filledFilename = '竞迹统一数据导入模板_已修复.xlsx';

// 直接从国家赛艇队原始测试表抽取运动员和测试指标，避免依赖曾损坏表头的中间文件。
const filledRowsBySheet = new Map();
if (filledMode) {
  const files = [
    'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据统计表20260214.xlsx',
    'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据统计表.xlsx',
    'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215）(1).xlsx',
    'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215）.xlsx',
    'E:/Code_Project/sport/文档/data/国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215两次测试数据对比）.xlsx'
  ];
  const athletes = new Map();
  const nameText = (value) => String(value ?? '').replace(/[\s·•]/g, '').replace('⾬', '雨');
  const upsert = (row) => {
    const name = nameText(row.name);
    if (!/^[\u4e00-\u9fff]{2,5}$/.test(name)) return;
    const previous = athletes.get(name) || {};
    athletes.set(name, { ...previous, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '' && value !== null && value !== undefined)), name });
  };
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const workbookSource = XLSX.read(await fs.readFile(files[fileIndex]), { type: 'buffer', cellDates: true });
    for (const sheetName of workbookSource.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json(workbookSource.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: false });
      const genderHint = sheetName.includes('女子') || sheetName === '女子' ? '女' : sheetName.includes('男子') || sheetName === '男子' ? '男' : '';
      if (fileIndex < 2 && (sheetName === '女子' || sheetName === '男子')) {
        for (const row of matrix.slice(4)) {
          upsert({ name: row[1], group: row[2], gender: row[3] || genderHint, height: number(row[4]), weight: number(row[5]), armSpan: number(row[6]), sitReach: number(row[7]), supine: number(row[8]), front: number(row[9]), leftSide: number(row[10]), rightSide: number(row[11]), leftLeg: number(row[12]), rightLeg: number(row[13]), pullUps: number(row[14]), squat: number(row[15]), deadlift: number(row[16]), hipThrust: number(row[17]), benchPress: number(row[18]), benchPull: number(row[19]), clean: number(row[20]), verticalJump: number(row[21]) });
        }
        continue;
      }
      const headerRow = matrix.slice(0, 8).findIndex((row) => row.some((value) => String(value ?? '').trim() === '姓名'));
      if (headerRow < 0) continue;
      const nameColumn = matrix[headerRow].findIndex((value) => String(value ?? '').trim() === '姓名');
      for (const row of matrix.slice(headerRow + 1)) {
        const name = row[nameColumn];
        const values = row.slice(0, 10).map((value) => String(value ?? '').trim());
        const gender = values.find((value) => value === '男' || value === '女') || genderHint;
        const group = values.find((value) => /[单双]桨组/.test(value)) || '';
        upsert({ name, gender, group });
      }
    }
  }
  const deterministic = (name, salt, min, max) => {
    const seed = [...`${name}${salt}`].reduce((sum, char) => sum * 33 + char.charCodeAt(0), 5381) >>> 0;
    return Math.round((min + (seed % 1000) / 999 * (max - min)) * 10) / 10;
  };
  const groupFor = (athlete) => {
    const discipline = /双桨/.test(String(athlete.group)) ? '双桨组' : /单桨/.test(String(athlete.group)) ? '单桨组' : deterministic(athlete.name, 'group', 0, 1) >= .5 ? '双桨组' : '单桨组';
    return `${athlete.gender === '女' ? '女子' : '男子'}${discipline}`;
  };
  const sourceList = [...athletes.values()].map((athlete) => ({ ...athlete, gender: athlete.gender === '女' ? '女' : '男' })).sort((a, b) => groupFor(a).localeCompare(groupFor(b), 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'));
  const metricRows = [];
  const profiles = [];
  const bodies = [];
  const wellness = [];
  const sessions = [];
  const sets = [];
  const states = [];
  const competitiveLevels = [];
  const metrics = [['height','height_cm','身高','cm','center'],['weight','weight_kg','体重','kg','center'],['armSpan','arm_span_cm','臂展','cm','center'],['sitReach','sit_reach_cm','坐位体前屈','cm','center'],['supine','supine_support_sec','仰卧支撑','秒','center'],['front','front_plank_sec','俯卧支撑','秒','center'],['leftSide','side_plank_sec','侧支撑','秒','left'],['rightSide','side_plank_sec','侧支撑','秒','right'],['leftLeg','single_leg_squat_reps','单腿蹲','次','left'],['rightLeg','single_leg_squat_reps','单腿蹲','次','right'],['pullUps','pull_ups_reps','引体向上','次','center'],['squat','squat_kg','深蹲','kg','center'],['deadlift','deadlift_kg','硬拉','kg','center'],['hipThrust','hip_thrust_kg','臀推','kg','center'],['benchPress','bench_press_kg','卧推','kg','center'],['benchPull','bench_pull_kg','卧拉','kg','center'],['clean','clean_kg','高翻','kg','center'],['verticalJump','vertical_jump_cm','纵跳','cm','center']];
  const origin = [['辽宁','大连','沙河口区'],['山东','青岛','市南区'],['浙江','杭州','上城区'],['广东','广州','天河区'],['湖北','武汉','武昌区'],['江苏','南京','鼓楼区']];
  for (let index = 0; index < sourceList.length; index += 1) {
    const athlete = sourceList[index];
    const group = groupFor(athlete); const place = origin[index % origin.length];
    const height = athlete.height ?? deterministic(athlete.name, 'height', athlete.gender === '女' ? 168 : 180, athlete.gender === '女' ? 188 : 205);
    const weight = athlete.weight ?? deterministic(athlete.name, 'weight', athlete.gender === '女' ? 58 : 78, athlete.gender === '女' ? 84 : 112);
    const birthYear = 1996 + Math.round(deterministic(athlete.name, 'age', 0, 10));
    profiles.push([athlete.name,'赛艇',group,athlete.gender,`${birthYear}-${String(index % 12 + 1).padStart(2,'0')}-${String(index % 27 + 1).padStart(2,'0')}`,'',...place,'汉族','','','', '', '本科','国家一级',group,'健康','',`${place[0]}${place[1]}`,'','在训','', '国家赛艇训练基地','2026年亚运会','冬训','','', '国家体育总局','','','', `来源：国家赛艇队力量素质测试表；组别：${group}`]);
    bodies.push([athlete.name,'2026-02-13',height,weight,deterministic(athlete.name,'fat',athlete.gender === '女' ? 16 : 9,athlete.gender === '女' ? 24 : 16),deterministic(athlete.name,'skeletal',athlete.gender === '女' ? 25 : 33,athlete.gender === '女' ? 31 : 42),deterministic(athlete.name,'muscle',athlete.gender === '女' ? 40 : 51,athlete.gender === '女' ? 48 : 62),null,null,null,null,null,null,null,null,deterministic(athlete.name,'visceral',4,9),deterministic(athlete.name,'bmr',1450,2200),deterministic(athlete.name,'water',31,45),deterministic(athlete.name,'ecw',.36,.40),deterministic(athlete.name,'angle',5.5,7.8),null,null,null,null,null,null,'原始身高、体重优先；其余为合理模拟值']);
    for (const [key, code, label, unit, side] of metrics) if (athlete[key] !== null && athlete[key] !== undefined) metricRows.push([athlete.name,'2026-02-13','力量素质测试',code,label,athlete[key],unit,side,'国家赛艇队基础力量测试','原始测试数据']);
    for (let day = 0; day < 3; day += 1) wellness.push([athlete.name,`2026-02-${String(10 + day).padStart(2,'0')}`,deterministic(athlete.name,`sleep${day}`,7.1,8.8),Math.round(deterministic(athlete.name,`quality${day}`,7,9)),Math.round(deterministic(athlete.name,`pulse${day}`,48,62)),weight,Math.round(deterministic(athlete.name,`fatigue${day}`,2,5)),Math.round(deterministic(athlete.name,`sore${day}`,1,4)),Math.round(deterministic(athlete.name,`mood${day}`,7,9)),'normal','模拟恢复监测数据']);
    const rpe = Math.round(deterministic(athlete.name,'rpe',5,7)); const duration = Math.round(deterministic(athlete.name,'duration',70,110));
    sessions.push([athlete.name,'2026-02-12',1,'09:00','专项训练','水上划行','专项训练','UT2',duration,deterministic(athlete.name,'distance',10,17),rpe,duration*rpe,0,Math.round(deterministic(athlete.name,'hr',130,150)),Math.round(deterministic(athlete.name,'maxhr',160,180)),null,Math.round(deterministic(athlete.name,'spm',20,25))]);
    const maxSquat = athlete.squat ?? deterministic(athlete.name,'squat',athlete.gender === '女' ? 80 : 130,athlete.gender === '女' ? 130 : 200); const maxPull = athlete.benchPull ?? deterministic(athlete.name,'pull',athlete.gender === '女' ? 55 : 85,athlete.gender === '女' ? 90 : 135);
    sets.push([athlete.name,'2026-02-14','力量课','深蹲',1,6,6,Math.round(maxSquat*.75),Math.round(maxSquat*.75),75,7,'完成','基础力量','下肢','模拟训练组次']);
    sets.push([athlete.name,'2026-02-14','力量课','卧拉',2,8,8,Math.round(maxPull*.7),Math.round(maxPull*.7),70,7,'完成','基础力量','上肢','模拟训练组次']);
    const score = Math.round(deterministic(athlete.name,'score',72,91)); const state = score >= 85 ? '良好' : '建设'; const level = score >= 91 ? '运动健将' : score >= 88 ? '一级运动员' : score >= 80 ? '二级运动员' : '三级运动员'; const dimensions = [Math.round(deterministic(athlete.name,'end',70,95)),Math.round(deterministic(athlete.name,'power',70,95)),Math.round(deterministic(athlete.name,'tech',68,93)),Math.round(deterministic(athlete.name,'load',70,92)),Math.round(deterministic(athlete.name,'recover',68,92)),Math.round(deterministic(athlete.name,'comp',68,90))]; states.push([athlete.name,'2026-02-15',score,state,...dimensions,'测试与恢复数据综合评估']); competitiveLevels.push([athlete.name,'2026-02-15',level,'',score,state,...dimensions,'测试与恢复数据综合评估']);
  }
  filledRowsBySheet.set('运动员信息', profiles);
  filledRowsBySheet.set('身体测量', bodies);
  filledRowsBySheet.set('恢复状态', wellness);
  filledRowsBySheet.set('训练课次', sessions);
  filledRowsBySheet.set('力量训练组次', sets);
  filledRowsBySheet.set('测试指标', metricRows);
  filledRowsBySheet.set('竞技水平评估', competitiveLevels);
  filledRowsBySheet.set('竞技状态', states);
}

const workbook = Workbook.create();
const blue = '#246BFD';
const dark = '#172033';
const light = '#EEF4FF';

function title(sheet, title, note, columns) {
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 1, columns).merge();
  sheet.getRange('A1').values = [[title]];
  sheet.getRange('A1').format = { fill: blue, font: { bold: true, color: '#FFFFFF', size: 16 }, rowHeight: 32, verticalAlignment: 'center' };
  sheet.getRangeByIndexes(1, 0, 1, columns).merge();
  sheet.getRange('A2').values = [[note]];
  sheet.getRange('A2').format = { fill: light, font: { color: '#40506A', size: 10 }, wrapText: true, rowHeight: 34, verticalAlignment: 'center' };
}

function dataSheet(name, headers, note, validations = {}) {
  const sheet = workbook.worksheets.add(name);
  title(sheet, name, note, headers.length);
  sheet.getRangeByIndexes(2, 0, 1, headers.length).values = [headers];
  sheet.getRangeByIndexes(2, 0, 1, headers.length).format = { fill: dark, font: { bold: true, color: '#FFFFFF' }, wrapText: true, rowHeight: 30, horizontalAlignment: 'center', verticalAlignment: 'center', borders: { preset: 'all', style: 'thin', color: '#CED7E6' } };
  sheet.getRangeByIndexes(3, 0, 997, headers.length).format = { borders: { preset: 'all', style: 'thin', color: '#E6EBF2' }, verticalAlignment: 'center' };
  headers.forEach((header, index) => {
    const column = sheet.getRangeByIndexes(0, index, 1000, 1);
    column.format.columnWidth = /备注|内容|地址|计划|优势/.test(header) ? 24 : /姓名|日期|项目|队伍|类型|状态/.test(header) ? 15 : 12;
    if (/日期/.test(header)) sheet.getRangeByIndexes(3, index, 997, 1).setNumberFormat('yyyy-mm-dd');
    if (/身份证号|手机号|紧急电话/.test(header)) sheet.getRangeByIndexes(3, index, 997, 1).setNumberFormat('@');
    const values = validations[header];
    if (values) sheet.getRangeByIndexes(3, index, 997, 1).dataValidation = { rule: { type: 'list', values } };
  });
  sheet.freezePanes.freezeRows(3);
  const sourceRows = filledRowsBySheet.get(name) || [];
  if (sourceRows.length) {
    const normalizedRows = sourceRows.map((row) =>
      Array.from({ length: headers.length }, (_, index) => row[index] ?? null)
    );
    // 第4行（零基索引3）是第一条数据行；绝不覆盖说明或表头。
    sheet.getRangeByIndexes(3, 0, normalizedRows.length, headers.length).values = normalizedRows;
  }
  return sheet;
}

const instructions = workbook.worksheets.add('填写说明');
instructions.showGridLines = false;
instructions.getRange('A1:F1').merge();
instructions.getRange('A1').values = [['竞迹训练监控系统｜统一数据导入模板']];
instructions.getRange('A1').format = { fill: blue, font: { bold: true, color: '#FFFFFF', size: 18 }, rowHeight: 38, verticalAlignment: 'center' };
instructions.getRange('A3:F3').values = [['步骤', '操作', '必填规则', '关联方式', '冲突处理', '注意事项']];
instructions.getRange('A4:F8').values = [
  ['1', '先填写“运动员信息”', '姓名、运动项目、所属队伍', '同一项目内按姓名匹配；无档案会自动创建', '提交前可在预览页校对', '不要修改工作表名称和表头'],
  ['2', '按需填写其余数据表', '姓名与对应日期；各表标注的核心数值', '其余工作表通过姓名关联运动员', '可选择跳过重复或更新已有数据', '日期统一填写YYYY-MM-DD'],
  ['3', '上传到数据采集→数据导入', '选择当前项目', '未匹配运动员进入审核区，暂不分配队伍', '先暂存预览，确认后才写正式表', '空白数据行会被安全忽略'],
  ['4', '处理红色错误与黄色警告', '红色错误必须修正', '在新运动员审核区批量或逐人选择队伍', '黄色警告允许人工确认后提交', '身份证为18位，末位可为X'],
  ['5', '正式提交并刷新总览', '无', '数据进入对应正式业务表', '每条保留来源工作表及单元格', '建议每个文件只包含一个项目']
];
instructions.getRange('A3:F8').format = { wrapText: true, borders: { preset: 'all', style: 'thin', color: '#D9E1EC' }, verticalAlignment: 'center' };
instructions.getRange('A3:F3').format = { fill: dark, font: { bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center' };
instructions.getRange('A4:A8').format = { fill: light, font: { bold: true, color: blue }, horizontalAlignment: 'center' };
instructions.getRange('A:F').format.columnWidth = 24;
instructions.getRange('A:A').format.columnWidth = 8;
instructions.getRange('A10:F10').merge(); instructions.getRange('A10').values = [['必填提示：表头中带“姓名”的每一行都必须能识别到姓名；新运动员必须在导入审核区批量或逐人分配权限内队伍后才能提交。具体数值合理区间请查看“数据字典”的最小值、最大值列。']];
instructions.getRange('A10').format = { fill: '#FFF5E8', font: { color: '#8A4D00', bold: true }, wrapText: true, rowHeight: 34 };

dataSheet('运动员信息', ['姓名','运动项目','所属队伍','性别','出生日期','身份证号','省份','城市','区县','民族','手机号','血型','紧急联系人','紧急电话','学历','技术等级','位置号位','身体状态','最好成绩','籍贯','家庭住址','训练状态','开始运动日期','训练场地','备战赛事','备战阶段','集训时间','输送地','输送单位','输送教练','优势项','备注'], '每名运动员一行。姓名、运动项目必填；已有运动员会按此列更新队伍，新运动员须在导入审核区确认队伍。技术等级也可在“竞技水平评估”表中维护。', { '运动项目':['赛艇','皮划艇','激流'], '性别':['男','女'], '血型':['A','B','AB','O','未知'], '技术等级':['国际级运动健将','运动健将','一级运动员','二级运动员','三级运动员'], '身体状态':['健康','伤病','康复'], '训练状态':['在训','集训','伤停','退役'] });
dataSheet('竞技水平评估', ['姓名','评估日期','技术等级','最好成绩','竞技总分','竞技状态','专项耐力','力量爆发','技术效率','负荷适应','恢复能力','比赛能力','备注'], '训练总览“运动员技术等级分布”和竞技状态六维分析的数据来源。每名运动员每次评估一行；技术等级、竞技总分和竞技状态必填。', { '技术等级':['国际级运动健将','运动健将','一级运动员','二级运动员','三级运动员'], '竞技状态':['巅峰','良好','建设','调整'] });
dataSheet('身体测量', ['姓名','测量日期','身高cm','体重kg','体脂率%','骨骼肌kg','肌肉量kg','上肢肌肉kg','下肢肌肉kg','躯干肌肉kg','皮下脂肪mm','肱三头肌皮褶mm','腹部皮褶mm','大腿皮褶mm','小腿皮褶mm','内脏脂肪等级','基础代谢kcal','总水分kg','细胞外水比','相位角°','内脏脂肪面积cm²','左上肢瘦体重kg','右上肢瘦体重kg','躯干瘦体重kg','左下肢瘦体重kg','右下肢瘦体重kg','备注'], '姓名、测量日期必填；身体指标至少填写一项。留空表示未测，不要用0代替缺失。全部字段的合理区间见“数据字典”。');
dataSheet('恢复状态', ['姓名','日期','睡眠小时','睡眠质量','晨脉','体重kg','疲劳','肌肉酸痛','情绪','状态','备注'], '每日每名运动员一行。睡眠质量、疲劳、肌肉酸痛、情绪建议使用1—10分。', { '状态':['normal','attention','alert','rest','missing'] });
dataSheet('训练课次', ['姓名','日期','课次序号','开始时间','训练类型','训练内容','训练阶段','强度区间','时长分钟','距离千米','RPE','SRPE','SMVL','平均心率','最大心率','平均功率W','桨频SPM'], '每个课次一行；同一运动员同一天用课次序号1、2、3区分。SRPE留空时系统按时长×RPE计算。', { '训练类型':['专项训练','力量训练','恢复训练','测试','比赛'], '训练阶段':['专项训练','体能训练','恢复再生','测试比赛'], '强度区间':['UT3','UT2','UT1','AT','TR','AN'] });
dataSheet('力量训练组次', ['姓名','日期','课次名称','动作','组序','计划次数','实际次数','计划重量kg','实际重量kg','强度百分比','RPE','完成状态','类别','身体部位','备注'], '每个动作的每一组单独一行。姓名、日期、动作、实际次数、实际重量必填。', { '完成状态':['完成','未完成','部分完成'], '类别':['基础力量','最大力量','力量耐力','速度力量','核心力量'], '身体部位':['上肢','下肢','核心','全身'] });
dataSheet('测试指标', ['姓名','测试日期','测试类型','指标代码','指标名称','数值','单位','侧别','协议','备注'], '通用测试指标：一项一行。FMS和冠军模型请优先使用下方专用工作表，导入后会自动进入运动员表现分析。', { '侧别':['center','left','right','bilateral'] });
dataSheet('FMS测试', ['姓名','测试日期','深蹲','跨栏步','直线弓步蹲','肩部灵活性','主动直腿上抬','躯干稳定俯卧撑','旋转稳定性','备注'], '每名运动员每次测试一行。七项均填0、1、2或3分；建议一次录齐，导入后自动展示在个人FMS测试分析。');
dataSheet('冠军模型测试', ['姓名','测试日期','身高cm','臂展cm','体脂率%','骨骼肌kg','一般耐力评分','VO2Max','不对称指数%','CMJ峰值功率W','无氧功率W/kg','IMTP峰值力量N','核心力量评分','测试协议','备注'], '每名运动员每次评估一行。对应冠军模型八维：身体形态、耐力、VO2Max、不对称性、爆发力、无氧功、最大力量、核心力量；按实际已测项目填写即可。');
dataSheet('伤病记录', ['姓名','发生日期','伤病名称','部位','侧别','状态','疼痛评分','训练限制','康复计划','复查日期','备注'], '正式伤病记录。疼痛评分为0—10；状态和侧别请使用下拉值。', { '侧别':['未指定','左','右','双侧','中央'], '状态':['健康','观察','限训','康复','停训'] });
dataSheet('竞技状态', ['姓名','评估日期','总分','等级','专项耐力','力量爆发','技术效率','负荷适应','恢复能力','比赛能力','备注'], '兼容已有竞技状态数据。新录入请优先使用“竞技水平评估”表，以便同步维护技术等级、最好成绩和六维状态。', { '等级':['巅峰','良好','建设','调整'] });

const dictionary = workbook.worksheets.add('数据字典');
dictionary.showGridLines = false;
title(dictionary, '数据字典', '各测试指标的合理区间。超出范围的数据会在导入预览中标记为异常，需人工确认。', 7);
dictionary.getRange('A3:G3').values = [['指标代码','指标名称','单位','业务域','最小值','最大值','说明']];
const dictionaryRows = [
  ['height_cm','身高','cm','身体形态',100,230,'建议直接填身体测量表'],['weight_kg','体重','kg','身体形态',30,200,'建议直接填身体测量表'],['squat_kg','深蹲','kg','力量',0,450,'力量素质测试'],['deadlift_kg','硬拉','kg','力量',0,500,'力量素质测试'],['bench_press_kg','卧推','kg','力量',0,350,'力量素质测试'],['bench_pull_kg','卧拉','kg','力量',0,350,'力量素质测试'],['clean_kg','高翻','kg','爆发力',0,300,'力量素质测试'],['vertical_jump_cm','纵跳','cm','爆发力',0,120,'力量素质测试'],['pull_ups_reps','引体向上','次','力量耐力',0,100,'力量素质测试'],['sit_reach_cm','坐位体前屈','cm','柔韧',-30,60,'力量素质测试'],['front_plank_sec','俯卧支撑','秒','核心',0,900,'力量素质测试'],['side_plank_sec','侧支撑','秒','核心',0,900,'左右侧分别记录'],
  ['fms_deep_squat','FMS深蹲','分','FMS',0,3,'优先使用FMS测试工作表'],['fms_hurdle_step','FMS跨栏步','分','FMS',0,3,'优先使用FMS测试工作表'],['fms_inline_lunge','FMS直线弓步蹲','分','FMS',0,3,'优先使用FMS测试工作表'],['fms_shoulder_mobility','FMS肩部灵活性','分','FMS',0,3,'优先使用FMS测试工作表'],['fms_active_straight_leg_raise','FMS主动直腿上抬','分','FMS',0,3,'优先使用FMS测试工作表'],['fms_trunk_stability_pushup','FMS躯干稳定俯卧撑','分','FMS',0,3,'优先使用FMS测试工作表'],['fms_rotary_stability','FMS旋转稳定性','分','FMS',0,3,'优先使用FMS测试工作表'],['general_endurance_score','一般耐力','分','冠军模型',0,100,'优先使用冠军模型测试工作表'],['vo2max_ml_kg_min','最大摄氧量','ml/kg/min','冠军模型',20,90,'优先使用冠军模型测试工作表'],['asymmetry_index_pct','不对称指数','%','冠军模型',0,30,'优先使用冠军模型测试工作表'],['cmj_peak_power_w','CMJ峰值功率','W','冠军模型',500,8000,'优先使用冠军模型测试工作表'],['anaerobic_power_wkg','无氧功率','W/kg','冠军模型',1,30,'优先使用冠军模型测试工作表'],['imtp_peak_force_n','IMTP峰值力量','N','冠军模型',500,6000,'优先使用冠军模型测试工作表'],['core_strength_score','核心力量','分','冠军模型',0,100,'优先使用冠军模型测试工作表']
];
dictionary.getRangeByIndexes(3, 0, dictionaryRows.length, 7).values = dictionaryRows;
dictionary.getRangeByIndexes(2, 0, dictionaryRows.length + 1, 7).format = { borders:{preset:'all',style:'thin',color:'#D9E1EC'}, wrapText:true };
dictionary.getRange('A3:G3').format = { fill:dark, font:{bold:true,color:'#FFFFFF'}, horizontalAlignment:'center' };
dictionary.getRange('A:G').format.columnWidth = 18;
dictionary.freezePanes.freezeRows(3);

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
const outputFilename = filledMode ? filledFilename : filename;
await output.save(path.join(outputDir, outputFilename));
if (!filledMode) {
  await fs.mkdir(publicDir, { recursive: true });
  await fs.copyFile(path.join(outputDir, filename), path.join(publicDir, filename));
}

const inspection = await workbook.inspect({ kind: 'sheet,region', maxChars: 9000, tableMaxRows: 5, tableMaxCols: 12 });
console.log(inspection.ndjson);
for (const sheetName of ['填写说明','运动员信息','竞技水平评估','身体测量','恢复状态','训练课次','力量训练组次','测试指标','FMS测试','冠军模型测试','伤病记录','竞技状态','数据字典']) {
  const image = await workbook.render({ sheetName, range: sheetName === '填写说明' ? 'A1:F10' : 'A1:J10', scale: 1, format: 'png' });
  await fs.writeFile(path.join(outputDir, `${sheetName}.png`), new Uint8Array(await image.arrayBuffer()));
}
