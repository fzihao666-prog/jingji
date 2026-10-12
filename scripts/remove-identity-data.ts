import { lstatSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  inspectIdentityRemoval,
  auditIdentityRemoval,
  applyIdentityRemoval,
} from '../server/core/identity-removal.js';
import {
  compactIdentityDatabase,
  createIdentityBackup,
  verifyIdentityDatabase,
  IdentityMaintenanceError,
} from '../server/core/identity-removal-backup.js';

let committed = false;
let compactOnly = false;
let db: DatabaseSync | undefined;
try {
  const { values } = parseArgs({
    options: {
      database: { type: 'string' },
      'backup-dir': { type: 'string' },
      apply: { type: 'boolean' },
      audit: { type: 'boolean' },
      'writers-stopped': { type: 'boolean' },
      'compact-only': { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  });
  const options = z
    .strictObject({
      database: z.string().trim().min(1).max(4096),
      'backup-dir': z.string().trim().min(1).max(4096).optional(),
      apply: z.boolean().optional(),
      audit: z.boolean().optional(),
      'writers-stopped': z.boolean().optional(),
      'compact-only': z.boolean().optional(),
    })
    .parse(values);
  compactOnly = Boolean(options['compact-only']);
  if ((options.apply && compactOnly) || (options.audit && (options.apply || compactOnly)))
    throw new Error('invalid combination');
  if ((options.apply || compactOnly) && !options['writers-stopped'])
    throw new Error('writers confirmation required');
  if (options.apply && !options['backup-dir']) throw new Error('backup required');
  if (!lstatSync(options.database).isFile()) throw new Error('existing database required');
  const database = realpathSync(options.database);
  db = new DatabaseSync(database, { readOnly: !options.apply && !compactOnly });
  if (compactOnly) {
    verifyIdentityDatabase(db);
    compactIdentityDatabase(db);
    console.log(JSON.stringify({ database, status: '整理完成' }));
  } else {
    const inspection = inspectIdentityRemoval(db);
    console.log(JSON.stringify({ database, ...inspection }));
    if (options.audit) console.log(JSON.stringify(auditIdentityRemoval(db)));
    if (options.apply) {
      if (inspection.dependencies.length) throw new Error('unsupported dependency');
      const backup = createIdentityBackup(db, database, options['backup-dir']!);
      console.log(
        JSON.stringify({
          backup,
          status: '备份校验通过；原始备份仍含身份证，须独立制定保留期限与安全销毁策略',
        })
      );
      const result = applyIdentityRemoval(db);
      committed = true;
      console.log(JSON.stringify({ ...result, status: '迁移已提交，开始整理' }));
      compactIdentityDatabase(db);
      console.log(JSON.stringify({ status: '迁移及整理校验完成' }));
    }
  }
} catch (error) {
  if (error instanceof IdentityMaintenanceError && error.status === 'database-invalid') {
    console.error('数据库完整性或外键检查失败，维护已阻断；需先修复原库完整性。');
  }
  console.error(
    committed
      ? '迁移已提交，但整理失败。保持停写，使用 --compact-only --writers-stopped --database 显式路径重试整理。'
      : compactOnly
        ? '整理失败；保持停写并排查数据库占用与完整性后重试。'
        : '维护未完成；请检查显式路径、参数、停写确认、结构依赖、数据库完整性与备份目录权限。未输出任何业务值或底层错误。'
  );
  process.exitCode = 1;
} finally {
  try {
    db?.close();
  } catch {
    process.exitCode = 1;
  }
}
