import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { initializeSystemData } from '../core/db-system-data.ts';

describe('数据库系统字典初始化', () => {
  it('重复启动不覆盖已存在的字典值', () => {
    const db = new DatabaseSync(':memory:');
    try {
      initializeSystemData(db);
      db.prepare(
        "UPDATE intensity_zone_definitions SET zone_name = '自定义分区名' WHERE zone_system = 'ROWING_U' AND zone_code = 'U3'"
      ).run();

      initializeSystemData(db);

      expect(
        db
          .prepare(
            "SELECT zone_name FROM intensity_zone_definitions WHERE zone_system = 'ROWING_U' AND zone_code = 'U3'"
          )
          .get()
      ).toEqual({ zone_name: '自定义分区名' });
      expect(db.prepare('SELECT COUNT(*) AS count FROM exercise_definitions').get()).toEqual({
        count: 13,
      });
    } finally {
      db.close();
    }
  });
});
