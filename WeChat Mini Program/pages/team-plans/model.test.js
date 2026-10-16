import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const localModule = { exports: {} };
vm.runInNewContext(readFileSync(new URL('./model.js', import.meta.url), 'utf8'), { module: localModule });
const { emptySession, effectiveSessions } = localModule.exports;
const differences = (...args) => JSON.parse(JSON.stringify(localModule.exports.differences(...args)));
test('个人差异只保存改变字段，真实零保留', () => {
  const base = { ...emptySession(), durationMin: 90, distanceKm: 16 };
  assert.deepEqual(differences(base, { ...base, durationMin: 60, distanceKm: 0 }), { durationMin: 60, distanceKm: 0 });
  assert.deepEqual(differences(base, { ...base }), {});
});
test('个人目标继承未修改字段且不污染主计划或其他运动员', () => {
  const session = { ...emptySession(), content: '水上有氧', durationMin: 90, distanceKm: 16 };
  const plan = { data: { sessions: [session], overrides: [{ athleteId: 8, sessionId: session.id, changes: { durationMin: 60 }, reason: '减量' }] } };
  assert.equal(effectiveSessions(plan, 8)[0].durationMin, 60);
  assert.equal(effectiveSessions(plan, 8)[0].distanceKm, 16);
  assert.equal(effectiveSessions(plan, 9)[0].durationMin, 90);
  assert.equal(session.durationMin, 90);
});
test('训练课稳定 ID 在编辑差异时不会被替换', () => {
  const session = emptySession();
  assert.ok(session.id);
  assert.deepEqual(differences(session, { ...session, id: 'other' }), {});
});

test('修订摘要显示相同课的目标变化', () => {
  const session = { ...emptySession(), date: '2026-10-17', content: '水上有氧', durationMin: 90 };
  const baseline = { title: '周期', data: { sessions: [session], overrides: [] } };
  const revised = { ...baseline, data: { ...baseline.data, sessions: [{ ...session, durationMin: 60 }] } };
  assert.match(localModule.exports.revisionSummary(baseline, revised), /90 → 60/);
});

test('体能指标默认缺失而非零，个人调整不能改日期类别', () => {
  const session = emptySession();
  assert.equal(session.sets, null);
  assert.equal(session.reps, null);
  assert.equal(session.load, null);
  assert.deepEqual(differences(session, { ...session, date: '2026-10-18', category: 'physical', sets: 0 }), { sets: 0 });
});

test('执行展示仅含本队并按所选版本过滤，null与pending保留待确认', () => {
  const result = { date: '2026-10-17', windowStart: '2026-10-11', athletes: [
    { athleteId: 1, athleteName: '甲', status: 'pending', completionRate: null, pendingSessions: 1, lessonExecution: [
      { planId: 3, sessionId: 'a', date: '2026-10-17', status: 'pending', completionRate: null, target: { content: '有氧' } },
      { planId: 2, sessionId: 'b', status: 'complete', completionRate: 1 } ] },
    { athleteId: 2, athleteName: '乙', completionRate: 1, lessonExecution: [] }
  ] };
  const view = localModule.exports.executionView(result, { id: 3, teamId: 9 }, [{ id: 1, teamId: 9 }, { id: 2, teamId: 8 }]);
  assert.equal(view.teamExecution.length, 1);
  assert.equal(view.lessonExecution.length, 1);
  assert.equal(view.teamExecution[0].rateText, '待确认');
  assert.equal(view.lessonExecution[0].status, 'pending');
  assert.equal(view.lessonExecution[0].statusLabel, '待确认');
});
