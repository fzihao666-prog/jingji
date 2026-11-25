import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readTrainingPlanCatalog } from './training-plan-catalog.ts';
import { filterCatalog, planDays } from '../../shared/training-plan-view.ts';
import { planPeriodStatus } from '../../shared/training-plan-catalog.ts';
const databases: DatabaseSync[] = [];
function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(`CREATE TABLE users(id INTEGER, display_name TEXT);
    CREATE TABLE athletes(id INTEGER, name TEXT, project TEXT, team_id INTEGER, active INTEGER);
    CREATE TABLE project_teams(id INTEGER, name TEXT);
    CREATE TABLE training_plans(id INTEGER, athlete_id INTEGER, title TEXT, start_date TEXT, end_date TEXT, created_by INTEGER, plan_data TEXT);
    CREATE TABLE special_training_plans(id INTEGER, project TEXT, week_start TEXT, title TEXT, status TEXT, created_by INTEGER);
    CREATE TABLE special_training_plan_sessions(id INTEGER, plan_id INTEGER, session_date TEXT, session_order INTEGER, content TEXT, target_json TEXT);
    INSERT INTO users VALUES(1,'教练'); INSERT INTO project_teams VALUES(10,'一队'),(20,'二队');
    INSERT INTO athletes VALUES(101,'甲','ROWING',10,1),(102,'乙','ROWING',10,1),(201,'丙','CANOE_SPRINT',20,1),(103,'停用','ROWING',10,0);
    INSERT INTO training_plans VALUES(1,101,'体能','2026-10-01','2026-10-31',1,'{}'),(2,102,'综合','2026-10-01','2026-10-31',1,'{}'),(3,201,'其他项目','2026-10-01','2026-10-31',1,'{}'),(4,103,'停用人员','2026-10-01','2026-10-31',1,'{}');
    INSERT INTO special_training_plans VALUES(1,'ROWING','2026-10-12','专项周计划','active',1),(2,'CANOE_SPRINT','2026-10-12','越权计划','active',2);
    INSERT INTO special_training_plan_sessions VALUES(1,1,'2026-10-16',1,'水上训练','{"distanceKm":0}');`);
  db.exec("ALTER TABLE training_plans ADD COLUMN model TEXT NOT NULL DEFAULT 'legacy'");
  db.prepare('UPDATE training_plans SET plan_data=? WHERE id=2').run(
    JSON.stringify({
      weeklyPlans: [
        {
          days: [
            {
              date: '2026-10-16',
              focus: '综合',
              exercises: [
                { name: '水上专项', duration: 60 },
                { name: '深蹲', sets: 3, reps: 5 },
              ],
            },
          ],
        },
      ],
    })
  );
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
describe('统一训练计划只读适配', () => {
  it('仅返回授权有效档案，来源 ID 同号不混淆，综合计划只出现一次', () => {
    const db = fixture();
    const plans = readTrainingPlanCatalog(db, {
      athleteIds: [101, 102, 103],
      canReadProjectPlan: (project, creator) => project === 'ROWING' && creator === 1,
    });
    expect(plans.map((plan) => plan.key)).toEqual([
      'training_plans:1',
      'training_plans:2',
      'special_training_plans:1',
    ]);
    expect(plans[1].kind).toBe('combined');
    expect(plans[2].teamId).toBeNull();
    expect(plans[2].endDate).toBe('2026-10-18');
    expect(planDays(plans[2])[0].items[0].target).toEqual({ distanceKm: 0 });
    expect(planDays(plans[1])[0]).toMatchObject({ date: '2026-10-16', focus: '综合' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM training_plans').get()?.count).toBe(4);
  });
  it('复用历史计划规范化，同时保留原始每日处方字段', () => {
    const db = fixture();
    const plans = readTrainingPlanCatalog(db, {
      athleteIds: [102],
      canReadProjectPlan: () => false,
      normalizeTrainingPlan: () => ({
        exercises: [
          {
            name: '深蹲',
            category: '基础力量',
            unitNote: '原备注',
            lines: [{ weeks: { 1: { sets: '3', reps: '5', percentage: 60 } } }],
          },
        ],
        weeklyPlans: [],
      }),
    });
    expect(planDays(plans[0])[0].items).toHaveLength(2);
    expect(plans[0].data.exercises).toMatchObject([{ category: '基础力量', unitNote: '原备注' }]);
  });

  it('无授权不得返回个人或项目级计划', () => {
    expect(
      readTrainingPlanCatalog(fixture(), { athleteIds: [], canReadProjectPlan: () => false })
    ).toEqual([]);
  });
  it('类型、项目、队伍及相交周期筛选，不把项目级计划当成指定队伍', () => {
    const plans = readTrainingPlanCatalog(fixture(), {
      athleteIds: [101, 102, 201],
      canReadProjectPlan: () => true,
    });
    const filters = {
      kind: '',
      project: 'ROWING',
      team: '10',
      from: '2026-10-16',
      to: '2026-10-16',
    };
    expect(filterCatalog(plans, filters).map((plan) => plan.key)).toEqual([
      'training_plans:1',
      'training_plans:2',
    ]);
    expect(filterCatalog(plans, { ...filters, kind: 'combined' })).toHaveLength(1);
    expect(filterCatalog(plans, { ...filters, from: '2027-01-01', to: '2027-02-01' })).toEqual([]);
  });
  it('状态按日期判定，草案和缺失日安排不伪造', () => {
    const [plan] = readTrainingPlanCatalog(fixture(), {
      athleteIds: [101],
      canReadProjectPlan: () => false,
    });
    expect(planDays(plan)).toEqual([]);
    expect(planPeriodStatus(plan, '2026-10-16')).toBe('进行中');
    expect(planPeriodStatus(plan, '2026-09-01')).toBe('尚未开始');
    expect(planPeriodStatus(plan, '2026-11-01')).toBe('已完成');
    expect(planPeriodStatus({ ...plan, sourceStatus: 'draft' }, '2026-10-16')).toBe('草案');
  });
});
