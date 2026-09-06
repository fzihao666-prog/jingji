import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from '@e965/xlsx';
import { db } from '../server/db.ts';
import { analyzeDataImport, commitDataImport, updateDataImportAthleteCandidates } from '../server/data-import.ts';
import { buildOverviewPayload } from '../server/overview-service.ts';
import { waterLandTrainingCategory } from '../shared/training-content-category.ts';

const databasePath = process.env.DATABASE_PATH;
assert(databasePath, 'DATABASE_PATH is required');

const owner = db.prepare("SELECT id FROM users WHERE username = 'coach01'").get() as { id: number } | undefined;
assert(owner, 'seed user is required');
assert.equal(waterLandTrainingCategory({ trainingType: '专项训练', content: '水上划行' }), 'water');
assert.equal(waterLandTrainingCategory({ trainingType: '体能训练', structureType: '最大力量', content: '深蹲' }), 'land');
assert.equal(waterLandTrainingCategory({ content: '其它' }), 'land');
assert.equal(waterLandTrainingCategory({ trainingType: '技术课', structureType: '待确认', content: '未知训练' }), 'unclassified');
const demoVolumeAthleteCount = db.prepare(`
  SELECT COUNT(DISTINCT athlete_id) AS count FROM training_sessions
  WHERE source = 'training_volume_demo' AND quality = 'estimated'
    AND is_demo = 1 AND duration_reported = 1 AND distance_reported = 1
`).get() as { count: number };
assert(demoVolumeAthleteCount.count > 0, '训练量统计应为缺少真实完整训练量的运动员写入可追溯模拟数据');
const athleteName = `导入测试运动员${Date.now()}`;
const athleteInsert = db.prepare("INSERT INTO athletes (name, project, team, gender, active) VALUES (?, '赛艇', '测试队', '男', 1)")
  .run(athleteName);
const athleteId = Number(athleteInsert.lastInsertRowid);
const athletes = [{ id: athleteId, name: athleteName, project: '赛艇', team: '测试队', gender: '男' }];
const newAthleteName = `无账号导入运动员${Date.now()}`;

// 真实国家队表中曾出现“雨”的兼容字形“⾬”；它必须与普通“雨”匹配为同一运动员。
const compatibilityWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(compatibilityWorkbook, XLSX.utils.aoa_to_sheet([
  ['测试指标'], ['说明'], ['姓名','测试日期','测试类型','指标代码','指标名称','数值','单位','侧别'],
  ['张欣⾬','2026-02-13','力量素质测试','squat_kg','深蹲',130,'kg','center']
]), '测试指标');
const compatibilityBuffer = Buffer.from(XLSX.write(compatibilityWorkbook, { type: 'buffer', bookType: 'xlsx' }));
const compatibilityPreview = analyzeDataImport({
  buffer: compatibilityBuffer, filename: '兼容字形测试.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  project: '赛艇', userId: owner.id, athletes: [...athletes, { id: athleteId, name: '张欣雨', project: '赛艇', team: '测试队', gender: '女' }]
});
assert.equal(compatibilityPreview.athleteCandidates.length, 0);
assert.equal(compatibilityPreview.items[0]?.athleteId, athleteId);

const rows = [
  ['国家赛艇队力量素质测试数据统计表'],
  ['序号', '姓名', '组别', '性别', '身体形态', null, null, null, '躯干核心静态稳定', null, null, null, '力量耐力', null, null, '基础力量', null, null, null, null, '爆发力'],
  [null, null, null, null, null, null, null, null, null, null, null, null, '单腿蹲', null, '引体向上'],
  [null, null, null, null, '身高', '体重', '臂展', '坐位体前屈', '仰卧支撑', '俯卧支撑', '左侧支撑', '右侧支撑', '左', '右', null, '深蹲', '硬拉', '臀推', '卧推', '卧拉', '高翻', '纵跳'],
  [1, athleteName, '测试队', '男', 190, 90, 196, 20, 120, 130, 100, 105, 22, 24, 16, 170, 190, 260, 110, 115, 100, 42],
  [2, newAthleteName, '女子双桨组', '女', 180, 72, 186, 18, 110, 120, 95, 98, 20, 21, 14, 140, 165, 220, 85, 90, 78, 38]
];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '男子');
const buffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
const preview = analyzeDataImport({ buffer, filename: '力量测试20260214.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: '赛艇', defaultArea: { region: '未设置', city: '未设置', county: '未设置' }, userId: owner.id, athletes });
assert.equal(preview.errorCount, 0);
assert.equal(preview.athleteCandidates.length, 1);
assert(preview.itemCount >= 18, 'summary metrics should be recognized');
const duplicate = analyzeDataImport({ buffer, filename: '力量测试20260214.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: '赛艇', userId: owner.id, athletes });
assert.equal(duplicate.id, preview.id);
assert.equal(duplicate.summary.duplicateFile, true);
const reviewed = updateDataImportAthleteCandidates({ batchId: preview.id, userId: owner.id, allowedTeams: new Set(['女子双桨组']), corrections: [{ id: preview.athleteCandidates[0].id, team: '女子双桨组' }] });
const committed = commitDataImport({ batchId: reviewed.id, userId: owner.id, creatorRole: 'SCC', athletes, allowedTeams: new Set(['女子双桨组']), conflictPolicy: 'update' });
assert(committed.imported >= 18);
assert.equal(committed.createdAthletes, 1);
const generatedAthlete = db.prepare('SELECT id, profile_status AS profileStatus, source FROM athletes WHERE name = ?').get(newAthleteName) as { id: number; profileStatus: string; source: string };
assert.equal(generatedAthlete.profileStatus, 'incomplete');
assert.equal(generatedAthlete.source, 'file_import');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE athlete_id = ?').get(generatedAthlete.id)?.count, 0);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM coach_athletes WHERE coach_user_id = ? AND athlete_id = ?').get(owner.id, generatedAthlete.id)?.count, 1);
const tests = db.prepare(`SELECT COUNT(*) AS count FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id WHERE ts.athlete_id = ?`).get(athleteId) as { count: number };
assert(tests.count >= 16);
const body = db.prepare('SELECT height_cm AS heightCm, weight_kg AS weightKg FROM athlete_body_measurements WHERE athlete_id = ?').get(athleteId) as { heightCm: number; weightKg: number };
assert.equal(body.heightCm, 190);
assert.equal(body.weightKg, 90);
const migratedSquat = db.prepare(`
  SELECT tm.value_num AS valueNum
  FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id
  WHERE ts.athlete_id = ? AND tm.metric_code = 'squat_kg'
  ORDER BY ts.test_date DESC LIMIT 1
`).get(athleteId) as { valueNum: number };
assert.equal(migratedSquat.valueNum, 170);

// 统一模板端到端：每一种标准工作表都必须能解析并写入对应正式业务表。
const templateAthleteName = `模板运动员${Date.now()}`;
const templateWorkbook = XLSX.utils.book_new();
const append = (name: string, headers: unknown[], values: unknown[]) => XLSX.utils.book_append_sheet(templateWorkbook, XLSX.utils.aoa_to_sheet([[name], ['说明'], headers, values]), name);
append('运动员信息', ['姓名','运动项目','所属队伍','性别','出生日期','身份证号','省份','城市','区县','民族','手机号','血型','紧急联系人','紧急电话','学历','技术等级','位置号位','身体状态','最好成绩','籍贯','家庭住址','训练状态','开始运动日期','训练场地','备战赛事','备战阶段','集训时间','输送地','输送单位','输送教练','优势项','备注'], [templateAthleteName,'赛艇','模板队','女','2001-02-03','11010120010203002X','北京市','北京市','海淀区','汉族','13800000000','A','家属','13900000000','本科','国际健将','1号位','健康','世界杯前三','北京','海淀','在训','2012-01-01','训练基地','世锦赛','专项准备','2026冬训','北京市','体校','王教练','耐力','模板测试']);
XLSX.utils.sheet_add_aoa(templateWorkbook.Sheets['运动员信息'], [[athleteName,'赛艇','女子双桨组','男','2000-01-02','11010120000102003X','北京市','北京市','朝阳区','汉族','','','','','本科','','','健康','','北京','','在训','','','','','','','','','','']], { origin: -1 });
append('竞技水平评估', ['姓名','评估日期','技术等级','最好成绩','竞技总分','竞技状态','专项耐力','力量爆发','技术效率','负荷适应','恢复能力','比赛能力'], [templateAthleteName,'2026-08-05','国际级运动健将','世界杯前三',91,'巅峰',93,90,92,89,91,94]);
append('身体测量', ['姓名','测量日期','身高cm','体重kg','体脂率%','骨骼肌kg'], [templateAthleteName,'2026-08-01',181,72,18,32]);
append('恢复状态', ['姓名','日期','睡眠小时','睡眠质量','晨脉','体重kg','疲劳','肌肉酸痛','情绪','状态'], [templateAthleteName,'2026-08-01',8,9,48,72,2,2,9,'normal']);
append('训练课次', ['姓名','日期','课次序号','开始时间','训练类型','训练内容','训练阶段','强度区间','时长分钟','距离千米','RPE','SRPE','SMVL'], [templateAthleteName,'2026-08-01',1,'08:00','专项训练','水上有氧','专项训练','UT2',90,18,5,450,0]);
XLSX.utils.sheet_add_aoa(templateWorkbook.Sheets['训练课次'], [
  [templateAthleteName,'2026-08-01',2,'15:00','专项训练','下午水上技术','专项训练','UT1',60,10,6,360,0],
  [templateAthleteName,'2026-08-02',1,'09:00','恢复训练','恢复活动','恢复再生','UT3',0,'',2,0,0]
], { origin: -1 });
append('力量训练组次', ['姓名','日期','课次名称','动作','组序','计划次数','实际次数','实际重量kg','强度百分比'], [templateAthleteName,'2026-08-02','基础力量','深蹲',1,5,5,100,80]);
append('测试指标', ['姓名','测试日期','测试类型','指标代码','指标名称','数值','单位','侧别'], [templateAthleteName,'2026-08-03','力量素质测试','squat_kg','深蹲',145,'kg','center']);
append('FMS测试', ['姓名','测试日期','深蹲','跨栏步','直线弓步蹲','肩部灵活性','主动直腿上抬','躯干稳定俯卧撑','旋转稳定性'], [templateAthleteName,'2026-08-06',3,2,2,2,3,2,2]);
append('冠军模型测试', ['姓名','测试日期','身高cm','臂展cm','体脂率%','骨骼肌kg','一般耐力评分','VO2Max','不对称指数%','CMJ峰值功率W','无氧功率W/kg','IMTP峰值力量N','核心力量评分'], [templateAthleteName,'2026-08-07',181,185,18,32,92,65,4.8,3900,10.4,3050,98]);
append('伤病记录', ['姓名','发生日期','伤病名称','部位','侧别','状态','疼痛评分','训练限制','康复计划'], [templateAthleteName,'2026-08-04','肌肉拉伤','大腿','左','观察',3,'减少冲刺','理疗']);
append('竞技状态', ['姓名','评估日期','总分','等级','专项耐力','力量爆发','技术效率','负荷适应','恢复能力','比赛能力'], [templateAthleteName,'2026-08-05',86,'良好',88,84,87,85,86,86]);
const templateBuffer = Buffer.from(XLSX.write(templateWorkbook, { type: 'buffer', bookType: 'xlsx' }));
const templatePreview = analyzeDataImport({ buffer: templateBuffer, filename: '竞迹统一数据导入模板-已填写.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: '赛艇', userId: owner.id, athletes });
assert.equal(templatePreview.errorCount, 0);
assert.equal(templatePreview.summary.recognizedSheets.length, 11);
assert.equal(templatePreview.itemCount, 31);
const reviewedTemplate = updateDataImportAthleteCandidates({ batchId: templatePreview.id, userId: owner.id, allowedTeams: new Set(['女子双桨组']), corrections: [{ id: templatePreview.athleteCandidates[0].id, team: '女子双桨组' }] });
const templateCommit = commitDataImport({ batchId: reviewedTemplate.id, userId: owner.id, creatorRole: 'SCC', athletes, allowedTeams: new Set(['女子双桨组']), conflictPolicy: 'update' });
assert.equal(templateCommit.imported, 31);
const templateAthlete = db.prepare('SELECT id, gender, region, city, county FROM athletes WHERE name=?').get(templateAthleteName) as { id:number; gender:string; region:string; city:string; county:string };
assert.equal(templateAthlete.gender, '女');
assert.equal(db.prepare('SELECT team FROM athletes WHERE id=?').get(templateAthlete.id)?.team, '女子双桨组');
assert.equal(db.prepare('SELECT team FROM athletes WHERE id=?').get(athleteId)?.team, '女子双桨组');
assert.equal(db.prepare('SELECT identity_number FROM athlete_profiles WHERE athlete_id=?').get(templateAthlete.id)?.identity_number, '11010120010203002X');
assert.equal(db.prepare('SELECT technical_level FROM athlete_profiles WHERE athlete_id=?').get(templateAthlete.id)?.technical_level, '国际级运动健将');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM daily_wellness WHERE athlete_id=?').get(templateAthlete.id)?.count, 1);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM training_sessions WHERE athlete_id=?').get(templateAthlete.id)?.count, 3);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM injury_records WHERE athlete_id=?').get(templateAthlete.id)?.count, 1);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM competitive_state_assessments WHERE athlete_id=?').get(templateAthlete.id)?.count, 1);
const overviewAfterTemplateImport = buildOverviewPayload({ athleteIds: [templateAthlete.id], from: '2026-08-01', to: '2026-08-31', project: '赛艇', individual: false, period: 'month' });
assert.equal(overviewAfterTemplateImport.profiles.length, 1, '总览应包含已导入运动员档案');
assert.notEqual(overviewAfterTemplateImport.profiles[0]?.age, null, '总览年龄结构需要读取导入出生日期');
assert.equal(overviewAfterTemplateImport.profiles[0]?.startSportDate, '2012-01-01', '运动经验结构需要读取导入开始运动日期');
assert.deepEqual(overviewAfterTemplateImport.trainingVolume.days, [
  { date: '2026-08-01', durationMin: 150, distanceKm: 28, sessionCount: 2 },
  { date: '2026-08-02', durationMin: 0, distanceKm: null, sessionCount: 1 }
], '训练量统计应按日期累加时长和公里数，并保留缺失距离');
assert.equal(overviewAfterTemplateImport.trainingVolume.totalDurationMin, 150, '累计训练时长应包含真实填报的 0');
assert.equal(overviewAfterTemplateImport.trainingVolume.totalDistanceKm, 28, '累计公里数不应把空值按 0 处理');
assert.equal(overviewAfterTemplateImport.trainingVolume.averageDurationMin, 75, '日均训练时长应按有时长填报的训练日计算');
assert.equal(overviewAfterTemplateImport.trainingVolume.averageDistanceKm, 28, '日均公里数应按有公里数填报的训练日计算');
const firstDaySessions = overviewAfterTemplateImport.records.filter((item) => item.date === '2026-08-01');
assert.equal(firstDaySessions.reduce((sum, item) => sum + item.durationMin, 0), 150, '同日多课次训练时长应正确累加');
assert.equal(firstDaySessions.reduce((sum, item) => sum + item.distanceKm, 0), 28, '同日多课次训练距离应正确累加');
const missingDistanceSession = overviewAfterTemplateImport.records.find((item) => item.date === '2026-08-02' && item.content === '恢复活动');
assert.equal(missingDistanceSession?.durationMin, 0, '实际录入的 0 时长应保留为 0');
assert.equal(missingDistanceSession?.durationReported, true, '实际录入的 0 时长应标记为已填报');
assert.equal(missingDistanceSession?.distanceReported, false, '空距离不得标记为真实 0');
const overviewAfterRefresh = buildOverviewPayload({ athleteIds: [templateAthlete.id], from: '2026-08-01', to: '2026-08-31', project: '赛艇', individual: false, period: 'month' });
assert.deepEqual(
  overviewAfterRefresh.records.map((item) => [item.date, item.durationMin, item.distanceKm, item.durationReported, item.distanceReported]),
  overviewAfterTemplateImport.records.map((item) => [item.date, item.durationMin, item.distanceKm, item.durationReported, item.distanceReported]),
  '重新读取数据库后训练量统计数据应保持一致'
);
const insertIntensitySession = db.prepare(`INSERT INTO training_sessions (
  athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content,
  duration_min, distance_km, duration_reported, distance_reported, rpe, srpe, smvl, source, quality, is_demo, created_by
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 5, ?, 0, 'test', 'valid', 0, ?)`);
insertIntensitySession.run(templateAthlete.id, '2026-08-10', 1, '专项训练', '专项训练', 'U3', '强度统计校验', 30, 0, owner.id);
insertIntensitySession.run(templateAthlete.id, '2026-08-10', 2, '专项训练', '专项训练', 'U2', '强度统计校验', 60, 0, owner.id);
insertIntensitySession.run(templateAthlete.id, '2026-08-10', 3, '专项训练', '专项训练', 'ATP', '强度统计校验', 10, 0, owner.id);
const intensityOverview = buildOverviewPayload({ athleteIds: [templateAthlete.id], from: '2026-08-10', to: '2026-08-10', project: '赛艇', individual: false, period: 'day' });
assert.deepEqual(intensityOverview.intensityDistribution.map((item) => item.zone), ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'], '训练强度统计必须固定返回七类原始强度区间');
assert.deepEqual(intensityOverview.intensityDistribution.map((item) => item.durationMin), [30, 60, 0, 0, 0, 0, 10], '训练强度统计必须按已填报训练时长汇总');
assert.equal(intensityOverview.intensityDistribution.reduce((sum, item) => sum + item.percentage, 0), 100, '有效训练强度占比之和应为 100%');
insertIntensitySession.run(templateAthlete.id, '2026-08-11', 1, '专项训练', '专项训练', 'U2', '水上划行', 60, 300, owner.id);
insertIntensitySession.run(templateAthlete.id, '2026-08-11', 2, '体能训练', '最大力量', 'AN', '深蹲', 50, 200, owner.id);
insertIntensitySession.run(templateAthlete.id, '2026-08-11', 3, '技术课', '待确认', 'U1', '未知训练', 40, 50, owner.id);
const waterLandOverview = buildOverviewPayload({ athleteIds: [templateAthlete.id], from: '2026-08-11', to: '2026-08-11', project: '赛艇', individual: false, period: 'day' });
assert.deepEqual(waterLandOverview.waterLandLoad, { waterLoad: 300, landLoad: 200, totalLoad: 500, waterPercentage: 60, landPercentage: 40, unclassifiedLoad: 50 }, '水陆负荷应仅按 SRPE 汇总，未分类负荷不得计入比例');
insertIntensitySession.run(templateAthlete.id, '2026-08-12', 1, '专项训练', '专项训练', 'U2', '水上划行', 60, 600, owner.id);
const waterOnlyOverview = buildOverviewPayload({ athleteIds: [templateAthlete.id], from: '2026-08-12', to: '2026-08-12', project: '赛艇', individual: false, period: 'day' });
assert.deepEqual(waterOnlyOverview.waterLandLoad, { waterLoad: 600, landLoad: 0, totalLoad: 600, waterPercentage: 100, landPercentage: 0, unclassifiedLoad: 0 }, '仅有水上负荷时应展示 100% / 0%');
const emptyWaterLandOverview = buildOverviewPayload({ athleteIds: [templateAthlete.id], from: '2026-08-13', to: '2026-08-13', project: '赛艇', individual: false, period: 'day' });
assert.deepEqual(emptyWaterLandOverview.waterLandLoad, { waterLoad: 0, landLoad: 0, totalLoad: 0, waterPercentage: 0, landPercentage: 0, unclassifiedLoad: 0 }, '无训练负荷时应返回完整零值结构');
assert.deepEqual(emptyWaterLandOverview.trainingVolume, { days: [], totalDurationMin: null, totalDistanceKm: null, averageDurationMin: null, averageDistanceKm: null, durationDayCount: 0, distanceDayCount: 0 }, '无训练记录时训练量统计应返回空值而非虚假 0');
assert.notEqual(overviewAfterTemplateImport.profiles[0]?.competitiveScore, null, '总览竞技水平需要读取导入竞技状态');
assert.equal(overviewAfterTemplateImport.measurements.filter((item) => item.domain === 'fms').length, 7, '个人FMS分析需要读取FMS测试工作表导入的七项数据');
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM test_measurements tm JOIN test_sessions ts ON ts.id=tm.test_session_id WHERE ts.athlete_id=? AND ts.test_type='冠军模型综合评估'").get(templateAthlete.id)?.count, 11, '冠军模型测试工作表需写入正式测试数据');

const realDataDirectory = process.env.REAL_DATA_DIR;
if (realDataDirectory) {
  const filenames = [
    '1月份基础力量训练数据.xls',
    '国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215）(1).xlsx',
    '国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215）.xlsx',
    '国家赛艇队力量素质测试数据对比表.2026.2.13-2025.12.17（20260215两次测试数据对比）.xlsx',
    '国家赛艇队力量素质测试数据统计表.xlsx',
    '国家赛艇队力量素质测试数据统计表20260214.xlsx'
  ];
  for (const filename of filenames) {
    const realPreview = analyzeDataImport({
      buffer: readFileSync(join(realDataDirectory, filename)), filename, mimetype: 'application/vnd.ms-excel',
      project: '赛艇', defaultDate: '2026-02-14', userId: owner.id, athletes
    });
    assert(realPreview.itemCount > 0, `${filename} should produce import candidates`);
    console.log(JSON.stringify({ filename, items: realPreview.itemCount, valid: realPreview.validCount, warnings: realPreview.warningCount, errors: realPreview.errorCount, recognized: realPreview.summary.recognizedSheets.map((sheet) => sheet.name), ignored: realPreview.summary.ignoredSheets.map((sheet) => sheet.name) }));
  }
}

db.close();
rmSync(databasePath, { force: true });
for (const suffix of ['-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
console.log('data-import-check passed');
