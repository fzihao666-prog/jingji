import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as XLSX from '@e965/xlsx';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../core/db-initialize.ts';
import type {
  TeamTrainingImportResult,
  TeamTrainingStatistics,
} from '../../shared/team-training-stats.ts';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));

const secret = 'synthetic-team-statistics-test';
let db: DatabaseSync;
let server: Server;
let base: string;
const date = '2025-12-29'; // 属于 2026 年 ISO 第 1 周。
const rowingSheet = '全队训练负荷';
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  db = new DatabaseSync(':memory:');
  fixture.db = db;
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
  db.exec(`
    INSERT INTO users(id,username,password_hash,display_name,role) VALUES
      (9701,'synthetic_team_stats','synthetic','合成教练','SCC'),
      (9702,'synthetic_team_athlete','synthetic','合成队员','ATL');
    INSERT INTO user_area_permissions(user_id,area_level,province,city,county,granted_by)
      VALUES(9701,'national','','','',9701);
    INSERT INTO user_project_permissions VALUES
      (9701,'ROWING',9701,CURRENT_TIMESTAMP),(9701,'CYCLING_ROAD',9701,CURRENT_TIMESTAMP);
    INSERT INTO user_team_permissions(user_id,project,team,granted_by) VALUES
      (9701,'ROWING','合成一队',9701),(9701,'CYCLING_ROAD','合成公路队',9701),
      (9701,'CYCLING_ROAD','合成周期队',9701);
    INSERT INTO project_teams(id,project,name) VALUES
      (9701,'ROWING','合成一队'),(9702,'ROWING','合成二队'),
      (9703,'CYCLING_ROAD','合成公路队'),(9704,'CYCLING_ROAD','合成周期队');
  `);
  const { registerTeamTrainingStatisticsRoutes } = await import('./team-training-routes.ts');
  const app = express();
  registerTeamTrainingStatisticsRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('未取得测试端口');
  base = `http://127.0.0.1:${address.port}/api/team-training-stats`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  vi.unstubAllEnvs();
});

const auth = (id = 9701) => ({
  Authorization: `Bearer ${jwt.sign({ id, sessionVersion: 1 }, secret)}`,
});
function workbook(
  sheetName: string,
  rows: unknown[][],
  configure?: (sheet: XLSX.WorkSheet) => void
) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  configure?.(sheet);
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  // 工作簿的其他工作表即使包含数值，也不属于队级导入来源。
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['日期', '错误来源'],
      [date, 1000],
    ]),
    '全年统计'
  );
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}
function rowing(rows: unknown[][]) {
  return workbook(
    rowingSheet,
    [
      ['日期', '3级有氧', null, '大力量', '恢复\n再生', '水上时间', '测功仪'],
      [null, 'HR＜75%', null, 'SM', 'RG'],
      [null, 'km', 'min', 'min', 'min', 'min', 'min'],
      ...rows,
    ],
    (sheet) => {
      sheet['!merges'] = ['A1:A3', 'B1:C1', 'B2:C2'].map(XLSX.utils.decode_range);
      sheet.G4 = { t: 'n', v: 99, f: 'RANDBETWEEN(1,100)' };
    }
  );
}
function upload(
  bytes: Uint8Array<ArrayBuffer>,
  target = { project: 'ROWING', teamId: 9701 },
  mappings = {},
  id = 9701
) {
  const body = new FormData();
  body.append('project', target.project);
  body.append('teamId', String(target.teamId));
  body.append('file', new Blob([bytes]), '合成训练.xlsx');
  body.append('mappings', JSON.stringify(mappings));
  return fetch(`${base}/import`, { method: 'POST', headers: auth(id), body });
}
const counts = () => db.prepare('SELECT COUNT(*) AS count FROM team_training_day_values').get();

it('拒绝匿名、运动员角色、非授权队伍和队伍项目不符', async () => {
  const bytes = rowing([[date, 2, 45, 20, 60, 999]]);
  expect((await fetch(`${base}?project=ROWING&teamId=9701`)).status).toBe(401);
  expect((await upload(bytes, undefined, {}, 9702)).status).toBe(403);
  expect((await upload(bytes, { project: 'ROWING', teamId: 9702 })).status).toBe(403);
  expect((await upload(bytes, { project: 'CYCLING_ROAD', teamId: 9701 })).status).toBe(403);
  expect((await fetch(`${base}?project=ROWING&teamId=9702`, { headers: auth() })).status).toBe(403);
  expect((await upload(bytes, { project: 'CYCLING_ROAD', teamId: 9703 })).status).toBe(400);
  expect(counts()).toEqual({ count: 0 });
});

it('保存带日期的原始分项，忽略无日期和公式，重传更新非空值并保留真实0', async () => {
  const before = db.prepare('SELECT COUNT(*) AS count FROM training_sessions').get();
  const original = rowing([
    [date, 2, 45, 20, 60, 999],
    [null, null, null, null, 60],
  ]);
  const first = await upload(original);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({
    status: 'imported',
    created: 4,
    updated: 0,
    unchanged: 0,
    undatedRows: 1,
    latestDate: date,
  });
  expect(await (await upload(original)).json()).toMatchObject({
    created: 0,
    updated: 0,
    unchanged: 4,
  });
  const change = await upload(rowing([[date, null, 0, 20]]));
  expect(await change.json()).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
  const response = await fetch(`${base}?project=ROWING&teamId=9701&date=2026-01-01`, {
    headers: auth(),
  });
  expect(response.status).toBe(200);
  const stats = (await response.json()) as TeamTrainingStatistics;
  expect(stats).toMatchObject({
    start: date,
    end: '2026-01-04',
    anchorDate: '2026-01-01',
    buckets: [
      { start: date, minutes: 80, distance: 2 },
      ...Array.from({ length: 6 }, () => ({ minutes: null, distance: null })),
    ],
  });
  expect(stats.categories).toContainEqual({
    category: '3级有氧',
    unit: 'min',
    value: 0,
    waterGroup: 'water',
    lessonGroup: 'main',
  });
  expect(stats.categories.map((item) => item.category)).not.toContain('测功仪');
  expect(stats.buckets[0]).toMatchObject({ start: date, water: 0, maxStrength: 20, minutes: 80 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM training_sessions').get()).toEqual(before);
});

it('新列须先映射，映射随同数据事务保存，其他队伍不共用', async () => {
  const bytes = workbook('队伍训练统计', [
    ['日期', '公路骑行（km）', '轮组重量（kg）'],
    [date, 20, 1.2],
    ['2025-12-30', null, 1.4],
  ]);
  const target = { project: 'CYCLING_ROAD', teamId: 9703 };
  const before = counts();
  const preview = (await (await upload(bytes, target)).json()) as TeamTrainingImportResult;
  expect(preview.status).toBe('mapping_required');
  if (preview.status !== 'mapping_required') throw Error('预期收到待映射列');
  expect(counts()).toEqual(before);
  expect(preview.columns.map((column) => column.unit)).toEqual(['km', 'kg']);
  const mappings = Object.fromEntries(
    preview.columns.map((column, index) => [
      column.key,
      { category: index === 0 ? '公路骑行' : '轮组重量', unit: column.unit },
    ])
  );
  const wrongUnit = {
    ...mappings,
    [preview.columns[0].key]: { category: '公路骑行', unit: 'min' },
  };
  expect((await upload(bytes, target, wrongUnit)).status).toBe(400);
  expect(counts()).toEqual(before);
  expect(await (await upload(bytes, target, mappings)).json()).toMatchObject({
    status: 'imported',
    created: 3,
  });
  expect(await (await upload(bytes, target)).json()).toMatchObject({
    status: 'imported',
    unchanged: 3,
  });
  const stats = (await (
    await fetch(`${base}?project=CYCLING_ROAD&teamId=9703`, { headers: auth() })
  ).json()) as TeamTrainingStatistics;
  expect(stats.buckets[0]).toMatchObject({ distance: 20, minutes: null });
  expect(stats.otherMeasures).toContainEqual({
    date,
    category: '轮组重量',
    unit: 'kg',
    value: 1.2,
    waterGroup: null,
    lessonGroup: null,
  });
  expect(stats.otherMeasures.map((item) => item.value)).toEqual([1.2, 1.4]);
  expect(await (await upload(bytes)).json()).toMatchObject({ status: 'mapping_required' });
});

it('无效日期和重复来源冲突都不写入，数据库写入失败时回滚映射和分项', async () => {
  const before = counts();
  expect((await upload(rowing([['2026-02-30', 2, 45]]))).status).toBe(400);
  expect(
    (
      await upload(
        rowing([
          [date, 2, 45],
          [date, 3, 45],
        ])
      )
    ).status
  ).toBe(400);
  const bytes = workbook('队伍训练统计', [
    ['日期', '新测试（min）'],
    [date, 12],
  ]);
  const preview = (await (await upload(bytes)).json()) as Extract<
    TeamTrainingImportResult,
    { status: 'mapping_required' }
  >;
  db.exec(`CREATE TRIGGER synthetic_stats_failure BEFORE INSERT ON audit_logs
    WHEN NEW.action='IMPORT_TEAM_TRAINING_STATS' BEGIN SELECT RAISE(ABORT,'合成写入失败'); END;`);
  try {
    expect(
      (
        await upload(bytes, undefined, {
          [preview.columns[0].key]: { category: '新测试', unit: 'min' },
        })
      ).status
    ).toBe(500);
  } finally {
    db.exec('DROP TRIGGER synthetic_stats_failure');
  }
  expect(counts()).toEqual(before);
  expect(await (await upload(bytes)).json()).toMatchObject({ status: 'mapping_required' });
});

it('按自然周、月和年取数，年视图按月汇总并保留非加总指标的原值', async () => {
  const target = { project: 'CYCLING_ROAD', teamId: 9704 };
  const bytes = workbook('队伍训练统计', [
    ['日期', '公路骑行（km）', '轮组重量（kg）'],
    ['2023-12-31', 100, 1.1],
    ['2024-01-01', 10, 1.2],
    ['2024-02-28', 0, 1.3],
    ['2024-02-29', 8, 1.4],
    ['2024-03-01', 2, 1.5],
    ['2024-12-31', 5, 1.6],
    ['2025-01-01', 200, 1.7],
  ]);
  const preview = (await (await upload(bytes, target)).json()) as TeamTrainingImportResult;
  if (preview.status !== 'mapping_required') throw Error('预期收到待映射列');
  const mappings = Object.fromEntries(
    preview.columns.map((column) => [
      column.key,
      { category: column.unit === 'km' ? '公路骑行' : '轮组重量', unit: column.unit },
    ])
  );
  expect(await (await upload(bytes, target, mappings)).json()).toMatchObject({
    status: 'imported',
    latestDate: '2025-01-01',
  });
  const get = (query: string) =>
    fetch(`${base}?project=${target.project}&teamId=${target.teamId}${query}`, { headers: auth() });
  const monthly = (await (
    await get('&period=month&date=2024-02-29')
  ).json()) as TeamTrainingStatistics;
  expect(monthly).toMatchObject({ start: '2024-02-01', end: '2024-02-29' });
  expect(monthly.buckets).toHaveLength(29);
  expect(monthly.buckets.slice(-3)).toMatchObject([
    { start: '2024-02-27', distance: null },
    { start: '2024-02-28', distance: 0 },
    { start: '2024-02-29', distance: 8 },
  ]);
  expect(monthly.categories).toMatchObject([{ category: '公路骑行', unit: 'km', value: 8 }]);
  expect(monthly.otherMeasures.map(({ value }) => value)).toEqual([1.3, 1.4]);

  const annual = (await (
    await get('&period=year&date=2024-12-31')
  ).json()) as TeamTrainingStatistics;
  expect(annual).toMatchObject({ start: '2024-01-01', end: '2024-12-31' });
  expect(annual.buckets).toHaveLength(12);
  expect(annual.buckets.map(({ distance }) => distance)).toEqual([
    10,
    8,
    2,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    5,
  ]);
  expect(annual.categories).toMatchObject([{ value: 25 }]);
  expect(annual.otherMeasures.map(({ value }) => value)).toEqual([1.2, 1.3, 1.4, 1.5, 1.6]);

  const latest = (await (await get('')).json()) as TeamTrainingStatistics;
  expect(latest).toMatchObject({
    start: '2024-12-30',
    end: '2025-01-05',
    anchorDate: '2025-01-01',
  });
  expect((await get('&period=quarter')).status).toBe(400);
  expect((await get('&period=month&date=2025-02-29')).status).toBe(400);
});
