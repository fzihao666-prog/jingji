import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { preserveLegacySpecialChampionModels } from '../core/db-migrations.ts';

describe('兼容专项冠军模型旧表', () => {
  it('归档旧表并保留记录，重复升级安全', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE special_champion_models (
          id INTEGER PRIMARY KEY,
          project TEXT NOT NULL,
          standard_type TEXT,
          event_group TEXT,
          competition_date TEXT
        );
        CREATE INDEX idx_special_champion_models_lookup ON special_champion_models (project);
        INSERT INTO special_champion_models (id, project, standard_type, event_group, competition_date)
        VALUES (7, 'ROWING', '亚洲', '男子单桨', '2025-01-01');
      `);

      preserveLegacySpecialChampionModels(db);
      preserveLegacySpecialChampionModels(db);

      expect(db.prepare('SELECT id, project FROM special_champion_models_legacy_v1').get()).toEqual(
        { id: 7, project: 'ROWING' }
      );
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_special_champion_models_lookup'"
          )
          .get()
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
