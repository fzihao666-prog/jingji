import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';

vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
import { db } from '../core/db.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
import { analyzeDataImport, commitDataImport } from './data-import.ts';
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
function analyze(sheets: Record<string, unknown[][]>) {
  unique += 1;
  return analyzeDataImport({
    buffer: workbookBuffer({ ...sheets, 说明: [[`测试标记__scope${unique}__`]] }),
    filename: `范围测试${unique}.xlsx`,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    project: PROJECT,
    userId: USER_ID,
    athletes,
    allowedTeams: new Set(['A队', 'B队']),
  });
}

// 当前账号可访问范围只含 id 1—3；id 9 是范围外运动员，仅存在于库中，不在 athletes 参数里。
const athletes: ImportAthlete[] = [
  { id: 1, name: '张某', project: PROJECT, team: 'A队', gender: '男', birthDate: '1990-01-01' },
  { id: 2, name: '赵某', project: PROJECT, team: 'B队', gender: '女', birthDate: '1992-02-02' },
  { id: 3, name: '钱某', project: PROJECT, team: 'A队', gender: '男', birthDate: '' },
];

function commitBatch(batchId: string) {
  return commitDataImport({
    batchId,
    userId: USER_ID,
    creatorRole: 'SCC',
    athletes,
    allowedTeams: new Set(['A队', 'B队']),
    conflictPolicy: 'skip',
  });
}

beforeEach(() => {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM audit_logs; DELETE FROM daily_wellness; DELETE FROM training_sessions;
    DELETE FROM strength_result_sets; DELETE FROM test_sessions; DELETE FROM test_measurements;
    DELETE FROM athlete_body_measurements; DELETE FROM injury_records;
    DELETE FROM competitive_state_assessments; DELETE FROM athlete_profiles;
    DELETE FROM athlete_origins; DELETE FROM athlete_aliases; DELETE FROM data_import_items;
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
  for (const athlete of [...athletes, { id: 9, name: '陈某', project: PROJECT, team: 'B队', gender: '男', birthDate: '' }])
    db.prepare(
      `INSERT INTO athletes (id, name, project, team, team_id, gender, birth_date, profile_status, active) VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', 1)`
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

describe('权限范围：别名匹配不得越权', () => {
  it('别名指向范围外运动员时不自动关联，进入待建档人工确认', () => {
    db.prepare(
      `INSERT INTO athlete_aliases (athlete_id, alias, normalized_alias, project) VALUES (9, '小陈', '小陈', ?)`
    ).run(PROJECT);
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时', '晨脉'],
        ['小陈', '2025-06-01', 7, 50],
      ],
    });
    const candidate = batch.athleteCandidates.find((entry) => entry.name === '小陈')!;
    expect(candidate.matchedAthleteId).toBeNull();
    expect(candidate.status).toBe('pending');
    const item = batch.items.find((entry) => entry.itemType === 'wellness')!;
    expect(item.athleteId).toBeNull();
  });

  it('别名指向范围内运动员时仍自动关联', () => {
    db.prepare(
      `INSERT INTO athlete_aliases (athlete_id, alias, normalized_alias, project) VALUES (1, '老张', '老张', ?)`
    ).run(PROJECT);
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时', '晨脉'],
        ['老张', '2025-06-02', 7, 50],
      ],
    });
    const candidate = batch.athleteCandidates.find((entry) => entry.name === '老张')!;
    expect(candidate.matchedAthleteId).toBe(1);
    expect(candidate.status).toBe('matched');
  });

  it('提交时拒绝草稿里越权的关联运动员，且不写入任何数据', () => {
    db.prepare(
      `INSERT INTO athlete_aliases (athlete_id, alias, normalized_alias, project) VALUES (9, '小陈', '小陈', ?)`
    ).run(PROJECT);
    const batch = analyze({
      恢复状态: [
        ['姓名', '日期', '睡眠小时', '晨脉'],
        ['小陈', '2025-06-03', 7, 50],
      ],
    });
    // 模拟旧数据/被篡改的草稿：候选直接关联到范围外运动员并标记已确认。
    db.prepare('UPDATE data_import_athlete_candidates SET matched_athlete_id = 9, confirmed = 1 WHERE batch_id = ?').run(
      batch.id
    );
    expect(() => commitBatch(batch.id)).toThrow(/不在当前权限范围内/);
    const wellness = db.prepare('SELECT COUNT(*) AS count FROM daily_wellness').get() as { count: number };
    expect(wellness.count).toBe(0);
    const sessions = db.prepare('SELECT COUNT(*) AS count FROM training_sessions').get() as { count: number };
    expect(sessions.count).toBe(0);
  });
});
