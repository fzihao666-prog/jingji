import type { DatabaseSync } from 'node:sqlite';
import { beijingDate } from './coach-daily-todos.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
// 统计窗口：近 7 天（含今天）。
const WINDOW_DAYS = 7;

type AthleteInfo = {
  athleteId: number;
  athleteName: string;
  team: string;
};

type PlanRecord = {
  athleteId: number;
  startDate: string;
  endDate: string;
  title: string;
  planData: string;
};

type SessionRecord = {
  athleteId: number;
  date: string;
  durationMin: number;
  srpe: number;
  source: string;
  quality: string;
  isDemo: number;
};

// 与教练待办同口径的正式训练筛选。
function isOfficialSession(session: SessionRecord) {
  return (
    !session.isDemo &&
    !['insufficient', 'outlier', 'estimated'].includes(session.quality) &&
    !/demo|seed|estimated/i.test(session.source)
  );
}

/**
 * 从 plan_data JSON 中解析计划训练天数。
 * 兼容两种结构：
 * 1. weeklyPlans[].days[].exercises[] (AI 生成)
 * 2. weeklyPlans[].days[].items[] (导入)
 */
function countPlannedDays(planData: string): Set<string> {
  const plannedDates = new Set<string>();
  try {
    const raw = JSON.parse(planData);
    const weeks = Array.isArray(raw?.weeklyPlans) ? raw.weeklyPlans : [];
    for (const week of weeks) {
      const days = Array.isArray(week?.days) ? week.days : [];
      for (const day of days) {
        const items = Array.isArray(day?.exercises) ? day.exercises : Array.isArray(day?.items) ? day.items : [];
        const hasContent = items.length > 0 || (day?.focus && String(day.focus).trim());
        if (!hasContent) continue;
        // 尝试提取日期
        const dateStr = day?.date || day?.dayLabel || '';
        const dateMatch = String(dateStr).match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
          plannedDates.add(dateMatch[0]);
        } else {
          // 无具体日期时用占位标记，后续按顺序映射到周内日期
          plannedDates.add(`week-day:${String(day?.dayOfWeek || day?.label || '').trim()}`);
        }
      }
    }
  } catch {
    // plan_data 解析失败时按空计划处理
  }
  return plannedDates;
}

/**
 * 计算训练计划执行率：近 7 天计划训练天数 vs 实际训练天数。
 */
export function buildPlanExecution(input: {
  athletes: AthleteInfo[];
  plans: PlanRecord[];
  sessions: SessionRecord[];
  now: Date;
}) {
  const { athletes, now } = input;
  const today = beijingDate(now);
  const windowStart = beijingDate(new Date(now.getTime() - (WINDOW_DAYS - 1) * DAY_MS));

  // 按运动员分组
  const plansByAthlete = new Map<number, PlanRecord[]>();
  for (const plan of input.plans) {
    if (!plansByAthlete.has(plan.athleteId)) plansByAthlete.set(plan.athleteId, []);
    plansByAthlete.get(plan.athleteId)!.push(plan);
  }

  const sessionsByAthlete = new Map<number, SessionRecord[]>();
  for (const session of input.sessions) {
    if (!isOfficialSession(session)) continue;
    if (session.date < windowStart || session.date > today) continue;
    if (!sessionsByAthlete.has(session.athleteId)) sessionsByAthlete.set(session.athleteId, []);
    sessionsByAthlete.get(session.athleteId)!.push(session);
  }

  const rows = athletes.map((athlete) => {
    // 找覆盖统计窗口的计划
    const activePlans = (plansByAthlete.get(athlete.athleteId) || []).filter(
      (p) => p.startDate <= today && p.endDate >= windowStart
    );
    // 统计计划训练天数
    const plannedDays = new Set<string>();
    let planTitle = '';
    for (const plan of activePlans) {
      planTitle = planTitle || plan.title;
      const dates = countPlannedDays(plan.planData);
      for (const d of dates) {
        // 只统计落在窗口内的具体日期
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= windowStart && d <= today) {
          plannedDays.add(d);
        } else if (d.startsWith('week-day:')) {
          // 无具体日期的计划日按 1 天估算
          plannedDays.add(d);
        }
      }
    }
    // 实际训练天数
    const sessions = sessionsByAthlete.get(athlete.athleteId) || [];
    const actualDays = new Set(sessions.map((s) => s.date));
    const totalLoad = sessions.reduce((s, r) => s + (r.srpe || 0), 0);
    const totalDuration = sessions.reduce((s, r) => s + (r.durationMin || 0), 0);

    const planned = plannedDays.size;
    const actual = actualDays.size;
    const completionRate = planned > 0 ? Math.min(1, actual / planned) : null;

    return {
      athleteId: athlete.athleteId,
      athleteName: athlete.athleteName,
      team: athlete.team,
      hasPlan: activePlans.length > 0,
      planTitle,
      plannedDays: planned,
      actualDays: actual,
      totalLoad: Math.round(totalLoad * 10) / 10,
      totalDurationMin: Math.round(totalDuration),
      completionRate: completionRate !== null ? Math.round(completionRate * 100) / 100 : null,
      status: planned === 0 ? 'no-plan' : actual >= planned ? 'complete' : actual > 0 ? 'partial' : 'missed',
    };
  });

  const withPlan = rows.filter((r) => r.hasPlan);
  const avgCompletion = withPlan.length
    ? Math.round(
        (withPlan.reduce((s, r) => s + (r.completionRate || 0), 0) / withPlan.length) * 100
      ) / 100
    : null;

  return {
    date: today,
    timezone: 'Asia/Shanghai',
    generatedAt: now.toISOString(),
    windowStart,
    windowDays: WINDOW_DAYS,
    summary: {
      total: rows.length,
      withPlan: withPlan.length,
      withoutPlan: rows.length - withPlan.length,
      complete: rows.filter((r) => r.status === 'complete').length,
      partial: rows.filter((r) => r.status === 'partial').length,
      missed: rows.filter((r) => r.status === 'missed').length,
      avgCompletion,
    },
    athletes: rows,
  };
}

export function readPlanExecution(
  db: DatabaseSync,
  input: { athleteIds: number[]; project: string; now: Date }
) {
  if (!input.athleteIds.length) {
    return buildPlanExecution({ athletes: [], plans: [], sessions: [], now: input.now });
  }
  const athletes = db
    .prepare(
      `
    SELECT a.id AS athleteId, a.name AS athleteName, COALESCE(pt.name, a.team, '') AS team
    FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
    WHERE a.active = 1 AND a.project = ? AND a.id IN (${input.athleteIds.map(() => '?').join(',')})
    ORDER BY a.name, a.id
  `
    )
    .all(input.project, ...input.athleteIds) as AthleteInfo[];
  if (!athletes.length) {
    return buildPlanExecution({ athletes, plans: [], sessions: [], now: input.now });
  }
  const ids = athletes.map((a) => a.athleteId);
  const placeholders = ids.map(() => '?').join(',');
  const windowStart = beijingDate(new Date(input.now.getTime() - (WINDOW_DAYS - 1) * DAY_MS));
  const today = beijingDate(input.now);

  const plans = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, start_date AS startDate, end_date AS endDate,
      title, plan_data AS planData
    FROM training_plans
    WHERE athlete_id IN (${placeholders}) AND start_date <= ? AND end_date >= ?
  `
    )
    .all(...ids, today, windowStart) as PlanRecord[];

  const sessions = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, session_date AS date,
      duration_min AS durationMin, srpe, source, quality, is_demo AS isDemo
    FROM training_sessions
    WHERE athlete_id IN (${placeholders}) AND session_date BETWEEN ? AND ?
  `
    )
    .all(...ids, windowStart, today) as SessionRecord[];

  return buildPlanExecution({ athletes, plans, sessions, now: input.now });
}
