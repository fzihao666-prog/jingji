import type { DatabaseSync } from 'node:sqlite';
import type { ProjectNameKind, ProjectNameMapping } from '../../shared/project-name-catalog.ts';

const metadataKey = 'project_name_mappings_v1';

export class ProjectNameMappingError extends Error {}

export function readProjectNameMappings(db: DatabaseSync): ProjectNameMapping[] {
  const row = db.prepare('SELECT value FROM app_metadata WHERE key=?').get(metadataKey);
  return row ? (JSON.parse(String(row.value)) as ProjectNameMapping[]) : [];
}

export function projectNameResolver(mappings: ProjectNameMapping[]) {
  const targets = { training: new Map<string, string>(), test: new Map<string, string>() };
  for (const rule of mappings) targets[rule.kind].set(rule.source, rule.target);
  return (kind: ProjectNameKind, rawName: string) => {
    let name = rawName.trim();
    const seen = new Set<string>();
    while (targets[kind].has(name)) {
      if (seen.has(name))
        throw new ProjectNameMappingError('名称映射会形成循环，请选择一个最终名称。');
      seen.add(name);
      name = targets[kind].get(name)!;
    }
    return name;
  };
}

export function saveProjectNameMapping(
  db: DatabaseSync,
  userId: number,
  mapping: ProjectNameMapping,
  previousSource?: string
) {
  const { kind, source, target } = mapping;
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = readProjectNameMappings(db);
    if (
      previousSource &&
      !previous.some((rule) => rule.kind === kind && rule.source === previousSource)
    )
      throw new ProjectNameMappingError('这条映射已变更，请刷新后再编辑。');
    if (
      previousSource &&
      previousSource !== source &&
      previous.some((rule) => rule.kind === kind && rule.source === source)
    )
      throw new ProjectNameMappingError('该原始名称已有映射，请直接编辑现有规则。');
    const next = previous.filter(
      (rule) => rule.kind !== kind || rule.source !== (previousSource ?? source)
    );
    if (source !== target) next.push(mapping);
    const resolve = projectNameResolver(next);
    for (const rule of next) resolve(rule.kind, rule.source);
    db.prepare(
      `INSERT INTO app_metadata(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
    ).run(metadataKey, JSON.stringify(next));
    db.prepare(
      `INSERT INTO audit_logs(user_id,action,entity_type,detail)
      VALUES(?,'SAVE_PROJECT_NAME_MAPPING','project_name_mapping',?)`
    ).run(
      userId,
      JSON.stringify({
        before: previous.find(
          (rule) => rule.kind === kind && rule.source === (previousSource ?? source)
        ),
        after: mapping,
      })
    );
    db.exec('COMMIT');
    return next;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
