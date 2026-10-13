import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { initializeProjectTeams } from './db-project-teams.ts';

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE project_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project, name)
  )`);
  return db;
}

describe('部署队伍初始化', () => {
  it('无运动员的新库补齐启用队伍，重复执行不重复写入', () => {
    const db = createDatabase();
    try {
      initializeProjectTeams(db);
      const teams = db.prepare('SELECT * FROM project_teams ORDER BY id').all();
      expect(teams).toHaveLength(24);
      expect(
        db.prepare("SELECT * FROM project_teams WHERE name IN ('test', '女子')").all()
      ).toEqual([]);
      initializeProjectTeams(db);
      expect(db.prepare('SELECT * FROM project_teams ORDER BY id').all()).toEqual(teams);
    } finally {
      db.close();
    }
  });

  it('保留已有停用记录及自定义队伍，按项目判重并在后续启动补回缺失项', () => {
    const db = createDatabase();
    try {
      db.exec(`INSERT INTO project_teams (id, project, name, active, created_at) VALUES
        (100, 'ROWING', '广东赛艇队', 0, '2020-01-01'),
        (101, 'CANOE_SPRINT', '广东赛艇队', 1, '2020-01-02')`);
      const existing = db.prepare('SELECT * FROM project_teams ORDER BY id').all();
      initializeProjectTeams(db);
      expect(
        db.prepare('SELECT * FROM project_teams WHERE id IN (100,101) ORDER BY id').all()
      ).toEqual(existing);
      expect(db.prepare('SELECT COUNT(*) AS count FROM project_teams').get()).toEqual({
        count: 25,
      });
      db.exec("DELETE FROM project_teams WHERE project='FOOTBALL' AND name='宁夏女足'");
      initializeProjectTeams(db);
      expect(
        db
          .prepare("SELECT active FROM project_teams WHERE project='FOOTBALL' AND name='宁夏女足'")
          .get()
      ).toEqual({ active: 1 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM project_teams').get()).toEqual({
        count: 25,
      });
    } finally {
      db.close();
    }
  });

  it('写入失败时回滚本次补齐且保留已有队伍', () => {
    const db = createDatabase();
    try {
      db.exec(`INSERT INTO project_teams(project,name) VALUES ('ROWING','自定义队伍');
        CREATE TRIGGER reject_team BEFORE INSERT ON project_teams
        WHEN NEW.project='BOXING' BEGIN SELECT RAISE(ABORT,'测试写入失败'); END;`);
      expect(() => initializeProjectTeams(db)).toThrow('测试写入失败');
      expect(db.prepare('SELECT project,name FROM project_teams').all()).toEqual([
        { project: 'ROWING', name: '自定义队伍' },
      ]);
    } finally {
      db.close();
    }
  });
});
