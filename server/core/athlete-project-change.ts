import type { DatabaseSync } from 'node:sqlite';
import { normalizeProject } from '../../shared/projects.ts';

export class AthleteProjectChangeError extends Error {}

export function assertAthleteProjectChangeAllowed(db: DatabaseSync, athleteId: number, nextProject: string) {
  const athlete = db.prepare('SELECT project FROM athletes WHERE id=?').get(athleteId) as { project: string } | undefined;
  if (!athlete || normalizeProject(athlete.project) === normalizeProject(nextProject)) return;
  const tables = ['training_sessions', 'test_sessions', 'daily_wellness', 'athlete_body_measurements', 'injury_records', 'competitive_assessments', 'competitive_states', 'training_reports'];
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some(column => column.name === 'athlete_id') && db.prepare(`SELECT 1 FROM ${table} WHERE athlete_id=? LIMIT 1`).get(athleteId))
      throw new AthleteProjectChangeError('运动员已有历史业务数据，不能直接改项目；需使用专门的归属迁移流程。');
  }
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='special_test_results'").get()) {
    const existing = db.prepare(`SELECT 1 FROM special_test_results r
      WHERE NOT json_valid(r.member_athlete_ids) OR EXISTS(SELECT 1 FROM json_each(
        CASE WHEN json_valid(r.member_athlete_ids) THEN r.member_athlete_ids ELSE '[]' END) WHERE value=?) LIMIT 1`).get(athleteId);
    if (existing) throw new AthleteProjectChangeError('运动员已有历史专项成绩，不能直接改项目。');
  }
}
