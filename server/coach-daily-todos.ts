import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { PROJECTS } from '../shared/projects.ts';
import { trainingLoadCategory } from '../shared/training-content-category.ts';

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

export function buildDailyTodos(input: {
  athletes: TodoAthlete[];
  sessions: TodoSession[];
  injuries: TodoInjury[];
  now: Date;
}) {
  const { now, athletes } = input;
  const date = beijingDate(now);
  const since = now.getTime() - DAY_MS;
  const sinceDate = beijingDate(new Date(since));
  const ids = new Set(athletes.map((athlete) => athlete.athleteId));
  const submitted = new Set<number>();
  const incomplete = new Set<number>();
  const loads = new Map<number, number>();
  for (const session of input.sessions) {
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
