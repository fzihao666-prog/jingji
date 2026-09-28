import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { PROJECTS } from '../../shared/projects.ts';
import { trainingLoadCategory } from '../../shared/training-content-category.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const HIGH_LOAD_AU = 600;

export function beijingDate(now: Date) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dailyTodoQuery(now: Date) {
  const today = beijingDate(now);
  return z.strictObject({
    project: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((value) => PROJECTS.includes(value)),
    // 本接口只提供当天闭环；拒绝历史、未来和不存在的日期。
    date: z
      .string()
      .max(10)
      .refine((value) => value === today)
      .optional(),
  });
}

type TodoAthlete = { athleteId: number; athleteName: string; project: string; team: string };
type TodoSession = {
  athleteId: number;
  date: string;
  startTime: string;
  srpe: number;
  trainingType: string;
  structureType: string;
  content: string;
  source: string;
  quality: string;
  isDemo: number;
};
type TodoInjury = {
  athleteId: number;
  status: string;
  injuryName: string;
  bodyPart: string;
  painScore: number;
  createdAt: string;
};

// 与训练总览的正式训练筛选一致，不新增旧 training_records 依赖。
function isOfficialSession(session: TodoSession) {
  return (
    !session.isDemo &&
    !['insufficient', 'outlier', 'estimated'].includes(session.quality) &&
    !/demo|seed|estimated/i.test(session.source)
  );
}

// 未填报、开训时间缺失与24小时负荷的唯一计算口径；教练待办与运动员今日状态共用。
export function sessionFacts(sessions: TodoSession[], athleteIds: number[], now: Date) {
  const date = beijingDate(now);
  const since = now.getTime() - DAY_MS;
  const sinceDate = beijingDate(new Date(since));
  const ids = new Set(athleteIds);
  const submitted = new Set<number>();
  const incomplete = new Set<number>();
  const loads = new Map<number, number>();
  for (const session of sessions) {
    if (!ids.has(session.athleteId) || !isOfficialSession(session)) continue;
    if (session.date < sinceDate || session.date > date) continue;
    if (session.date === date) submitted.add(session.athleteId);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(session.startTime)) {
      incomplete.add(session.athleteId);
      continue;
    }
    const timestamp = Date.parse(`${session.date}T${session.startTime}:00+08:00`);
    if (timestamp < since || timestamp > now.getTime() || !Number.isFinite(timestamp)) continue;
    // 使用持久化 SRPE 与既有分类；逐人累计，不应用团队共同课次去重。
    if (trainingLoadCategory(session) && Number.isFinite(session.srpe) && session.srpe >= 0) {
      loads.set(session.athleteId, (loads.get(session.athleteId) || 0) + session.srpe);
    }
  }
  return { date, submitted, incomplete, loads };
}

export function buildDailyTodos(input: {
  athletes: TodoAthlete[];
  sessions: TodoSession[];
  injuries: TodoInjury[];
  now: Date;
}) {
  const { now, athletes } = input;
  const date = beijingDate(now);
  const since = now.getTime() - DAY_MS;
  const ids = new Set(athletes.map((athlete) => athlete.athleteId));
  const { submitted, incomplete, loads } = sessionFacts(
    input.sessions,
    athletes.map((athlete) => athlete.athleteId),
    now
  );
  const injuries = new Map<number, TodoInjury & { recent: boolean }>();
  for (const injury of input.injuries) {
    // SQLite CURRENT_TIMESTAMP 为 UTC；无时区后缀时显式按 UTC 解析。
    const timestamp = Date.parse(
      /[zZ]|[+-]\d\d:\d\d$/.test(injury.createdAt)
        ? injury.createdAt
        : `${injury.createdAt.replace(' ', 'T')}Z`
    );
    if (
      ids.has(injury.athleteId) &&
      injury.status !== 'healthy' &&
      Number.isFinite(timestamp) &&
      timestamp <= now.getTime()
    ) {
      injuries.set(injury.athleteId, { ...injury, recent: timestamp >= since });
    }
  }
  const missing = athletes.filter((athlete) => !submitted.has(athlete.athleteId));
  const incompleteTime = athletes.filter((athlete) => incomplete.has(athlete.athleteId));
  const attention = athletes
    .map((athlete) => {
      const load = loads.get(athlete.athleteId) || 0;
      return {
        ...athlete,
        load24h: Math.round(load * 10) / 10,
        highLoad: load >= HIGH_LOAD_AU,
        injury: injuries.get(athlete.athleteId) || null,
        timeIncomplete: incomplete.has(athlete.athleteId),
      };
    })
    .filter((athlete) => athlete.highLoad || athlete.injury)
    .sort((a, b) => Number(Boolean(b.injury)) - Number(Boolean(a.injury)) || b.load24h - a.load24h);
  return {
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: now.toISOString(),
    windowStart: new Date(since).toISOString(),
    highLoadThreshold: HIGH_LOAD_AU,
    counts: {
      total: athletes.length,
      submitted: athletes.length - missing.length,
      missing: missing.length,
      attention: attention.length,
      incompleteTime: incompleteTime.length,
    },
    missing,
    attention,
    incompleteTime,
  };
}

export function readDailyTodos(
  db: DatabaseSync,
  input: {
    athleteIds: number[];
    project: string;
    now: Date;
  }
) {
  if (!input.athleteIds.length) {
    return buildDailyTodos({ athletes: [], sessions: [], injuries: [], now: input.now });
  }
  const athletes = db
    .prepare(
      `
    SELECT a.id AS athleteId, a.name AS athleteName, a.project, COALESCE(pt.name, a.team, '') AS team
    FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
    WHERE a.active = 1 AND a.project = ? AND a.id IN (${input.athleteIds.map(() => '?').join(',')})
    ORDER BY a.name, a.id
  `
    )
    .all(input.project, ...input.athleteIds) as TodoAthlete[];
  if (!athletes.length)
    return buildDailyTodos({ athletes, sessions: [], injuries: [], now: input.now });
  const ids = athletes.map((athlete) => athlete.athleteId);
  const placeholders = ids.map(() => '?').join(',');
  const sessions = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, session_date AS date, start_time AS startTime, srpe,
      training_type AS trainingType, structure_type AS structureType, content, source, quality, is_demo AS isDemo
    FROM training_sessions WHERE athlete_id IN (${placeholders}) AND session_date BETWEEN ? AND ?
  `
    )
    .all(
      ...ids,
      beijingDate(new Date(input.now.getTime() - DAY_MS)),
      beijingDate(input.now)
    ) as TodoSession[];
  const injuries = db
    .prepare(
      `
    SELECT ir.athlete_id AS athleteId, ir.status, ir.injury_name AS injuryName,
      ir.body_part AS bodyPart, ir.pain_score AS painScore, ir.created_at AS createdAt
    FROM injury_records ir WHERE ir.athlete_id IN (${placeholders}) AND ir.id = (
      SELECT latest.id FROM injury_records latest WHERE latest.athlete_id = ir.athlete_id
        AND datetime(latest.created_at) <= datetime(?)
      ORDER BY datetime(latest.created_at) DESC, latest.id DESC LIMIT 1
    )
  `
    )
    .all(...ids, input.now.toISOString()) as TodoInjury[];
  return buildDailyTodos({ athletes, sessions, injuries, now: input.now });
}

type OverviewWellness = {
  athleteId: number;
  sleepHours: number | null;
  morningPulse: number | null;
  weightKg: number | null;
  fatigueIndex: number | null;
  sorenessIndex: number | null;
  moodIndex: number | null;
};

// 队伍总览：聚合当日训练提交、24h负荷与恢复日报，供教练快速扫全队状态。
export function buildTeamOverview(input: {
  athletes: TodoAthlete[];
  sessions: TodoSession[];
  wellness: OverviewWellness[];
  now: Date;
}) {
  const { athletes, now } = input;
  const date = beijingDate(now);
  const ids = athletes.map((a) => a.athleteId);
  const { submitted, loads } = sessionFacts(input.sessions, ids, now);
  const wellnessMap = new Map(input.wellness.map((w) => [w.athleteId, w]));
  const rows = athletes.map((athlete) => {
    const load = loads.get(athlete.athleteId) || 0;
    const w = wellnessMap.get(athlete.athleteId) || null;
    return {
      athleteId: athlete.athleteId,
      athleteName: athlete.athleteName,
      team: athlete.team,
      hasTraining: submitted.has(athlete.athleteId),
      load24h: Math.round(load * 10) / 10,
      highLoad: load >= HIGH_LOAD_AU,
      wellnessReported: Boolean(w),
      sleepHours: w?.sleepHours ?? null,
      morningPulse: w?.morningPulse ?? null,
      weightKg: w?.weightKg ?? null,
      fatigueIndex: w?.fatigueIndex ?? null,
      sorenessIndex: w?.sorenessIndex ?? null,
      moodIndex: w?.moodIndex ?? null,
    };
  });
  const trained = rows.filter((r) => r.hasTraining).length;
  const wellnessReported = rows.filter((r) => r.wellnessReported).length;
  const totalLoad = rows.reduce((sum, r) => sum + r.load24h, 0);
  return {
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: now.toISOString(),
    summary: {
      total: rows.length,
      trained,
      wellnessReported,
      averageLoad: rows.length ? Math.round((totalLoad / rows.length) * 10) / 10 : 0,
    },
    athletes: rows,
  };
}

export function readTeamOverview(
  db: DatabaseSync,
  input: { athleteIds: number[]; project: string; now: Date }
) {
  if (!input.athleteIds.length) {
    return buildTeamOverview({ athletes: [], sessions: [], wellness: [], now: input.now });
  }
  const athletes = db
    .prepare(
      `
    SELECT a.id AS athleteId, a.name AS athleteName, a.project, COALESCE(pt.name, a.team, '') AS team
    FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
    WHERE a.active = 1 AND a.project = ? AND a.id IN (${input.athleteIds.map(() => '?').join(',')})
    ORDER BY a.name, a.id
  `
    )
    .all(input.project, ...input.athleteIds) as TodoAthlete[];
  if (!athletes.length)
    return buildTeamOverview({ athletes, sessions: [], wellness: [], now: input.now });
  const ids = athletes.map((a) => a.athleteId);
  const placeholders = ids.map(() => '?').join(',');
  const sessions = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, session_date AS date, start_time AS startTime, srpe,
      training_type AS trainingType, structure_type AS structureType, content, source, quality, is_demo AS isDemo
    FROM training_sessions WHERE athlete_id IN (${placeholders}) AND session_date BETWEEN ? AND ?
  `
    )
    .all(
      ...ids,
      beijingDate(new Date(input.now.getTime() - DAY_MS)),
      beijingDate(input.now)
    ) as TodoSession[];
  const wellness = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, sleep_hours AS sleepHours, morning_pulse AS morningPulse,
      weight_kg AS weightKg, fatigue_index AS fatigueIndex, soreness_index AS sorenessIndex,
      mood_index AS moodIndex
    FROM daily_wellness WHERE athlete_id IN (${placeholders}) AND wellness_date = ?
  `
    )
    .all(...ids, beijingDate(input.now)) as OverviewWellness[];
  return buildTeamOverview({ athletes, sessions, wellness, now: input.now });
}

// 运动员本人的今日状态：与教练待办同口径，只针对单个运动员。
export function buildTodayStatus(input: {
  athleteId: number;
  sessions: TodoSession[];
  now: Date;
}) {
  const { athleteId, now } = input;
  const date = beijingDate(now);
  const { submitted, incomplete, loads } = sessionFacts(input.sessions, [athleteId], now);
  const latest = input.sessions.find(
    (session) => session.athleteId === athleteId && session.date === date && isOfficialSession(session)
  );
  return {
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: now.toISOString(),
    submitted: submitted.has(athleteId),
    timeIncomplete: incomplete.has(athleteId),
    load24h: Math.round((loads.get(athleteId) || 0) * 10) / 10,
    source: latest ? latest.source : null,
  };
}

export function readTodayStatus(
  db: DatabaseSync,
  input: { athleteId: number; now: Date }
) {
  const date = beijingDate(input.now);
  const sessions = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, session_date AS date, start_time AS startTime, srpe,
      training_type AS trainingType, structure_type AS structureType, content, source, quality, is_demo AS isDemo
    FROM training_sessions
    WHERE athlete_id = ? AND session_date BETWEEN ? AND ?
    ORDER BY session_date DESC, session_order DESC
  `
    )
    .all(
      input.athleteId,
      beijingDate(new Date(input.now.getTime() - DAY_MS)),
      date
    ) as TodoSession[];
  return buildTodayStatus({ athleteId: input.athleteId, sessions, now: input.now });
}
