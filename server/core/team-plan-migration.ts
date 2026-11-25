import type { DatabaseSync } from 'node:sqlite';
/** 仅兼容扩展，不删除旧计划或训练事实。athlete_id 保留为旧 Schema 技术锚点。 */
export function migrateTeamPlans(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(training_plans)').all() as Array<{ name: string }>).map(
      (item) => item.name
    )
  );
  const additions: Record<string, string> = {
    model: "TEXT NOT NULL DEFAULT 'legacy'",
    team_id: 'INTEGER REFERENCES project_teams(id)',
    root_id: 'INTEGER',
    version: 'INTEGER NOT NULL DEFAULT 1',
    revision: 'INTEGER NOT NULL DEFAULT 1',
    status: "TEXT NOT NULL DEFAULT 'draft'",
    published_at: 'TEXT',
    archived_at: 'TEXT',
    reviewed_by: 'INTEGER REFERENCES users(id)',
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, type] of Object.entries(additions))
      if (!columns.has(name)) db.exec(`ALTER TABLE training_plans ADD COLUMN ${name} ${type}`);
    db.exec(
      "CREATE INDEX IF NOT EXISTS training_plans_team_status ON training_plans(team_id,status) WHERE model='team'; CREATE UNIQUE INDEX IF NOT EXISTS training_plans_team_version ON training_plans(root_id,version) WHERE model='team'"
    );
    db.exec(`CREATE TRIGGER IF NOT EXISTS protect_team_plan_anchor BEFORE DELETE ON athletes
      WHEN EXISTS (SELECT 1 FROM training_plans WHERE model='team' AND athlete_id=OLD.id)
      BEGIN SELECT RAISE(ABORT, '队伍计划历史关联运动员不可删除，请停用运动员'); END`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
