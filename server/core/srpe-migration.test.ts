import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { migrateNullableSrpe } from './srpe-migration.ts';
it('备份后迁移缺失SRPE，保留真实零、子表、索引、序号，重复执行及失败回滚', () => {
  const folder = mkdtempSync(join(tmpdir(), 'jingji-srpe-'));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE training_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,duration_reported INTEGER,rpe REAL,srpe REAL NOT NULL DEFAULT 0);
 INSERT INTO training_sessions VALUES(1,0,5,0),(2,1,NULL,0),(3,1,0,0),(4,1,5,100),(80,1,5,100); DELETE FROM training_sessions WHERE id=80;
 CREATE TABLE child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES training_sessions(id) ON DELETE CASCADE); INSERT INTO child VALUES(1,1);
 CREATE INDEX idx_srpe_fixture ON training_sessions(rpe);`);
    const native = db.exec.bind(db);
    const spy = vi.spyOn(db, 'exec').mockImplementation((sql) => {
      if (sql.startsWith('CREATE INDEX idx_srpe_fixture')) throw new Error('测试失败');
      return native(sql);
    });
    expect(() => migrateNullableSrpe(db, join(folder, 'before.db'))).toThrow('测试失败');
    spy.mockRestore();
    expect(db.prepare('SELECT srpe FROM training_sessions WHERE id=1').get()).toEqual({ srpe: 0 });
    migrateNullableSrpe(db);
    migrateNullableSrpe(db);
    expect(db.prepare('SELECT srpe FROM training_sessions ORDER BY id').all()).toEqual([
      { srpe: null },
      { srpe: null },
      { srpe: 0 },
      { srpe: 100 },
    ]);
    expect(db.prepare('SELECT * FROM child').all()).toEqual([{ id: 1, parent: 1 }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      db.prepare('INSERT INTO training_sessions(duration_reported,rpe,srpe) VALUES(1,0,0)').run()
        .lastInsertRowid
    ).toBe(81);
    const backup = new DatabaseSync(join(folder, 'before.db'), { readOnly: true });
    try {
      expect(backup.prepare('SELECT srpe FROM training_sessions WHERE id=1').get()).toEqual({
        srpe: 0,
      });
    } finally {
      backup.close();
    }
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
