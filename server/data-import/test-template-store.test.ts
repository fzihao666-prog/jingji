import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initializeTestTemplates, readTestTemplateDownload } from './test-template-store.ts';

it('升级旧版测试模板快照表，保留原记录并允许保存新快照', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE test_template_downloads (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, team_id INTEGER NOT NULL,
        columns_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO test_template_downloads (id,project,team_id,columns_json) VALUES ('old','ROWING',12,'[]');
    `);

    initializeTestTemplates(db);
    initializeTestTemplates(db);

    expect(readTestTemplateDownload(db, 'old')).toEqual({
      id: 'old', project: 'ROWING', teamId: 12, teamName: '', columns: [],
    });
    db.prepare('INSERT INTO test_template_downloads (id,project,team_id,team_name,columns_json) VALUES (?,?,?,?,?)')
      .run('new', 'ROWING', 12, '测试队伍', '[]');
    expect(readTestTemplateDownload(db, 'new')?.teamName).toBe('测试队伍');
  } finally {
    db.close();
  }
});
