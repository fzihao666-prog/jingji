import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  initializeTeamPlanChecks,
  readTeamPlanChecks,
  writeTeamPlanCheck,
  TeamPlanCheckError,
} from './team-plan-checks.ts';

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE training_plans(id INTEGER PRIMARY KEY);INSERT INTO training_plans VALUES(1);`);
  initializeTeamPlanChecks(db);
  return db;
}

it('勾选执行、取消需原因、撤销回待执行且版本号连续', () => {
  const db = openDb();
  const executed = writeTeamPlanCheck(db, {
    planId: 1,
    sessionId: 's1',
    itemId: 's1-1',
    status: 'executed',
    userId: 7,
    revision: 0,
  });
  expect(executed.status).toBe('executed');
  expect(executed.revision).toBe(1);
  expect(executed.checkedBy).toBe(7);

  expect(() =>
    writeTeamPlanCheck(db, {
      planId: 1,
      sessionId: 's1',
      itemId: 's1-1',
      status: 'cancelled',
      reason: '',
      userId: 7,
      revision: 1,
    })
  ).toThrow(TeamPlanCheckError);

  const cancelled = writeTeamPlanCheck(db, {
    planId: 1,
    sessionId: 's1',
    itemId: 's1-1',
    status: 'cancelled',
    reason: '场地关闭',
    userId: 7,
    revision: 1,
  });
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.reason).toBe('场地关闭');
  expect(cancelled.revision).toBe(2);

  const reverted = writeTeamPlanCheck(db, {
    planId: 1,
    sessionId: 's1',
    itemId: 's1-1',
    status: null,
    userId: 8,
    revision: 2,
  });
  expect(reverted.status).toBe('pending');
  expect(reverted.revision).toBe(3);
  expect(readTeamPlanChecks(db, 1)).toHaveLength(1);
  db.close();
});

it('版本号不符时拒绝保存，并发状态不被覆盖', () => {
  const db = openDb();
  writeTeamPlanCheck(db, { planId: 1, sessionId: 's1', status: 'executed', userId: 1, revision: 0 });
  expect(() =>
    writeTeamPlanCheck(db, { planId: 1, sessionId: 's1', status: 'executed', userId: 2, revision: 0 })
  ).toThrow(TeamPlanCheckError);
  const rows = readTeamPlanChecks(db, 1);
  expect(rows[0].checkedBy).toBe(1);
  db.close();
});

it('课程级与内容项级确认互不影响', () => {
  const db = openDb();
  writeTeamPlanCheck(db, { planId: 1, sessionId: 's1', status: 'executed', userId: 1 });
  writeTeamPlanCheck(db, { planId: 1, sessionId: 's1', itemId: 's1-1', status: 'cancelled', reason: '改期', userId: 1 });
  const rows = readTeamPlanChecks(db, 1);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.itemId === '')?.status).toBe('executed');
  expect(rows.find((row) => row.itemId === 's1-1')?.status).toBe('cancelled');
  db.close();
});
