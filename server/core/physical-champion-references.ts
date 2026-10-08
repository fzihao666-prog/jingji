import type { DatabaseSync } from 'node:sqlite';
import { PHYSICAL_CHAMPION_DIMENSIONS } from '../../shared/physical-champion.ts';

const tables = ['radar_reference_sources', 'radar_reference_values'] as const;

/** 扩展原有参考表；事务重建保留记录、外键、索引和触发器。 */
function migrateReferenceTables(db: DatabaseSync) {
  const schemas = tables.map((name) => ({
    name,
    sql: (
      db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', name) as
        { sql: string } | undefined
    )?.sql,
  }));
  if (schemas.some((schema) => !schema.sql)) throw new Error('冠军参考表尚未初始化');
  const projectCheck = /CHECK\s*\(\s*project\s*(?:=\s*'[^']+'|IN\s*\([^)]*\))\s*\)/gi;
  const needsRebuild = schemas.some((schema) => {
    const constraints = schema.sql!.match(projectCheck) || [];
    return constraints.some(
      (constraint) =>
        !constraint.includes("'CANOE_SPRINT'") || !constraint.includes("'CANOE_SLALOM'")
    );
  });
  const foreignKeys = Number(
    (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys
  );
  if (db.isTransaction) throw new Error('冠军参考迁移必须在独立事务中执行');
  if (needsRebuild) db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (needsRebuild) {
      const sequences = db
        .prepare('SELECT name, seq FROM sqlite_sequence WHERE name IN (?, ?)')
        .all(...tables) as { name: string; seq: number }[];
      const objects = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND tbl_name IN (?, ?) AND sql IS NOT NULL"
        )
        .all(...tables) as { sql: string }[];
      for (const schema of schemas) {
        const next = `${schema.name}_physical_next`;
        const sql = schema
          .sql!.replace(
            projectCheck,
            "CHECK(project IN ('ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM', 'CANOE', 'SLALOM'))"
          )
          .replace(
            new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?["\x60]?${schema.name}["\x60]?`, 'i'),
            `CREATE TABLE ${next}`
          );
        db.exec(sql);
        db.exec(`INSERT INTO ${next} SELECT * FROM ${schema.name}`);
      }
      db.exec(
        'DROP TABLE radar_reference_values; DROP TABLE radar_reference_sources; ALTER TABLE radar_reference_sources_physical_next RENAME TO radar_reference_sources; ALTER TABLE radar_reference_values_physical_next RENAME TO radar_reference_values'
      );
      for (const object of objects) db.exec(object.sql);
      // 保留已删除记录占用过的自增范围，避免新标准复用旧标识符。
      for (const sequence of sequences) {
        db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(
          sequence.seq,
          sequence.name
        );
      }
    }
    const columns = new Set(
      (db.prepare('PRAGMA table_info(radar_reference_values)').all() as { name: string }[]).map(
        (column) => column.name
      )
    );
    const additions = {
      source_id: 'INTEGER REFERENCES radar_reference_sources(id) ON DELETE RESTRICT',
      revision: 'INTEGER NOT NULL DEFAULT 0',
      source_type:
        "TEXT NOT NULL DEFAULT 'public_reference' CHECK(source_type IN ('measured', 'public_reference', 'estimated'))",
      protocol: "TEXT NOT NULL DEFAULT ''",
      event_group: "TEXT NOT NULL DEFAULT 'open'",
      weight_class: "TEXT NOT NULL DEFAULT 'open'",
      age_group: "TEXT NOT NULL DEFAULT 'adult'",
      direction:
        "TEXT NOT NULL DEFAULT 'higher_better' CHECK(direction IN ('higher_better', 'lower_better'))",
    };
    for (const [name, declaration] of Object.entries(additions)) {
      if (!columns.has(name))
        db.exec(`ALTER TABLE radar_reference_values ADD COLUMN ${name} ${declaration}`);
    }
    // 早期参考表没有来源外键。只补关联，不猜测其原始出处或测试协议。
    const unlinkedProjects = db
      .prepare('SELECT DISTINCT project FROM radar_reference_values WHERE source_id IS NULL')
      .all() as { project: string }[];
    const legacyName = '历史参考来源未关联（待人工核实；链接仅为管理占位）';
    for (const { project } of unlinkedProjects) {
      db.prepare(
        `INSERT OR IGNORE INTO radar_reference_sources (project, name, url, source_year, protocol, verified_at)
        VALUES (?, ?, 'https://www.sport.gov.cn/', 2026, '历史协议未确认', '待核实')`
      ).run(project, legacyName);
      const source = db
        .prepare(
          `SELECT id FROM radar_reference_sources WHERE project = ? AND name = ?
        AND url = 'https://www.sport.gov.cn/' AND source_year = 2026 AND protocol = '历史协议未确认'`
        )
        .get(project, legacyName) as { id: number };
      db.prepare(
        'UPDATE radar_reference_values SET source_id = ? WHERE project = ? AND source_id IS NULL'
      ).run(source.id, project);
    }
    if (db.prepare('PRAGMA foreign_key_check(radar_reference_values)').all().length)
      throw new Error('冠军参考迁移外键检查失败');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    if (needsRebuild && foreignKeys) db.exec('PRAGMA foreign_keys = ON');
  }
}

// 参考科研中的能力维度与量级制定可校准基线，数值均为估算，绝非冠军个人实测。
const referenceBaselines = {
  ROWING: { 男: [2, 1.4, 1.2, 55, 65, 240, 13, 72], 女: [1.7, 1.15, 0.95, 42, 60, 210, 10.5, 64] },
  CANOE_SPRINT: {
    男: [1.8, 1.5, 1.15, 55, 70, 240, 14, 65],
    女: [1.5, 1.2, 0.9, 42, 62, 210, 11, 58],
  },
  CANOE_SLALOM: {
    男: [1.8, 1.4, 1.1, 52, 65, 240, 13, 60],
    女: [1.5, 1.1, 0.85, 40, 58, 210, 10, 54],
  },
} as const;

export function initializePhysicalChampionReferences(db: DatabaseSync) {
  migrateReferenceTables(db);
  const insertSource = db.prepare(`INSERT OR IGNORE INTO radar_reference_sources
    (project, name, url, source_year, protocol, verified_at) VALUES (?, ?, ?, 2026, ?, '2026-10-08')`);
  const selectSource = db.prepare(
    'SELECT id FROM radar_reference_sources WHERE project = ? AND name = ? AND protocol = ?'
  );
  const existing =
    db.prepare(`SELECT 1 FROM radar_reference_values WHERE project IN (?, ?) AND radar_kind = 'physical'
    AND metric_key = ? AND gender = ? AND trim(protocol) <> '' AND boat_class = '' AND event_group = 'open' AND weight_class = 'open' AND age_group = 'adult' LIMIT 1`);
  const insertValue = db.prepare(`INSERT INTO radar_reference_values
    (source_id, project, radar_kind, metric_key, gender, boat_class, applicability, value_num, unit, source_type, protocol, event_group, weight_class, age_group, direction)
    VALUES (?, ?, 'physical', ?, ?, '', ?, ?, ?, 'estimated', ?, 'open', 'open', 'adult', ?)`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [project, genders] of Object.entries(referenceBaselines)) {
      const name = '成年开放组高水平体能参考基线（估算，可人工校准）';
      const protocol = '按各维度独立测试协议比较；不跨协议混算';
      const url =
        project === 'ROWING'
          ? 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12538512/'
          : project === 'CANOE_SPRINT'
            ? 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9354820/'
            : 'https://www.intjmorphol.com/wp-content/uploads/2023/07/Art_25_414_2023.pdf';
      insertSource.run(project, name, url, protocol);
      const source = selectSource.get(project, name, protocol) as { id: number };
      for (const [gender, values] of Object.entries(genders)) {
        PHYSICAL_CHAMPION_DIMENSIONS.forEach((dimension, index) => {
          // 已有标准（包括停用标准）均不覆盖，也不通过新 seed 重新启用。
          if (
            existing.get(
              project,
              project === 'CANOE_SPRINT'
                ? 'CANOE'
                : project === 'CANOE_SLALOM'
                  ? 'SLALOM'
                  : project,
              dimension.key,
              gender
            )
          )
            return;
          insertValue.run(
            source.id,
            project,
            dimension.key,
            gender,
            '成人开放组估算参考；非冠军实测；不适用于未成年、轻量级或专项分组',
            values[index],
            dimension.unit,
            dimension.protocol,
            dimension.direction
          );
        });
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
