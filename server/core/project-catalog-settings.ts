import type { DatabaseSync } from 'node:sqlite';
import type { ProjectCatalogSettings, ProjectNameKind } from '../../shared/project-name-catalog.ts';
import {
  ProjectNameMappingError,
  projectNameResolver,
  readProjectNameMappings,
  saveProjectNameMapping,
} from './project-name-mappings.ts';

const metadataKey = 'project_catalog_settings_v1';

export function readProjectCatalogSettings(db: DatabaseSync): ProjectCatalogSettings[] {
  const row = db.prepare('SELECT value FROM app_metadata WHERE key=?').get(metadataKey);
  return row ? (JSON.parse(String(row.value)) as ProjectCatalogSettings[]) : [];
}

export function projectCatalogSettingsLookup(db: DatabaseSync) {
  const resolve = projectNameResolver(readProjectNameMappings(db));
  const settings = readProjectCatalogSettings(db);
  const exact = new Map(
    settings.map((setting) => [JSON.stringify([setting.kind, setting.name]), setting])
  );
  const resolved = new Map(
    settings.map((setting) => [
      JSON.stringify([setting.kind, resolve(setting.kind, setting.name)]),
      setting,
    ])
  );
  return (kind: ProjectNameKind, name: string) => {
    const key = JSON.stringify([kind, resolve(kind, name)]);
    return exact.get(key) ?? resolved.get(key);
  };
}

export function saveProjectCatalogSettings(
  db: DatabaseSync,
  userId: number,
  source: string,
  draft: Omit<ProjectCatalogSettings, 'fields'> & { fields?: ProjectCatalogSettings['fields'] }
) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = readProjectCatalogSettings(db);
    const { kind, name, fields } = draft;
    const originalNames = readProjectNameMappings(db);
    const resolveBefore = projectNameResolver(originalNames);
    if (resolveBefore(kind, source) !== source)
      throw new ProjectNameMappingError('项目名称已变更，请刷新后再编辑。');
    const mappings =
      source === name
        ? originalNames
        : saveProjectNameMapping(db, userId, { kind, source, target: name });
    const standard = projectNameResolver(mappings)(kind, name);
    const matches = (setting: ProjectCatalogSettings, name: string) =>
      setting.kind === kind && setting.name === name;
    const old = previous.find((setting) => matches(setting, source));
    const target = previous.find((setting) => matches(setting, standard));
    const edited = fields ?? old?.fields;
    if (edited) {
      // 归到已有项目时保留目标下未编辑的字段。
      const preserved =
        source === standard
          ? []
          : (target?.fields.filter(
              (field) => !edited.some((entry) => entry.source === field.source)
            ) ?? []);
      const next = previous.filter(
        (setting) => !matches(setting, source) && !matches(setting, standard)
      );
      next.push({ kind, name: standard, fields: [...preserved, ...edited] });
      db.prepare(
        `INSERT INTO app_metadata(key,value) VALUES(?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
      ).run(metadataKey, JSON.stringify(next));
    }
    db.prepare(
      `INSERT INTO audit_logs(user_id,action,entity_type,detail)
      VALUES(?,'EDIT_PROJECT_CATALOG','project_catalog',?)`
    ).run(
      userId,
      JSON.stringify({ source, previous: old, updated: { kind, name: standard, fields } })
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
