import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  canEditPhysicalChampionValues,
  canManageGlobalPhysicalReferences,
} from '../../shared/physical-champion-policy.ts';
import type { DatabaseSync } from 'node:sqlite';
import {
  PHYSICAL_CHAMPION_DIMENSIONS,
  physicalReferenceDraftSchema,
  physicalChampionValuesSchema,
} from '../../shared/physical-champion.ts';

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
    return (
      (schema.name === 'radar_reference_values' &&
        /CHECK\s*\(\s*gender\s+IN/i.test(schema.sql!) &&
        !/gender\s+IN\s*\([^)]*'open'/i.test(schema.sql!)) ||
      (schema.name === 'radar_reference_sources' && /CHECK\s*\(\s*url\s+LIKE/i.test(schema.sql!)) ||
      constraints.some(
        (constraint) =>
          !constraint.includes("'VOLLEYBALL'") ||
          !constraint.includes("'CYCLING_ROAD'") ||
          !constraint.includes("'CYCLING_TRACK'")
      )
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
            "CHECK(project IN ('ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM', 'CANOE', 'SLALOM', 'CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'))"
          )
          .replace(
            /CHECK\s*\(\s*gender\s+IN\s*\([^)]*\)\s*\)/gi,
            "CHECK(gender IN ('男','女','open'))"
          )
          .replace(
            /CHECK\s*\(\s*url\s+LIKE\s+'https:\/\/%'\s+OR\s+url\s+LIKE\s+'http:\/\/%'\s*\)/gi,
            "CHECK(url = '' OR url LIKE 'https://%' OR url LIKE 'http://%')"
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
      protocol_version: "TEXT NOT NULL DEFAULT ''",
      test_context: "TEXT NOT NULL DEFAULT ''",
      side: "TEXT NOT NULL DEFAULT 'center' CHECK(side IN ('center','bilateral','left','right'))",
      event_group: "TEXT NOT NULL DEFAULT 'open'",
      weight_class: "TEXT NOT NULL DEFAULT 'open'",
      age_group: "TEXT NOT NULL DEFAULT 'adult'",
      review_status:
        "TEXT NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','reviewed','disabled'))",
      source_nature:
        "TEXT NOT NULL DEFAULT 'unverified' CHECK(source_nature IN ('official_research','expert','team','estimated','unverified'))",
      version: 'INTEGER NOT NULL DEFAULT 1',
      parent_id: 'INTEGER REFERENCES radar_reference_values(id)',
      reference_root_id: 'INTEGER REFERENCES radar_reference_values(id)',
      effective_from: 'TEXT',
      effective_to: 'TEXT',
      position: "TEXT NOT NULL DEFAULT 'open'",
      reference_level: "TEXT NOT NULL DEFAULT 'open'",
      reference_label: "TEXT NOT NULL DEFAULT ''",
      dimension_version: "TEXT NOT NULL DEFAULT ''",
      measurement_codes: "TEXT NOT NULL DEFAULT '[]'",
      measurement_unit: "TEXT NOT NULL DEFAULT ''",
      weight_relative: 'INTEGER NOT NULL DEFAULT 0',
      reviewed_by: 'INTEGER',
      reviewed_at: 'TEXT',
      direction:
        "TEXT NOT NULL DEFAULT 'higher_better' CHECK(direction IN ('higher_better', 'lower_better'))",
    };
    for (const [name, declaration] of Object.entries(additions)) {
      if (!columns.has(name))
        db.exec(`ALTER TABLE radar_reference_values ADD COLUMN ${name} ${declaration}`);
    }
    for (const dimension of PHYSICAL_CHAMPION_DIMENSIONS) {
      db.prepare(
        `UPDATE radar_reference_values SET measurement_codes=?, measurement_unit=?, weight_relative=?, dimension_version='legacy-unreviewed'
        WHERE project IN ('ROWING','CANOE_SPRINT','CANOE_SLALOM','CANOE','SLALOM') AND metric_key=? AND dimension_version=''`
      ).run(
        JSON.stringify(dimension.codes),
        dimension.measurementUnit,
        Number(dimension.weightRelative),
        dimension.key
      );
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
    AND metric_key = ? AND gender = ? AND (trim(protocol) <> '' OR (source_type='estimated' AND dimension_version='legacy-unreviewed')) AND boat_class = '' AND event_group = 'open' AND weight_class = 'open' AND age_group = 'adult' LIMIT 1`);
  const insertValue = db.prepare(`INSERT INTO radar_reference_values
    (source_id, project, radar_kind, metric_key, gender, boat_class, applicability, value_num, unit, source_type, protocol, event_group, weight_class, age_group, direction, source_nature, measurement_codes, measurement_unit, weight_relative, dimension_version)
    VALUES (?, ?, 'physical', ?, ?, '', ?, ?, ?, 'estimated', ?, 'open', 'open', 'adult', ?, 'estimated', ?, ?, ?, 'legacy-unreviewed')`);
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
            dimension.direction,
            JSON.stringify(dimension.codes),
            dimension.measurementUnit,
            Number(dimension.weightRelative)
          );
        });
      }
    }
    for (const dimension of PHYSICAL_CHAMPION_DIMENSIONS) {
      db.prepare(
        `UPDATE radar_reference_values SET
        protocol=CASE WHEN trim(protocol)='' THEN ? ELSE protocol END,
        protocol_version=COALESCE(protocol_version,''), test_context=COALESCE(test_context,''),
        effective_from=COALESCE(effective_from, (SELECT printf('%04d-01-01',source_year) FROM radar_reference_sources WHERE id=source_id)),
        source_nature='estimated'
        WHERE radar_kind='physical' AND metric_key=? AND dimension_version='legacy-unreviewed' AND source_type='estimated' AND (trim(protocol)='' OR protocol_version IS NULL OR test_context IS NULL OR effective_from IS NULL OR source_nature<>'estimated')`
      ).run(dimension.protocol, dimension.key);
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export class PhysicalReferenceError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

type ReferenceActor = {
  id: number;
  role: string;
  permissions: Parameters<typeof canManageGlobalPhysicalReferences>[1];
};
function authorizeReference(actor: ReferenceActor) {
  if (!canManageGlobalPhysicalReferences(actor.role, actor.permissions))
    throw new PhysicalReferenceError(403, '维护全局标准需要全国、全部项目及全部队伍管理权限。');
}
function assertNoReferenceOverlap(
  db: DatabaseSync,
  row: Record<string, string | number | null>,
  id: number
) {
  const fields = [
    'gender',
    'event_group',
    'weight_class',
    'age_group',
    'position',
    'reference_level',
  ];
  const rank = (item: Record<string, string | number | null>) =>
    fields.filter((field) => item[field] !== 'open').length;
  const others = db
    .prepare(
      `SELECT * FROM radar_reference_values WHERE id<>? AND project IN (?,?) AND radar_kind='physical' AND metric_key=?
        AND review_status='reviewed' AND active=1 AND source_id IN (SELECT id FROM radar_reference_sources WHERE active=1)`
    )
    .all(
      id,
      row.project,
      row.project === 'CANOE_SPRINT'
        ? 'CANOE'
        : row.project === 'CANOE_SLALOM'
          ? 'SLALOM'
          : row.project,
      row.metric_key
    ) as Array<Record<string, string | number | null>>;
  if (
    others.some(
      (other) =>
        other.protocol === row.protocol &&
        other.protocol_version === row.protocol_version &&
        other.test_context === row.test_context &&
        other.side === row.side &&
        other.unit === row.unit &&
        rank(other) === rank(row) &&
        fields.every(
          (field) => other[field] === 'open' || row[field] === 'open' || other[field] === row[field]
        ) &&
        String(other.effective_from || '') <= String(row.effective_to || '9999-12-31') &&
        String(row.effective_from || '') <= String(other.effective_to || '9999-12-31')
    )
  )
    throw new PhysicalReferenceError(409, '存在同优先级有效期重叠标准，请先停用旧版本。');
}
export function savePhysicalReferenceDraft(
  db: DatabaseSync,
  actor: ReferenceActor,
  input: unknown,
  previous?: { id: number; expectedRevision: number }
) {
  authorizeReference(actor);
  const parsed = physicalReferenceDraftSchema.safeParse(input);
  if (!parsed.success)
    throw new PhysicalReferenceError(400, '参考维度、来源、适用范围或有效日期无效。');
  const draft = parsed.data;
  db.exec('BEGIN IMMEDIATE');
  try {
    let version = 1;
    let rootId: number | null = null;
    if (previous) {
      const old = db
        .prepare(
          "SELECT id,reference_root_id,revision,version,project,metric_key FROM radar_reference_values WHERE id=? AND radar_kind='physical'"
        )
        .get(previous.id) as
        | {
            id: number;
            reference_root_id: number | null;
            revision: number;
            version: number;
            project: string;
            metric_key: string;
          }
        | undefined;
      if (!old) throw new PhysicalReferenceError(404, '参考版本不存在。');
      if (old.revision !== previous.expectedRevision)
        throw new PhysicalReferenceError(409, '参考版本已更新，请刷新。');
      if (old.project !== draft.project || old.metric_key !== draft.key)
        throw new PhysicalReferenceError(400, '新版本不得变更项目和指标归属。');
      rootId = old.reference_root_id || old.id;
      const latest = db
        .prepare(
          'SELECT MAX(version) AS version FROM radar_reference_values WHERE id=? OR reference_root_id=?'
        )
        .get(rootId, rootId) as { version: number };
      version = latest.version + 1;
      db.prepare('UPDATE radar_reference_values SET revision=revision+1 WHERE id=?').run(
        previous.id
      );
    }
    const sourceProtocol = draft.protocol;
    const sourceYear = new Date().getUTCFullYear();
    db.prepare(
      `INSERT OR IGNORE INTO radar_reference_sources(project,name,url,source_year,protocol,verified_at) VALUES(?,?,'',?,?,'保存生效')`
    ).run(draft.project, draft.sourceNote, sourceYear, sourceProtocol);
    const source = db
      .prepare(
        "SELECT id FROM radar_reference_sources WHERE project=? AND name=? AND url='' AND source_year=? AND protocol=?"
      )
      .get(draft.project, draft.sourceNote, sourceYear, sourceProtocol) as { id: number };
    const result = db
      .prepare(
        `INSERT INTO radar_reference_values(source_id,project,radar_kind,metric_key,gender,boat_class,applicability,value_num,unit,
      source_type,protocol,event_group,weight_class,age_group,direction,review_status,source_nature,version,parent_id,reference_root_id,effective_from,effective_to,
      position,reference_level,reference_label,dimension_version,measurement_codes,measurement_unit,weight_relative,protocol_version,test_context,side)
      VALUES(?,?,'physical',?,?,'',?,?,?, ?,?,?,?,?,?,'reviewed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        source.id,
        draft.project,
        draft.key,
        draft.gender,
        `版本草稿:${randomUUID()}`,
        draft.value,
        draft.unit,
        draft.sourceType,
        draft.protocol,
        draft.event,
        draft.weightClass,
        draft.ageGroup,
        draft.direction,
        draft.sourceNature,
        version,
        previous?.id || null,
        rootId,
        draft.effectiveFrom,
        draft.effectiveTo,
        draft.position,
        draft.referenceLevel,
        draft.referenceLabel,
        draft.dimensionVersion,
        JSON.stringify(draft.measurementCodes),
        draft.measurementUnit,
        Number(draft.weightRelative),
        draft.protocolVersion,
        draft.testContext,
        draft.side
      );
    const id = Number(result.lastInsertRowid);
    const activeRow = db
      .prepare('SELECT * FROM radar_reference_values WHERE id=?')
      .get(id) as Record<string, string | number | null>;
    assertNoReferenceOverlap(db, activeRow, id);
    db.prepare(
      "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,'CREATE_PHYSICAL_REFERENCE_VERSION','radar_reference_values',?,?)"
    ).run(actor.id, id, JSON.stringify({ parentId: previous?.id || null, version }));
    db.exec('COMMIT');
    return { id, version, message: '冠军参考版本已保存并生效；估算来源仅用于展示。' };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
export function reviewPhysicalReference(
  db: DatabaseSync,
  actor: ReferenceActor,
  id: number,
  input: unknown
) {
  authorizeReference(actor);
  const parsed = z
    .strictObject({
      expectedRevision: z.number().int().nonnegative(),
      status: z.enum(['reviewed', 'disabled']),
    })
    .safeParse(input);
  if (!parsed.success) throw new PhysicalReferenceError(400, '审核操作参数无效。');
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare("SELECT * FROM radar_reference_values WHERE id=? AND radar_kind='physical'")
      .get(id) as Record<string, string | number | null> | undefined;
    if (!row) throw new PhysicalReferenceError(404, '参考版本不存在。');
    // 兼容旧客户端的启用调用：不再审核，也不重新启用停用版本。
    if (parsed.data.status === 'reviewed' || row.review_status === 'disabled') {
      db.exec('COMMIT');
      return {
        message:
          row.review_status === 'disabled'
            ? '参考版本已停用，请另存新版本。'
            : '保存即生效，无需另行审核。',
      };
    }
    if (row.revision !== parsed.data.expectedRevision)
      throw new PhysicalReferenceError(409, '参考版本已更新，请刷新。');
    db.prepare(
      `UPDATE radar_reference_values SET review_status=?,revision=revision+1,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(parsed.data.status, actor.id, id);
    db.prepare(
      "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,'REVIEW_PHYSICAL_REFERENCE','radar_reference_values',?,?)"
    ).run(actor.id, id, JSON.stringify(parsed.data));
    db.exec('COMMIT');
    return {
      message: '参考版本已停用。',
    };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

/** 两行模型的数值更新：同批事务、修订冲突保护，旧值与来源保存在审计中。 */
export function updatePhysicalChampionValues(
  db: DatabaseSync,
  actor: ReferenceActor,
  input: unknown
) {
  const parsed = physicalChampionValuesSchema.safeParse(input);
  if (!parsed.success)
    throw new PhysicalReferenceError(400, '冠军模型数值无效，请填写大于0的数值。');
  const { project, values } = parsed.data;
  if (!canEditPhysicalChampionValues(actor.role, actor.permissions, project))
    throw new PhysicalReferenceError(403, '无权修改该项目冠军模型。');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const value of values) {
      const old = db
        .prepare(
          "SELECT rv.*,rs.active AS source_active FROM radar_reference_values rv JOIN radar_reference_sources rs ON rs.id=rv.source_id WHERE rv.id=? AND rv.radar_kind='physical'"
        )
        .get(value.id) as Record<string, string | number | null> | undefined;
      if (!old) throw new PhysicalReferenceError(404, '冠军模型指标不存在。');
      const oldProject =
        old.project === 'CANOE'
          ? 'CANOE_SPRINT'
          : old.project === 'SLALOM'
            ? 'CANOE_SLALOM'
            : old.project;
      if (oldProject !== project)
        throw new PhysicalReferenceError(403, '不能修改其他项目的冠军模型。');
      if (!old.active || !old.source_active || old.review_status === 'disabled')
        throw new PhysicalReferenceError(409, '冠军模型已停用，请刷新。');
      if (old.revision !== value.expectedRevision)
        throw new PhysicalReferenceError(409, '冠军模型已被更新，请刷新后修改。');
      if (old.value_num === value.value) continue;
      const sourceName = '教练手工维护冠军模型';
      const year = new Date().getUTCFullYear();
      db.prepare(
        "INSERT OR IGNORE INTO radar_reference_sources(project,name,url,source_year,protocol,verified_at) VALUES(?,?,'',?,?,'手工参考')"
      ).run(old.project, sourceName, year, old.protocol);
      const source = db
        .prepare(
          "SELECT id,active FROM radar_reference_sources WHERE project=? AND name=? AND url='' AND source_year=? AND protocol=?"
        )
        .get(old.project, sourceName, year, old.protocol) as { id: number; active: number };
      if (!source.active)
        throw new PhysicalReferenceError(409, '手工参考来源已停用，请联系管理员。');
      db.prepare(
        "UPDATE radar_reference_values SET value_num=?,source_id=?,source_type='estimated',source_nature='estimated',revision=revision+1,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).run(value.value, source.id, value.id);
      db.prepare(
        "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,'UPDATE_PHYSICAL_CHAMPION_VALUE','radar_reference_values',?,?)"
      ).run(
        actor.id,
        value.id,
        JSON.stringify({
          before: old,
          after: {
            value: value.value,
            sourceId: source.id,
            sourceType: 'estimated',
            sourceNature: 'estimated',
            revision: value.expectedRevision + 1,
          },
        })
      );
    }
    db.exec('COMMIT');
    return { message: '冠军模型已保存，团队平均由系统自动计算。' };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
