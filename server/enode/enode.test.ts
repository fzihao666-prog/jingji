import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  initializeEnodeDatabase,
  importEnodeFile,
  readEnodeData,
  parseEnodeFile,
} from './enode.ts';

const headers =
  'Date [yyyy-MM-dd],Time,Athlete,Exercise,Distance [m],Mean velocity [m/s],Peak velocity [m/s],Mean power [W],Peak power [W],Jump height [m],RSI [RSI],Propulsive distance [m],Side';
const line = '2026-10-03,01:25:44,合成人员,"新动作,变式",0.36,0.85,1.15,,,,,,bilateral';
const input = (text: string) => Buffer.from(text);
const candidates = [{ id: 1, name: '合成人员' }];
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'PRAGMA foreign_keys=ON; CREATE TABLE athletes(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE audit_logs(user_id INTEGER,action TEXT,entity_type TEXT,detail TEXT); INSERT INTO athletes VALUES(1); INSERT INTO users VALUES(1);'
  );
  initializeEnodeDatabase(db);
  return db;
}
describe('Enode 导入与趋势', () => {
  it('识别无扩展名 CSV，保留新动作、缺失值、真实0与同秒多行', () => {
    const parsed = parseEnodeFile(input(headers + '\n' + line + '\n' + line.replace('0.85', '0')));
    expect(parsed.kind).toBe('measurement');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].exercise).toBe('新动作,变式');
    expect(parsed.rows[0].values.meanPower).toBeNull();
    expect(parsed.rows[1].values.meanVelocity).toBe(0);
  });
  it('同文件重传、交叉导出幂等，完全相同行保留源内次数；趋势排除空值', () => {
    const db = fixture();
    const run = (text: string) =>
      importEnodeFile(db, {
        buffer: input(text),
        filename: '设备导出',
        project: 'ROWING',
        userId: 1,
        candidates,
      });
    const text = headers + '\n' + line + '\n' + line;
    expect(run(text)).toMatchObject({ inserted: 2, skipped: 0, failed: 0 });
    expect(run(text)).toMatchObject({ inserted: 0, skipped: 2 });
    expect(
      run(headers + '\n' + line + '\n' + line + '\n' + line.replace('0.85', '0'))
    ).toMatchObject({ inserted: 1, skipped: 2 });
    const data = readEnodeData(db, {
      athleteId: 1,
      project: 'ROWING',
      kind: 'measurement',
      from: '2026-10-01',
      to: '2026-10-31',
      exercise: '新动作,变式',
      metric: 'meanVelocity',
      side: 'bilateral',
      page: 1,
    });
    expect(data.total).toBe(3);
    expect(data.daily[0].count).toBe(3);
    expect(data.daily[0].mean).toBeCloseTo(1.7 / 3);
    initializeEnodeDatabase(db);
    expect(data.records[0].values.meanPower).toBeNull();
    db.close();
  });
  it('异常行不写入、姓名歧义不猜测，映射只能使用范围内运动员', () => {
    const db = fixture();
    const options = {
      buffer: input(headers + '\n' + line + '\n' + line.replace('0.85', 'NaN')),
      filename: '异常',
      project: 'ROWING',
      userId: 1,
      candidates,
    };
    expect(importEnodeFile(db, options)).toMatchObject({ inserted: 1, failed: 1 });
    expect(
      importEnodeFile(db, { ...options, candidates: [...candidates, { id: 2, name: '合成人员' }] })
    ).toMatchObject({ inserted: 0, failed: 2 });
    expect(importEnodeFile(db, { ...options, matches: { 合成人员: 99 } })).toMatchObject({
      inserted: 0,
      failed: 2,
    });
    db.close();
  });
  it('状态不替换现有量表；空RPE文件合法，有记录时保留来源负荷', () => {
    const wellness =
      '日期 [yyyy-MM-dd],时间,运动员,stress,mood,sleep,soreness,fatigue,wellnessScore\n2026-10-03,01:00:00,合成人员,4,5,5,5,4,23';
    expect(parseEnodeFile(input(wellness)).rows[0].values).toMatchObject({
      stress: 4,
      sleep: 5,
      wellnessScore: 23,
    });
    const rpe =
      '日期 [yyyy-MM-dd],时间,运动员,sessionRpe,trainingLoad,workoutStart,workoutEnd,durationMin,sessionCount,exercises,volume';
    expect(parseEnodeFile(input(rpe))).toMatchObject({ kind: 'sessionRpe', rows: [] });
    const db = fixture();
    expect(
      importEnodeFile(db, {
        buffer: input(rpe + '\n2026-10-03,01:00:00,合成人员,0,0,01:00:00,02:00:00,60,1,深蹲,0'),
        filename: 'RPE',
        project: 'ROWING',
        userId: 1,
        candidates,
      })
    ).toMatchObject({ inserted: 1 });
    const data = readEnodeData(db, {
      athleteId: 1,
      project: 'ROWING',
      kind: 'sessionRpe',
      from: '2026-10-01',
      to: '2026-10-31',
      metric: 'trainingLoad',
      page: 1,
    });
    expect(data.daily[0].mean).toBe(0);
    expect(data.records[0].values.durationMin).toBe(60);
    db.close();
  });
  it('保留设备带符号测量和无测量的动作事件，不将空值补0', () => {
    const parsed = parseEnodeFile(
      input(
        headers +
          '\n' +
          line.replace('0.85', '-0.85') +
          '\n2026-10-03,01:25:45,合成人员,新动作,,,,,,,,,bilateral'
      )
    );
    expect(parsed.rows[0].values.meanVelocity).toBe(-0.85);
    expect(parsed.rows[0].error).toBe('');
    expect(parsed.rows[1].values.meanVelocity).toBeNull();
    expect(parsed.rows[1].error).toBe('');
  });
  it('真实日期和数值校验；不将非数值转成0', () => {
    const parsed = parseEnodeFile(input(headers + '\n' + line.replace('2026-10-03', '2026-02-30')));
    expect(parsed.rows[0].error).toBeTruthy();
    expect(() => parseEnodeFile(input('not,a,device,file'))).toThrow();
  });
});
it('文件事务失败整体回滚，已有记录和回执不受影响', () => {
  const db = fixture();
  const options = {
    buffer: input(headers + '\n' + line),
    filename: '事务',
    project: 'ROWING',
    userId: 1,
    candidates,
  };
  importEnodeFile(db, options);
  db.exec(
    "CREATE TRIGGER reject_enode BEFORE INSERT ON enode_records WHEN NEW.recorded_at='2026-10-04T01:25:44' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;"
  );
  expect(() =>
    importEnodeFile(db, {
      ...options,
      buffer: input(
        headers +
          '\n' +
          line.replace('0.85', '0.9') +
          '\n' +
          line.replace('2026-10-03', '2026-10-04')
      ),
    })
  ).toThrow();
  expect(db.prepare('SELECT COUNT(*) AS n FROM enode_records').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM enode_import_files').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()).toEqual({ n: 1 });
  db.close();
});
it('不同动作和侧别不混合，按日期范围过滤、分页，空值不进入均值', () => {
  const db = fixture();
  const rows = [
    line,
    line.replace('0.85', '1.15'),
    line.replace('0.85', '').replace('1.15', '2'),
    line.replace('0.85', '8').replace('bilateral', 'left'),
    line.replace('0.85', '9').replace('新动作,变式', '其他动作'),
    line.replace('2026-10-03', '2026-11-03'),
  ];
  importEnodeFile(db, {
    buffer: input(headers + '\n' + rows.join('\n')),
    filename: '筛选',
    project: 'ROWING',
    userId: 1,
    candidates,
  });
  const scope = {
    athleteId: 1,
    project: 'ROWING',
    kind: 'measurement' as const,
    from: '2026-10-01',
    to: '2026-10-31',
    metric: 'meanVelocity' as const,
    exercise: '新动作,变式',
    page: 1,
  };
  const data = readEnodeData(db, scope);
  expect(data.total).toBe(3);
  expect(data.daily).toEqual([{ date: '2026-10-03', mean: 1, min: 0.85, max: 1.15, count: 2 }]);
  expect(readEnodeData(db, { ...scope, side: 'left' }).daily[0].mean).toBe(8);
  expect(readEnodeData(db, { ...scope, page: 2 }).records).toEqual([]);
  expect(readEnodeData(db, { ...scope, project: 'VOLLEYBALL' }).total).toBe(0);
  db.close();
});
it('超过1000点只抽样散点，完整均值和分页明细不抽样', () => {
  const db = fixture();
  importEnodeFile(db, {
    buffer: input(headers + '\n' + Array(1201).fill(line).join('\n')),
    filename: '密集测量',
    project: 'ROWING',
    userId: 1,
    candidates,
  });
  const data = readEnodeData(db, {
    athleteId: 1,
    project: 'ROWING',
    kind: 'measurement',
    from: '2026-10-01',
    to: '2026-10-31',
    metric: 'meanVelocity',
    page: 2,
  });
  expect(data.total).toBe(1201);
  expect(data.pointCount).toBe(1201);
  expect(data.points).toHaveLength(601);
  expect(data.records).toHaveLength(50);
  expect(data.daily[0].mean).toBeCloseTo(0.85);
  db.close();
});
