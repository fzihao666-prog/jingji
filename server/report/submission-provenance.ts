import type { DatabaseSync } from 'node:sqlite';

export function initializeSubmissionProvenance(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS submission_provenance (
      entity TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entity, entity_id)
    );
    CREATE TRIGGER IF NOT EXISTS submission_training_created AFTER INSERT ON training_sessions
    WHEN NEW.created_by IS NOT NULL AND NEW.is_demo=0 BEGIN
      INSERT INTO submission_provenance(entity,entity_id,user_id)
        VALUES('training_session',NEW.id,NEW.created_by) ON CONFLICT DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS submission_strength_created AFTER INSERT ON strength_result_sets
    WHEN NEW.created_by IS NOT NULL BEGIN
      INSERT INTO submission_provenance(entity,entity_id,user_id)
        VALUES('strength_result_set',NEW.id,NEW.created_by) ON CONFLICT DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS submission_team_training_created AFTER INSERT ON team_training_day_values
    BEGIN
      INSERT INTO submission_provenance(entity,entity_id,user_id)
        VALUES('team_training_day_value:' || json_array(NEW.project_code,NEW.training_date,NEW.category,NEW.unit),NEW.team_id,NEW.updated_by) ON CONFLICT DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS submission_team_training_deleted AFTER DELETE ON team_training_day_values
    BEGIN
      DELETE FROM submission_provenance WHERE entity='team_training_day_value:' || json_array(OLD.project_code,OLD.training_date,OLD.category,OLD.unit)
        AND entity_id=OLD.team_id;
    END;
  `);
}

export function saveSubmissionProvenance(
  db: DatabaseSync,
  entity: string,
  id: number,
  actor: number
) {
  db.prepare(
    `INSERT INTO submission_provenance(entity,entity_id,user_id)
    VALUES(?,?,?) ON CONFLICT DO NOTHING`
  ).run(entity, id, actor);
}
