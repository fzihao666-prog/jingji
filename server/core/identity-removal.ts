import type { DatabaseSync } from 'node:sqlite';

export const IDENTITY_REMOVAL_VERSION = 'identity_removal_v1';
type Column = { table: string; column: string };
type Schema = { type: string; name: string; sql: string | null };
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const identityKey = (key: string) =>
  /^(identitynumber|idcard|idcardnumber|身份证|身份证号|身份证号码)$/i.test(
    key.replace(/[_\s-]/g, '')
  );
const redact = (value: string) =>
  value.replace(/(?<![\dA-Za-z])\d{17}[\dXx](?![\dA-Za-z])/g, (candidate) => {
    const digits = candidate.slice(6, 14);
    const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
      return candidate;
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const sum = weights.reduce(
      (total, weight, index) => total + Number(candidate[index]) * weight,
      0
    );
    return '10X98765432'[sum % 11] === candidate[17].toUpperCase() ? '[已清除敏感信息]' : candidate;
  });

/** 只检查结构，不读取或输出任何个人数据。 */
export function inspectIdentityRemoval(db: DatabaseSync) {
  const schema = db
    .prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
    .all() as Schema[];
  const columns: Column[] = [],
    jsonColumns: Column[] = [],
    textColumns: Column[] = [];
  for (const table of schema.filter((item) => item.type === 'table')) {
    const fields = db.prepare(`PRAGMA table_xinfo(${quote(table.name)})`).all() as Array<{
      name: string;
      type: string;
      hidden: number;
      pk: number;
    }>;
    for (const field of fields) {
      if (field.hidden) continue;
      const item = { table: table.name, column: field.name };
      if (identityKey(field.name)) columns.push(item);
      else if (
        field.name.endsWith('_json') ||
        field.name === 'plan_data' ||
        (table.name === 'audit_logs' && field.name === 'detail')
      )
        jsonColumns.push(item);
      else if (
        /TEXT|CHAR|CLOB/i.test(field.type) &&
        !field.pk &&
        table.name !== 'app_metadata' &&
        !/(?:^id$|_id$|hash|token|password|secret|business_key|account_code)/i.test(field.name)
      )
        textColumns.push(item);
    }
  }
  const dependencies = schema
    .filter(
      (item) =>
        item.type !== 'table' && (item.sql ?? '').split(/[^\p{L}\p{N}_-]+/u).some(identityKey)
    )
    .map(({ type, name }) => ({ type, name }));
  return { pending: columns.length > 0, columns, dependencies, jsonColumns, textColumns };
}
function scrub(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !identityKey(key))
        .map(([key, item]) => [key, scrub(item)])
    );
  return value;
}
function rowKeys(db: DatabaseSync, table: string) {
  const schema = db
    .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?")
    .get(table) as { sql: string };
  if (!/WITHOUT\s+ROWID/i.test(schema.sql)) return ['rowid'];
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{
    name: string;
    pk: number;
  }>;
  return columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
}
function changes(db: DatabaseSync, mutate: boolean) {
  const plan = inspectIdentityRemoval(db);
  let jsonRows = 0,
    textRows = 0,
    invalidJsonRows = 0;
  for (const [json, fields] of [
    [true, plan.jsonColumns],
    [false, plan.textColumns],
  ] as const) {
    for (const { table, column } of fields) {
      const keys = rowKeys(db, table);
      const keySelection = keys
        .map((key, index) => `${quote(key)} AS ${quote(`__migration_key_${index}`)}`)
        .join(',');
      const rows = db
        .prepare(
          `SELECT ${keySelection},${quote(column)} AS value FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL AND ${quote(column)} != ''`
        )
        .all();
      for (const row of rows) {
        if (typeof row.value !== 'string') continue;
        let next: string;
        const strictJson =
          json &&
          !(table === 'audit_logs' && column === 'detail' && !/^[{[]/.test(row.value.trim()));
        const possibleJson = strictJson || /^[{[]/.test(row.value.trim());
        if (possibleJson) {
          try {
            const parsed: unknown = JSON.parse(row.value);
            const cleaned = scrub(parsed);
            next = JSON.stringify(cleaned);
            if (next === JSON.stringify(parsed)) continue;
          } catch {
            if (strictJson) {
              invalidJsonRows++;
              continue;
            }
            next = redact(row.value);
            if (next === row.value) continue;
          }
        } else {
          next = redact(row.value);
          if (next === row.value) continue;
        }
        if (json) jsonRows++;
        else textRows++;
        if (mutate)
          db.prepare(
            `UPDATE ${quote(table)} SET ${quote(column)}=? WHERE ${keys.map((key) => `${quote(key)}=?`).join(' AND ')}`
          ).run(
            next,
            ...keys.map((_, index) => row[`__migration_key_${index}`] as string | number | null)
          );
      }
    }
  }
  return { jsonRows, textRows, invalidJsonRows };
}
/** 审计仅返回数量；不记录字段内容。 */
export function auditIdentityRemoval(db: DatabaseSync) {
  return changes(db, false);
}

/** 仅供已确认的离线维护工具调用；不备份、不自动启动、不执行 VACUUM。 */
export function applyIdentityRemoval(db: DatabaseSync) {
  const version = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
  const [major, minor] = version.version.split('.').map(Number);
  if (major < 3 || (major === 3 && minor < 35))
    throw new Error('身份证清理要求 SQLite 3.35 或以上版本');
  db.exec('PRAGMA secure_delete=ON');
  db.exec('BEGIN IMMEDIATE');
  try {
    const plan = inspectIdentityRemoval(db);
    if (plan.dependencies.length) throw new Error('身份证字段存在未知结构依赖，需人工处理后迁移');
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'app_metadata'"
      )
      .all() as Array<{ name: string }>;
    const snapshot = () =>
      tables.map(({ name }) => ({
        name,
        rows: db
          .prepare(
            `SELECT ${rowKeys(db, name).map(quote).join(',')} FROM ${quote(name)} ORDER BY ${rowKeys(db, name).map(quote).join(',')}`
          )
          .all(),
      }));
    const before = JSON.stringify(snapshot());
    const result = changes(db, true);
    if (result.invalidJsonRows) throw new Error('历史JSON格式无效，迁移已回滚');
    for (const { table, column } of plan.columns)
      db.exec(`ALTER TABLE ${quote(table)} DROP COLUMN ${quote(column)}`);
    if (before !== JSON.stringify(snapshot())) throw new Error('迁移改变了业务行或核心ID');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('迁移外键检查失败');
    const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string;
    }>;
    if (integrity.some((row) => row.integrity_check !== 'ok'))
      throw new Error('迁移完整性检查失败');
    db.exec(
      'CREATE TABLE IF NOT EXISTS app_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    );
    const alreadyApplied = Boolean(
      db.prepare('SELECT 1 FROM app_metadata WHERE key=?').get(IDENTITY_REMOVAL_VERSION)
    );
    db.prepare(
      "INSERT INTO app_metadata(key,value) VALUES(?,'completed') ON CONFLICT(key) DO UPDATE SET value='completed'"
    ).run(IDENTITY_REMOVAL_VERSION);
    db.exec('COMMIT');
    return {
      removedColumns: plan.columns.length,
      cleanedJsonRows: result.jsonRows,
      cleanedTextRows: result.textRows,
      alreadyApplied,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
