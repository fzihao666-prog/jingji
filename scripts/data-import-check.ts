import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from '@e965/xlsx';
import { db } from '../server/db.ts';
import { analyzeDataImport, commitDataImport } from '../server/data-import.ts';

const databasePath = process.env.DATABASE_PATH;
assert(databasePath, 'DATABASE_PATH is required');

const owner = db.prepare("SELECT id FROM users WHERE username = 'coach01'").get() as { id: number } | undefined;
assert(owner, 'seed user is required');
const athleteName = `导入测试运动员${Date.now()}`;
const athleteInsert = db.prepare("INSERT INTO athletes (name, project, team, gender, active) VALUES (?, '赛艇', '测试队', '男', 1)")
  .run(athleteName);
const athleteId = Number(athleteInsert.lastInsertRowid);
const athletes = [{ id: athleteId, name: athleteName, project: '赛艇', team: '测试队', gender: '男' }];
const newAthleteName = `无账号导入运动员${Date.now()}`;

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
const preview = analyzeDataImport({ buffer, filename: '力量测试20260214.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: '赛艇', defaultTeam: '女子双桨组', defaultArea: { region: '未设置', city: '未设置', county: '未设置' }, userId: owner.id, athletes });
assert.equal(preview.errorCount, 0);
assert.equal(preview.athleteCandidates.length, 1);
assert(preview.itemCount >= 18, 'summary metrics should be recognized');
const duplicate = analyzeDataImport({ buffer, filename: '力量测试20260214.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: '赛艇', defaultTeam: '女子双桨组', userId: owner.id, athletes });
assert.equal(duplicate.id, preview.id);
assert.equal(duplicate.summary.duplicateFile, true);
const committed = commitDataImport({ batchId: preview.id, userId: owner.id, creatorRole: 'SCC', athletes, conflictPolicy: 'update' });
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
const legacy = db.prepare('SELECT metrics_json AS metricsJson FROM athlete_strength_tests WHERE athlete_id = ?').get(athleteId) as { metricsJson: string };
assert.equal(JSON.parse(legacy.metricsJson).squatKg, 170);

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
      project: '赛艇', defaultDate: '2026-02-14', defaultTeam: '女子双桨组', userId: owner.id, athletes
    });
    assert(realPreview.itemCount > 0, `${filename} should produce import candidates`);
    console.log(JSON.stringify({ filename, items: realPreview.itemCount, valid: realPreview.validCount, warnings: realPreview.warningCount, errors: realPreview.errorCount, recognized: realPreview.summary.recognizedSheets.map((sheet) => sheet.name), ignored: realPreview.summary.ignoredSheets.map((sheet) => sheet.name) }));
  }
}

db.close();
rmSync(databasePath, { force: true });
for (const suffix of ['-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
console.log('data-import-check passed');
