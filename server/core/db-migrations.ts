import type { DatabaseSync } from 'node:sqlite';

function tableExists(db: DatabaseSync, table: string) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}

function hasColumn(db: DatabaseSync, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (item) => item.name === column
  );
}

/** 保留旧版冠军模型数据，并腾出新版 schema 使用的索引名。 */
export function preserveLegacySpecialChampionModels(db: DatabaseSync) {
  const source = 'special_champion_models';
  const archive = 'special_champion_models_legacy_v1';
  const hasLegacyShape =
    tableExists(db, source) &&
    (hasColumn(db, source, 'standard_type') ||
      hasColumn(db, source, 'event_group') ||
      hasColumn(db, source, 'competition_date'));
  if (!hasLegacyShape) return;
  if (tableExists(db, archive)) {
    throw new Error(`旧版 ${source} 与归档表 ${archive} 同时存在；拒绝覆盖任一表。`);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`ALTER TABLE ${source} RENAME TO ${archive}`);
    // SQLite 重命名表时保留索引；该名称需由后续新版 schema 建在新表上。
    db.exec('DROP INDEX IF EXISTS idx_special_champion_models_lookup');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
