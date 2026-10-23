import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';

vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
import { db } from '../core/db.ts';
import { UNIFIED_IMPORT_HEADERS } from '../../shared/data-import-template.ts';
import { importTemplateFields, templateHeaderKey } from '../../shared/import-template-fields.ts';
import { importReviewGroups, selectImportReviewRecord } from '../../shared/import-conflict-review.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
import {
  analyzeDataImport,
  getDataImportBatch,
  commitDataImport,
  updateDataImportAthleteCandidates,
  updateDataImportItems,
} from './data-import.ts';
import type { ImportAthlete } from './data-import.ts';

initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: false });

const PROJECT = '赛艇';
const USER_ID = 7;

function workbookBuffer(sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

let unique = 0;
function analyze(sheets: Record<string, unknown[][]>, options?: Partial<Parameters<typeof analyzeDataImport>[0]>) {
  unique += 1;
  // 追加独立说明页写入唯一标记，保证每个用例的文件哈希互不相同，且不影响业务解析。
  return analyzeDataImport({
    buffer: workbookBuffer({ ...sheets, 说明: [[`测试标记__t${unique}__`]] }),
    filename: `测试${unique}.xlsx`,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    project: PROJECT,
    userId: USER_ID,
    athletes: options?.athletes ?? athletes,
    allowedTeams: options?.allowedTeams ?? new Set(['A队', 'B队']),
    ...options,
  });
}

const athletes: ImportAthlete[] = [
  { id: 1, name: '张某', project: PROJECT, team: 'A队', gender: '男', birthDate: '1990-01-01' },
  { id: 2, name: '赵某', project: PROJECT, team: 'B队', gender: '女', birthDate: '1992-02-02' },
  { id: 3, name: '钱某', project: PROJECT, team: 'A队', gender: '男', birthDate: '' },
];

const commit = (batchId: string, conflictPolicy: 'skip' | 'update', allowedTeams?: Set<string>) =>
  commitDataImport({
    batchId,
    userId: USER_ID,
    creatorRole: 'SCC',
    athletes,
    allowedTeams: allowedTeams ?? new Set(['A队', 'B队']),
    conflictPolicy,
  });

it('在线修复非法数值源行并一致重算同源测试记录，修订冲突回滚', () => {
  const batch = analyze({ 体能测试: [['姓名', '测试日期', 'VO2Max', 'CMJ峰值功率W'], ['张某', '2026-02-13', '坏值', 30]] });
  const invalid = batch.items.find(item => item.itemType === 'invalid_row')!;
  expect(invalid).toBeDefined();
  expect(invalid.payload.sourceRow).toBeDefined();
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, expectedRevision: batch.revision, athletes, corrections: [{ id: invalid.id, sourceCells: { VO2Max: 40, 测试日期: '2026-02-14' } }] });
  expect(fixed.items.some(item => item.itemType === 'invalid_row')).toBe(false);
  expect(fixed.items.map(item => item.eventDate)).toEqual(fixed.items.map(() => '2026-02-14'));
  expect(fixed.items.map(item => item.valueNum).sort()).toEqual([30, 40]);
  expect(() => updateDataImportItems({ batchId: fixed.id, userId: USER_ID, expectedRevision: batch.revision, athletes, corrections: [{ id: fixed.items[0].id, sourceCells: { VO2Max: 55 } }] })).toThrow();
  expect(getDataImportBatch(batch.id, USER_ID).items.map(item => item.valueNum).sort()).toEqual([30, 40]);
});

it('源行固定选项、日期和授权姓名可修正，未知人员仍阻断提交', () => {
  const batch = analyze({ 伤病记录: [['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态', '疼痛评分'], ['张某', '坏日期', '膝伤', '膝', '错误侧别', '错误状态', 2]] });
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, sourceCells: { 姓名: '赵某', 发生日期: '2026-02-14', 侧别: '左', 状态: '康复' } }] });
  expect(fixed.items.flatMap(item => item.messages).filter(message => message.startsWith('错误：'))).toEqual([]);
  expect(fixed.items[0].athleteId).toBe(2);
  expect(fixed.items[0].payload.side).toBe('left');
  const unknown = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: fixed.items[0].id, sourceCells: { 姓名: '未知人员' } }] });
  expect(unknown.errorCount).toBeGreaterThan(0);
  expect(unknown.items[0].athleteId).toBeNull();
  expect(() => commit(batch.id, 'skip')).toThrow();
});

it('源行修复保留已确认人员映射', () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值'], ['待关联人员', '2026-02-13', 'single_leg_squat_reps', 10]] });
  const candidate = batch.athleteCandidates[0];
  updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, athletes, allowedTeams: new Set(['A队', 'B队']), corrections: [{ id: candidate.id, matchedAthleteId: 2, confirmed: true }] });
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, sourceCells: { 数值: 20 } }] });
  expect(fixed.items[0].athleteId).toBe(2);
  expect(fixed.items[0].valueNum).toBe(20);
});

it('业务字段校对后禁止旧源行覆盖已保存值', () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值'], ['张某', '2026-02-13', 'single_leg_squat_reps', 10]] });
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, valueNum: 20 }] });
  expect(fixed.items[0].payload.sourceRowOutdated).toBe(true);
  expect(() => updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: fixed.items[0].id, sourceCells: { 测试日期: '2026-02-14' } }] })).toThrow('业务字段校对');
  expect(getDataImportBatch(batch.id, USER_ID).items[0].valueNum).toBe(20);
});

it('缺少姓名源行可关联已有人员，未知源字段和越项目指标拒绝且保留原草稿', () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值'], ['', '2026-02-13', 'single_leg_squat_reps', 10]] });
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, sourceCells: { 姓名: '张某' } }] });
  expect(fixed.items[0].athleteId).toBe(1);
  expect(() => updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: fixed.items[0].id, sourceCells: { 不存在: 1 } }] })).toThrow('无效字段');
  expect(() => updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: fixed.items[0].id, metricCode: 'not_a_metric' }] })).toThrow('正式字典');
});

it('档案非空资料自动采用本次导入，血型不进入数据库冲突审查，空白保留原值', () => {
  db.prepare("INSERT INTO athlete_profiles (athlete_id, blood_type, phone) VALUES (1, 'A', '123')").run();
  const batch = analyze({ 运动员基本资料: [['姓名', '血型', '手机号'], ['张某', 'O', '']] });
  expect(importReviewGroups(batch.items)).toEqual([]);
  expect(batch.counts.overwriteCount).toBe(1);
  expect(commit(batch.id, 'skip').updatedRecords).toBe(1);
  expect(db.prepare('SELECT blood_type, phone FROM athlete_profiles WHERE athlete_id = 1').get()).toEqual({ blood_type: 'O', phone: '123' });
});

it('明确排除档案行时不自动更新资料', () => {
  db.prepare("INSERT INTO athlete_profiles (athlete_id, blood_type) VALUES (1, 'A')").run();
  const batch = analyze({ 运动员基本资料: [['姓名', '血型'], ['张某', 'O']] });
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, resolution: 'skip' }] });
  expect(commit(batch.id, 'skip').updatedRecords).toBe(0);
  expect(db.prepare('SELECT blood_type FROM athlete_profiles WHERE athlete_id = 1').get()).toEqual({ blood_type: 'A' });
});

it('测试最新导入自动更新数值、目标、协议、时长，空白保留且导出往返不再出现旧值', async () => {
  const headers = ['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '协议', '测试时长分钟', '目标值', '备注'];
  const seed = analyze({ 其他测试: [headers, ['张某', '2026-02-13', '力量素质测试', 'single_leg_squat_reps', 255, '次', '旧协议', 12, 30, '原备注']] });
  commit(seed.id, 'skip');
  const changed = analyze({ 其他测试: [headers, ['张某', '2026-02-13', '力量素质测试', 'single_leg_squat_reps', 25, '次', '新协议', 15, 35, '']] });
  expect(changed.errorCount).toBe(0);
  expect(importReviewGroups(changed.items)).toEqual([]);
  expect(commit(changed.id, 'skip').updatedRecords).toBe(1);
  expect(db.prepare('SELECT m.value_num, m.target_value, m.note, s.protocol, s.duration_min FROM test_measurements m JOIN test_sessions s ON s.id = m.test_session_id').get()).toEqual({ value_num: 25, target_value: 35, note: '原备注', protocol: '新协议', duration_min: 15 });
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const roundtrip = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '最新导入往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  expect(roundtrip.items.filter(item => item.itemType === 'test_measurement').map(item => item.valueNum)).toEqual([25]);
  expect(roundtrip.items.flatMap(item => item.messages).some(message => message.includes('255'))).toBe(false);
  expect(commit(roundtrip.id, 'skip').updatedRecords).toBe(0);
});

it('力量组次、伤病和竞技评估统一自动更新，零值有效，空白文本不清空', () => {
  const strengthHeaders = ['姓名', '日期', '课次名称', '动作', '组序', '实际次数', '实际重量kg', '备注'];
  const injuryHeaders = ['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态', '疼痛评分', '训练限制', '备注'];
  const stateHeaders = ['姓名', '评估日期', '总分', '等级', '备注'];
  const seed = analyze({
    力量训练组次: [strengthHeaders, ['张某', '2026-02-12', '力量课', '深蹲', 1, 5, 80, '组次备注']],
    伤病记录: [injuryHeaders, ['张某', '2026-02-12', '膝伤', '膝', '左', '观察', 5, '限制内容', '伤病备注']],
    竞技评估: [stateHeaders, ['张某', '2026-02-12', 80, '良好', '评估备注']],
  });
  expect(seed.errorCount).toBe(0);
  commit(seed.id, 'skip');
  const changed = analyze({
    力量训练组次: [strengthHeaders, ['张某', '2026-02-12', '力量课', '深蹲', 1, 0, 90, '']],
    伤病记录: [injuryHeaders, ['张某', '2026-02-12', '膝伤', '膝', '左', '康复', 0, '', '']],
    竞技评估: [stateHeaders, ['张某', '2026-02-12', 0, '调整', '']],
  });
  expect(changed.errorCount).toBe(0);
  expect(importReviewGroups(changed.items)).toEqual([]);
  expect(commit(changed.id, 'skip').updatedRecords).toBe(3);
  expect(db.prepare('SELECT actual_reps, actual_weight_kg, note FROM strength_result_sets').get()).toEqual({ actual_reps: 0, actual_weight_kg: 90, note: '组次备注' });
  expect(db.prepare('SELECT pain_score, status, restrictions, note FROM injury_records').get()).toEqual({ pain_score: 0, status: 'rehab', restrictions: '限制内容', note: '伤病备注' });
  expect(db.prepare('SELECT overall_score, state_level, note FROM competitive_state_assessments').get()).toEqual({ overall_score: 0, state_level: 'adjust', note: '评估备注' });
});

it('只更新测试协议和时长也正确计入更新，空白测量元数据保留', () => {
  const headers = ['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '协议', '测试时长分钟'];
  commit(analyze({ 其他测试: [headers, ['张某', '2026-02-11', '专项测试', 'grip', 30, 'kg', 'A', 10]] }).id, 'skip');
  const changed = analyze({ 其他测试: [headers, ['张某', '2026-02-11', '专项测试', 'grip', 30, 'kg', 'B', 15]] });
  expect(commit(changed.id, 'skip').updatedRecords).toBe(1);
  expect(db.prepare('SELECT protocol, duration_min FROM test_sessions').get()).toEqual({ protocol: 'B', duration_min: 15 });
});

beforeEach(() => {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM audit_logs; DELETE FROM daily_wellness; DELETE FROM training_sessions;
    DELETE FROM strength_result_sets; DELETE FROM test_sessions; DELETE FROM test_measurements;
    DELETE FROM athlete_body_measurements; DELETE FROM injury_records;
    DELETE FROM competitive_state_assessments; DELETE FROM athlete_profiles;
    DELETE FROM athlete_origins; DELETE FROM data_import_items;
    DELETE FROM data_import_athlete_candidates; DELETE FROM data_import_batches;
    DELETE FROM users; DELETE FROM athletes; DELETE FROM project_teams;
    PRAGMA foreign_keys = ON;
  `);
  db.prepare('INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)').run(
    USER_ID,
    'coach',
    'x',
    '教练',
    'SCC'
  );
  // 这些用例测试成绩合并及往返；自定义项目由管理员事先配置，导入本身不再建字典。
  const configuredMetrics = [['grip', 'kg'], ['metric_a', 'kg'], ['metric_b', 'kg'], ['a', 'kg'], ['b', 'kg'], ['custom_note', 'kg'], ['migration_note', 'kg'], ['custom_unit', 'g']];
  for (const [code, unit] of configuredMetrics)
    db.prepare("INSERT OR IGNORE INTO metric_definitions (code,label,domain,unit,direction,frequency) VALUES (?,?,'custom',?,'neutral','phase')").run(code, code, unit);
  for (const team of ['A队', 'B队'])
    db.prepare('INSERT INTO project_teams (project, name) VALUES (?, ?)').run(PROJECT, team);
  for (const athlete of athletes)
    db.prepare(
      `INSERT INTO athletes (id, name, project, team, team_id, gender, birth_date, profile_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'complete')`
    ).run(
      athlete.id,
      athlete.name,
      athlete.project,
      athlete.team,
      athlete.team === 'A队' ? 1 : 2,
      athlete.gender,
      athlete.birthDate || null
    );
});

afterAll(() => db.close());

describe('数据准确性：校对值与入库值一致', () => {
  it('训练课次时长在预览中修改后，入库读取的是修改后的值而不是原始 payload', async () => {
    const batch = analyze({
      训练课次: [
        ['姓名', '日期', '课次序号', '训练类型', '训练内容', '时长分钟', '距离千米'],
        ['张某', '2025-05-01', 1, '专项训练', '水上', 60, 12],
      ],
    });
    const item = batch.items.find((entry) => entry.itemType === 'training_session')!;
    expect(item.valueNum).toBe(60);
    updateDataImportItems({
      batchId: batch.id,
      userId: USER_ID,
      athletes,
      corrections: [{ id: item.id, valueNum: 75 }],
    });
    const result = commit(batch.id, 'skip');
    expect(result.createdRecords).toBe(1);
    const session = db
      .prepare('SELECT duration_min AS duration FROM training_sessions WHERE athlete_id = 1')
      .get() as { duration: number };
    expect(session.duration).toBe(75);
    // payload 同步更新，保证预览与提交同一份最终数据。
    const saved = db
      .prepare('SELECT payload_json AS payload FROM data_import_items WHERE id = ?')
      .get(item.id) as { payload: string };
    expect(JSON.parse(saved.payload).durationMin).toBe(75);
  });

  it('恢复日报睡眠小时修改后按修改值入库', () => {
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时', '晨脉'],
        ['张某', '2025-05-02', 6, 52],
      ],
    });
    const item = batch.items.find((entry) => entry.itemType === 'wellness')!;
    updateDataImportItems({
      batchId: batch.id,
      userId: USER_ID,
      athletes,
      corrections: [{ id: item.id, valueNum: 8 }],
    });
    commit(batch.id, 'skip');
    const row = db
      .prepare('SELECT sleep_hours AS sleep FROM daily_wellness WHERE athlete_id = 1')
      .get() as { sleep: number };
    expect(row.sleep).toBe(8);
  });
});

describe('数据准确性：空白保护与真实 0', () => {
  it('空白字段不覆盖已有有效值，真实 0 正常写入', () => {
    db.prepare(
      `INSERT INTO daily_wellness (athlete_id, wellness_date, sleep_hours, morning_pulse, status) VALUES (1, '2025-05-03', 7, 50, 'normal')`
    ).run();
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时', '晨脉'],
        ['张某', '2025-05-03', null, 55],
        ['张某', '2025-05-04', 0, null],
      ],
    });
    const result = commit(batch.id, 'update');
    expect(result.updatedRecords).toBe(1);
    expect(result.createdRecords).toBe(1);
    const updated = db
      .prepare('SELECT sleep_hours AS sleep, morning_pulse AS pulse FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = ?')
      .get('2025-05-03') as { sleep: number; pulse: number };
    // 空白睡眠保留 7；晨脉更新为 55。
    expect(updated.sleep).toBe(7);
    expect(updated.pulse).toBe(55);
    const zero = db
      .prepare('SELECT sleep_hours AS sleep FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = ?')
      .get('2025-05-04') as { sleep: number };
    expect(zero.sleep).toBe(0);
  });

  it('旧客户端的跳过批次参数也按最新非空值更新', () => {
    db.prepare(
      `INSERT INTO daily_wellness (athlete_id, wellness_date, sleep_hours, status) VALUES (1, '2025-05-05', 7, 'normal')`
    ).run();
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时'],
        ['张某', '2025-05-05', 5],
      ],
    });
    const result = commit(batch.id, 'skip');
    expect(result.skipped).toBe(0);
    const row = db
      .prepare('SELECT sleep_hours AS sleep FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = ?')
      .get('2025-05-05') as { sleep: number };
    expect(row.sleep).toBe(5);
  });

  it('档案非空字段按本次导入更新，不受测量记录的跳过策略影响', () => {
    const batch = analyze({
      运动员信息: [
        ['姓名', '运动项目', '所属队伍', '性别', '最好成绩'],
        ['张某', PROJECT, 'A队', '女', '全国冠军'],
      ],
    });
    commit(batch.id, 'skip');
    const row = db
      .prepare('SELECT gender FROM athletes WHERE id = 1')
      .get() as { gender: string };
    expect(row.gender).toBe('女');
  });

  it('更新策略下档案覆盖计数并写入，空白仍不覆盖', () => {
    const batch = analyze({
      运动员信息: [
        ['姓名', '运动项目', '所属队伍', '性别', '最好成绩'],
        ['张某', PROJECT, 'A队', '女', ''],
      ],
    });
    const result = commit(batch.id, 'update');
    expect(result.overwrittenProfileFields).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT gender FROM athletes WHERE id = 1')
      .get() as { gender: string };
    expect(row.gender).toBe('女');
  });
});

describe('统一合并语义：最新非空值覆盖并补全空缺', () => {
  it('恢复状态更新非空字段并补全空缺', () => {
    db.prepare(
      `INSERT INTO daily_wellness (athlete_id, wellness_date, sleep_hours, status) VALUES (1, '2025-05-06', 7, 'normal')`
    ).run();
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时', '晨脉'],
        ['张某', '2025-05-06', 5, 52],
      ],
    });
    const result = commit(batch.id, 'skip');
    expect(result.updatedRecords).toBe(1);
    expect(result.skipped).toBe(0);
    const row = db
      .prepare(
        'SELECT sleep_hours AS sleep, morning_pulse AS pulse FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = ?'
      )
      .get('2025-05-06') as { sleep: number; pulse: number };
    expect(row.sleep).toBe(5); // 采用本次导入值
    expect(row.pulse).toBe(52); // 空缺补全
  });

  it('身体测量更新非空字段并补全空缺', () => {
    db.prepare(
      `INSERT INTO athlete_body_measurements (athlete_id, measurement_date, height_cm) VALUES (1, '2025-05-07', 180)`
    ).run();
    const batch = analyze({
      身体测量: [
        ['姓名', '日期', '身高cm', '体重kg'],
        ['张某', '2025-05-07', 181, 77],
      ],
    });
    const result = commit(batch.id, 'skip');
    expect(result.updatedRecords).toBe(1);
    const row = db
      .prepare(
        'SELECT height_cm AS height, weight_kg AS weight FROM athlete_body_measurements WHERE athlete_id = 1 AND measurement_date = ?'
      )
      .get('2025-05-07') as { height: number; weight: number };
    expect(row.height).toBe(181);
    expect(row.weight).toBe(77);
  });

  it('训练课次更新已报时长并补全未报距离', () => {
    db.prepare(
      `INSERT INTO training_sessions (athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content, duration_min, distance_km, duration_reported, distance_reported)
       VALUES (1, '2025-05-08', 1, '专项训练', '水上训练', 'AN', '水上', 60, 0, 1, 0)`
    ).run();
    const batch = analyze({
      训练课次: [
        ['姓名', '日期', '课次序号', '训练类型', '训练内容', '时长分钟', '距离千米'],
        ['张某', '2025-05-08', 1, '专项训练', '水上', 50, 8],
      ],
    });
    const result = commit(batch.id, 'skip');
    expect(result.updatedRecords).toBe(1);
    const row = db
      .prepare(
        'SELECT duration_min AS duration, distance_km AS distance, distance_reported AS distanceReported FROM training_sessions WHERE athlete_id = 1 AND session_date = ?'
      )
      .get('2025-05-08') as { duration: number; distance: number; distanceReported: number };
    expect(row.duration).toBe(50); // 采用本次导入时长
    expect(row.distance).toBe(8); // 未报距离属于空缺，补全
    expect(row.distanceReported).toBe(1);
  });

  it('全部字段不同仍自动更新，不按旧批次策略跳过', () => {
    db.prepare(
      `INSERT INTO daily_wellness (athlete_id, wellness_date, sleep_hours, status) VALUES (1, '2025-05-09', 7, 'normal')`
    ).run();
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时'],
        ['张某', '2025-05-09', 5],
      ],
    });
    const result = commit(batch.id, 'skip');
    expect(result.skipped).toBe(0);
    expect(result.updatedRecords).toBe(1);
    const row = db
      .prepare('SELECT sleep_hours AS sleep FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = ?')
      .get('2025-05-09') as { sleep: number };
    expect(row.sleep).toBe(5);
  });
});

describe('校对保存上限：超限显式拒绝而不是静默截断', () => {
  it('单次超过 5000 条数据校对被拒绝，草稿不被部分写入', () => {
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时'],
        ['张某', '2025-05-10', 6],
      ],
    });
    const corrections = Array.from({ length: 5001 }, (_, index) => ({ id: index + 1 }));
    expect(() =>
      updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections })
    ).toThrow(/分批保存/);
    const saved = db
      .prepare('SELECT payload_json AS payload FROM data_import_items WHERE batch_id = ?')
      .get(batch.id) as { payload: string };
    expect(JSON.parse(saved.payload).sleepHours).toBe(6);
  });

  it('单次超过 500 条人员修改被拒绝', () => {
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时'],
        ['张某', '2025-05-11', 6],
      ],
    });
    const corrections = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      confirmed: true,
    }));
    expect(() =>
      updateDataImportAthleteCandidates({
        batchId: batch.id,
        userId: USER_ID,
        allowedTeams: new Set(['A队', 'B队']),
        athletes,
        corrections,
      })
    ).toThrow(/分批保存/);
  });
});

describe('数据准确性：非法日期与错误行', () => {
  it('非法日期被拒绝为错误行，修正后才能提交', () => {
    const batch = analyze({
      训练课次: [
        ['姓名', '日期', '课次序号', '训练类型', '训练内容', '时长分钟'],
        ['张某', '2025-02-30', 1, '专项训练', '水上', 60],
      ],
    });
    const item = batch.items.find((entry) => entry.itemType === 'training_session')!;
    expect(item.quality).toBe('error');
    expect(item.messages.join('；')).toContain('日期');
    expect(() => commit(batch.id, 'skip')).toThrow(/校验/);
    updateDataImportItems({
      batchId: batch.id,
      userId: USER_ID,
      athletes,
      corrections: [{ id: item.id, eventDate: '2025-02-28' }],
    });
    const result = commit(batch.id, 'skip');
    expect(result.createdRecords).toBe(1);
  });

  it('有内容但缺少姓名的行生成错误行并阻止提交，可显式排除', () => {
    const batch = analyze({
      训练课次: [
        ['姓名', '日期', '课次序号', '训练类型', '训练内容', '时长分钟'],
        ['', '2025-05-01', 1, '专项训练', '无名数据', 60],
      ],
    });
    const invalid = batch.items.find((entry) => entry.itemType === 'invalid_row')!;
    expect(invalid.quality).toBe('error');
    expect(invalid.messages.join('；')).toContain('缺少姓名');
    expect(() => commit(batch.id, 'skip')).toThrow(/错误行/);
    updateDataImportItems({
      batchId: batch.id,
      userId: USER_ID,
      athletes,
      corrections: [{ id: invalid.id, resolution: 'skip' }],
    });
    // 该文件仅有错误行；排除后没有可导入业务数据，批次仍可提交（导入 0 条）。
    const result = commit(batch.id, 'skip');
    expect(result.imported).toBe(0);
  });
});

describe('人员识别：同名歧义与最小建档', () => {
  it('同名不同队不自动合并，必须人工选择关联人员', () => {
    const twinList: ImportAthlete[] = [
      ...athletes,
      { id: 4, name: '孙某', project: PROJECT, team: 'A队', gender: '男', birthDate: '' },
      { id: 5, name: '孙某', project: PROJECT, team: 'B队', gender: '女', birthDate: '' },
    ];
    for (const athlete of twinList.slice(-2))
      db.prepare(
        `INSERT INTO athletes (id, name, project, team, team_id, gender, profile_status) VALUES (?, ?, ?, ?, ?, ?, 'complete')`
      ).run(athlete.id, athlete.name, athlete.project, athlete.team, athlete.team === 'A队' ? 1 : 2, athlete.gender);
    const batch = analyze(
      {
        恢复状态: [
          ['姓名', '日期', '睡眠小时'],
          ['孙某', '2025-06-01', 7],
        ],
      },
      { athletes: twinList }
    );
    const candidate = batch.athleteCandidates.find((entry) => entry.name === '孙某')!;
    expect(candidate.status).toBe('pending');
    expect(candidate.suggested).toHaveLength(2);
    const item = batch.items.find((entry) => entry.itemType === 'wellness')!;
    expect(item.athleteId).toBeNull();
    // 未完成人员确认不允许提交。
    expect(() =>
      commitDataImport({
        batchId: batch.id,
        userId: USER_ID,
        creatorRole: 'SCC',
        athletes: twinList,
        allowedTeams: new Set(['A队', 'B队']),
        conflictPolicy: 'skip',
      })
    ).toThrow(/人员确认/);
    updateDataImportAthleteCandidates({
      batchId: batch.id,
      userId: USER_ID,
      allowedTeams: new Set(['A队', 'B队']),
      athletes: twinList,
      corrections: [{ id: candidate.id, matchedAthleteId: 5, confirmed: true }],
    });
    const result = commitDataImport({
      batchId: batch.id,
      userId: USER_ID,
      creatorRole: 'SCC',
      athletes: twinList,
      allowedTeams: new Set(['A队', 'B队']),
      conflictPolicy: 'skip',
    });
    expect(result.linkedAthletes).toBe(1);
    const row = db
      .prepare('SELECT athlete_id AS athleteId FROM daily_wellness WHERE wellness_date = ?')
      .get('2025-06-01') as { athleteId: number };
    expect(row.athleteId).toBe(5);
  });

  it('最小建档只填姓名与队伍，不伪造生日性别，不创建登录账号', () => {
    const batch = analyze(
      {
        恢复状态: [
          ['姓名', '日期', '睡眠小时'],
          ['李某', '2025-06-02', 8],
        ],
      },
      // 当前仅有一个可管理队伍时自动带入。
      { allowedTeams: new Set(['A队']) }
    );
    const candidate = batch.athleteCandidates.find((entry) => entry.name === '李某')!;
    expect(candidate.team).toBe('A队');
    updateDataImportAthleteCandidates({
      batchId: batch.id,
      userId: USER_ID,
      allowedTeams: new Set(['A队']),
      athletes,
      corrections: [{ id: candidate.id, confirmed: true }],
    });
    const result = commitDataImport({
      batchId: batch.id,
      userId: USER_ID,
      creatorRole: 'SCC',
      athletes,
      allowedTeams: new Set(['A队']),
      conflictPolicy: 'skip',
    });
    expect(result.createdAthletes).toBe(1);
    const athlete = db
      .prepare('SELECT gender, birth_date AS birthDate, team, profile_status AS profileStatus FROM athletes WHERE name = ?')
      .get('李某') as { gender: string | null; birthDate: string | null; team: string; profileStatus: string };
    expect(athlete.team).toBe('A队');
    expect(athlete.gender).toBeNull();
    expect(athlete.birthDate).toBeNull();
    expect(athlete.profileStatus).toBe('incomplete');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 1 });
  });

  it('无法越权把人员关联到权限外的已有运动员', () => {
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时'],
        ['周某', '2025-06-03', 7],
      ],
    });
    const candidate = batch.athleteCandidates.find((entry) => entry.name === '周某')!;
    expect(() =>
      updateDataImportAthleteCandidates({
        batchId: batch.id,
        userId: USER_ID,
        allowedTeams: new Set(['A队', 'B队']),
        athletes,
        corrections: [{ id: candidate.id, matchedAthleteId: 999 }],
      })
    ).toThrow(/权限|不存在/);
  });
});

describe('预览与提交校验一致', () => {
  it('训练课次缺时长和距离在预览报错并阻止提交', () => {
    const batch = analyze({
      训练课次: [
        ['姓名', '日期', '课次序号', '训练类型', '训练内容', '时长分钟', '距离千米'],
        ['张某', '2025-07-01', 1, '专项训练', '无量', null, null],
      ],
    });
    const item = batch.items.find((entry) => entry.itemType === 'training_session')!;
    expect(item.quality).toBe('error');
    expect(item.messages.join('；')).toContain('至少填写一项');
    expect(() => commit(batch.id, 'skip')).toThrow(/校验/);
  });

  it('测试成绩数值为空在预览报错', () => {
    const batch = analyze({
      测试指标: [
        ['姓名', '测试日期', '测试类型', '指标代码', '指标名称', '数值', '单位', '侧别'],
        ['张某', '2025-07-02', '力量素质测试', 'squat_kg', '深蹲', null, 'kg', '中央'],
      ],
    });
    const item = batch.items.find((entry) => entry.itemType === 'test_measurement')!;
    expect(item.quality).toBe('error');
    expect(item.messages.join('；')).toContain('测试值');
  });
});

describe('P0：人员隔离与训练空白保护', () => {
  it('同名不同编号跨表独立匹配并分别入库', () => {
    db.prepare("UPDATE athletes SET name = '张某' WHERE id = 2").run();
    const people = [athletes[0], { ...athletes[1], name: '张某' }];
    const batch = analyze(
      {
        运动员信息: [
          ['系统运动员编号', '姓名', '所属队伍'],
          [1, '张某', 'A队'],
          [2, '张某', 'B队'],
        ],
        训练课次: [
          ['系统运动员编号', '姓名', '日期', '时长分钟'],
          [1, '张某', '2025-08-01', 60],
          [2, '张某', '2025-08-01', 90],
        ],
      },
      { athletes: people }
    );
    expect(batch.athleteCandidates).toHaveLength(2);
    expect(
      batch.items.filter((x) => x.itemType === 'training_session').map((x) => x.athleteId)
    ).toEqual([1, 2]);
    const result = commitDataImport({
      batchId: batch.id,
      userId: USER_ID,
      creatorRole: 'SCC',
      athletes: people,
      allowedTeams: new Set(['A队', 'B队']),
      conflictPolicy: 'skip',
    });
    expect(result.createdRecords).toBe(2);
    expect(
      db
        .prepare(
          'SELECT athlete_id AS id, duration_min AS duration FROM training_sessions ORDER BY athlete_id'
        )
        .all()
    ).toEqual([
      { id: 1, duration: 60 },
      { id: 2, duration: 90 },
    ]);
  });

  it('更新时空白类型、阶段和强度保留原值，显式值进入覆盖预览', () => {
    db.prepare(
      "INSERT INTO training_sessions (athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content, duration_min) VALUES (1, '2025-08-02', 1, '体能训练', '体能训练', 'UT2', '原内容', 50)"
    ).run();
    const batch = analyze({
      训练课次: [
        ['姓名', '日期', '时长分钟'],
        ['张某', '2025-08-02', 60],
      ],
    });
    expect(batch.items[0].payload.intensityZone).toBe('');
    commit(batch.id, 'update');
    expect(
      db
        .prepare(
          'SELECT training_type AS type, structure_type AS structure, intensity_zone AS zone, content FROM training_sessions'
        )
        .get()
    ).toEqual({ type: '体能训练', structure: '体能训练', zone: 'UT2', content: '原内容' });
    const explicit = analyze({
      训练课次: [
        ['姓名', '日期', '时长分钟', '训练阶段', '强度区间'],
        ['张某', '2025-08-02', 60, '水上训练', 'AN'],
      ],
    });
    expect(explicit.items[0].conflict?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'intensityZone',
          oldValue: 'UT2',
          newValue: 'AN',
          overwrites: true,
        }),
        expect.objectContaining({ field: 'structureType', overwrites: true }),
      ])
    );
  });

  it('新增记录未填写强度时不伪造AN', () => {
    const batch = analyze({
      训练课次: [
        ['姓名', '日期', '时长分钟'],
        ['张某', '2025-08-03', 60],
      ],
    });
    commit(batch.id, 'skip');
    expect(db.prepare('SELECT intensity_zone AS zone FROM training_sessions').get()).toEqual({
      zone: '',
    });
  });
});

describe('P0：人员确认及旧草稿保护', () => {
  it('无效编号不降级按姓名自动关联，确认与排除仅作用于对应人员', () => {
    const batch = analyze({
      训练课次: [
        ['系统运动员编号', '姓名', '日期', '时长分钟'],
        [998, '张某', '2025-08-04', 60],
        [999, '张某', '2025-08-04', 90],
      ],
    });
    expect(batch.athleteCandidates).toHaveLength(2);
    expect(batch.items.every((item) => item.athleteId === null)).toBe(true);
    const [first, second] = batch.athleteCandidates;
    updateDataImportAthleteCandidates({
      batchId: batch.id,
      userId: USER_ID,
      allowedTeams: new Set(['A队', 'B队']),
      athletes,
      corrections: [
        { id: first.id, matchedAthleteId: 1, confirmed: true },
        { id: second.id, excluded: true },
      ],
    });
    const result = commit(batch.id, 'skip');
    expect(result.createdRecords).toBe(1);
    expect(
      db.prepare('SELECT athlete_id AS id, duration_min AS duration FROM training_sessions').all()
    ).toEqual([{ id: 1, duration: 60 }]);
  });

  it('无编号同名不同队的资料独立识别', () => {
    db.prepare("UPDATE athletes SET name = '张某' WHERE id = 2").run();
    const people = [athletes[0], { ...athletes[1], name: '张某' }];
    const batch = analyze(
      {
        运动员信息: [
          ['姓名', '所属队伍', '出生日期'],
          ['张某', 'A队', '1990-01-01'],
          ['张某', 'B队', '1992-02-02'],
        ],
      },
      { athletes: people }
    );
    expect(batch.athleteCandidates).toHaveLength(2);
    expect(batch.items.map((item) => item.athleteId)).toEqual([1, 2]);
  });

  it('旧版草稿禁止直接提交，原文件重新解析后可提交', () => {
    const sheets = {
      训练课次: [
        ['姓名', '日期', '时长分钟'],
        ['张某', '2025-08-05', 60],
      ],
    };
    const batch = analyze(sheets);
    db.prepare(
      "UPDATE data_import_batches SET parser_version = 'deterministic-v7-profile-data-minimization' WHERE id = ?"
    ).run(batch.id);
    expect(() => commit(batch.id, 'skip')).toThrow(/重新上传原文件/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM training_sessions').get()).toEqual({
      count: 0,
    });
    const fresh = analyzeDataImport({
      buffer: workbookBuffer({ ...sheets, 说明: [[`测试标记__t${unique}__`]] }),
      filename: '重新解析.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      project: PROJECT,
      userId: USER_ID,
      athletes,
      allowedTeams: new Set(['A队', 'B队']),
    });
    expect(fresh.id).toBe(batch.id);
    expect(fresh.revision).toBe(batch.revision + 1);
    expect(commit(fresh.id, 'skip').createdRecords).toBe(1);
  });
});

it('选择队伍后唯一同队同名档案自动关联，无需手动选择', () => {
  const batch = analyze({
    训练课次: [
      ['系统运动员编号', '姓名', '日期', '时长分钟'],
      [999, '张某', '2025-08-06', 60],
    ],
  });
  const updated = updateDataImportAthleteCandidates({
    batchId: batch.id,
    userId: USER_ID,
    allowedTeams: new Set(['A队']),
    athletes,
    corrections: [{ id: batch.athleteCandidates[0].id, team: 'A队', confirmed: true }],
  });
  expect(updated.athleteCandidates[0]).toMatchObject({ matchedAthleteId: 1, confirmed: true });
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  expect(db.prepare('SELECT athlete_id FROM training_sessions').get()).toEqual({ athlete_id: 1 });
});

describe('P1：模板空行、日期和非法数值', () => {
  it('只导入实际填写的业务行，未填人员行和未用工作表无需删除', () => {
    const batch = analyze({
      训练课次: [
        ['系统运动员编号', '姓名', '所属队伍', '日期', '时长分钟'],
        [1, '张某', 'A队', '2025-09-01', 60],
        [2, '赵某', 'B队'],
      ],
      力量训练组次: [
        ['系统运动员编号', '姓名'],
        [1, '张某'],
        [2, '赵某'],
      ],
      恢复状态: [
        ['系统运动员编号', '姓名'],
        [1, '张某'],
      ],
      测试指标: [
        ['系统运动员编号', '姓名'],
        [1, '张某'],
      ],
      FMS测试: [
        ['系统运动员编号', '姓名'],
        [1, '张某'],
      ],
      冠军模型测试: [
        ['系统运动员编号', '姓名'],
        [1, '张某'],
      ],
    });
    expect(batch.items).toHaveLength(1);
    expect(batch.errorCount).toBe(0);
    expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  });

  it('全部只有预填人员时提示尚未填写数据，不创建错误批次', () => {
    expect(() =>
      analyze({
        训练课次: [
          ['系统运动员编号', '姓名'],
          [1, '张某'],
        ],
      })
    ).toThrow(/未填写业务数据/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM data_import_batches').get()).toEqual({
      count: 0,
    });
  });

  it.each(['错误日期', '2025-02-30', '2025-09-01额外文本'])(
    '非空错误日期%s不能被默认日期替换',
    (rawDate) => {
      const batch = analyze(
        {
          训练课次: [
            ['姓名', '日期', '时长分钟'],
            ['张某', rawDate, 60],
          ],
        },
        { defaultDate: '2025-09-02' }
      );
      expect(batch.errorCount).toBeGreaterThan(0);
      expect(batch.items[0].eventDate).not.toBe('2025-09-02');
      expect(batch.items[0].messages.join('；')).toContain('日期');
      expect(() => commit(batch.id, 'skip')).toThrow(/校验/);
      const corrected = updateDataImportItems({
        batchId: batch.id,
        userId: USER_ID,
        athletes,
        corrections: [{ id: batch.items[0].id, eventDate: '2025-09-01' }],
      });
      expect(corrected.errorCount).toBe(0);
      expect(commit(batch.id, 'skip').createdRecords).toBe(1);
    }
  );

  it('只有空白日期才使用默认日期，真实0仍视为已填业务数据', () => {
    const batch = analyze(
      {
        恢复状态: [
          ['姓名', '日期', '睡眠小时'],
          ['张某', '', 0],
        ],
      },
      { defaultDate: '2025-09-02' }
    );
    expect(batch.items[0].eventDate).toBe('2025-09-02');
    expect(batch.errorCount).toBe(0);
    commit(batch.id, 'skip');
    expect(db.prepare('SELECT sleep_hours AS sleep FROM daily_wellness').get()).toEqual({
      sleep: 0,
    });
  });

  it.each([
    [
      '身体测量',
      ['姓名', '测量日期', '身高cm', '体重kg'],
      ['张某', '2025-09-03', '填错了', 75],
      '身高cm',
      'C2',
    ],
    [
      '恢复状态',
      ['姓名', '日期', '睡眠小时', '晨脉'],
      ['张某', '2025-09-03', 7, '填错了'],
      '晨脉',
      'D2',
    ],
    [
      '训练课次',
      ['姓名', '日期', '时长分钟', 'RPE'],
      ['张某', '2025-09-03', 60, '填错了'],
      'RPE',
      'D2',
    ],
    [
      '力量训练组次',
      ['姓名', '日期', '动作', '实际次数', '实际重量kg', '计划次数'],
      ['张某', '2025-09-03', '深蹲', 5, 60, '填错了'],
      '计划次数',
      'F2',
    ],
    [
      'FMS测试',
      ['姓名', '测试日期', '深蹲', '跨栏步'],
      ['张某', '2025-09-03', 2, '填错了'],
      '跨栏步',
      'D2',
    ],
    [
      '测试指标',
      ['姓名', '测试日期', '指标代码', '数值', '测试时长分钟'],
      ['张某', '2025-09-03', 'squat_kg', 60, '填错了'],
      '测试时长分钟',
      'E2',
    ],
  ])('%s的非法数值保留原文并准确定位', (sheet, headers, row, label, address) => {
    const batch = analyze({ [sheet as string]: [headers as unknown[], row as unknown[]] });
    expect(batch.errorCount).toBeGreaterThan(0);
    const item = batch.items.find((entry) => entry.quality === 'error')!;
    expect(item.rawValue).toContain('填错了');
    expect(item.messages.join('；')).toContain(label);
    expect(item.messages.join('；')).toContain(address);
    expect(() => commit(batch.id, 'skip')).toThrow();
    // 排除必须显式操作，不能让该行的其他有效字段悄悄入库。
    updateDataImportItems({
      batchId: batch.id,
      userId: USER_ID,
      athletes,
      corrections: batch.items.map((entry) => ({ id: entry.id, resolution: 'skip' })),
    });
    expect(commit(batch.id, 'skip').imported).toBe(0);
  });
});

it('校对接口不能将非法可选数值静默丢弃，修正后可提交', () => {
  const batch = analyze({
    训练课次: [
      ['姓名', '日期', '时长分钟'],
      ['张某', '2025-09-04', 60],
    ],
  });
  const invalid = updateDataImportItems({
    batchId: batch.id,
    userId: USER_ID,
    athletes,
    corrections: [{ id: batch.items[0].id, payload: { rpe: '填错了' } }],
  });
  expect(invalid.errorCount).toBe(1);
  expect(() => commit(batch.id, 'skip')).toThrow(/校验/);
  const fixed = updateDataImportItems({
    batchId: batch.id,
    userId: USER_ID,
    athletes,
    corrections: [{ id: batch.items[0].id, payload: { rpe: 5 } }],
  });
  expect(fixed.errorCount).toBe(0);
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT rpe FROM training_sessions').get()).toEqual({ rpe: 5 });
});

it('实际统一模板保留三行表头及未填写工作表后能够往返导入', () => {
  const workbook = XLSX.read(readFileSync('public/templates/竞迹统一数据导入模板.xlsx'), {
    type: 'buffer',
  });
  XLSX.utils.sheet_add_aoa(
    workbook.Sheets['训练课次'],
    [{ 系统运动员编号: 1, 姓名: '张某', 日期: '2025-09-05', 课次序号: 1, 时长分钟: 60 }, { 系统运动员编号: 2, 姓名: '赵某' }].map(values => importTemplateFields('训练课次').map(field => values[field.key as keyof typeof values] ?? null)),
    { origin: 'A4' }
  );
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const batch = analyzeDataImport({
    buffer,
    filename: '实际模板往返.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    project: PROJECT,
    userId: USER_ID,
    athletes,
    allowedTeams: new Set(['A队', 'B队']),
  });
  expect(batch.errorCount).toBe(0);
  expect(batch.items).toHaveLength(1);
  expect(batch.items[0].sourceAddress).toBe('B4');
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
});

describe('竞技水平评估为可选资料', () => {
  it.each([
    ['二级运动员', ''],
    ['', '省赛第一名'],
    ['二级运动员', '省赛第一名'],
  ])('只填写技术等级%s和最好成绩%s不要求评估日期或总分', (level, best) => {
    const batch = analyze({ 竞技水平评估: [
      ['姓名', '评估日期', '技术等级', '最好成绩', '竞技总分', '竞技状态'],
      ['张某', '', level, best, '', ''],
    ] });
    expect(batch.errorCount).toBe(0);
    expect(batch.items.map(item => item.itemType)).toEqual(['athlete_profile']);
    expect(commit(batch.id, 'update').imported).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM competitive_state_assessments').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT technical_level AS level, best_result AS best FROM athlete_profiles WHERE athlete_id = 1').get()).toMatchObject({ ...(level ? { level } : {}), ...(best ? { best } : {}) });
  });

  it('只有姓名的评估行不产生记录，也不阻断其他工作表', () => {
    const batch = analyze({
      竞技水平评估: [['姓名', '评估日期', '技术等级', '竞技总分'], ['张某']],
      训练课次: [['姓名', '日期', '时长分钟'], ['张某', '2025-09-06', 60]],
    });
    expect(batch.errorCount).toBe(0);
    expect(batch.items.map(item => item.itemType)).toEqual(['training_session']);
  });

  it('实际填写了评估分数但缺日期时自动补当天', () => {
    const batch = analyze({ 竞技水平评估: [['姓名', '评估日期', '竞技总分'], ['张某', '', 80]] });
    expect(batch.items.map(item => item.itemType)).toEqual(['competitive_state']);
    expect(batch.errorCount).toBe(0);
    expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  });
});

describe('自动识别附带的未注明日期冠军模型数据', () => {
  it('附带未填日期的冠军模型数值自动补当天并导入', () => {
    const batch = analyze({
      运动员信息: [['姓名', '所属队伍'], ['张某', 'A队']],
      冠军模型测试: [['姓名', '测试日期', '体脂率%'], ['张某', '', 21.9]],
    });
    expect(batch.errorCount).toBe(0);
    expect(batch.items.map(item => item.itemType).sort()).toEqual(['athlete_profile', 'body_measurement']);
    commit(batch.id, 'skip');
    expect(db.prepare('SELECT COUNT(*) AS count FROM athlete_body_measurements').get()).toEqual({ count: 1 });
  });

  it('填写了明确测试日期的冠军模型数据仍正常导入', () => {
    const batch = analyze({ 冠军模型测试: [['姓名', '测试日期', '体脂率%'], ['张某', '2025-09-07', 21.9]] });
    expect(batch.errorCount).toBe(0);
    expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  });
});


it('空白日期按所选默认日期、北京时间当天依次补充，表内日期优先', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-21T16:30:00Z'));
    const sheets = { 训练课次: [['姓名', '日期', '时长分钟'], ['张某', '', 60], ['赵某', '2025-09-07', 90]] };
    const today = analyze(sheets);
    expect(today.items.map(item => item.eventDate)).toEqual(['2026-10-22', '2025-09-07']);
    expect(today.errorCount).toBe(0);
    commit(today.id, 'skip');
    expect(db.prepare('SELECT session_date AS date FROM training_sessions WHERE athlete_id = 1').get()).toEqual({ date: '2026-10-22' });
    const chosen = analyze(sheets, { defaultDate: '2025-09-08' });
    expect(chosen.items.map(item => item.eventDate)).toEqual(['2025-09-08', '2025-09-07']);
  } finally {
    vi.useRealTimers();
  }
});

describe('跨表新队员人员确认', () => {
  it('档案有队伍、测试表只有姓名时，共用唯一的新队员建档候选', () => {
    const batch = analyze({
      运动员信息: [['姓名', '所属队伍'], ['新队员', 'A队']],
      冠军模型测试: [['姓名', '测试日期', '体脂率%'], ['新队员', '', 21.9]],
    });
    expect(batch.athleteCandidates).toHaveLength(1);
    updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, athletes, allowedTeams: new Set(['A队']), corrections: [{ id: batch.athleteCandidates[0].id, confirmed: true }] });
    expect(commit(batch.id, 'skip').createdAthletes).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM athletes WHERE name = '新队员'").get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM athlete_body_measurements').get()).toEqual({ count: 1 });
  });
  it('编号无效时仍提供可访问的同名人员供人工关联', () => {
    const batch = analyze({ 运动员信息: [['系统运动员编号', '姓名', '所属队伍'], [999, '张某', 'A队']] });
    expect(batch.athleteCandidates[0].status).toBe('pending');
    expect(batch.athleteCandidates[0].suggested.map(person => person.id)).toEqual([1]);
  });
});

it('文件中多个同名身份时，仅姓名的跨表记录仍要求人工确认', () => {
  db.prepare("UPDATE athletes SET name = '张某' WHERE id = 2").run();
  const people = [athletes[0], { ...athletes[1], name: '张某' }];
  const batch = analyze({
    运动员信息: [['系统运动员编号', '姓名', '所属队伍'], [1, '张某', 'A队'], [2, '张某', 'B队']],
    冠军模型测试: [['姓名', '测试日期', '体脂率%'], ['张某', '', 21.9]],
  }, { athletes: people });
  expect(batch.athleteCandidates).toHaveLength(3);
  const test = batch.items.find(item => item.itemType === 'body_measurement')!;
  expect(test.athleteId).toBeNull();
  expect(batch.athleteCandidates.find(person => person.status === 'pending')?.suggested).toHaveLength(2);
});

it('已入库文件重传可恢复已停用运动员并补回缺失记录，保留历史批次及已有数据', () => {
  const buffer = workbookBuffer({ 训练课次: [['系统运动员编号', '姓名', '日期', '时长分钟'], [1, '张某', '2025-09-10', 60], [2, '赵某', '2025-09-10', 90]] });
  const input = { buffer, filename: '恢复导入.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes, allowedTeams: new Set(['A队', 'B队']) };
  const original = analyzeDataImport(input);
  commit(original.id, 'skip');
  db.prepare('UPDATE athletes SET active = 0 WHERE id = 1').run();
  db.prepare('DELETE FROM training_sessions WHERE athlete_id = 1').run();
  const current = [{ ...athletes[0], active: false }, athletes[1], athletes[2]];
  const next = analyzeDataImport({ ...input, athletes: current });
  expect(next.status).toBe('reviewing');
  expect(next.id).not.toBe(original.id);
  const person = next.athleteCandidates.find(person => person.name === '张某')!;
  expect(person.confirmed).toBe(false);
  updateDataImportAthleteCandidates({ batchId: next.id, userId: USER_ID, athletes: current, allowedTeams: input.allowedTeams, corrections: [{ id: person.id, matchedAthleteId: 1, confirmed: true }] });
  const result = commitDataImport({ batchId: next.id, userId: USER_ID, creatorRole: 'TD', athletes: current, allowedTeams: input.allowedTeams, conflictPolicy: 'skip' });
  expect(result.createdRecords).toBe(1);
  expect(result.skipped).toBeGreaterThanOrEqual(1);
  expect(db.prepare('SELECT active FROM athletes WHERE id = 1').get()).toEqual({ active: 1 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM training_sessions').get()).toEqual({ count: 2 });
  expect(db.prepare('SELECT status FROM data_import_batches WHERE id = ?').get(original.id)).toEqual({ status: 'committed' });
  expect(db.prepare('SELECT COUNT(*) AS count FROM data_import_batches').get()).toEqual({ count: 2 });
});

it('恢复停用档案不启用登录账号，权限被收回时拒绝提交', () => {
  db.prepare('UPDATE athletes SET active = 0 WHERE id = 1').run();
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role, athlete_id, active) VALUES (99, 'inactive-athlete', 'x', '测试账号', 'ATL', 1, 0)").run();
  const current = [{ ...athletes[0], active: false }, athletes[1]];
  const batch = analyze({ 训练课次: [['系统运动员编号', '姓名', '日期', '时长分钟'], [1, '张某', '2025-09-11', 60]] }, { athletes: current });
  updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, athletes: current, allowedTeams: new Set(['A队']), corrections: [{ id: batch.athleteCandidates[0].id, matchedAthleteId: 1, confirmed: true }] });
  expect(() => commitDataImport({ batchId: batch.id, userId: USER_ID, creatorRole: 'TD', athletes: [athletes[1]], allowedTeams: new Set(['B队']), conflictPolicy: 'skip' })).toThrow();
  expect(db.prepare('SELECT active FROM athletes WHERE id = 1').get()).toEqual({ active: 0 });
  commitDataImport({ batchId: batch.id, userId: USER_ID, creatorRole: 'TD', athletes: current, allowedTeams: new Set(['A队']), conflictPolicy: 'skip' });
  expect(db.prepare('SELECT active FROM users WHERE id = 99').get()).toEqual({ active: 0 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'RESTORE_ATHLETE_FROM_IMPORT'").get()).toEqual({ count: 1 });
});

it('恢复后的业务写入失败时，档案恢复和审计同事务回滚', () => {
  db.prepare('UPDATE athletes SET active = 0 WHERE id = 1').run();
  const current = [{ ...athletes[0], active: false }];
  const batch = analyze({ 训练课次: [['系统运动员编号', '姓名', '日期', '时长分钟'], [1, '张某', '2025-09-12', 60]] }, { athletes: current });
  updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, athletes: current, allowedTeams: new Set(['A队']), corrections: [{ id: batch.athleteCandidates[0].id, matchedAthleteId: 1, confirmed: true }] });
  db.exec("CREATE TRIGGER reject_import_insert BEFORE INSERT ON training_sessions BEGIN SELECT RAISE(ABORT, '模拟写入失败'); END");
  try {
    expect(() => commitDataImport({ batchId: batch.id, userId: USER_ID, creatorRole: 'TD', athletes: current, allowedTeams: new Set(['A队']), conflictPolicy: 'skip' })).toThrow();
    expect(db.prepare('SELECT active FROM athletes WHERE id = 1').get()).toEqual({ active: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'RESTORE_ATHLETE_FROM_IMPORT'").get()).toEqual({ count: 0 });
  } finally {
    db.exec('DROP TRIGGER reject_import_insert');
  }
});

it('重传同一文件沿用已提交的人员关联，只让已停用人员重新确认', () => {
  const buffer = workbookBuffer({ 运动员信息: [['系统运动员编号', '姓名', '所属队伍'], [991, '张某', 'A队'], [992, '赵某', 'B队']] });
  const input = { buffer, filename: '历史人员映射.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes, allowedTeams: new Set(['A队', 'B队']) };
  const first = analyzeDataImport(input);
  updateDataImportAthleteCandidates({ batchId: first.id, userId: USER_ID, athletes, allowedTeams: input.allowedTeams, corrections: first.athleteCandidates.map(person => ({ id: person.id, matchedAthleteId: person.name === '张某' ? 1 : 2, confirmed: true })) });
  commit(first.id, 'skip');
  db.prepare('UPDATE athletes SET active = 0 WHERE id = 1').run();
  const current = [{ ...athletes[0], active: false }, athletes[1], athletes[2]];
  const next = analyzeDataImport({ ...input, athletes: current });
  expect(next.athleteCandidates.find(person => person.name === '赵某')).toMatchObject({ status: 'matched', matchedAthleteId: 2, confirmed: true });
  expect(next.athleteCandidates.find(person => person.name === '张某')).toMatchObject({ status: 'pending', confirmed: false });
  const revoked = analyzeDataImport({ ...input, athletes: [current[0], current[2]], reparse: true });
  expect(revoked.athleteCandidates.find(person => person.name === '赵某')).toMatchObject({ status: 'pending', matchedAthleteId: null, confirmed: false });
});

it('已关联档案的队伍不被导入文件或默认队伍覆盖，即使使用更新策略', () => {
  const originalTeam = db.prepare('SELECT team_id AS teamId, team FROM athletes WHERE id = 1').get();
  const batch = analyze({ 运动员信息: [['系统运动员编号', '姓名', '所属队伍', '最好成绩'], [1, '张某', 'B队', '新成绩']] });
  expect(batch.items[0].conflict?.fields.some(field => field.field === 'team')).toBe(false);
  const result = commit(batch.id, 'update');
  expect(result.updatedRecords).toBe(1);
  expect(db.prepare('SELECT team_id AS teamId, team FROM athletes WHERE id = 1').get()).toEqual(originalTeam);
  expect(batch.items[0].messages.join('；')).toContain('保留已有队伍');
});

it('已有运动员未填写文件队伍时不会套用唯一可选的其他队伍', () => {
  const batch = analyze({ 运动员信息: [['系统运动员编号', '姓名', '最好成绩'], [1, '张某', '成绩']] }, { allowedTeams: new Set(['B队']) });
  expect(batch.items[0].payload.team).toBe('A队');
});

describe('统一模板按业务归属整理', () => {
  it('新表名可导入，身体指标与体能成绩分开保存', () => {
    const batch = analyze({
      运动员基本资料: [['姓名', '所属队伍'], ['张某', 'A队']],
      身体测量: [['姓名', '测量日期', '身高cm', '臂展cm', '体脂率%'], ['张某', '2025-10-01', 180, 185, 21.9]],
      体能测试: [['姓名', '测试日期', 'VO2Max', '测试协议'], ['张某', '2025-10-01', 55, '实测协议']],
    });
    expect(batch.errorCount).toBe(0);
    expect(batch.items.some(item => item.metricCode === 'arm_span_cm')).toBe(true);
    expect(batch.items.some(item => item.metricCode === 'vo2max_ml_kg_min')).toBe(true);
    commit(batch.id, 'skip');
    expect(db.prepare('SELECT height_cm AS height, body_fat_pct AS fat FROM athlete_body_measurements').get()).toEqual({ height: 180, fat: 21.9 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM test_measurements WHERE metric_code = 'heightCm'").get()).toEqual({ count: 0 });
  });
  it('旧冠军模型的身体指标落到身体测量，与同日重复值合并', () => {
    const batch = analyze({
      身体测量: [['姓名', '测量日期', '身高cm'], ['张某', '2025-10-02', 180]],
      冠军模型测试: [['姓名', '测试日期', '身高cm', '体脂率%'], ['张某', '2025-10-02', 180, 20]],
    });
    expect(batch.errorCount).toBe(0);
    commit(batch.id, 'skip');
    expect(db.prepare('SELECT COUNT(*) AS count FROM athlete_body_measurements').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT height_cm AS height, body_fat_pct AS fat FROM athlete_body_measurements').get()).toEqual({ height: 180, fat: 20 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM test_measurements').get()).toEqual({ count: 0 });
  });
  it('旧表与新表的同日身体指标不一致时阻断，不按表格顺序取值', () => {
    const batch = analyze({
      身体测量: [['姓名', '测量日期', '身高cm'], ['张某', '2025-10-03', 180]],
      冠军模型测试: [['姓名', '测试日期', '身高cm'], ['张某', '2025-10-03', 181]],
    });
    expect(batch.errorCount).toBeGreaterThan(0);
    expect(batch.items.flatMap(item => item.messages).join('；')).toContain('冲突');
    expect(() => commit(batch.id, 'skip')).toThrow();
  });
  it('新统一模板没有冠军模型表，基本资料和身体测量职责分离', () => {
    const workbook = XLSX.read(readFileSync('public/templates/竞迹统一数据导入模板.xlsx'), { type: 'buffer' });
    expect(workbook.SheetNames).toContain('运动员基本资料');
    expect(workbook.SheetNames).toContain('体能测试');
    expect(workbook.SheetNames).not.toContain('冠军模型测试');
    expect(workbook.SheetNames).not.toContain('竞技水平评估');
    for (const [name, headers] of UNIFIED_IMPORT_HEADERS) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }) as unknown[][];
      expect(rows[2].map(value => templateHeaderKey(String(value)))).toEqual(importTemplateFields(name).map(field => field.key));
      expect(rows[2].map(value => templateHeaderKey(String(value))).sort()).toEqual(headers.filter(key => name !== '其他测试' || !['指标代码', '单位'].includes(key)).sort());
    }
  });
});

it('新模板导入后统一导出再导入不重复写入，协议、单位及字段不串列', async () => {
  const batch = analyze({
    运动员基本资料: [['系统运动员编号', '姓名', '所属队伍'], [1, '张某', 'A队']],
    身体测量: [['姓名', '测量日期', '身高cm', '臂展cm', '体脂率%'], ['张某', '2025-10-04', 180, 185, 20]],
    体能测试: [['姓名', '测试日期', 'VO2Max', '测试协议'], ['张某', '2025-10-04', 55, '协议A']],
    FMS测试: [['姓名', '测试日期', '深蹲', '跨栏步'], ['张某', '2025-10-04', 2, 3]],
    训练课次: [['姓名', '日期', '时长分钟'], ['张某', '2025-10-04', 60]],
    力量训练组次: [['姓名', '日期', '课次名称', '动作', '组序', '计划次数', '实际次数', '实际重量kg'], ['张某', '2025-10-04', '力量课', '深蹲', 1, 6, 5, 60]],
    竞技评估: [['姓名', '评估日期', '一般耐力评分', '评估协议'], ['张某', '2025-10-04', 80, '人工评分协议A']],
  });
  expect(batch.errorCount).toBe(0);
  commit(batch.id, 'skip');
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const exported = analyzeDataImport({ buffer, filename: '统一导出往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes, allowedTeams: new Set(['A队', 'B队']) });
  expect(exported.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  expect(exported.items.find(item => item.metricCode === 'vo2max_ml_kg_min')?.payload.protocol).toBe('协议A');
  expect(exported.items.find(item => item.itemType === 'training_set')).toMatchObject({ actualReps: 5, actualWeightKg: 60, targetReps: 6 });
  expect(commit(exported.id, 'skip').createdRecords).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS count FROM athlete_body_measurements').get()).toEqual({ count: 1 });
});

it('人工评分缺少明确协议时阻断，补充协议后才可导入', () => {
  const batch = analyze({ 竞技评估: [['姓名', '评估日期', '核心力量评分'], ['张某', '2025-10-05', 75]] });
  expect(batch.errorCount).toBe(1);
  expect(batch.items[0].messages.join('；')).toContain('评估协议');
  expect(() => commit(batch.id, 'skip')).toThrow(/校验/);
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { protocol: '评分协议B' } }] });
  expect(fixed.errorCount).toBe(0);
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
});

it('不对称指数未注明测试方法时必须明确补充协议', () => {
  const batch = analyze({ 体能测试: [['姓名', '测试日期', '不对称指数%'], ['张某', '2025-10-06', 10]] });
  expect(batch.errorCount).toBe(1);
  expect(batch.items[0].messages.join('；')).toContain('测试协议');
});

it('通用测试旧代码和新身体表指向同一事实，单位不一致不能静默换算', () => {
  const batch = analyze({
    身体测量: [['姓名', '测量日期', '身高cm'], ['张某', '2025-10-07', 180]],
    其他测试: [['姓名', '测试日期', '指标代码', '数值', '单位'], ['张某', '2025-10-07', 'heightCm', 180, 'cm']],
  });
  expect(batch.errorCount).toBe(0);
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  const invalid = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值', '单位'], ['张某', '2025-10-08', 'heightCm', 1.8, 'm']] });
  expect(invalid.errorCount).toBe(1);
  expect(invalid.items[0].messages.join('；')).toContain('单位');
});

it('同课次不同指标的协议冲突阻断，缺失协议可从同课次补齐', () => {
  const headers = ['姓名', '测试日期', 'VO2Max', '不对称指数%', '测试协议'];
  const conflict = analyze({ 体能测试: [headers, ['张某', '2025-10-09', 55, null, 'A'], ['张某', '2025-10-09', null, 10, 'B']] });
  expect(conflict.errorCount).toBe(2);
  expect(() => commit(conflict.id, 'skip')).toThrow();
  const valid = analyze({ 体能测试: [headers, ['张某', '2025-10-09', 55], ['张某', '2025-10-09', null, 10, 'B']] });
  expect(valid.errorCount).toBe(0);
  commit(valid.id, 'skip');
  expect(db.prepare("SELECT protocol FROM test_sessions WHERE test_date = '2025-10-09'").get()).toEqual({ protocol: 'B' });
  const mismatch = analyze({ 体能测试: [headers, ['张某', '2025-10-09', 56, null, 'C']] });
  expect(mismatch.errorCount).toBe(0);
  expect(importReviewGroups(mismatch.items)).toEqual([]);
  commit(mismatch.id, 'skip');
  expect(db.prepare("SELECT protocol FROM test_sessions WHERE test_date = '2025-10-09'").get()).toEqual({ protocol: 'C' });
});

it('已有测试课次的空协议可以补充，身体指标的侧别原样保留', () => {
  const headers = ['姓名', '测试日期', '指标代码', '数值', '单位', '侧别', '测试类型', '协议'];
  const first = analyze({ 其他测试: [headers, ['张某', '2025-10-10', 'height_cm', 180, 'cm', 'left', '侧别测试']] });
  expect(first.items[0]).toMatchObject({ itemType: 'test_measurement', side: 'left', testType: '侧别测试' });
  expect(first.errorCount).toBe(0);
  commit(first.id, 'skip');
  const second = analyze({ 其他测试: [headers, ['张某', '2025-10-10', 'arm_span_cm', 185, 'cm', 'right', '侧别测试', '测量协议']] });
  expect(second.errorCount).toBe(0);
  expect(second.items[0]).toMatchObject({ itemType: 'test_measurement', side: 'right', testType: '侧别测试' });
  commit(second.id, 'skip');
  expect(db.prepare("SELECT protocol FROM test_sessions WHERE test_date = '2025-10-10'").get()).toEqual({ protocol: '测量协议' });
});

it('上传解析即关联唯一管理队伍内的已有运动员，新人员保持新建候选', () => {
  const scoped = [...athletes, { id: 4, name: '张某', project: PROJECT, team: 'B队', gender: '男' }];
  const batch = analyze({ 运动员信息: [['姓名'], ['张某'], ['首次队员']] }, { athletes: scoped, allowedTeams: new Set(['A队']) });
  expect(batch.athleteCandidates.find(person => person.name === '张某')).toMatchObject({ status: 'matched', matchedAthleteId: 1, confirmed: true });
  expect(batch.athleteCandidates.find(person => person.name === '首次队员')).toMatchObject({ status: 'pending', matchedAthleteId: null });
});

it('表内身体冲突保留两行和双方数值，可排除任一行后保存并提交', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-10-11', 83], ['张某', '2025-10-11', 85]] });
  expect(batch.items).toHaveLength(2);
  expect(batch.errorCount).toBe(2);
  expect(batch.items[0].messages.join('；')).toContain('83kg');
  expect(batch.items[0].messages.join('；')).toContain('85kg');
  expect(() => commit(batch.id, 'skip')).toThrow();
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[1].id, resolution: 'skip' }] });
  expect(fixed.errorCount).toBe(0);
  expect(fixed.items[0].messages.join('；')).not.toContain('不同数值');
  const restored = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[1].id, resolution: '' }] });
  expect(restored.errorCount).toBe(2);
  expect(() => commit(batch.id, 'skip')).toThrow();
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[1].id, resolution: 'skip' }] });
  commit(batch.id, 'skip');
  expect(db.prepare("SELECT weight_kg AS weight FROM athlete_body_measurements WHERE measurement_date = '2025-10-11'").get()).toEqual({ weight: 83 });
});

it('修改冲突日期可保留两次身体测量，修改数值也会重新校验同组', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-10-12', 83], ['张某', '2025-10-12', 85]] });
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[1].id, eventDate: '2025-10-13' }] });
  expect(fixed.errorCount).toBe(0);
  expect(commit(batch.id, 'skip').createdRecords).toBe(2);
  const next = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-10-14', 80], ['张某', '2025-10-14', 81]] });
  expect(updateDataImportItems({ batchId: next.id, userId: USER_ID, athletes, corrections: [{ id: next.items[1].id, payload: { weightKg: 80 } }] }).items.every(item => !item.messages.join('；').includes('存在不同数值'))).toBe(true);
});

it('身体测量逐字段合并保留互补字段和原始记录，刷新可重新编辑', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '体脂率%', '骨骼肌kg'], ['张某', '2025-11-01', 85.94, 9.6], ['张某', '2025-11-01', 85.9, 33, 38]] });
  const review = { action: 'merge', memberIds: batch.items.map(item => item.id), values: { weightKg: 85.94, bodyFatPct: 9.6 } };
  const merged = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: review } }] });
  expect(merged.errorCount).toBe(0);
  expect(merged.items[0].payload).toMatchObject({ weightKg: 85.94, bodyFatPct: 9.6, skeletalMuscleKg: 38, valueReviewDecision: { confirmed: true } });
  expect(merged.items[1]).toMatchObject({ resolution: 'skip', payload: { weightKg: 85.9, bodyFatPct: 33 } });
  const reopened = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'reopen' } } }] });
  expect(reopened.errorCount).toBe(2);
  expect(reopened.items[0].payload.skeletalMuscleKg).toBeUndefined();
  expect(reopened.items[1].resolution).toBe('');
});

it('身体测量合并不能漏选冲突字段或引用其他日期记录', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-11-02', 80], ['张某', '2025-11-02', 81], ['张某', '2025-11-03', 82]] });
  const merge = (memberIds: number[], values: Record<string, unknown>) => updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds, values } } }] });
  expect(() => merge([batch.items[0].id, batch.items[1].id], {})).toThrow(/选择/);
  expect(() => merge(batch.items.map(item => item.id), { weightKg: 80 })).toThrow(/同一/);
  expect(() => merge([batch.items[0].id, batch.items[1].id], { weightKg: 'abc' })).toThrow();
});

it('三条身体测量保留真实0、手填选择与互补值，合并只写一次且可重复提交', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '体脂率%', '骨骼肌kg'], ['张某', '2025-11-04', 80, 0], ['张某', '2025-11-04', 81, null, 30], ['张某', '2025-11-04', 82, 0]] });
  expect(batch.items).toHaveLength(3);
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values: { weightKg: 81.5 } } } }] });
  expect(fixed.errorCount).toBe(0);
  expect(fixed.items[0].payload).toMatchObject({ weightKg: 81.5, bodyFatPct: 0, skeletalMuscleKg: 30 });
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  expect(db.prepare('SELECT COUNT(*) AS count FROM athlete_body_measurements').get()).toEqual({ count: 1 });
});

it('表内合并不自动覆盖数据库，更新策略需明确保存且不会改写来源', () => {
  const original = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-11-05', 79]] });
  commit(original.id, 'skip');
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-11-05', 80], ['张某', '2025-11-05', 81]] });
  const fixed = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values: { weightKg: 80 } } } }] });
  expect(fixed.items[0].conflict?.fields.find(field => field.field === 'weightKg')?.oldValue).toBe('79');
  expect(() => updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { weightKg: 90 } }] })).toThrow(/重新编辑/);
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, resolution: 'update' }] });
  commit(batch.id, 'skip');
  expect(db.prepare("SELECT weight_kg AS weight FROM athlete_body_measurements WHERE measurement_date = '2025-11-05'").get()).toEqual({ weight: 80 });
});


it('相同互补身体测量直接自动合并，无需确认且不丢字段', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '骨骼肌kg'], ['张某', '2025-11-06', 80], ['张某', '2025-11-06', null, 30]] });
  expect(batch.errorCount).toBe(0);
  expect(batch.items.some(item => item.payload.valueAutoMergeSources)).toBe(true);
  expect(importReviewGroups(batch.items)).toEqual([]);
  commit(batch.id, 'skip');
  expect(db.prepare("SELECT weight_kg AS weight, skeletal_muscle_kg AS muscle FROM athlete_body_measurements WHERE measurement_date = '2025-11-06'").get()).toEqual({ weight: 80, muscle: 30 });
});

it('未完成的字段选择可暂存，不解除冲突，非法草稿字段拒绝且不改正式数据', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '体脂率%'], ['张某', '2025-11-07', 80, 10], ['张某', '2025-11-07', 81, 20]] });
  const review = { action: 'draft', choices: { weightKg: '80' }, manual: {} };
  const saved = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: review } }] });
  expect(saved.items[0].payload.valueReviewDraft).toEqual({ choices: { weightKg: '80' }, manual: {} });
  expect(saved.errorCount).toBe(2);
  expect(() => commit(batch.id, 'skip')).toThrow();
  expect(() => updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { ...review, choices: { unknown: '2' } } } }] })).toThrow(/字段/);
  expect(db.prepare('SELECT COUNT(*) AS count FROM athlete_body_measurements').get()).toEqual({ count: 0 });
});

it('臂展复用统一值审查，保留两条来源并可选最终值入库', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '臂展cm'], ['张某', '2025-11-08', 185], ['张某', '2025-11-08', 186]] });
  expect(batch.items).toHaveLength(2);
  expect(batch.items.every(item => item.payload.valueImportConflicts)).toBe(true);
  const merged = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values: { 'metric:arm_span_cm:center': 186 } } } }] });
  expect(merged.errorCount).toBe(0);
  commit(batch.id, 'skip');
  expect(db.prepare("SELECT value_num AS value FROM test_measurements WHERE metric_code = 'arm_span_cm'").get()).toEqual({ value: 186 });
});

it('同测试课次的协议冲突也复用统一选择，保留所有不同指标及侧别', () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '侧别', '协议'], ['张某', '2025-11-09', '统一课次', 'grip', 30, 'kg', 'left', 'A'], ['张某', '2025-11-09', '统一课次', 'grip', 35, 'kg', 'right', 'B']] });
  expect(batch.errorCount).toBe(2);
  const merged = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values: { protocol: 'A' } } } }] });
  expect(merged.errorCount).toBe(0);
  expect(commit(batch.id, 'skip').createdRecords).toBe(2);
  expect(db.prepare('SELECT side, value_num AS value FROM test_measurements ORDER BY side').all()).toEqual([{ side: 'left', value: 30 }, { side: 'right', value: 35 }]);
  expect(db.prepare("SELECT protocol FROM test_sessions WHERE test_date = '2025-11-09'").get()).toEqual({ protocol: 'A' });
});

it.each([
  ['每日恢复', ['姓名', '日期', '睡眠小时'], ['张某', '2025-11-10', 7], ['张某', '2025-11-10', 8], { sleepHours: 8 }, 'SELECT sleep_hours AS value FROM daily_wellness', 8],
  ['训练课次', ['姓名', '日期', '时长分钟', '训练内容'], ['张某', '2025-11-10', 30, '内容A'], ['张某', '2025-11-10', 60, '内容B'], { durationMin: 60, content: '内容B' }, 'SELECT duration_min AS value FROM training_sessions', 60],
  ['竞技评估', ['姓名', '评估日期', '总分'], ['张某', '2025-11-10', 70], ['张某', '2025-11-10', 80], { overallScore: 80 }, 'SELECT overall_score AS value FROM competitive_state_assessments', 80],
] as const)('%s 的冲突通过相同命令选择最终字段', (sheet, header, first, second, values, sql, value) => {
  const batch = analyze({ [sheet]: [[...header], [...first], [...second]] });
  expect(batch.errorCount).toBe(2);
  const merged = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values } } }] });
  expect(merged.errorCount).toBe(0);
  commit(batch.id, 'skip');
  expect(db.prepare(sql).get()).toEqual({ value });
});

it('同一审查命令可逐字段选择数据库已有值和导入值，并检查并发变化', () => {
  const first = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '体脂率%'], ['张某', '2025-11-11', 80, 20]] });
  commit(first.id, 'skip');
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '体脂率%'], ['张某', '2025-11-11', 81, 21]] });
  const merged = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: [batch.items[0].id], includeDatabase: true, values: { weightKg: 80, bodyFatPct: 21 } } } }] });
  expect(merged.errorCount).toBe(0);
  expect(merged.items[0].payload.valueReviewDecision).toMatchObject({ finalValues: { weightKg: 80, bodyFatPct: 21 } });
  db.prepare("UPDATE athlete_body_measurements SET weight_kg = 82 WHERE measurement_date = '2025-11-11'").run();
  expect(() => commit(batch.id, 'skip')).toThrow(/修改/);
  expect(db.prepare("SELECT body_fat_pct AS value FROM athlete_body_measurements WHERE measurement_date = '2025-11-11'").get()).toEqual({ value: 20 });
});

it('力量组次、伤病和档案文本采用同一审查命令，业务唯一键不混用', () => {
  const cases: Array<{ sheet: string; rows: unknown[][]; values: Record<string, string | number> }> = [
    { sheet: '力量训练组次', rows: [['姓名', '日期', '动作', '组序', '实际次数', '实际重量kg', 'RPE', '备注'], ['张某', '2025-11-12', '深蹲', 1, 5, 60, 5, 'A'], ['张某', '2025-11-12', '深蹲', 1, 6, 65, 6, 'B']], values: { actualReps: 6, actualWeightKg: 65, rpe: 6, note: 'B' } },
    { sheet: '伤病记录', rows: [['姓名', '发生日期', '伤病名称', '部位', '疼痛评分'], ['张某', '2025-11-12', '肩部不适', '肩', 2], ['张某', '2025-11-12', '肩部不适', '肩', 3]], values: { painScore: 3 } },
    { sheet: '运动员基本资料', rows: [['姓名', '最好成绩'], ['张某', '成绩A'], ['张某', '成绩B']], values: { bestResult: '成绩B' } },
  ];
  for (const entry of cases) {
    const batch = analyze({ [entry.sheet]: entry.rows });
    expect(batch.items).toHaveLength(2);
    const merged = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values: entry.values } } }] });
    expect(merged.errorCount).toBe(0);
    expect(merged.items[0].payload.valueReviewDecision).toMatchObject({ finalValues: entry.values });
    commit(batch.id, 'skip');
  }
  expect(db.prepare('SELECT actual_reps AS reps, actual_weight_kg AS weight, rpe, note FROM strength_result_sets').get()).toEqual({ reps: 6, weight: 65, rpe: 6, note: 'B' });
  expect(db.prepare('SELECT pain_score AS pain FROM injury_records').get()).toEqual({ pain: 3 });
  expect(db.prepare('SELECT best_result AS best FROM athlete_profiles WHERE athlete_id = 1').get()).toEqual({ best: '成绩B' });
});

it('不同指标的协议审查可恢复所有来源，不会只恢复一个测量值', () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '协议'], ['张某', '2025-11-13', '同课次', 'metric_a', 10, 'kg', 'A'], ['张某', '2025-11-13', '同课次', 'metric_b', 20, 'kg', 'B']] });
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values: { protocol: 'A' } } } }] });
  const reopened = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'reopen' } } }] });
  expect(reopened.errorCount).toBe(2);
  expect(reopened.items.map(item => [item.metricCode, item.valueNum, item.payload.protocol])).toEqual([['metric_a', 10, 'A'], ['metric_b', 20, 'B']]);
});

it('单位、计划次数和强度百分比在保存、重新读取及入库后都保留选择结果', () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值', '单位', '备注'], ['张某', '2025-11-14', 'custom_unit', 10, 'g', '来源A'], ['张某', '2025-11-14', 'custom_unit', 20, 'g', '来源B']] });
  const saved = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), values: { 'metric:custom_unit:center': 20, 'unit:custom_unit:center': 'g', 'note:custom_unit:center': '来源B' } } } }] });
  expect(saved.items[0]).toMatchObject({ valueNum: 20, unit: 'g', payload: { note: '来源B' } });
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT value_num AS value, unit, note FROM test_measurements').get()).toEqual({ value: 20, unit: 'g', note: '来源B' });
  const strength = analyze({ 力量训练组次: [['姓名', '日期', '动作', '组序', '计划次数', '实际次数', '实际重量kg', '强度百分比'], ['张某', '2025-11-14', '深蹲', 1, 5, 5, 60, 50], ['张某', '2025-11-14', '深蹲', 1, 6, 5, 60, 60]] });
  const result = updateDataImportItems({ batchId: strength.id, userId: USER_ID, athletes, corrections: [{ id: strength.items[0].id, payload: { valueReview: { action: 'merge', memberIds: strength.items.map(item => item.id), values: { targetReps: 6, intensityPercent: 60 } } } }] });
  expect(result.items[0]).toMatchObject({ targetReps: 6, intensityPercent: 60 });
  commit(strength.id, 'skip');
  expect(db.prepare('SELECT target_reps AS reps, intensity_percent AS intensity FROM strength_result_sets').get()).toEqual({ reps: 6, intensity: 60 });
});

it('测试备注可补空、通过统一审查覆盖，且导出再导入保留备注', async () => {
  const headers = ['姓名', '测试日期', '指标代码', '数值', '单位', '备注'];
  const first = analyze({ 其他测试: [headers, ['张某', '2025-11-15', 'custom_note', 20, 'kg', 'A']] });
  commit(first.id, 'skip');
  const batch = analyze({ 其他测试: [headers, ['张某', '2025-11-15', 'custom_note', 20, 'kg', 'B']] });
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: [batch.items[0].id], includeDatabase: true, values: { 'note:custom_note:center': 'B' } } } }] });
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT note FROM test_measurements').get()).toEqual({ note: 'B' });
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const exported = analyzeDataImport({ buffer, filename: '备注往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes, allowedTeams: new Set(['A队']) });
  expect(exported.items.find(item => item.metricCode === 'custom_note')?.payload.note).toBe('B');
});

it('明确选择数据库课次的新协议后保留所有指标，并记录审计', () => {
  const headers = ['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '协议'];
  const first = analyze({ 其他测试: [headers, ['张某', '2025-11-16', '协议审查课次', 'a', 10, 'kg', 'A'], ['张某', '2025-11-16', '协议审查课次', 'b', 20, 'kg', 'A']] });
  commit(first.id, 'skip');
  const batch = analyze({ 其他测试: [headers, ['张某', '2025-11-16', '协议审查课次', 'a', 10, 'kg', 'B'], ['张某', '2025-11-16', '协议审查课次', 'b', 20, 'kg', 'B']] });
  const saved = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { valueReview: { action: 'merge', memberIds: batch.items.map(item => item.id), includeDatabase: true, values: { protocol: 'B' } } } }] });
  expect(saved.errorCount).toBe(0);
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT protocol FROM test_sessions').get()).toEqual({ protocol: 'B' });
  expect(db.prepare('SELECT COUNT(*) AS count FROM test_measurements').get()).toEqual({ count: 2 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'UPDATE_IMPORT_TEST_PROTOCOL'").get()).toEqual({ count: 1 });
});

it('测试备注的新增列初始化可重复执行，保留既有测量和备注', () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值', '单位', '备注'], ['张某', '2025-11-17', 'migration_note', 20, 'kg', '保留备注']] });
  commit(batch.id, 'skip');
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  expect(db.prepare("SELECT value_num AS value, note FROM test_measurements WHERE metric_code = 'migration_note'").get()).toEqual({ value: 20, note: '保留备注' });
  const columns = db.prepare('PRAGMA table_info(test_measurements)').all() as Array<{ name: string }>;
  expect(columns.filter(column => column.name === 'note')).toHaveLength(1);
});


it('当前草稿的相同互补行刷新后直接整理，不再要求确认', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '骨骼肌kg'], ['张某', '2025-12-01', 80], ['张某', '2025-12-01', null, 30]] });
  for (const item of batch.items) {
    const payload = { ...item.payload };
    delete payload.valueAutoMergeSources;
    delete payload.valueAutoMerged;
    if (item.sourceAddress === batch.items[0].sourceAddress) delete payload.skeletalMuscleKg;
    payload.valueReviewPending = true;
    db.prepare("UPDATE data_import_items SET payload_json = ?, quality = 'error', resolution = '', messages_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), JSON.stringify(['错误：存在重复业务数据，请在集中审查卡片确认最终值或填写真实日期后分别保留']), item.id);
  }
  const refreshed = getDataImportBatch(batch.id, USER_ID);
  expect(refreshed.errorCount).toBe(0);
  expect(importReviewGroups(refreshed.items)).toEqual([]);
  expect(refreshed.items.filter(item => item.resolution !== 'skip')).toHaveLength(1);
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  expect(db.prepare("SELECT weight_kg AS weight, skeletal_muscle_kg AS muscle FROM athlete_body_measurements").get()).toEqual({ weight: 80, muscle: 30 });
});

it.each([
  ['每日恢复', ['姓名', '日期', '睡眠小时'], ['张某', '2025-12-02', 7], 'SELECT COUNT(*) AS count FROM daily_wellness'],
  ['其他测试', ['姓名', '测试日期', '指标代码', '数值', '单位'], ['张某', '2025-12-02', 'grip', 30, 'kg'], 'SELECT COUNT(*) AS count FROM test_measurements'],
] as const)('%s 相同值自动合并且只写一次', (sheet, headers, values, sql) => {
  const batch = analyze({ [sheet]: [[...headers], [...values], [...values]] });
  expect(batch.errorCount).toBe(0);
  expect(batch.items.filter(item => item.resolution !== 'skip')).toHaveLength(1);
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  expect(db.prepare(sql).get()).toEqual({ count: 1 });
});


it('选齐自动保存后可在同一事务直接改选，入库采用新的选择', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '体脂率%'], ['张某', '2025-12-03', 80, 10], ['张某', '2025-12-03', 81, 20]] });
  const id = batch.items[0].id;
  const memberIds = batch.items.map(item => item.id);
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, reviewTargetId: id, corrections: [{ id, payload: { valueReview: { action: 'merge', memberIds, values: { weightKg: 80, bodyFatPct: 20 } } } }] });
  const saved = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, reviewTargetId: id, corrections: [
    { id, payload: { valueReview: { action: 'reopen' } } },
    { id, payload: { valueReview: { action: 'merge', memberIds, values: { weightKg: 81, bodyFatPct: 10 } } } },
  ] });
  expect(saved.errorCount).toBe(0);
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT weight_kg AS weight, body_fat_pct AS fat FROM athlete_body_measurements').get()).toEqual({ weight: 81, fat: 10 });
});


it('千行批次单组选择只校验、更新并返回本组，查询数量不随整批行数增长', () => {
  const others = Array.from({ length: 1000 }, (_, index) => ['张某', new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), 70]);
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-12-04', 80], ['张某', '2025-12-04', 81], ...others] });
  const members = batch.items.filter(item => item.eventDate === '2025-12-04');
  const id = members[0].id;
  db.exec('CREATE TEMP TABLE review_updates (id INTEGER); CREATE TEMP TRIGGER track_review_updates AFTER UPDATE ON data_import_items BEGIN INSERT INTO review_updates VALUES (NEW.id); END;');
  const prepare = vi.spyOn(db, 'prepare');
  try {
    const started = performance.now();
    const patch = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, reviewTargetId: id, corrections: [{ id, payload: { valueReview: { action: 'merge', memberIds: members.map(item => item.id), values: { weightKg: 81 } } } }] });
    const elapsed = performance.now() - started;
    const queries = prepare.mock.calls.length;
    expect(patch.items.map(item => item.id).sort()).toEqual(members.map(item => item.id).sort());
    expect(patch.itemCount).toBe(1002);
    expect(patch.errorCount).toBe(0);
    expect(queries).toBeLessThan(40);
    expect(db.prepare('SELECT id FROM review_updates ORDER BY id').all()).toEqual(members.map(item => ({ id: item.id })).sort((a, b) => a.id - b.id));
    console.info(`单组保存：批次1002条，返回${patch.items.length}条，SQL预编译${queries}次，内存数据库耗时${elapsed.toFixed(1)}ms`);
  } finally {
    prepare.mockRestore();
    db.exec('DROP TRIGGER track_review_updates; DROP TABLE review_updates;');
  }
});

it('单组保存拒绝跨组成员、其他账号、权限外人员和夹带字段', () => {
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-12-05', 80], ['张某', '2025-12-05', 81], ['赵某', '2025-12-05', 70]] });
  const members = batch.items.filter(item => item.athleteId === 1);
  const other = batch.items.find(item => item.athleteId === 2)!;
  const id = members[0].id;
  const input = { batchId: batch.id, userId: USER_ID, athletes, reviewTargetId: id, corrections: [{ id, payload: { valueReview: { action: 'merge', memberIds: members.map(item => item.id), values: { weightKg: 81 } } } }] };
  expect(() => updateDataImportItems({ ...input, corrections: [{ id, payload: { valueReview: { action: 'merge', memberIds: [id, other.id], values: { weightKg: 81 } } } }] })).toThrow(/同一业务记录/);
  expect(() => updateDataImportItems({ ...input, userId: 999 })).toThrow(/无权/);
  expect(() => updateDataImportItems({ ...input, athletes: [] })).toThrow(/权限/);
  expect(() => updateDataImportItems({ ...input, corrections: [{ ...input.corrections[0], eventDate: '2025-12-06' }] })).toThrow(/单组审查/);
  expect(db.prepare('SELECT COUNT(*) AS count FROM athlete_body_measurements').get()).toEqual({ count: 0 });
});


it('全选记录2一次保存所有待审查组，提交正确采用各组第二条记录', () => {
  const rows = Array.from({ length: 10 }, (_, index) => [`2025-12-${String(index + 10).padStart(2, '0')}`]).flatMap(([date], index) => [['张某', date, 70 + index], ['张某', date, 80 + index]]);
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ...rows] });
  const groups = importReviewGroups(batch.items);
  const updates = selectImportReviewRecord(groups, 1);
  expect(updates).toHaveLength(10);
  const saved = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: updates });
  expect(saved.errorCount).toBe(0);
  expect(commit(batch.id, 'skip').createdRecords).toBe(10);
  expect(db.prepare('SELECT weight_kg AS weight FROM athlete_body_measurements ORDER BY measurement_date').all()).toEqual(Array.from({ length: 10 }, (_, index) => ({ weight: 80 + index })));
});

it('只修改真实差异字段，不顺带改写浮点尾差相同的其他字段', () => {
  db.prepare("INSERT INTO athlete_body_measurements (athlete_id, measurement_date, weight_kg, note) VALUES (1, '2026-08-12', ?, '旧备注')").run(61.300000000000004);
  const batch = analyze({ 身体测量: [['姓名', '测量日期', '体重kg', '备注'], ['张某', '2026-08-12', 61.3, '新备注']] });
  expect(batch.items[0].conflict?.fields.filter(field => field.overwrites).map(field => field.field)).toEqual(['note']);
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: selectImportReviewRecord(importReviewGroups(batch.items), 0) });
  expect(commit(batch.id, 'update').updatedRecords).toBe(1);
  expect(db.prepare('SELECT weight_kg, note FROM athlete_body_measurements WHERE athlete_id = 1').get()).toEqual({ weight_kg: 61.300000000000004, note: '新备注' });
});

it('65项测试的浮点尾差不改写数据库，真实差异按最新导入更新', async () => {
  db.prepare("INSERT OR IGNORE INTO metric_definitions (code, label, domain, unit, direction, frequency) VALUES ('weight_kg', '体重', 'custom', 'kg', 'neutral', 'phase')").run();
  const session = db.prepare("INSERT INTO test_sessions (athlete_id, test_date, test_type) VALUES (1, '2026-08-13', '专业综合评估')").run();
  db.prepare('INSERT INTO test_measurements (test_session_id, metric_code, value_num, unit) VALUES (?, ?, ?, ?)').run(session.lastInsertRowid, 'weight_kg', 61.300000000000004, 'kg');
  const rows = [['张某', '2026-08-13', '专业综合评估', 'weight_kg', 61.3, 'kg'], ...Array.from({ length: 64 }, (_, index) => ['张某', '2026-08-13', '专业综合评估', `custom_${index}`, index + 1, '分'])];
  for (let index = 0; index < 64; index += 1) db.prepare("INSERT OR IGNORE INTO metric_definitions (code,label,domain,unit,direction,frequency) VALUES (?,?,'custom','分','neutral','phase')").run(`custom_${index}`, `虚构测试${index}`);
  const seed = analyze({ 其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位'], ...rows] });
  const weight = seed.items.find(item => item.metricCode === 'weight_kg')!;
  expect(weight.conflict?.identical).toBe(true);
  expect(importReviewGroups(seed.items)).toEqual([]);
  expect(commit(seed.id, 'update').updatedRecords).toBe(0);
  expect(db.prepare('SELECT value_num FROM test_measurements WHERE metric_code = ?').get('weight_kg')).toEqual({ value_num: 61.300000000000004 });
  const snapshot = () => JSON.stringify(['test_sessions', 'test_measurements', 'metric_definitions'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
  const before = snapshot();
  const repeat = analyze({ 其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位'], ...rows] });
  expect(importReviewGroups(repeat.items)).toEqual([]);
  expect(commit(repeat.id, 'update').updatedRecords).toBe(0);
  expect(snapshot()).toBe(before);
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const roundtrip = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '浮点尾差往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  const tests = roundtrip.items.filter(item => item.itemType === 'test_measurement');
  expect(tests).toHaveLength(65);
  expect(tests.every(item => item.conflict?.identical)).toBe(true);
  expect(importReviewGroups(tests)).toEqual([]);
  expect(commit(roundtrip.id, 'update').updatedRecords).toBe(0);
  expect(snapshot()).toBe(before);
  const changed = analyze({ 其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位'], ['张某', '2026-08-13', '专业综合评估', 'weight_kg', 61.4, 'kg']] });
  expect(changed.items.find(item => item.metricCode === 'weight_kg')?.conflict?.fields.some(field => field.overwrites)).toBe(true);
  expect(importReviewGroups(changed.items)).toEqual([]);
});

it('不同测试类型的同日同指标导出往返不串课次、不丢时长、不制造冲突', async () => {
  const batch = analyze({ 其他测试: [
    ['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '协议', '测试时长分钟'],
    ['张某', '2025-12-22', '实验室测试A', 'vo2max_ml_kg_min', 50, 'ml/kg/min', '协议A', 12],
    ['张某', '2025-12-22', '实验室测试B', 'vo2max_ml_kg_min', 55, 'ml/kg/min', '协议B', 15],
    ['张某', '2025-12-22', '体能测试', 'vo2max_ml_kg_min', 60, 'ml/kg/min', '协议C', 20],
  ] });
  expect(batch.errorCount).toBe(0);
  commit(batch.id, 'skip');
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const exported = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '多课次往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  expect(exported.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  expect(exported.items.filter(item => item.itemType === 'test_measurement').map(item => [item.testType, item.valueNum, item.payload.durationMin]).sort()).toEqual([
    ['实验室测试A', 50, 12], ['实验室测试B', 55, 15], ['体能测试', 60, 20],
  ].sort());
  expect(commit(exported.id, 'skip').createdRecords).toBe(0);
});

it('历史测试表中的身体指标及自定义FMS协议导出后保留原归属，不制造身体测量冲突', async () => {
  const body = analyze({ 身体测量: [['姓名', '测量日期', '体重kg'], ['张某', '2025-12-23', 80]] });
  commit(body.id, 'skip');
  for (const [type, code, value, unit, protocol] of [
    ['历史体测', 'weight_kg', 81, 'kg', '历史测量协议'],
    ['FMS测试', 'fms_deep_squat', 2, '分', '历史FMS协议'],
    ['其他臂展测试', 'arm_span_cm', 185, 'cm', '臂展协议'],
    ['历史身高测试', 'heightCm', 180, 'cm', '旧代码协议'],
  ] as const) {
    const session = db.prepare('INSERT INTO test_sessions (athlete_id, test_date, test_type, protocol) VALUES (1, ?, ?, ?)').run('2025-12-23', type, protocol);
    db.prepare('INSERT INTO test_measurements (test_session_id, metric_code, value_num, unit) VALUES (?, ?, ?, ?)').run(session.lastInsertRowid, code, value, unit);
  }
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const exported = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '历史身体指标往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  expect(exported.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  expect(exported.items.filter(item => item.itemType === 'test_measurement').map(item => item.testType).sort()).toEqual(['历史体测', 'FMS测试', '其他臂展测试', '历史身高测试'].sort());
  expect(commit(exported.id, 'skip').createdRecords).toBe(0);
});

it('同日同名力量课完整往返保留课次、组次字段与未完成状态', async () => {
  for (const order of [1, 2]) {
    const session = db.prepare("INSERT INTO training_sessions (athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content, duration_min) VALUES (1, '2025-12-26', ?, '力量训练', '体能训练', 'AN', '力量课', 60)").run(order);
    db.prepare(`INSERT INTO strength_result_sets (training_session_id, exercise_name, exercise_code, set_index, target_reps, actual_reps, actual_weight_kg, planned_weight_kg, training_category, body_position, training_environment, duration_min, distance_km, intensity_percent, intensity_zone, rpe, completed, note)
      VALUES (?, '深蹲', 'squat', 1, 6, 0, ?, ?, '基础力量', '下肢', '陆上', 0, 0, 75, 'AN', 0, 0, '未完成且零值保留')`).run(session.lastInsertRowid, 80 + order, 90 + order);
  }
  const expected = db.prepare(`SELECT ts.session_order, srs.exercise_code, srs.actual_reps, srs.actual_weight_kg, srs.planned_weight_kg, srs.training_environment, srs.duration_min, srs.distance_km, srs.intensity_zone, srs.completed, srs.rpe, srs.note FROM strength_result_sets srs JOIN training_sessions ts ON ts.id = srs.training_session_id ORDER BY ts.session_order`).all();
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parse = () => analyzeDataImport({ buffer, filename: '完整力量往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  const preview = parse();
  expect(preview.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  expect(commit(preview.id, 'skip').createdRecords).toBe(0);
  db.exec("DELETE FROM strength_result_sets; DELETE FROM training_sessions;");
  const restored = parse();
  expect(commit(restored.id, 'skip').createdRecords).toBe(4);
  expect(db.prepare(`SELECT ts.session_order, srs.exercise_code, srs.actual_reps, srs.actual_weight_kg, srs.planned_weight_kg, srs.training_environment, srs.duration_min, srs.distance_km, srs.intensity_zone, srs.completed, srs.rpe, srs.note FROM strength_result_sets srs JOIN training_sessions ts ON ts.id = srs.training_session_id ORDER BY ts.session_order`).all()).toEqual(expected);
});

it('旧模板存在同名力量课歧义时阻断，可选择课次序号后保存', () => {
  for (const order of [1, 2]) db.prepare("INSERT INTO training_sessions (athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content) VALUES (1, '2025-12-27', ?, '力量训练', '体能训练', 'AN', '力量课')").run(order);
  const batch = analyze({ 力量训练组次: [['姓名', '日期', '课次名称', '动作', '组序', '实际次数', '实际重量kg'], ['张某', '2025-12-27', '力量课', '深蹲', 1, 5, 80]] });
  expect(batch.errorCount).toBe(1);
  expect(batch.items[0].payload.sessionChoices).toHaveLength(2);
  expect(() => commit(batch.id, 'skip')).toThrow();
  const saved = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, payload: { sessionOrder: 2 } }] });
  expect(saved.errorCount).toBe(0);
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT ts.session_order AS orderNum FROM strength_result_sets srs JOIN training_sessions ts ON ts.id = srs.training_session_id').get()).toEqual({ orderNum: 2 });
});

it('未定级档案与每日恢复备注完整往返', async () => {
  db.prepare("INSERT INTO athlete_profiles (athlete_id, technical_level) VALUES (1, '未定级')").run();
  const batch = analyze({ 每日恢复: [['姓名', '日期', '睡眠小时', '备注'], ['张某', '2025-12-28', 0, '今日未入睡']] });
  commit(batch.id, 'skip');
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const preview = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '档案恢复备注往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  expect(preview.errorCount).toBe(0);
  expect(preview.items.find(item => item.itemType === 'wellness')?.payload.note).toBe('今日未入睡');
  expect(commit(preview.id, 'skip').createdRecords).toBe(0);
});


it('测试目标值含0导出再导入不丢失，真实目标值差异复用选择逻辑', async () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '目标值'], ['张某', '2025-12-29', '专项测试', 'grip', 30, 'kg', 0]] });
  expect(batch.errorCount).toBe(0);
  commit(batch.id, 'skip');
  expect(db.prepare("SELECT target_value AS target FROM test_measurements WHERE metric_code = 'grip'").get()).toEqual({ target: 0 });
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const preview = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '目标值往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  expect(preview.errorCount).toBe(0);
  expect(preview.items.find(item => item.itemType === 'test_measurement')?.payload.targetValue).toBe(0);
  expect(commit(preview.id, 'skip').createdRecords).toBe(0);
  const changed = analyze({ 其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '目标值'], ['张某', '2025-12-29', '专项测试', 'grip', 30, 'kg', 40]] });
  const item = changed.items.find(item => item.itemType === 'test_measurement')!;
  expect(item.conflict?.fields.some(field => field.field === 'targetValue' && field.overwrites)).toBe(true);
  const saved = updateDataImportItems({ batchId: changed.id, userId: USER_ID, athletes, corrections: [{ id: item.id, payload: { valueReview: { action: 'merge', memberIds: [item.id], includeDatabase: true, values: { 'target:grip:center': 40 } } } }] });
  expect(saved.errorCount).toBe(0);
  commit(changed.id, 'update');
  expect(db.prepare("SELECT target_value AS target FROM test_measurements WHERE metric_code = 'grip'").get()).toEqual({ target: 40 });
});

it('每日恢复备注列迁移可重复执行且保留已有数据', () => {
  const batch = analyze({ 每日恢复: [['姓名', '日期', '备注'], ['张某', '2025-12-30', '恢复备注']] });
  commit(batch.id, 'skip');
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  expect(db.prepare("SELECT note FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = '2025-12-30'").get()).toEqual({ note: '恢复备注' });
});

it('统一模板覆盖业务字段可完整导出并恢复，缺失与真实0及课次总量保持不变', async () => {
  const batch = analyze({
    运动员基本资料: [['系统运动员编号', '姓名', '所属队伍', '技术等级', '备注'], [1, '张某', 'A队', '未定级', '档案备注']],
    身体测量: [['姓名', '测量日期', '身高cm', '臂展cm', '体重kg', '骨骼肌kg', '备注'], ['张某', '2025-12-31', 180, 185, 80, 30, '身体备注']],
    每日恢复: [['姓名', '日期', '睡眠小时', '睡眠质量', '晨脉', '体重kg', '疲劳', '肌肉酸痛', '情绪', '状态', '备注'], ['张某', '2025-12-31', 0, 0, 60, 80, 0, 1, 2, 'normal', '恢复备注']],
    训练课次: [['姓名', '日期', '课次序号', '开始时间', '训练类型', '训练内容', '训练阶段', '强度区间', '时长分钟', '距离千米', 'RPE', 'SRPE', 'SMVL', '平均心率', '最大心率', '平均功率W', '桨频SPM'], ['张某', '2025-12-31', 1, '09:30', '力量训练', '力量课', '体能训练', 'AN', 60, null, 6, 360, 789, 130, 170, 200, 25]],
    力量训练组次: [['姓名', '日期', '课次序号', '课次名称', '动作', '组序', '计划次数', '实际次数', '实际重量kg', '计划重量kg', '完成状态', '训练环境', '组次时长分钟', '组次距离千米', '强度区间', '动作代码', '类别', '身体部位', '强度百分比', 'RPE', '备注'], ['张某', '2025-12-31', 1, '力量课', '深蹲', 1, 6, 5, 70, 80, 0, '场馆', 0, 0, 'AN', 'squat', '基础力量', '下肢', 75, 0, '组次备注']],
    其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '侧别', '协议', '备注', '测试时长分钟', '目标值'], ['张某', '2025-12-31', '专项测试', 'grip', 0, 'kg', 'left', '测试协议', '测试备注', 8, 0]],
    体能测试: [['姓名', '测试日期', 'VO2Max', '测试协议'], ['张某', '2025-12-31', 55, '体能协议']],
    FMS测试: [['姓名', '测试日期', '深蹲'], ['张某', '2025-12-31', 2]],
    伤病记录: [['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态', '疼痛评分', '训练限制', '康复计划', '复查日期', '备注'], ['张某', '2025-12-31', '膝部不适', '膝', '左', '观察', 0, '减少负重', '恢复活动', '2026-01-02', '伤病备注']],
    竞技评估: [['姓名', '评估日期', '总分', '等级', '专项耐力', '力量爆发', '技术效率', '负荷适应', '恢复能力', '比赛能力', '一般耐力评分', '评估协议', '备注'], ['张某', '2025-12-31', 0, '调整', 1, 2, 3, 4, 5, 6, 70, '人工评价', '评估备注']],
  });
  expect(batch.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  commit(batch.id, 'skip');
  const queries = [
    'SELECT technical_level, notes FROM athlete_profiles ORDER BY athlete_id',
    'SELECT height_cm, weight_kg, skeletal_muscle_kg, note FROM athlete_body_measurements ORDER BY athlete_id',
    'SELECT sleep_hours, sleep_quality, morning_pulse, weight_kg, fatigue_index, soreness_index, mood_index, status, note FROM daily_wellness ORDER BY athlete_id',
    'SELECT session_order, start_time, training_type, structure_type, intensity_zone, content, duration_min, distance_km, duration_reported, distance_reported, rpe, srpe, smvl, average_heart_rate, max_heart_rate, average_power_w, stroke_rate_spm FROM training_sessions ORDER BY athlete_id, session_order',
    'SELECT exercise_code, exercise_name, set_index, target_reps, actual_reps, actual_weight_kg, planned_weight_kg, training_category, body_position, training_environment, duration_min, distance_km, intensity_percent, intensity_zone, rpe, completed, note FROM strength_result_sets ORDER BY exercise_name',
    'SELECT ts.test_type, ts.protocol, ts.duration_min, tm.metric_code, tm.value_num, tm.target_value, tm.unit, tm.side, tm.note FROM test_measurements tm JOIN test_sessions ts ON ts.id = tm.test_session_id ORDER BY ts.test_type, tm.metric_code, tm.side',
    'SELECT injury_name, body_part, side, status, pain_score, restrictions, rehab_plan, review_date, note FROM injury_records ORDER BY athlete_id',
    'SELECT overall_score, state_level, endurance_score, power_score, technique_score, load_adaptation_score, recovery_score, competition_score, note FROM competitive_state_assessments ORDER BY athlete_id',
  ];
  const snapshot = () => queries.map(sql => db.prepare(sql).all());
  const original = snapshot();
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parse = () => analyzeDataImport({ buffer, filename: '全业务字段往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  const unchanged = parse();
  expect(unchanged.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  const unchangedResult = commit(unchanged.id, 'skip');
  expect(unchangedResult.createdRecords).toBe(0);
  expect(unchangedResult.updatedRecords).toBe(0);
  expect(snapshot()).toEqual(original);
  db.exec('DELETE FROM strength_result_sets; DELETE FROM training_sessions; DELETE FROM test_measurements; DELETE FROM test_sessions; DELETE FROM athlete_profiles; DELETE FROM athlete_body_measurements; DELETE FROM daily_wellness; DELETE FROM injury_records; DELETE FROM competitive_state_assessments;');
  const restored = parse();
  expect(restored.errorCount).toBe(0);
  commit(restored.id, 'skip');
  expect(snapshot()).toEqual(original);
});

it('导出模板中的中文侧别、状态与等级再导入与数据库同口径，不制造覆盖冲突', async () => {
  const sides = ['未指定', '左', '右', '双侧', '中央'];
  const statuses = ['健康', '观察', '限训', '康复', '停训'];
  const seed = analyze({
    伤病记录: [['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态', '疼痛评分'],
      ...sides.flatMap((side, index) => statuses.map((status, j) => ['张某', '2026-01-05', `枚举${index}-${j}`, '膝', side, status, j === 0 ? null : j]))],
    竞技评估: [['姓名', '评估日期', '总分', '等级'], ...['巅峰', '良好', '建设', '调整'].map((level, index) => ['张某', `2026-01-0${index + 5}`, 80, level])],
    其他测试: [['姓名', '测试日期', '测试类型', '指标代码', '数值', '单位', '侧别'], ...sides.slice(1).map(side => ['张某', '2026-01-05', '专项测试', 'grip', 30, 'kg', side])],
  });
  expect(seed.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  commit(seed.id, 'skip');
  const snapshot = () => JSON.stringify(['injury_records', 'competitive_state_assessments', 'test_sessions', 'test_measurements'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
  const before = snapshot();
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const roundtrip = analyzeDataImport({
    buffer,
    filename: '中文枚举往返.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    project: PROJECT,
    userId: USER_ID,
    athletes,
  });
  expect(roundtrip.items.filter(item => item.quality === 'error').map(item => item.messages)).toEqual([]);
  const items = roundtrip.items.filter(
    item => item.itemType === 'injury_record' || item.itemType === 'competitive_state' || item.itemType === 'test_measurement'
  );
  expect(items).toHaveLength(33);
  expect(items.filter(item => item.itemType === 'injury_record')).toHaveLength(25);
  expect(items.filter(item => item.itemType === 'competitive_state').length).toBeGreaterThan(0);
  for (const item of items) {
    expect(item.conflict?.exists).toBe(true);
    expect(item.conflict?.identical).toBe(true);
    expect(item.conflict?.fields.filter(field => field.overwrites)).toEqual([]);
  }
  expect(importReviewGroups(items)).toEqual([]);
  const result = commit(roundtrip.id, 'update');
  expect(result.updatedRecords).toBe(0);
  expect(snapshot()).toBe(before);
});


it.each([
  ['课次序号', 1.5], ['计划重量kg', -1], ['完成状态', 2], ['组次时长分钟', -1], ['组次距离千米', -1], ['训练环境', '未知环境'], ['强度区间', '未知区间'],
])('新增组次字段%s的非法值会阻断写入', (header, value) => {
  const batch = analyze({ 力量训练组次: [['姓名', '日期', '课次名称', '动作', '实际次数', '实际重量kg', header], ['张某', '2025-12-24', '力量课', '深蹲', 5, 80, value]] });
  expect(batch.errorCount).toBeGreaterThan(0);
  expect(() => commit(batch.id, 'skip')).toThrow();
  expect(db.prepare('SELECT COUNT(*) AS count FROM strength_result_sets').get()).toEqual({ count: 0 });
});

it('旧文件同名课次歧义不能被相同值自动合并，两条来源可分别关联', () => {
  for (const order of [1, 2]) db.prepare("INSERT INTO training_sessions (athlete_id, session_date, session_order, training_type, structure_type, intensity_zone, content) VALUES (1, '2025-12-21', ?, '力量训练', '体能训练', 'AN', '力量课')").run(order);
  const batch = analyze({ 力量训练组次: [['姓名', '日期', '课次名称', '动作', '组序', '实际次数', '实际重量kg'], ['张某', '2025-12-21', '力量课', '深蹲', 1, 5, 80], ['张某', '2025-12-21', '力量课', '深蹲', 1, 5, 80]] });
  expect(batch.items).toHaveLength(2);
  expect(batch.errorCount).toBe(2);
  const saved = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: batch.items.map((item, index) => ({ id: item.id, payload: { sessionOrder: index + 1 } })) });
  expect(saved.errorCount).toBe(0);
  expect(commit(batch.id, 'skip').createdRecords).toBe(2);
  expect(db.prepare('SELECT ts.session_order AS orderNum FROM strength_result_sets srs JOIN training_sessions ts ON ts.id = srs.training_session_id ORDER BY ts.session_order').all()).toEqual([{ orderNum: 1 }, { orderNum: 2 }]);
});


it('仅承载力量组次的课次也导出完整课次资料，不伪造时长与距离', async () => {
  const session = db.prepare("INSERT INTO training_sessions (athlete_id, session_date, session_order, start_time, training_type, structure_type, intensity_zone, content, duration_min, distance_km, duration_reported, distance_reported, smvl) VALUES (1, '2025-12-20', 3, '13:00', '体能训练', '动作准备', 'U3', '功能训练', 0, 0, 0, 0, 350)").run();
  db.prepare("INSERT INTO strength_result_sets (training_session_id, exercise_name, actual_reps, actual_weight_kg) VALUES (?, '深蹲', 5, 70)").run(session.lastInsertRowid);
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parse = () => analyzeDataImport({ buffer, filename: '仅组次课次往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  const preview = parse();
  expect(preview.errorCount).toBe(0);
  expect(preview.items.some(item => item.itemType === 'training_session' && item.payload.sessionOrder === 3)).toBe(true);
  expect(commit(preview.id, 'skip').createdRecords).toBe(0);
  db.exec('DELETE FROM strength_result_sets; DELETE FROM training_sessions;');
  const restored = parse();
  expect(commit(restored.id, 'skip').createdRecords).toBe(2);
  expect(db.prepare('SELECT session_order, start_time, training_type, structure_type, intensity_zone, content, duration_reported, distance_reported, smvl FROM training_sessions').get()).toEqual({ session_order: 3, start_time: '13:00', training_type: '体能训练', structure_type: '动作准备', intensity_zone: 'U3', content: '功能训练', duration_reported: 0, distance_reported: 0, smvl: 350 });
});

it('校对和审查中的中文枚举立即归一，未知文本保留并阻断，空白疼痛不伪造0', () => {
  const batch = analyze({ 伤病记录: [['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态', '疼痛评分'], ['张某', '2026-01-06', '不适', '膝', '左', '观察', null]] });
  const id = batch.items[0].id;
  const corrected = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id, payload: { side: '右', status: '康复' } }] });
  expect(corrected.items[0].payload).toMatchObject({ side: 'right', status: 'rehab', painScore: null });
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT side, status, pain_score AS pain FROM injury_records').get()).toEqual({ side: 'right', status: 'rehab', pain: null });
  const invalid = analyze({ 伤病记录: [['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态'], ['张某', '2026-01-07', '不适', '膝', 'constructor', '未知状态']] });
  expect(invalid.items[0].payload).toMatchObject({ side: 'constructor', status: '未知状态' });
  expect(invalid.errorCount).toBe(1);
});


it('空白枚举使用约定默认，竞技等级仅新增时默认，已有疼痛与等级不被空白覆盖', () => {
  const batch = analyze({
    伤病记录: [['姓名', '发生日期', '伤病名称', '部位'], ['张某', '2026-01-09', '空白默认', '膝']],
    竞技评估: [['姓名', '评估日期', '总分', '等级'], ['张某', '2026-01-09', 80, null]],
  });
  expect(batch.items.find(item => item.itemType === 'injury_record')?.payload).toMatchObject({ side: 'unspecified', status: 'observation', painScore: null });
  expect(batch.items.find(item => item.itemType === 'competitive_state')?.payload.stateLevel).toBe('');
  commit(batch.id, 'skip');
  expect(db.prepare('SELECT pain_score AS pain FROM injury_records').get()).toEqual({ pain: null });
  expect(db.prepare('SELECT state_level AS level FROM competitive_state_assessments').get()).toEqual({ level: 'build' });
  db.prepare("UPDATE injury_records SET pain_score = 5").run();
  db.prepare("UPDATE competitive_state_assessments SET state_level = 'good'").run();
  const replay = analyze({
    伤病记录: [['姓名', '发生日期', '伤病名称', '部位'], ['张某', '2026-01-09', '空白默认', '膝']],
    竞技评估: [['姓名', '评估日期', '总分'], ['张某', '2026-01-09', 80]],
  });
  commit(replay.id, 'update');
  expect(db.prepare('SELECT pain_score AS pain FROM injury_records').get()).toEqual({ pain: 5 });
  expect(db.prepare('SELECT state_level AS level FROM competitive_state_assessments').get()).toEqual({ level: 'good' });
});

it('疼痛差异自动更新，中文枚举校对及审查写回均只保存规范代码', () => {
  const seed = analyze({ 伤病记录: [['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态', '疼痛评分'], ['张某', '2026-01-10', '疼痛差异', '膝', 'left', 'observation', 2]] });
  commit(seed.id, 'skip');
  const changed = analyze({ 伤病记录: [['姓名', '发生日期', '伤病名称', '部位', '侧别', '状态', '疼痛评分'], ['张某', '2026-01-10', '疼痛差异', '膝', '左', '观察', 4]] });
  const item = changed.items[0];
  expect(item.payload).toMatchObject({ side: 'left', status: 'observation' });
  expect(item.conflict?.fields.filter(field => field.overwrites).map(field => field.field)).toEqual(['painScore']);
  expect(importReviewGroups(changed.items)).toEqual([]);
  expect(item.conflict?.fields.find(field => field.field === 'side')).toMatchObject({ oldValue: 'left', newValue: 'left', overwrites: false });
  const draft = updateDataImportItems({ batchId: changed.id, userId: USER_ID, athletes, corrections: [{ id: item.id, payload: { valueReview: { action: 'draft', choices: { side: '左', status: '观察' }, manual: {} } } }] });
  expect(draft.items[0].payload.valueReviewDraft).toMatchObject({ choices: { side: 'left', status: 'observation' } });
  const saved = updateDataImportItems({ batchId: changed.id, userId: USER_ID, athletes, corrections: [{ id: item.id, payload: { valueReview: { action: 'merge', memberIds: [item.id], includeDatabase: true, values: { side: '左', status: '观察', painScore: 4 } } } }] });
  expect(saved.items[0].payload).toMatchObject({ side: 'left', status: 'observation' });
  expect(saved.items[0].payload.valueReviewDecision).toMatchObject({ finalValues: { side: 'left', status: 'observation', painScore: 4 } });
  expect(commit(changed.id, 'update').updatedRecords).toBe(1);
});

it('普通覆盖在校对后数据库变化时拒绝提交，重新保存校对后才采用新基线', () => {
  commit(analyze({ 身体测量: [['姓名', '日期', '体重kg'], ['张某', '2026-10-01', 70]] }).id, 'update');
  const batch = analyze({ 身体测量: [['姓名', '日期', '体重kg'], ['张某', '2026-10-01', 80]] });
  db.prepare('UPDATE athlete_body_measurements SET weight_kg = 75 WHERE athlete_id = 1').run();
  expect(() => commit(batch.id, 'update')).toThrow(/变化|修改/);
  expect(db.prepare('SELECT weight_kg FROM athlete_body_measurements WHERE athlete_id = 1').get()).toEqual({ weight_kg: 75 });
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [] });
  expect(commit(batch.id, 'update').updatedRecords).toBe(1);
});

it('预览后新增或删除同一业务记录也要求重新校对，跳过行不阻断', () => {
  const batch = analyze({ 每日恢复: [['姓名', '日期', '睡眠小时'], ['张某', '2026-10-02', 8]] });
  commit(analyze({ 每日恢复: [['姓名', '日期', '睡眠小时'], ['张某', '2026-10-02', 6]] }).id, 'update');
  expect(() => commit(batch.id, 'update')).toThrow(/变化|修改/);
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [] });
  db.prepare('DELETE FROM daily_wellness WHERE athlete_id = 1').run();
  expect(() => commit(batch.id, 'update')).toThrow(/变化|修改/);
  updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes, corrections: [{ id: batch.items[0].id, resolution: 'skip' }] });
  expect(commit(batch.id, 'update').imported).toBe(0);
});

it('人员映射保存即更新下游记录，再改关联后按新运动员重新检查重复', () => {
  const batch = analyze({ 每日恢复: [['姓名', '日期', '睡眠小时'], ['待确认队员', '2026-10-03', 8]] });
  const candidate = batch.athleteCandidates[0];
  const first = updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, allowedTeams: new Set(['A队', 'B队']), athletes,
    corrections: [{ id: candidate.id, matchedAthleteId: 1, confirmed: true }] });
  expect(first.items[0].athleteId).toBe(1);
  const second = updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, allowedTeams: new Set(['A队', 'B队']), athletes,
    corrections: [{ id: candidate.id, matchedAthleteId: 2, confirmed: true }] });
  expect(second.items[0].athleteId).toBe(2);
  expect(commit(batch.id, 'update').createdRecords).toBe(1);
  expect(db.prepare('SELECT athlete_id FROM daily_wellness').all()).toEqual([{ athlete_id: 2 }]);
});

it('重复提交返回首次入库结果，不把已新增和更新数量伪装为0', () => {
  const batch = analyze({ 每日恢复: [['姓名', '日期', '睡眠小时'], ['张某', '2026-10-04', 8]] });
  const first = commit(batch.id, 'update');
  const second = commit(batch.id, 'update');
  expect(second.createdRecords).toBe(first.createdRecords);
  expect(second.updatedRecords).toBe(first.updatedRecords);
  expect(second.skipped).toBe(first.skipped);
});

it('改关联使原冲突选择失效，恢复每条来源后按新身份重新审查', () => {
  const batch = analyze({ 身体测量: [['姓名', '日期', '体重kg'], ['待确认新人', '2026-10-07', 70], ['待确认新人', '2026-10-07', 80]] });
  const candidate = batch.athleteCandidates[0];
  const linked = updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, allowedTeams: new Set(['A队', 'B队']), athletes,
    corrections: [{ id: candidate.id, matchedAthleteId: 1, confirmed: true }] });
  const merged = updateDataImportItems({ batchId: batch.id, userId: USER_ID, athletes,
    corrections: selectImportReviewRecord(importReviewGroups(linked.items), 0) });
  expect(merged.items.some(item => item.payload.valueReviewDecision)).toBe(true);
  const changed = updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, allowedTeams: new Set(['A队', 'B队']), athletes,
    corrections: [{ id: candidate.id, matchedAthleteId: 2, confirmed: true }] });
  expect(changed.items.every(item => item.athleteId === 2 && !item.payload.valueReviewDecision)).toBe(true);
  expect(changed.items.map(item => item.payload.weightKg).sort()).toEqual([70, 80]);
  expect(importReviewGroups(changed.items)).toHaveLength(1);
  expect(() => commit(batch.id, 'update')).toThrow(/校验|审查/);
});

it('人员排除再恢复即更新校对状态，不提前写正式记录', () => {
  const batch = analyze({ 每日恢复: [['姓名', '日期', '睡眠小时'], ['待确认新人', '2026-10-08', 8]] });
  const candidate = batch.athleteCandidates[0];
  const excluded = updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, allowedTeams: new Set(['A队', 'B队']), athletes,
    corrections: [{ id: candidate.id, excluded: true }] });
  expect(excluded.items[0].quality).toBe('skipped');
  const restored = updateDataImportAthleteCandidates({ batchId: batch.id, userId: USER_ID, allowedTeams: new Set(['A队', 'B队']), athletes,
    corrections: [{ id: candidate.id, excluded: false, matchedAthleteId: 1, confirmed: true }] });
  expect(restored.items[0].quality).not.toBe('skipped');
  expect(db.prepare('SELECT COUNT(*) AS count FROM daily_wellness').get()).toEqual({ count: 0 });
  expect(commit(batch.id, 'update').createdRecords).toBe(1);
});

describe('简化模板的填写契约', () => {
  async function simplified(name: string, values: Record<string, unknown>, options: Partial<Parameters<typeof analyzeDataImport>[0]> = {}) {
    const { buildImportWorkbook } = await import('./template-workbook.ts');
    const { templateHeaderKey } = await import('../../shared/import-template-fields.ts');
    const workbook = buildImportWorkbook([name]);
    const sheet = workbook.getWorksheet(name)!;
    sheet.getRow(3).eachCell((cell, column) => {
      const key = templateHeaderKey(String(cell.value));
      if (key in values) sheet.getCell(4, column).value = values[key] as string | number;
    });
    return analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: `简化${++unique}.xlsx`, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes, allowedTeams: new Set(['A队', 'B队']), ...options });
  }
  it('新模板无日期阻断，选定统一日期后只填距离可提交且不伪造SRPE', async () => {
    const values = { 姓名: '张某', 距离千米: 12.5 };
    const missing = await simplified('训练课次', values);
    expect(missing.errorCount).toBeGreaterThan(0);
    expect(missing.items[0].eventDate).toBe('');
    const valid = await simplified('训练课次', values, { defaultDate: '2026-10-01', reparse: true });
    expect(valid.errorCount).toBe(0);
    expect(valid.items[0].payload.srpe).toBeNull();
    expect(commit(valid.id, 'skip').createdRecords).toBe(1);
  });
  it('有效编号无需重复填姓名；只预填身份和日期不产生业务行', async () => {
    const batch = await simplified('身体测量', { 系统运动员编号: 1, 测量日期: '2026-10-01', 体重kg: 75 });
    expect(batch.errorCount).toBe(0);
    expect(batch.items[0].athleteId).toBe(1);
    await expect(simplified('训练课次', { 姓名: '张某', 日期: '2026-10-01' })).rejects.toThrow('未填写业务数据');
  });
  it('恢复只填睡眠合法，只填备注报错；旧文件日期回退明确提示', async () => {
    const valid = await simplified('每日恢复', { 姓名: '张某', 日期: '2026-10-01', 睡眠小时: 8 });
    expect(valid.errorCount).toBe(0);
    const invalid = await simplified('每日恢复', { 姓名: '张某', 日期: '2026-10-01', 备注: '未采集' });
    expect(invalid.errorCount).toBeGreaterThan(0);
    const legacy = analyze({ 训练课次: [['姓名', '时长分钟'], ['张某', 60]] });
    expect(legacy.items[0].messages.join('；')).toContain('北京时间当天');
  });
  it('新模板复用RPE与恢复量表边界并定位原列', async () => {
    const training = await simplified('训练课次', { 姓名: '张某', 日期: '2026-10-01', 时长分钟: 60, RPE: 11 });
    expect(training.errorCount).toBeGreaterThan(0);
    expect(training.items[0].messages.join('；')).toMatch(/训练课次![A-Z]+4.*RPE/);
    const recovery = await simplified('每日恢复', { 姓名: '张某', 日期: '2026-10-01', 睡眠小时: 99 });
    expect(recovery.errorCount).toBeGreaterThan(0);
  });
  it('装饰表头与业务列重排后仍按字段名解析', async () => {
    const { buildImportWorkbook } = await import('./template-workbook.ts');
    const workbook = buildImportWorkbook(['训练课次']);
    const sheet = workbook.getWorksheet('训练课次')!;
    const fields = importTemplateFields('训练课次');
    const data: Record<string, string | number> = { 系统运动员编号: 1, 日期: '2026-10-01', 时长分钟: 60, RPE: 6 };
    sheet.getRow(3).values = fields.map(field => String(sheet.getCell(3, fields.indexOf(field) + 1).value)).reverse();
    sheet.getRow(4).values = fields.map(field => data[field.key] ?? null).reverse();
    const batch = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '列重排.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
    expect(batch.errorCount).toBe(0);
    expect(batch.items[0].payload).toMatchObject({ durationMin: 60, rpe: 6, srpe: 360 });
    expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  });
  it('同人同日多课缺序号时不静默合并', async () => {
    const batch = analyze({ 训练课次: [['姓名', '日期', '时长分钟', '训练内容'], ['张某', '2026-10-01', 60, '上午'], ['张某', '2026-10-01', 30, '下午']] });
    expect(batch.errorCount).toBeGreaterThan(0);
    expect(batch.items.flatMap(item => item.messages).join('；')).toContain('课次序号');
  });
});

it.each([400, 0])('互补课次合并保留外部显式SRPE=%s', (load) => {
  const batch = analyze({ 训练课次: [['姓名', '日期', '课次序号', '时长分钟', 'SRPE'], ['张某', '2026-10-17', 1, 60, ''], ['张某', '2026-10-17', 1, '', load]] });
  expect(batch.errorCount).toBe(0);
  expect(batch.items.find(item => item.quality !== 'skipped')!.payload.srpe).toBe(load);
  commit(batch.id, 'skip');
  expect(db.prepare("SELECT srpe FROM training_sessions WHERE athlete_id=1 AND session_date='2026-10-17'").get()).toEqual({ srpe: load });
});

it('已知无量纲指标与完整导出往返不要求编造单位', async () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值', '单位'], ['张某', '2026-10-18', 'dsd_ratio', 0.8, '']] });
  expect(batch.errorCount).toBe(0);
  commit(batch.id, 'skip');
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const roundtrip = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '无量纲往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  expect(roundtrip.errorCount).toBe(0);
  expect(roundtrip.items.find(item => item.metricCode === 'dsd_ratio')?.valueNum).toBe(0.8);
});

it('历史对比表编号在姓名前时仍读取姓名列', () => {
  const batch = analyze({ 数据源: [
    ['历史数据源'],
    ['系统运动员编号', '姓名', '队伍', '性别', '备注', '', '深蹲'],
    ['', '', '', '', '', '', '2026-10-19'],
    [1, '张某', 'A队', '男', '', '', 60],
  ] });
  expect(batch.items[0].rawAthleteName).toBe('张某');
  expect(batch.items[0].athleteId).toBe(1);
});

it('重复解析不改写未变化的指标字典元数据', () => {
  analyze({ 训练课次: [['姓名', '日期', '时长分钟'], ['张某', '2026-10-21', 60]] });
  db.prepare("UPDATE metric_definitions SET updated_at='2000-01-01 00:00:00' WHERE code='squat_kg'").run();
  analyze({ 训练课次: [['姓名', '日期', '时长分钟'], ['张某', '2026-10-21', 60]] });
  expect(db.prepare("SELECT updated_at AS value FROM metric_definitions WHERE code='squat_kg'").get()).toEqual({ value: '2000-01-01 00:00:00' });
});

it('复制带通俗条件说明的部分列后，仍识别新版模板并阻止缺日期', async () => {
  const { templateFieldHeader } = await import('../../shared/import-template-fields.ts');
  const fields = importTemplateFields('训练课次').filter(field => ['姓名', '时长分钟'].includes(field.key));
  const batch = analyze({ 训练课次: [fields.map(templateFieldHeader), fields.map(field => field.key === '姓名' ? '张某' : 60)] });
  expect(batch.items[0].eventDate).toBe('');
  expect(batch.errorCount).toBeGreaterThan(0);
});

it('教练只填中文测试项目与成绩，系统确定代码和单位并支持完整往返', async () => {
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '测试项目', '数值'], ['张某', '2026-10-22', '纵跳（cm）', 45]] });
  expect(batch.errorCount).toBe(0);
  expect(batch.items[0]).toMatchObject({ metricCode: 'vertical_jump_cm', metricLabel: '纵跳', unit: 'cm', valueNum: 45 });
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  const { buildUnifiedDataExport } = await import('./data-import-export.ts');
  const workbook = await buildUnifiedDataExport(PROJECT, [1]);
  const rows = XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(await workbook.xlsx.writeBuffer())).Sheets['其他测试'], { header: 1 }) as unknown[][];
  expect(rows[2]).toContain('指标代码');
  const roundtrip = analyzeDataImport({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: '中文测试往返.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', project: PROJECT, userId: USER_ID, athletes });
  expect(roundtrip.errorCount).toBe(0);
  expect(commit(roundtrip.id, 'skip').createdRecords).toBe(0);
});

it('中文测试项目使用当前启用字典，未知、同名歧义、项目外或停用项不猜测', () => {
  const insert = db.prepare("INSERT INTO metric_definitions (code,label,domain,unit,direction,frequency,projects_json,active) VALUES (?,?,'custom',?,'neutral','phase',?,?)");
  insert.run('coach_test', '队内测试甲', '秒', '["赛艇"]', 1);
  insert.run('ambiguous_a', '队内同名测试', '秒', '["赛艇"]', 1);
  insert.run('ambiguous_b', '队内同名测试', '秒', '["赛艇"]', 1);
  insert.run('foreign_test', '项目外测试', '秒', '["皮划艇"]', 1);
  insert.run('inactive_test', '已停用测试', '秒', '["赛艇"]', 0);
  const valid = analyze({ 其他测试: [['姓名', '测试日期', '测试项目', '数值'], ['张某', '2026-10-22', '队内测试甲', 12]] });
  expect(valid.errorCount).toBe(0);
  expect(valid.items[0]).toMatchObject({ metricCode: 'coach_test', unit: '秒' });
  for (const name of ['未知测试', '队内同名测试', '项目外测试', '已停用测试']) {
    const invalid = analyze({ 其他测试: [['姓名', '测试日期', '测试项目', '数值'], ['张某', '2026-10-22', name, 12]] });
    expect(invalid.errorCount, name).toBeGreaterThan(0);
    expect(invalid.items[0].messages.join('；')).toContain('测试项目');
  }
});

it.each([['正常', 'normal'], ['休息', 'rest'], ['关注', 'attention'], ['警报', 'alert'], ['缺失', 'missing']])('恢复状态下拉中文%s按既有代码%s入库', (label, code) => {
  const batch = analyze({ 每日恢复: [['姓名', '日期', '状态'], ['张某', '2026-10-23', label]] });
  expect(batch.errorCount).toBe(0);
  expect(batch.items[0].payload.status).toBe(code);
  expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  expect(db.prepare("SELECT status FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = '2026-10-23'").get()).toEqual({ status: code });
});

it('P0：解析和失败提交不覆盖管理员指标设置', () => {
  const before = db.prepare("SELECT * FROM metric_definitions WHERE code='vertical_jump_cm'").get();
  db.prepare("UPDATE metric_definitions SET label='队内纵跳', unit='毫米', active=0 WHERE code='vertical_jump_cm'").run();
  const snapshot = db.prepare('SELECT * FROM metric_definitions ORDER BY code').all();
  try {
    const batch = analyze({ 每日恢复: [['姓名', '日期', '睡眠小时'], ['张某', '2026-11-01', 8]] });
    commit(batch.id, 'skip');
    expect(() => analyze({ 每日恢复: [['姓名', '日期', '睡眠小时']] })).toThrow();
    expect(db.prepare('SELECT * FROM metric_definitions ORDER BY code').all()).toEqual(snapshot);
  } finally {
    if (before) db.prepare('UPDATE metric_definitions SET label=?, unit=?, active=? WHERE code=?').run(before.label, before.unit, before.active, 'vertical_jump_cm');
  }
});

it('P0：不同账号可上传相同文件，本人旧哈希草稿可继续', () => {
  db.prepare("INSERT INTO users (id,username,password_hash,display_name,role) VALUES (8,'other-p0','x','虚构教练','SCC')").run();
  const buffer = workbookBuffer({ 每日恢复: [['姓名', '日期', '睡眠小时'], ['张某', '2026-11-02', 8]] });
  const first = analyze({}, { buffer });
  const second = analyze({}, { buffer, userId: 8 });
  expect(first.id).not.toBe(second.id);
  db.prepare('UPDATE data_import_batches SET file_hash=? WHERE id=?').run(createHash('sha256').update(buffer).digest('hex'), first.id);
  expect(analyze({}, { buffer }).id).toBe(first.id);
  expect(() => getDataImportBatch(first.id, 8)).toThrow();
});

it('P0：重解析失败保留旧草稿与校对，持久化失败也回滚', () => {
  const buffer = workbookBuffer({ 每日恢复: [['姓名', '所属队伍', '日期', '睡眠小时'], ['新队员P0', 'A队', '', 8]] });
  const first = analyze({}, { buffer, defaultDate: '2026-11-03' });
  updateDataImportAthleteCandidates({ batchId: first.id, userId: USER_ID, athletes, allowedTeams: new Set(['A队']), corrections: [{ id: first.athleteCandidates[0].id, matchedAthleteId: 1, confirmed: true }] });
  const saved = updateDataImportItems({ batchId: first.id, userId: USER_ID, athletes, corrections: [{ id: first.items[0].id, payload: { sleepHours: 9 } }] });
  const storedHash = (db.prepare('SELECT file_hash AS hash FROM data_import_batches WHERE id=?').get(first.id) as { hash: string }).hash;
  const tooManySheets = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`表${index}`, [['表头']]]));
  for (const badBuffer of [Buffer.from('PK\x03\x04损坏的工作簿'), workbookBuffer({ 每日恢复: [['姓名', '日期', '睡眠小时']] }), workbookBuffer(tooManySheets)]) {
    db.prepare('UPDATE data_import_batches SET file_hash=? WHERE id=?').run(createHash('sha256').update(badBuffer).digest('hex'), first.id);
    expect(() => analyze({}, { buffer: badBuffer, reparse: true })).toThrow();
    expect(getDataImportBatch(first.id, USER_ID)).toEqual(saved);
  }
  db.prepare('UPDATE data_import_batches SET file_hash=? WHERE id=?').run(storedHash, first.id);
  db.exec("CREATE TRIGGER p0_fail_insert BEFORE INSERT ON data_import_items BEGIN SELECT RAISE(ABORT, '模拟持久化失败'); END");
  try { expect(() => analyze({}, { buffer, reparse: true })).toThrow('模拟持久化失败'); } finally { db.exec('DROP TRIGGER p0_fail_insert'); }
  expect(getDataImportBatch(first.id, USER_ID)).toEqual(saved);
});

it('P0：未知指标不能通过旧代码文件创建字典，停用及单位变化在提交时复核', () => {
  const unknown = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值', '单位'], ['张某', '2026-11-05', 'not_configured_p0', 30, 'kg']] });
  expect(unknown.errorCount).toBeGreaterThan(0);
  expect(() => commit(unknown.id, 'skip')).toThrow();
  expect(db.prepare("SELECT code FROM metric_definitions WHERE code='not_configured_p0'").get()).toBeUndefined();
  const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '数值', '单位'], ['张某', '2026-11-05', 'grip', 30, 'kg']] });
  expect(batch.errorCount).toBe(0);
  try {
    db.prepare("UPDATE metric_definitions SET unit='g' WHERE code='grip'").run();
    expect(() => commit(batch.id, 'skip')).toThrow();
    db.prepare("UPDATE metric_definitions SET unit='kg',active=0 WHERE code='grip'").run();
    expect(() => commit(batch.id, 'skip')).toThrow();
  } finally { db.prepare("UPDATE metric_definitions SET unit='kg',active=1 WHERE code='grip'").run(); }
  expect(db.prepare('SELECT COUNT(*) AS count FROM test_measurements').get()).toEqual({ count: 0 });
});


it('P0：管理员配置在重复初始化和成功测试入库后保持不变', () => {
  const previous = db.prepare("SELECT * FROM metric_definitions WHERE code='squat_kg'").get() as { label: string; unit: string; active: number };
  try {
    db.prepare("UPDATE metric_definitions SET label='队内深蹲',unit='千克',active=1 WHERE code='squat_kg'").run();
    const snapshot = db.prepare("SELECT * FROM metric_definitions WHERE code='squat_kg'").get();
    initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
    const batch = analyze({ 其他测试: [['姓名', '测试日期', '指标代码', '指标名称', '数值', '单位'], ['张某', '2026-11-06', 'squat_kg', '文件自改名称', 60, '千克']] });
    expect(batch.errorCount).toBe(0);
    expect(commit(batch.id, 'skip').createdRecords).toBe(1);
    expect(db.prepare("SELECT * FROM metric_definitions WHERE code='squat_kg'").get()).toEqual(snapshot);
  } finally { db.prepare('UPDATE metric_definitions SET label=?,unit=?,active=? WHERE code=?').run(previous.label, previous.unit, previous.active, 'squat_kg'); }
});
