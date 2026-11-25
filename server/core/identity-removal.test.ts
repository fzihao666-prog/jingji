import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyIdentityRemoval, inspectIdentityRemoval } from './identity-removal.ts';

describe('身份证独立迁移', () => {
  it('保留业务数据与生日并递归清理身份证，重复执行安全', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `CREATE TABLE athletes(id INTEGER PRIMARY KEY, birth_date TEXT); INSERT INTO athletes VALUES(1,'2000-01-01'); CREATE TABLE athlete_profiles(athlete_id INTEGER REFERENCES athletes(id), identity_number TEXT, phone TEXT); INSERT INTO athlete_profiles VALUES(1,'110101200001011232','123'); CREATE TABLE data_import_items(id INTEGER PRIMARY KEY,payload_json TEXT,raw_value TEXT);`
      );
      db.prepare('INSERT INTO data_import_items VALUES(1,?,?)').run(
        JSON.stringify({
          nested: [{ identityNumber: '110101200001011232', score: 3 }],
          phone: '123',
        }),
        '证件110101200001011232'
      );
      expect(inspectIdentityRemoval(db).columns).toHaveLength(1);
      expect(applyIdentityRemoval(db).removedColumns).toBe(1);
      expect(db.prepare('SELECT * FROM athlete_profiles').get()).toEqual({
        athlete_id: 1,
        phone: '123',
      });
      expect(db.prepare('SELECT * FROM athletes').get()).toEqual({
        id: 1,
        birth_date: '2000-01-01',
      });
      expect(db.prepare('SELECT payload_json,raw_value FROM data_import_items').get()).toEqual({
        payload_json: '{"nested":[{"score":3}],"phone":"123"}',
        raw_value: '证件[已清除敏感信息]',
      });
      expect(applyIdentityRemoval(db).alreadyApplied).toBe(true);
    } finally {
      db.close();
    }
  });
  it('坏JSON和未知索引依赖均阻断且回滚', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `CREATE TABLE athlete_profiles(id INTEGER PRIMARY KEY,identity_number TEXT); CREATE TABLE history(id INTEGER PRIMARY KEY,payload_json TEXT); INSERT INTO history VALUES(1,'{bad');`
      );
      expect(() => applyIdentityRemoval(db)).toThrow('JSON');
      expect(inspectIdentityRemoval(db).columns).toHaveLength(1);
      db.exec(
        `DELETE FROM history; CREATE INDEX sensitive_index ON athlete_profiles(identity_number);`
      );
      expect(() => applyIdentityRemoval(db)).toThrow('依赖');
      expect(inspectIdentityRemoval(db).columns).toHaveLength(1);
    } finally {
      db.close();
    }
  });
  it('保留索引、元数据和外键；普通18位业务数字不会脱敏', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `PRAGMA foreign_keys=ON; CREATE TABLE athletes(id INTEGER PRIMARY KEY); INSERT INTO athletes VALUES(1); CREATE TABLE athlete_profiles(athlete_id INTEGER REFERENCES athletes(id), identity_number TEXT, phone TEXT); INSERT INTO athlete_profiles VALUES(1,'synthetic','123'); CREATE INDEX phone_index ON athlete_profiles(phone); CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO app_metadata VALUES('existing','retained'); CREATE TABLE notes(id INTEGER PRIMARY KEY,raw_value TEXT,password_hash TEXT); INSERT INTO notes VALUES(1,'110101200001011233','110101200001011232');`
      );
      applyIdentityRemoval(db);
      expect(db.prepare("SELECT value FROM app_metadata WHERE key='existing'").get()).toEqual({
        value: 'retained',
      });
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='phone_index'").get()).toEqual({
        name: 'phone_index',
      });
      expect(db.prepare('PRAGMA foreign_key_list(athlete_profiles)').all()).toHaveLength(1);
      expect(db.prepare('SELECT raw_value,password_hash FROM notes').get()).toEqual({
        raw_value: '110101200001011233',
        password_hash: '110101200001011232',
      });
    } finally {
      db.close();
    }
  });
  it('外键损坏时回滚字段删除和JSON清理', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `PRAGMA foreign_keys=OFF; CREATE TABLE athletes(id INTEGER PRIMARY KEY); CREATE TABLE athlete_profiles(athlete_id INTEGER REFERENCES athletes(id),identity_number TEXT); INSERT INTO athlete_profiles VALUES(999,'synthetic'); CREATE TABLE history(id INTEGER PRIMARY KEY,payload_json TEXT); INSERT INTO history VALUES(1,'{"id_card":"synthetic","score":2}');`
      );
      expect(() => applyIdentityRemoval(db)).toThrow('外键');
      expect(inspectIdentityRemoval(db).columns).toHaveLength(1);
      expect(db.prepare('SELECT payload_json FROM history').get()).toEqual({
        payload_json: '{"id_card":"synthetic","score":2}',
      });
    } finally {
      db.close();
    }
  });
  it('普通审计详情可迁移，JSON详情递归清理', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,detail TEXT); INSERT INTO audit_logs VALUES(1,'完成训练计划审核'); INSERT INTO audit_logs VALUES(2,'证件110101200001011232'); INSERT INTO audit_logs VALUES(3,'{"id_card_number":"synthetic","action":"保留"}');`
      );
      applyIdentityRemoval(db);
      expect(db.prepare('SELECT detail FROM audit_logs ORDER BY id').all()).toEqual([
        { detail: '完成训练计划审核' },
        { detail: '证件[已清除敏感信息]' },
        { detail: '{"action":"保留"}' },
      ]);
    } finally {
      db.close();
    }
  });
  it('支持无rowid复合主键历史表', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `CREATE TABLE history(batch TEXT,item INTEGER,payload_json TEXT,PRIMARY KEY(batch,item)) WITHOUT ROWID; INSERT INTO history VALUES('b',1,'{"身份证号":"synthetic","score":3}');`
      );
      applyIdentityRemoval(db);
      expect(db.prepare('SELECT * FROM history').get()).toEqual({
        batch: 'b',
        item: 1,
        payload_json: '{"score":3}',
      });
    } finally {
      db.close();
    }
  });
  it('计划JSON和自由文本JSON均递归删除身份证键，保留计划内容', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        `CREATE TABLE training_plans(id INTEGER PRIMARY KEY,plan_data TEXT,notes TEXT); INSERT INTO training_plans VALUES(1,'{"days":[{"identityNumber":"invalid","load":3}]}','{"身份证号":"invalid","text":"保留"}');`
      );
      applyIdentityRemoval(db);
      expect(db.prepare('SELECT * FROM training_plans').get()).toEqual({
        id: 1,
        plan_data: '{"days":[{"load":3}]}',
        notes: '{"text":"保留"}',
      });
    } finally {
      db.close();
    }
  });
});
