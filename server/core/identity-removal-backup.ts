import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class IdentityMaintenanceError extends Error {
  constructor(public readonly status: 'database-invalid' | 'backup-failed' | 'compaction-failed') {
    super(status);
  }
}

/** 只返回检查状态，绝不传播可能包含业务值的 SQLite 诊断。 */
export function verifyIdentityDatabase(db: DatabaseSync): void {
  const rows = db.prepare('PRAGMA integrity_check').all();
  if (
    rows.length !== 1 ||
    rows[0].integrity_check !== 'ok' ||
    db.prepare('PRAGMA foreign_key_check').all().length
  )
    throw new IdentityMaintenanceError('database-invalid');
}

/** VACUUM INTO 包含 WAL 中已提交的数据；独占预留文件避免覆盖已有备份。 */
export function createIdentityBackup(
  db: DatabaseSync,
  database: string,
  backupDirectory: string
): string {
  verifyIdentityDatabase(db);
  try {
    const directory = resolve(backupDirectory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
      throw new Error('invalid directory');
    chmodSync(directory, 0o700);
    const destination = join(
      realpathSync(directory),
      `identity-before-removal-${randomUUID()}.sqlite`
    );
    if (destination === realpathSync(database)) throw new Error('source collision');
    const descriptor = openSync(destination, 'wx', 0o600);
    closeSync(descriptor);
    db.prepare('VACUUM INTO ?').run(destination);
    chmodSync(destination, 0o600);
    const backup = new DatabaseSync(destination, { readOnly: true });
    try {
      verifyIdentityDatabase(backup);
    } finally {
      backup.close();
    }
    return destination;
  } catch {
    throw new IdentityMaintenanceError('backup-failed');
  }
}

/** 迁移提交后的独立整理步骤，失败时可通过 compact-only 重试。 */
export function compactIdentityDatabase(db: DatabaseSync): void {
  try {
    const checkpoint = () => {
      const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (!result || Number(result.busy) !== 0) throw new Error('busy');
    };
    checkpoint();
    db.exec('VACUUM');
    checkpoint();
    verifyIdentityDatabase(db);
  } catch {
    throw new IdentityMaintenanceError('compaction-failed');
  }
}
