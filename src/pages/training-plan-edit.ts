import type { TeamPlan, TeamPlanOverride, TeamPlanSession } from '../../shared/team-plan';
const changeKeys = [
  'period',
  'content',
  'durationMin',
  'distanceKm',
  'intensity',
  'sets',
  'reps',
  'load',
  'notes',
] as const;
export function planSessionChanges(
  base: TeamPlanSession,
  edited: TeamPlanSession
): TeamPlanOverride['changes'] {
  return Object.fromEntries(
    changeKeys.filter((key) => base[key] !== edited[key]).map((key) => [key, edited[key]])
  );
}
export function replacePlanSession(plan: TeamPlan, session: TeamPlanSession): TeamPlan {
  const exists = plan.data.sessions.some((item) => item.id === session.id);
  let overridesChanged = false;
  const overrides = plan.data.overrides.flatMap((item) => {
    if (item.sessionId !== session.id) return [item];
    const equal = changeKeys.filter(
      (key) => key in item.changes && item.changes[key] === session[key]
    );
    if (!equal.length) return [item];
    overridesChanged = true;
    const changes = { ...item.changes };
    for (const key of equal) delete changes[key];
    return Object.keys(changes).length ? [{ ...item, changes }] : [];
  });
  return {
    ...plan,
    data: {
      ...plan.data,
      overrides: overridesChanged ? overrides : plan.data.overrides,
      sessions: exists
        ? plan.data.sessions.map((item) =>
            item.id === session.id ? { ...item, ...session } : item
          )
        : [...plan.data.sessions, session],
    },
  };
}
export function removePlanSession(plan: TeamPlan, id: string): TeamPlan {
  return {
    ...plan,
    data: {
      ...plan.data,
      sessions: plan.data.sessions.filter((item) => item.id !== id),
      overrides: plan.data.overrides.filter((item) => item.sessionId !== id),
    },
  };
}
export function movePlanSession(plan: TeamPlan, id: string, direction: -1 | 1): TeamPlan {
  const index = plan.data.sessions.findIndex((item) => item.id === id);
  if (index < 0) return plan;
  const sameDay = plan.data.sessions.flatMap((item, i) =>
    item.date === plan.data.sessions[index].date ? [i] : []
  );
  const target = sameDay[sameDay.indexOf(index) + direction];
  if (target === undefined) return plan;
  const sessions = [...plan.data.sessions];
  [sessions[index], sessions[target]] = [sessions[target], sessions[index]];
  return { ...plan, data: { ...plan.data, sessions } };
}
export function hasUnsupportedPlanFields(plan: TeamPlan): boolean {
  const unknown = (value: object, allowed: readonly string[]) =>
    Object.keys(value).some((key) => !allowed.includes(key));
  return (
    unknown(plan.data, ['sessions', 'overrides', 'goal', 'focus']) ||
    plan.data.sessions.some((item) => unknown(item, ['id', 'date', 'category', ...changeKeys])) ||
    plan.data.overrides.some(
      (item) =>
        unknown(item, [
          'athleteId',
          'sessionId',
          'changes',
          'reason',
          'createdBy',
          'updatedBy',
          'createdAt',
          'updatedAt',
        ]) || unknown(item.changes, changeKeys)
    )
  );
}
