import { describe, expect, it } from 'vitest';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport, readTeamWeeklyReportSnapshot } from './team-weekly-report.ts';
import { teamWeeklyQuerySchema } from '../../shared/team-weekly-report.ts';
const query = { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'special' } as const;
describe('两类周报事实快照', () => {
  it('拒绝旧混合查询', () => {
    expect(
      teamWeeklyQuerySchema.safeParse({ project: 'ROWING', teamId: '1', date: query.date }).success
    ).toBe(false);
  });
  it('训练、测试、力量与全员明细隔离；恢复仅作为背景', () => {
    const db = createTeamWeeklyFixture();
    try {
      db.exec(`INSERT INTO athletes(id,project,active,name,team_id) VALUES(9,'ROWING',1,'无记录队员',1);
        UPDATE training_sessions SET duration_reported=1,duration_min=0,rpe=0 WHERE id=2;
        INSERT INTO metric_definitions VALUES('jump','跳跃','explosive');
        INSERT INTO test_measurements VALUES(9,1,'jump','cm','center',0,0,'manual','valid');
        INSERT INTO strength_result_sets VALUES(1,'错误类型力量',10,20,1,'manual'),(2,'自重',10,0,1,'manual');`);
      const special = readTeamWeeklyReport(db, query, [1, 3, 9]);
      const physical = readTeamWeeklyReport(db, { ...query, reportType: 'physical' }, [1, 3, 9]);
      expect(special.totals.participations).toBe(2);
      expect(physical.totals.participations).toBe(1);
      expect(physical.totals.duration).toBe(0);
      expect(special.strength).toEqual([]);
      expect(physical.strength?.map((s) => s.exercise)).toEqual(['自重']);
      expect(physical.strength?.[0].volumeKg).toBe(0);
      expect(special.athletes.find((a) => a.id === 1)?.data.tests.map((t) => t.label)).toEqual([
        '测试功率',
        '测试功率',
      ]);
      expect(physical.athletes.find((a) => a.id === 1)?.data.tests.map((t) => t.label)).toEqual([
        '跳跃',
      ]);
      expect(physical.athletes).toHaveLength(3);
      expect(physical.athletes.find((a) => a.id === 9)?.data.totals.duration).toBeNull();
      expect(physical.athletes.find((a) => a.id === 1)?.data.daily[2].duration).toBeNull();
      expect(physical.recovery?.[0].sleep).toBe(8);
    } finally {
      db.close();
    }
  });
  it('逐指标覆盖检查、上周真实零、人员变化与无数据不生成虚假对比', () => {
    const db = createTeamWeeklyFixture();
    try {
      db.exec('UPDATE training_sessions SET duration_min=0,rpe=NULL WHERE id=8');
      const report = readTeamWeeklyReport(db, query, [1]);
      expect(report.comparison.metrics.find((m) => m.key === 'duration')).toMatchObject({
        current: 60,
        previous: 0,
      });
      expect(report.comparison.metrics.some((m) => m.key === 'srpe')).toBe(false);
      expect(readTeamWeeklyReport(db, query, [1, 3]).comparison.metrics).toEqual([]);
      const empty = readTeamWeeklyReport(db, { ...query, date: '2026-11-02' }, [1]);
      expect(empty.dataNotes.join('')).toContain('测试');
      expect(empty.comparison.metrics).toEqual([]);
    } finally {
      db.close();
    }
  });
  it('保存事务可复核快照，元信息保留且未分类不计入训练量', () => {
    const db = createTeamWeeklyFixture();
    try {
      db.exec("UPDATE training_sessions SET training_type='',content='' WHERE id=1; BEGIN");
      const result = readTeamWeeklyReportSnapshot(db, query, [1], {
        stage: '赛前阶段',
        coachNotes: '教练观察',
      });
      expect(result).toMatchObject({
        stage: '赛前阶段',
        coachNotes: '教练观察',
        templateVersion: 'weekly-v2',
      });
      expect(result.totals.sessions).toBe(0);
      expect(result.dataNotes.join('')).toContain('未分类');
      db.exec('ROLLBACK');
    } finally {
      db.close();
    }
  });
});
