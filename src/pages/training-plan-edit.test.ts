import { describe, expect, it } from 'vitest';
import type { TeamPlan, TeamPlanSession } from '../../shared/team-plan';
import {
  hasUnsupportedPlanFields,
  movePlanSession,
  planSessionChanges,
  removePlanSession,
  replacePlanSession,
} from './training-plan-edit';
const session: TeamPlanSession = {
  id: 'a',
  date: '2026-10-19',
  category: 'special',
  period: '上午',
  content: '训练',
  durationMin: 90,
  distanceKm: null,
  intensity: 'U2',
  sets: null,
  reps: null,
  load: null,
  notes: '',
};
const plan = {
  data: {
    goal: '目标',
    focus: '重点',
    sessions: [session, { ...session, id: 'b' }, { ...session, id: 'c', date: '2026-10-20' }],
    overrides: [
      { sessionId: 'a', athleteId: 1, changes: { durationMin: 60 } },
      { sessionId: 'b', athleteId: 2, changes: { content: '其他' } },
    ],
  },
} as TeamPlan;
describe('训练课编辑适配', () => {
  it('仅保存可调整且真正变化的字段，保留 null 与零的区别', () => {
    expect(
      planSessionChanges(session, {
        ...session,
        id: 'x',
        date: '2026-10-20',
        durationMin: null,
        distanceKm: 0,
      })
    ).toEqual({ durationMin: null, distanceKm: 0 });
    expect(planSessionChanges(session, { ...session })).toEqual({});
  });
  it('更新保留未知字段和其他安排', () => {
    const original = {
      ...plan,
      data: {
        ...plan.data,
        extra: '保留',
        sessions: [{ ...session, extra: 42 }, ...plan.data.sessions.slice(1)],
      },
    };
    const updated = replacePlanSession(original, { ...session, content: '新内容' });
    expect(updated.data).toMatchObject({
      extra: '保留',
      sessions: [{ id: 'a', content: '新内容', extra: 42 }, { id: 'b' }, { id: 'c' }],
    });
    expect(updated.data.overrides).toBe(original.data.overrides);
  });
  it('主课修改后移除已与队伍一致的差异，保留其它运动员调整', () => {
    const updated = replacePlanSession(plan, { ...session, durationMin: 60 });
    expect(updated.data.overrides).toHaveLength(1);
    expect(updated.data.overrides[0].sessionId).toBe('b');
    expect(plan.data.overrides).toHaveLength(2);
  });
  it('删除仅级联本课调整', () => {
    const updated = removePlanSession(plan, 'a');
    expect(updated.data.sessions.map((s) => s.id)).toEqual(['b', 'c']);
    expect(updated.data.overrides.map((o) => o.sessionId)).toEqual(['b']);
  });
  it('排序仅交换同日课程', () => {
    expect(movePlanSession(plan, 'a', 1).data.sessions.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(movePlanSession(plan, 'b', 1)).toBe(plan);
  });
  it('识别各层未知字段', () => {
    expect(hasUnsupportedPlanFields(plan)).toBe(false);
    expect(
      hasUnsupportedPlanFields({ ...plan, data: { ...plan.data, extra: 1 } } as TeamPlan)
    ).toBe(true);
    const extendedSession = { ...session, extra: 1 };
    expect(
      hasUnsupportedPlanFields({ ...plan, data: { ...plan.data, sessions: [extendedSession] } })
    ).toBe(true);
    expect(
      hasUnsupportedPlanFields({
        ...plan,
        data: {
          ...plan.data,
          overrides: [{ ...plan.data.overrides[0], changes: { date: '2026-10-21' } }],
        },
      } as unknown as TeamPlan)
    ).toBe(true);
  });
});
