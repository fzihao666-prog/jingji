import { readFileSync } from 'node:fs';
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

describe('统一合并语义：skip 只补空缺不覆盖', () => {
  it('恢复状态部分冲突时补全空字段并保留冲突值', () => {
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
    expect(row.sleep).toBe(7); // 冲突值保留
    expect(row.pulse).toBe(52); // 空缺补全
  });

  it('身体测量部分冲突时补全空缺字段并保留冲突值', () => {
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
    expect(row.height).toBe(180);
    expect(row.weight).toBe(77);
  });

  it('训练课次部分冲突时只补空字段，未报距离按空缺补全', () => {
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
    expect(row.duration).toBe(60); // 已报冲突时长保留
    expect(row.distance).toBe(8); // 未报距离属于空缺，补全
    expect(row.distanceReported).toBe(1);
  });

  it('skip 下全部字段冲突时整行保留，计入跳过', () => {
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
    expect(result.skipped).toBe(1);
    expect(result.updatedRecords).toBe(0);
    const row = db
      .prepare('SELECT sleep_hours AS sleep FROM daily_wellness WHERE athlete_id = 1 AND wellness_date = ?')
      .get('2025-05-09') as { sleep: number };
    expect(row.sleep).toBe(7);
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
    expect(fresh.id).not.toBe(batch.id);
    expect(commit(fresh.id, 'skip').createdRecords).toBe(1);
  });
});

it('选择新建时遇到同队同名档案不在提交阶段偷偷关联', () => {
  const batch = analyze({
    训练课次: [
      ['系统运动员编号', '姓名', '日期', '时长分钟'],
      [999, '张某', '2025-08-06', 60],
    ],
  });
  updateDataImportAthleteCandidates({
    batchId: batch.id,
    userId: USER_ID,
    allowedTeams: new Set(['A队']),
    athletes,
    corrections: [{ id: batch.athleteCandidates[0].id, team: 'A队', confirmed: true }],
  });
  expect(() => commit(batch.id, 'skip')).toThrow(/同名档案/);
  expect(db.prepare('SELECT COUNT(*) AS count FROM training_sessions').get()).toEqual({ count: 0 });
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
    [['张某', '2025-09-05', 1, '', '', '', '', '', 60], ['赵某']],
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
  expect(batch.items[0].sourceAddress).toBe('A4');
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

  it('实际填写了评估分数时仍须填写日期', () => {
    const batch = analyze({ 竞技水平评估: [['姓名', '评估日期', '竞技总分'], ['张某', '', 80]] });
    expect(batch.items.map(item => item.itemType)).toEqual(['competitive_state']);
    expect(batch.errorCount).toBe(1);
    expect(() => commit(batch.id, 'skip')).toThrow(/校验/);
  });
});

describe('自动识别附带的未注明日期冠军模型数据', () => {
  it('导入队员资料时不因附带未填日期的冠军模型数值而阻断，明确说明未导入', () => {
    const batch = analyze({
      运动员信息: [['姓名', '所属队伍'], ['张某', 'A队']],
      冠军模型测试: [['姓名', '测试日期', '体脂率%'], ['张某', '', 21.9]],
    });
    expect(batch.errorCount).toBe(0);
    expect(batch.items.map(item => item.itemType)).toEqual(['athlete_profile']);
    expect(batch.summary.ignoredSheets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '冠军模型测试', reason: expect.stringContaining('未填测试日期') }),
    ]));
    commit(batch.id, 'skip');
    expect(db.prepare('SELECT COUNT(*) AS count FROM test_measurements').get()).toEqual({ count: 0 });
  });

  it('填写了明确测试日期的冠军模型数据仍正常导入', () => {
    const batch = analyze({ 冠军模型测试: [['姓名', '测试日期', '体脂率%'], ['张某', '2025-09-07', 21.9]] });
    expect(batch.errorCount).toBe(0);
    expect(commit(batch.id, 'skip').createdRecords).toBe(1);
  });
});
