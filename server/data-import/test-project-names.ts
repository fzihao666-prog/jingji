import type { DatabaseSync } from 'node:sqlite';

export type TestProjectField = { projectName: string; field: string };

// 通过正式成绩的最新来源定位填报原称，历史记录和代码仍可追溯。
export const originalTestProjectSql = `COALESCE((
  SELECT json_extract(CASE WHEN json_valid(i.payload_json) THEN i.payload_json ELSE '{}' END,'$.rawTestProjectName')
  FROM data_import_items i WHERE i.batch_id=m.data_import_batch_id AND i.committed_entity_id=m.id
    AND i.committed_entity_type='test_measurement' AND i.source_sheet || '!' || i.source_address=m.source_ref
  ORDER BY i.id LIMIT 1
),'')`;

export function readTestProjectFields(db: DatabaseSync, projects: readonly string[]) {
  const rows = db
    .prepare(
      `
    SELECT g.project, g.name AS projectName, c.value AS code
    FROM test_template_groups g, json_each(g.codes_json) c
    WHERE g.project IN (SELECT value FROM json_each(?))
    ORDER BY g.name, c.key
  `
    )
    .all(JSON.stringify(projects)) as Array<{ project: string; projectName: string; code: string }>;
  const fields = new Map<string, string[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.project, row.code]);
    const names = fields.get(key) ?? [];
    names.push(row.projectName);
    fields.set(key, names);
  }
  return (project: string, code: string, label: string, original?: string): TestProjectField[] => {
    const names = fields.get(JSON.stringify([project, code])) ?? [];
    if (original) {
      const base = names.find((name) => label.startsWith(name));
      return [{ projectName: original, field: base ? label.slice(base.length) || '成绩' : '成绩' }];
    }
    if (!names.length) return [{ projectName: label, field: '成绩' }];
    return names.map((name) => ({
      projectName: name,
      field: label.startsWith(name) ? label.slice(name.length) || '成绩' : label,
    }));
  };
}
