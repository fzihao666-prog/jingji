// 计划训练日推导与「计划-实际」关联口径。
// 关联规则：实际课次与计划课次须「日期一致且训练动作名称有交集」才认定关联，仅日期相同不算完成。
// 计划训练日来源优先级：AI 计划 weeklyPlans[].days[].dayOfWeek → 计划 scheduleLabel 的「周X」；
// 两者都不可推导时不生成计划课次，由调用方提示「暂无计划」，不计算虚假完成率。
import type { StrengthTrainingSession, TrainingPlan, TrainingPlanData } from '../types';
import { addDays } from '../utils';

export type PlannedTrainingSession = {
  athleteId: number;
  planId: number;
  planTitle: string;
  date: string;
  weekKey: string;
  exerciseNames: string[];
  plannedMinutes: number | null;
  plannedSets: number | null;
  plannedReps: number | null;
  source: 'week_days' | 'schedule_label';
};

export type TrainingExecutionStatus = '完成' | '部分完成' | '未完成' | '未进行' | '计划外';

export type ScopedStrengthSession = StrengthTrainingSession & { athleteId: number };

export type TrainingExecutionRow = {
  key: string;
  date: string;
  athleteId: number;
  planId: number | null;
  planTitle: string | null;
  plannedNames: string[];
  plannedMinutes: number | null;
  plannedSets: number | null;
  plannedReps: number | null;
  session: ScopedStrengthSession | null;
  status: TrainingExecutionStatus;
};

const WEEKDAY_OFFSET: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

const ENGLISH_WEEKDAYS: Array<[RegExp, number]> = [
  [/monday/i, 1],
  [/tuesday/i, 2],
  [/wednesday/i, 3],
  [/thursday/i, 4],
  [/friday/i, 5],
  [/saturday/i, 6],
  [/sunday/i, 7],
];

export function parseWeekdays(text: string): number[] {
  const found = new Set<number>();
  for (const match of String(text ?? '').matchAll(
    /(?:周|星期|礼拜)([一二三四五六日天])(?![次个])/g
  )) {
    const day = WEEKDAY_OFFSET[match[1]];
    if (day) found.add(day);
  }
  for (const [pattern, day] of ENGLISH_WEEKDAYS) {
    if (pattern.test(text)) found.add(day);
  }
  return [...found].sort((left, right) => left - right);
}

export function isoWeekday(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 ? 7 : day;
}

// 与训练安排页保持一致的处方口径：取字符串中全部数字的平均值，无法解析记 0。
export function prescriptionNumber(value: string | number | null | undefined) {
  const values =
    String(value ?? '')
      .match(/\d+(?:\.\d+)?/g)
      ?.map(Number)
      .filter(Number.isFinite) || [];
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function planWeekKeys(data: TrainingPlanData) {
  const explicit = (data.weekKeys || []).map(String).filter(Boolean);
  if (explicit.length) return [...new Set(explicit)];
  const firstLine = data.exercises.flatMap((exercise) => exercise.lines).find(Boolean);
  const stored = firstLine ? Object.keys(firstLine.weeks || {}) : [];
  return stored.length ? stored : ['1', '2', '3', '4'];
}

function dateInWeek(weekStart: string, weekday: number) {
  const offset = (weekday - isoWeekday(weekStart) + 7) % 7;
  return addDays(weekStart, offset);
}

function weeklyPlanDays(data: TrainingPlanData, weekNumber: number): number[] {
  const weeklyPlans = Array.isArray(data.weeklyPlans) ? data.weeklyPlans : [];
  const week = weeklyPlans.find(
    (item) => Number((item as Record<string, unknown>).weekNumber) === weekNumber
  );
  const days = (week as Record<string, unknown> | undefined)?.days;
  if (!Array.isArray(days)) return [];
  const weekdays = days.flatMap((day) => {
    const dayOfWeek = (day as Record<string, unknown>)?.dayOfWeek;
    return typeof dayOfWeek === 'string' ? parseWeekdays(dayOfWeek) : [];
  });
  return [...new Set(weekdays)].sort((left, right) => left - right);
}

function weekExerciseNames(data: TrainingPlanData) {
  const names = data.exercises.map((exercise) => exercise.name.trim()).filter(Boolean);
  return [...new Set(names)];
}

function weekPlannedVolume(data: TrainingPlanData, weekKey: string) {
  let sets = 0;
  let reps = 0;
  let hasContent = false;
  for (const exercise of data.exercises) {
    for (const line of exercise.lines) {
      const entry = line.weeks?.[weekKey];
      if (!entry) continue;
      const plannedSets = prescriptionNumber(entry.sets);
      const plannedReps = prescriptionNumber(entry.reps);
      if (plannedSets > 0 || plannedReps > 0) hasContent = true;
      sets += plannedSets;
      reps += plannedSets * plannedReps;
    }
  }
  return { sets: hasContent ? Math.round(sets) : null, reps: hasContent ? Math.round(reps) : null };
}

function weekPlannedMinutes(data: TrainingPlanData) {
  const minutes = data.exercises
    .map((exercise) => exercise.estimatedMinutes)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  return minutes.length ? minutes.reduce((sum, value) => sum + value, 0) : null;
}

export function derivePlannedSessions(
  plans: TrainingPlan[],
  from: string,
  to: string
): PlannedTrainingSession[] {
  // 每名运动员只取与统计周期重叠的最新计划，避免旧计划重复生成计划课次。
  const latestByAthlete = new Map<number, TrainingPlan>();
  for (const plan of plans) {
    if (plan.data.endDate < from || plan.data.startDate > to) continue;
    const current = latestByAthlete.get(plan.athleteId);
    if (!current || current.data.startDate < plan.data.startDate) {
      latestByAthlete.set(plan.athleteId, plan);
    }
  }
  const result: PlannedTrainingSession[] = [];
  for (const plan of latestByAthlete.values()) {
    const data = plan.data;
    const fallbackWeekdays = parseWeekdays(data.scheduleLabel || '');
    const exerciseNames = weekExerciseNames(data);
    if (!exerciseNames.length) continue;
    planWeekKeys(data).forEach((weekKey, index) => {
      const weekStart = addDays(data.startDate, 7 * index);
      const weekDays = weeklyPlanDays(data, index + 1);
      const weekdays = weekDays.length ? weekDays : fallbackWeekdays;
      const source = weekDays.length ? 'week_days' : 'schedule_label';
      const volume = weekPlannedVolume(data, weekKey);
      const plannedMinutes = weekPlannedMinutes(data);
      for (const weekday of weekdays) {
        const date = dateInWeek(weekStart, weekday);
        if (date < from || date > to) continue;
        result.push({
          athleteId: plan.athleteId,
          planId: plan.id,
          planTitle: data.title || '训练计划',
          date,
          weekKey,
          exerciseNames,
          plannedMinutes,
          plannedSets: volume.sets,
          plannedReps: volume.reps,
          source,
        });
      }
    });
  }
  return result.sort(
    (left, right) => left.date.localeCompare(right.date) || left.athleteId - right.athleteId
  );
}

function sessionExerciseNames(session: ScopedStrengthSession) {
  return new Set(session.sets.map((set) => set.exerciseName.trim()).filter(Boolean));
}

function sessionStatus(session: ScopedStrengthSession): TrainingExecutionStatus {
  const sets = session.sets.filter((set) => set.exerciseName.trim());
  if (!sets.length) return '未完成';
  const completed = sets.filter((set) => set.completed).length;
  return completed === sets.length ? '完成' : completed > 0 ? '部分完成' : '未完成';
}

export function matchTrainingRows(
  planned: PlannedTrainingSession[],
  sessions: ScopedStrengthSession[]
): TrainingExecutionRow[] {
  const remaining = [...sessions];
  const rows: TrainingExecutionRow[] = planned.map((item, index) => {
    const matchIndex = remaining.findIndex((session) => {
      if (session.athleteId !== item.athleteId || session.trainingDate !== item.date) return false;
      const names = sessionExerciseNames(session);
      return item.exerciseNames.some((name) => names.has(name));
    });
    const session = matchIndex >= 0 ? remaining.splice(matchIndex, 1)[0] : null;
    return {
      key: `plan-${item.planId}-${item.weekKey}-${item.athleteId}-${index}`,
      date: item.date,
      athleteId: item.athleteId,
      planId: item.planId,
      planTitle: item.planTitle,
      plannedNames: item.exerciseNames,
      plannedMinutes: item.plannedMinutes,
      plannedSets: item.plannedSets,
      plannedReps: item.plannedReps,
      session,
      status: session ? sessionStatus(session) : '未进行',
    };
  });
  for (const session of remaining) {
    rows.push({
      key: `actual-${session.id}`,
      date: session.trainingDate,
      athleteId: session.athleteId,
      planId: null,
      planTitle: null,
      plannedNames: [],
      plannedMinutes: null,
      plannedSets: null,
      plannedReps: null,
      session,
      status: '计划外',
    });
  }
  return rows.sort(
    (left, right) => right.date.localeCompare(left.date) || left.athleteId - right.athleteId
  );
}
