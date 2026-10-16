import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrateTeamPlans } from '../core/team-plan-migration.ts';
import {
  teamPlanInput,
  readTeamPlansForAthlete,
  resolveTeamPlanSessions,
} from './team-plan-service.ts';
const data = {
  goal: '',
  focus: '',
  sessions: [
    {
      id: 's1',
      date: '2026-10-17',
      category: 'special',
      period: '上午',
      content: '水上训练',
      durationMin: 90,
      distanceKm: 16,
      intensity: 'U2',
      sets: null,
      reps: null,
      load: null,
      notes: '',
    },
  ],
  overrides: [
    {
      athleteId: 1,
      sessionId: 's1',
      changes: { durationMin: 60 },
      reason: '减量',
      createdBy: 1,
      updatedBy: 1,
      createdAt: 'now',
      updatedAt: 'now',
    },
  ],
};
describe('队伍计划兼容与目标解析', () => {
  it('幂等迁移保留旧数据，限制锚点删除，个人调整只覆盖差异', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      `PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);CREATE TABLE project_teams(id INTEGER PRIMARY KEY,project TEXT,name TEXT);INSERT INTO project_teams VALUES(1,'赛艇','一队');CREATE TABLE athletes(id INTEGER PRIMARY KEY,team_id INTEGER);INSERT INTO athletes VALUES(1,1);CREATE TABLE training_plans(id INTEGER PRIMARY KEY,athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,start_date TEXT,end_date TEXT,title TEXT,plan_data TEXT);INSERT INTO training_plans VALUES(1,1,'old','old','历史','{}')`
    );
    migrateTeamPlans(db);
    migrateTeamPlans(db);
    expect(db.prepare('SELECT model FROM training_plans WHERE id=1').get()).toEqual({
      model: 'legacy',
    });
    db.prepare(
      `INSERT INTO training_plans(id,athlete_id,start_date,end_date,title,plan_data,model,team_id,root_id,status,published_at) VALUES(2,1,'2026-10-17','2026-10-17','队伍',?,'team',1,2,'published','now')`
    ).run(JSON.stringify(data));
    const plans = readTeamPlansForAthlete(db, 1);
    expect(plans).toHaveLength(1);
    const sessions = resolveTeamPlanSessions(plans[0], 1);
    expect(sessions[0].durationMin).toBe(60);
    expect(sessions[0].distanceKm).toBe(16);
    expect(() => db.exec('DELETE FROM athletes WHERE id=1')).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM training_plans').get()).toEqual({ n: 2 });
    db.close();
  });
  it('拒绝重复课标识、非法日期、越界日期和无效差异字段', () => {
    const input = { title: '计划', startDate: '2026-10-17', endDate: '2026-10-17', data };
    expect(teamPlanInput.safeParse(input).success).toBe(true);
    const same = {
      ...input,
      data: { ...data, overrides: [{ ...data.overrides[0], changes: { durationMin: 90 } }] },
    };
    expect(teamPlanInput.safeParse(same).success).toBe(false);
    expect(teamPlanInput.safeParse({ ...input, data: { ...data, extra: true } }).success).toBe(
      false
    );
    expect(
      teamPlanInput.safeParse({
        ...input,
        data: { ...data, sessions: [{ ...data.sessions[0], content: '   ' }] },
      }).success
    ).toBe(false);
    const filtered = teamPlanInput.safeParse({
      ...input,
      data: {
        ...data,
        overrides: [{ ...data.overrides[0], changes: { durationMin: 60, distanceKm: 16 } }],
      },
    });
    expect(filtered.success && filtered.data.data.overrides[0].changes).toEqual({
      durationMin: 60,
    });

    expect(teamPlanInput.safeParse({ ...input, startDate: '2026-99-99' }).success).toBe(false);
    expect(
      teamPlanInput.safeParse({
        ...input,
        data: { ...data, sessions: [...data.sessions, ...data.sessions] },
      }).success
    ).toBe(false);
    expect(
      teamPlanInput.safeParse({
        ...input,
        data: { ...data, overrides: [{ ...data.overrides[0], changes: { id: 'x' } }] },
      }).success
    ).toBe(false);
  });
});
