import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  initializeTrainingPlanLinks,
  resolveTrainingPlanLink,
  saveTrainingPlanLink,
} from '../core/training-plan-links.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE athletes(id INTEGER PRIMARY KEY,team_id INTEGER); INSERT INTO athletes VALUES(1,10),(2,20);
    CREATE TABLE project_teams(id INTEGER PRIMARY KEY,project TEXT,name TEXT); INSERT INTO project_teams VALUES(10,'ROWING','一队');
    CREATE TABLE training_sessions(id INTEGER PRIMARY KEY,athlete_id INTEGER,session_date TEXT); INSERT INTO training_sessions VALUES(1,1,'2026-10-16');
    CREATE TABLE training_plans(id INTEGER PRIMARY KEY,model TEXT,team_id INTEGER,root_id INTEGER,version INTEGER,revision INTEGER,status TEXT,title TEXT,start_date TEXT,end_date TEXT,plan_data TEXT,published_at TEXT,archived_at TEXT);`);
  const data = {
    goal: '',
    focus: '',
    sessions: [
      {
        id: 'am',
        date: '2026-10-16',
        category: 'special',
        period: '上午',
        content: '水上',
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
        sessionId: 'am',
        changes: { durationMin: 60, distanceKm: 10 },
        reason: '减量',
      },
    ],
  };
  db.prepare(
    "INSERT INTO training_plans VALUES(1,'team',10,1,1,1,'published','队伍计划','2026-10-16','2026-10-20',?,'2026-10-15T00:00:00Z',NULL)"
  ).run(JSON.stringify(data));
  initializeTrainingPlanLinks(db);
  return db;
}
describe('发布计划执行关联', () => {
  it('幂等迁移且无关联历史训练合法保留', () => {
    const db = fixture();
    initializeTrainingPlanLinks(db);
    expect(
      resolveTrainingPlanLink(db, 1, { date: '2026-10-16', trainingType: '专项训练' })
    ).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM training_sessions').get()?.n).toBe(1);
    db.close();
  });
  it('快照继承主计划与个人差异，修订不会覆盖执行基准', () => {
    const db = fixture();
    const link = resolveTrainingPlanLink(db, 1, {
      date: '2026-10-16',
      trainingType: '专项训练',
      teamPlanId: 1,
      planSessionId: 'am',
    });
    expect(link?.target.durationMin).toBe(60);
    expect(link?.target.content).toBe('水上');
    saveTrainingPlanLink(db, 1, link);
    db.exec("UPDATE training_plans SET plan_data='{}',status='archived'");
    const row = db.prepare('SELECT target_json FROM training_plan_execution_links').get();
    expect(JSON.parse(String(row?.target_json)).distanceKm).toBe(10);
    db.close();
  });
  it('拒绝跨队、草稿、错日期与错类别关联', () => {
    const db = fixture();
    const input = {
      date: '2026-10-16',
      trainingType: '专项训练',
      teamPlanId: 1,
      planSessionId: 'am',
    };
    expect(() => resolveTrainingPlanLink(db, 2, input)).toThrow();
    expect(() => resolveTrainingPlanLink(db, 1, { ...input, date: '2026-10-17' })).toThrow();
    expect(() => resolveTrainingPlanLink(db, 1, { ...input, trainingType: '体能训练' })).toThrow();
    db.exec("UPDATE training_plans SET status='draft'");
    expect(() => resolveTrainingPlanLink(db, 1, input)).toThrow();
    db.close();
  });
});

it('北京凌晨发布不能关联前一天，归档版本可补填当时训练日', () => {
  const db = fixture();
  const input = {
    date: '2026-10-16',
    trainingType: '专项训练',
    teamPlanId: 1,
    planSessionId: 'am',
  };
  db.exec("UPDATE training_plans SET published_at='2026-10-16T16:30:00Z'");
  expect(() => resolveTrainingPlanLink(db, 1, input)).toThrow();
  db.exec("UPDATE training_plans SET published_at='2026-10-15T01:00:00Z',status='archived'");
  expect(resolveTrainingPlanLink(db, 1, input)?.target.durationMin).toBe(60);
  db.prepare(
    "INSERT INTO training_plans SELECT 2,model,team_id,root_id,2,1,'published',title,start_date,end_date,plan_data,'2026-10-17T00:00:00Z',NULL FROM training_plans WHERE id=1"
  ).run();
  expect(resolveTrainingPlanLink(db, 1, input)?.planId).toBe(1);
  db.exec("UPDATE training_plans SET published_at='2026-10-16T00:00:00Z' WHERE id=2");
  expect(() => resolveTrainingPlanLink(db, 1, input)).toThrow();
  db.close();
});
