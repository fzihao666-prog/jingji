import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
import { db } from '../core/db.ts';
import { discardDataImport } from './discard-data-import.ts';

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE data_import_batches (
    id TEXT PRIMARY KEY, created_by INTEGER, project TEXT, status TEXT,
    imported_count INTEGER DEFAULT 0, committed_at TEXT
  );
  CREATE TABLE data_import_items (
    id INTEGER PRIMARY KEY, batch_id TEXT REFERENCES data_import_batches(id) ON DELETE CASCADE
  );
  CREATE TABLE data_import_athlete_candidates (
    id INTEGER PRIMARY KEY, batch_id TEXT REFERENCES data_import_batches(id) ON DELETE CASCADE
  );
  CREATE TABLE metric_scoring_rules (
    id INTEGER PRIMARY KEY, source_batch_id TEXT REFERENCES data_import_batches(id)
  );
`);
afterAll(() => db.close());
beforeEach(() => {
  db.exec(`DELETE FROM metric_scoring_rules; DELETE FROM data_import_batches;
    INSERT INTO data_import_batches(id, created_by, project, status) VALUES
      ('draft', 7, '赛艇', 'reviewing'), ('other', 8, '赛艇', 'reviewing');
    INSERT INTO data_import_items VALUES (1, 'draft'), (2, 'other');
    INSERT INTO data_import_athlete_candidates VALUES (1, 'draft'), (2, 'other');`);
});
const count = (table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;

describe('放弃待审核导入批次', () => {
  it('级联删除本批次暂存资料，保留其他批次，并允许后续数据库操作', () => {
    discardDataImport('draft', 7, '赛艇');
    expect(count('data_import_batches')).toBe(1);
    expect(count('data_import_items')).toBe(1);
    expect(count('data_import_athlete_candidates')).toBe(1);
    expect(db.prepare('SELECT id FROM data_import_batches').get()?.id).toBe('other');
    db.exec('BEGIN IMMEDIATE; ROLLBACK;');
  });
  it.each([
    ['draft', 8, '赛艇'],
    ['draft', 7, '皮划艇'],
    ['missing', 7, '赛艇'],
  ])('拒绝越权、跨项目或不存在的批次 %s %s %s', (id, userId, project) => {
    expect(() => discardDataImport(String(id), Number(userId), String(project))).toThrow('未找到');
    expect(count('data_import_batches')).toBe(2);
    expect(count('data_import_items')).toBe(2);
  });
  it.each(['committed', 'failed', 'rolled_back'])('拒绝非待审核状态 %s', (status) => {
    db.prepare('UPDATE data_import_batches SET status = ? WHERE id = ?').run(status, 'draft');
    expect(() => discardDataImport('draft', 7, '赛艇')).toThrow('仅可放弃');
    expect(count('data_import_items')).toBe(2);
  });
  it.each([
    ['imported_count', 1],
    ['committed_at', '2026-10-20'],
  ])('拒绝已有入库痕迹 %s', (column, value) => {
    db.prepare(`UPDATE data_import_batches SET ${column} = ? WHERE id = 'draft'`).run(value);
    expect(() => discardDataImport('draft', 7, '赛艇')).toThrow('仅可放弃');
    expect(count('data_import_batches')).toBe(2);
  });
  it('存在正式数据引用时回滚，保留批次和全部暂存资料', () => {
    db.exec("INSERT INTO metric_scoring_rules VALUES (1, 'draft')");
    expect(() => discardDataImport('draft', 7, '赛艇')).toThrow();
    expect(count('data_import_batches')).toBe(2);
    expect(count('data_import_items')).toBe(2);
    expect(count('data_import_athlete_candidates')).toBe(2);
    expect(count('metric_scoring_rules')).toBe(1);
    db.exec('BEGIN IMMEDIATE; ROLLBACK;');
  });
});
