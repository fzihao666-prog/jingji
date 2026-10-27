import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initializeDatabase } from './db-initialize.ts';
import { saveTestSession } from './test-session-store.ts';
it('同日不同协议和试次独立保存，重试不重复', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
    db.exec("INSERT INTO athletes(id,name,project) VALUES(99001,'合成测试','VOLLEYBALL')");
    const base = { athleteId: 99001, date: '2026-10-10', type: '体能测试', source: 'manual', createdBy: null };
    const first = saveTestSession(db, { ...base, protocol: 'CMJ' });
    const second = saveTestSession(db, { ...base, protocol: 'SJ' });
    expect(first.id).not.toBe(second.id);
    expect(saveTestSession(db, { ...base, protocol: 'CMJ' }).id).toBe(first.id);
    expect(saveTestSession(db, { ...base, protocol: 'CMJ', attempt: 2 }).id).not.toBe(first.id);
    expect(db.prepare('SELECT project_code, project_status FROM test_sessions WHERE id=?').get(first.id)).toMatchObject({ project_code: 'VOLLEYBALL', project_status: 'confirmed' });
    initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: true });
    expect(saveTestSession(db, { ...base, protocol: 'CMJ' }).id).toBe(first.id);
    expect(db.prepare('SELECT COUNT(*) AS total FROM test_sessions WHERE athlete_id=99001').get()).toEqual({ total: 3 });
  } finally { db.close(); }
});
