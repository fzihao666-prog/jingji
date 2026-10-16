import type { DatabaseSync } from 'node:sqlite';
import {
  readTeamPlansForAthlete,
  resolveTeamPlanSessions,
} from '../training-plan/team-plan-service.ts';
import type { TeamPlanSession } from '../../shared/team-plan.ts';
import { beijingDate } from './coach-daily-todos.ts';
import { extractTodayPlanDay, summarizeTodayPlans, type TodayPlanDay } from './plan-today.ts';

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
  teamPlanId?: number;
  rootId?: number;
  publishedAt?: string;
  archivedAt?: string;
  targetSessions?: TeamPlanSession[];
};

type SessionRecord = {
  athleteId: number;
  date: string;
  durationMin: number;
  srpe: number;
  source: string;
  quality: string;
  isDemo: number;
  // 今日执行情况扩展字段：旧调用方缺省时不参与今日汇总。
  distanceKm?: number;
  durationReported?: number;
  distanceReported?: number;
  rpe?: number | null;
  trainingType?: string;
  content?: string;
  structureType?: string;
  teamPlanId?: number;
  planSessionId?: string;
  target?: TeamPlanSession;
  sessionOrder?: number;
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
        const items = Array.isArray(day?.exercises)
          ? day.exercises
          : Array.isArray(day?.items)
            ? day.items
            : [];
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

    // 队伍计划按训练课与发布版本计算，旧个人计划继续沿用历史按天口径。
    const teamPlans = activePlans.filter((plan) => plan.teamPlanId && plan.targetSessions);
    const targets = new Map<string, { planId: number; target: TeamPlanSession }>();
    for (const plan of teamPlans) {
      for (const target of plan.targetSessions || []) {
        if (target.date < windowStart || target.date > today) continue;
        const eligible = teamPlans
          .filter(
            (candidate) =>
              candidate.rootId === plan.rootId &&
              candidate.startDate <= target.date &&
              candidate.endDate >= target.date &&
              candidate.publishedAt &&
              beijingDate(new Date(candidate.publishedAt)) <= target.date &&
              (!candidate.archivedAt || target.date < beijingDate(new Date(candidate.archivedAt)))
          )
          .sort(
            (a, b) =>
              (b.publishedAt || '').localeCompare(a.publishedAt || '') ||
              (b.teamPlanId || 0) - (a.teamPlanId || 0)
          );
        if (eligible[0]?.teamPlanId === plan.teamPlanId)
          targets.set(`${plan.rootId}:${target.id}`, { planId: plan.teamPlanId!, target });
      }
    }
    // 已记录的执行快照优先，后续修订不能改变这节训练的个人目标。
    for (const session of sessions) {
      if (!session.target || !session.teamPlanId || !session.planSessionId) continue;
      const plan = teamPlans.find((plan) => plan.teamPlanId === session.teamPlanId);
      targets.set(`${plan?.rootId || session.teamPlanId}:${session.planSessionId}`, {
        planId: session.teamPlanId,
        target: session.target,
      });
    }
    const lessonExecution = [...targets.values()].map(({ planId, target }) => {
      const records = sessions.filter(
        (session) => session.teamPlanId === planId && session.planSessionId === target.id
      );
      if (!records.length)
        return {
          planId,
          sessionId: target.id,
          date: target.date,
          category: target.category,
          target,
          status: 'pending',
          completionRate: null,
        };
      const ratios: number[] = [];
      if (
        target.durationMin !== null &&
        target.durationMin > 0 &&
        records.some((record) => record.durationReported)
      )
        ratios.push(
          records
            .filter((record) => record.durationReported)
            .reduce((sum, record) => sum + record.durationMin, 0) / target.durationMin
        );
      if (
        target.distanceKm !== null &&
        target.distanceKm > 0 &&
        records.some((record) => record.distanceReported)
      )
        ratios.push(
          records
            .filter((record) => record.distanceReported)
            .reduce((sum, record) => sum + (record.distanceKm || 0), 0) / target.distanceKm
        );
      const numericTarget = (target.durationMin || 0) > 0 || (target.distanceKm || 0) > 0;
      const missingTargetMeasurement =
        ((target.durationMin || 0) > 0 && !records.some((record) => record.durationReported)) ||
        ((target.distanceKm || 0) > 0 && !records.some((record) => record.distanceReported));
      const ratio = missingTargetMeasurement
        ? null
        : ratios.length
          ? Math.min(1, ...ratios)
          : numericTarget
            ? null
            : 1;
      return {
        planId,
        sessionId: target.id,
        date: target.date,
        category: target.category,
        target,
        status: ratio === null ? 'recorded' : ratio >= 1 ? 'complete' : 'partial',
        completionRate: ratio === null ? null : Math.round(ratio * 100) / 100,
      };
    });
    const hasTeamTargets = teamPlans.length > 0 || lessonExecution.length > 0;
    const knownLessons = lessonExecution.filter((lesson) => lesson.completionRate !== null);
    const planned = hasTeamTargets
      ? new Set(lessonExecution.map((lesson) => lesson.date)).size
      : plannedDays.size;
    const actual = actualDays.size;
    const completionRate = hasTeamTargets
      ? knownLessons.length && knownLessons.length === lessonExecution.length
        ? knownLessons.reduce((sum, lesson) => sum + (lesson.completionRate || 0), 0) /
          knownLessons.length
        : null
      : planned > 0
        ? Math.min(1, actual / planned)
        : null;

    // 今日执行事实：只用当天正式课次；无记录先记待确认，不判定未完成。
    const todaySessions = sessions.filter((s) => s.date === today);
    const todayPlan = readTodayPlanFrom(plansByAthlete.get(athlete.athleteId) || [], today);
    const todayRecorded = todaySessions.length > 0;
    // 未填报的时长/距离不计 0；全程无人填报保持 null。
    const durationSessions = todaySessions.filter((s) => s.durationReported);
    const distanceSessions = todaySessions.filter((s) => s.distanceReported);
    const todayRpe = todaySessions.some((s) => s.rpe !== null && s.rpe !== undefined);

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
      status: hasTeamTargets
        ? !lessonExecution.length
          ? 'no-plan'
          : lessonExecution.every((lesson) => lesson.status === 'complete')
            ? 'complete'
            : knownLessons.length
              ? 'partial'
              : 'pending'
        : planned === 0
          ? 'no-plan'
          : actual >= planned
            ? 'complete'
            : actual > 0
              ? 'partial'
              : 'missed',
      lessonExecution,
      plannedSessions: lessonExecution.length,
      pendingSessions: lessonExecution.filter((lesson) => lesson.status === 'pending').length,
      hasPlanToday: todayPlan !== null,
      todayFocus: todayPlan ? todayPlan.focus : null,
      todayStatus: todayRecorded ? 'recorded' : todayPlan ? 'pending' : 'no-plan',
      todayDurationMin: durationSessions.length
        ? Math.round(durationSessions.reduce((sum, s) => sum + (s.durationMin || 0), 0) * 10) / 10
        : null,
      todayDistanceKm: distanceSessions.length
        ? Math.round(distanceSessions.reduce((sum, s) => sum + (s.distanceKm || 0), 0) * 10) / 10
        : null,
      todayRpeReported: todayRpe,
    };
  });

  // 今日队伍汇总：计划量来自各运动员当日课表，实际量来自当日正式课次（未填报的量不计 0）。
  const todayPlans = rows.map((row) =>
    readTodayPlanFrom(plansByAthlete.get(row.athleteId) || [], today)
  );
  const todaySessions = rows.flatMap((row) =>
    (sessionsByAthlete.get(row.athleteId) || []).filter((s) => s.date === today)
  );
  const recordedIds = new Set(
    rows.filter((row) => row.todayStatus === 'recorded').map((row) => row.athleteId)
  );
  const planSummary = summarizeTodayPlans(todayPlans);
  const reportedDurations = todaySessions.filter((s) => s.durationReported);
  const reportedDistances = todaySessions.filter((s) => s.distanceReported);

  const withPlan = rows.filter((r) => r.hasPlan);
  const measured = withPlan.filter((row) => row.completionRate !== null);
  const avgCompletion = measured.length
    ? Math.round(
        (measured.reduce((s, r) => s + (r.completionRate || 0), 0) / measured.length) * 100
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
      pending: rows.filter((r) => r.status === 'pending').length,
      avgCompletion,
    },
    athletes: rows,
    // 今日计划与执行反馈：执行率仍只用上方现有算法结果，此处只汇总当日事实。
    today: {
      summary: {
        planned: rows.filter((r) => r.hasPlanToday).length,
        recorded: recordedIds.size,
        confirmed: rows.filter((r) => r.hasPlanToday && r.todayStatus === 'recorded').length,
        pending: rows.filter((r) => r.todayStatus === 'pending').length,
        rpeReported: rows.filter((r) => r.todayRpeReported).length,
        actualDurationMin: reportedDurations.length
          ? Math.round(reportedDurations.reduce((sum, s) => sum + (s.durationMin || 0), 0) * 10) /
            10
          : null,
        actualDistanceKm: reportedDistances.length
          ? Math.round(reportedDistances.reduce((sum, s) => sum + (s.distanceKm || 0), 0) * 10) / 10
          : null,
      },
      plan: planSummary,
    },
  };
}

// 从运动员的计划中取当日课表；优先精确日期命中的计划，其次周期内当周星期命中的计划。
function readTodayPlanFrom(plans: PlanRecord[], today: string): TodayPlanDay | null {
  const current = plans
    .filter(
      (plan) =>
        !plan.teamPlanId ||
        (plan.publishedAt &&
          beijingDate(new Date(plan.publishedAt)) <= today &&
          (!plan.archivedAt || today < beijingDate(new Date(plan.archivedAt))))
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.teamPlanId)) - Number(Boolean(a.teamPlanId)) ||
        (b.publishedAt || '').localeCompare(a.publishedAt || '')
    );
  for (const plan of current) {
    const day = extractTodayPlanDay(plan.planData, today, {
      startDate: plan.startDate,
      endDate: plan.endDate,
      title: plan.title,
    });
    if (day) return day;
  }
  return null;
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

  const hasTeamSchema = (
    db.prepare('PRAGMA table_info(training_plans)').all() as { name: string }[]
  ).some((column) => column.name === 'model');
  const plans: PlanRecord[] = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, start_date AS startDate, end_date AS endDate,
      title, plan_data AS planData
    FROM training_plans
    WHERE ${hasTeamSchema ? "model='legacy' AND" : ''} athlete_id IN (${placeholders}) AND start_date <= ? AND end_date >= ?
  `
    )
    .all(...ids, today, windowStart) as Array<{
    athleteId: number;
    startDate: string;
    endDate: string;
    title: string;
    planData: string;
  }>;

  if (hasTeamSchema) {
    for (const athlete of athletes) {
      for (const plan of readTeamPlansForAthlete(db, athlete.athleteId)) {
        const targetSessions = resolveTeamPlanSessions(plan, athlete.athleteId);
        plans.unshift({
          athleteId: athlete.athleteId,
          startDate: plan.startDate,
          endDate: plan.endDate,
          title: plan.title,
          planData: JSON.stringify({ sessions: targetSessions, focus: plan.data.focus }),
          teamPlanId: plan.id,
          rootId: plan.rootId,
          publishedAt: plan.publishedAt || undefined,
          archivedAt: plan.archivedAt || undefined,
          targetSessions,
        });
      }
    }
  }
  const hasLinks = Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='training_plan_execution_links'"
      )
      .get()
  );
  const sessions: SessionRecord[] = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, session_date AS date, session_order AS sessionOrder,
      duration_min AS durationMin, distance_km AS distanceKm,
      duration_reported AS durationReported, distance_reported AS distanceReported,
      rpe, training_type AS trainingType, structure_type AS structureType, content,
      srpe, source, quality, is_demo AS isDemo
    FROM training_sessions
    WHERE athlete_id IN (${placeholders}) AND session_date BETWEEN ? AND ?
  `
    )
    .all(...ids, windowStart, today) as Array<Omit<SessionRecord, 'target'>>;

  if (hasLinks) {
    const links = db
      .prepare(
        `SELECT l.plan_id AS planId,l.session_id AS sessionId,l.target_json AS targetJson,
      t.athlete_id AS athleteId,t.session_date AS date,t.session_order AS sessionOrder
      FROM training_plan_execution_links l JOIN training_sessions t ON t.id=l.training_session_id
      WHERE t.athlete_id IN (${placeholders}) AND t.session_date BETWEEN ? AND ?`
      )
      .all(...ids, windowStart, today) as {
      planId: number;
      sessionId: string;
      targetJson: string;
      athleteId: number;
      date: string;
      sessionOrder: number;
    }[];
    // 同日多课只按数据库稳定课次对应，不按内容或时间猜测计划。
    for (const session of sessions) {
      const ordered = links.filter(
        (link) => link.athleteId === session.athleteId && link.date === session.date
      );
      const link = ordered.find((link) => link.sessionOrder === session.sessionOrder);
      if (link) {
        session.teamPlanId = link.planId;
        session.planSessionId = link.sessionId;
        session.target = JSON.parse(link.targetJson) as TeamPlanSession;
      }
    }
  }
  return buildPlanExecution({ athletes, plans, sessions, now: input.now });
}
