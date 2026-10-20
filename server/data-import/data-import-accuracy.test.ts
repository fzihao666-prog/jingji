import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';

vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
import { db } from '../core/db.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
import {
  analyzeDataImport,
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

  it('跳过重复策略不更新已有记录', () => {
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
    expect(result.skipped).toBe(1);
    const row = db
      .prepare('SELECT sleep_hours AS sleep FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = ?')
      .get('2025-05-05') as { sleep: number };
    expect(row.sleep).toBe(7);
  });

  it('跳过重复策略不修改已有运动员档案字段', () => {
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
    expect(row.gender).toBe('男');
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
