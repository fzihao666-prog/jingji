import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initializeDatabase } from './db-initialize.ts';

it('初始化不运行雷达和训练量演示补数', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: false });
    const backfills = db.prepare(
      'SELECT key FROM app_metadata WHERE key IN (?, ?)'
    );
    expect(backfills.all('overview_radar_metric_gap_seed_v2', 'training_volume_demo_seed_v1')).toEqual([]);
  } finally {
    db.close();
  }
});
