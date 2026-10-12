import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { initializeDatabase } from './db-initialize.ts';

const options = { databasePath: ':memory:', databaseExistedBeforeStartup: true };
describe('注册人口信息历史迁移', () => {
  it.each(['ATL', 'athlete'])('兼容旧角色表%s并保留身份证，重复初始化不覆盖新生日', (role) => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `CREATE TABLE registration_requests (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, display_name TEXT, requested_role TEXT CHECK(requested_role IN ('${role}', 'coach')), project TEXT, team TEXT, gender TEXT, identity_number TEXT, native_place TEXT, phone TEXT, region TEXT, city TEXT, county TEXT, status TEXT, reviewed_by INTEGER, reviewed_at TEXT, created_at TEXT)`
      );
      const insert = db.prepare(
        "INSERT INTO registration_requests (id,username,password_hash,display_name,requested_role,identity_number,status,created_at) VALUES (?,?,'hash','历史申请',?,?, 'pending',CURRENT_TIMESTAMP)"
      );
      insert.run(1, 'legacy_valid', role, '510107200002291234');
      insert.run(2, 'legacy_invalid', role, '510107200102291234');
      initializeDatabase(db, options);
      expect(
        db.prepare('SELECT birth_date,identity_number FROM registration_requests WHERE id=1').get()
      ).toEqual({ birth_date: '2000-02-29', identity_number: '510107200002291234' });
      expect(db.prepare('SELECT birth_date FROM registration_requests WHERE id=2').get()).toEqual({
        birth_date: null,
      });
      db.exec("UPDATE registration_requests SET birth_date='1999-01-01' WHERE id=1");
      initializeDatabase(db, options);
      expect(
        db.prepare('SELECT birth_date,identity_number FROM registration_requests WHERE id=1').get()
      ).toEqual({ birth_date: '1999-01-01', identity_number: '510107200002291234' });
    } finally {
      db.close();
    }
  });
});
