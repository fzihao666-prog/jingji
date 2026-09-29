import type { DatabaseSync } from 'node:sqlite';
import { beijingDate, HIGH_LOAD_AU } from './coach-daily-todos.ts';
import { trainingLoadCategory } from '../../shared/training-content-category.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// ACWR 风险区间：与 Kitman Labs / WHOOP 等主流平台一致的分级阈值。
export const ACWR_ZONES = {
  under: 0.8, // 低于 0.8 = 欠训练
  optimal: 1.3, // 0.8-1.3 = 最佳区间
} as const;

type LoadSession = {
  athleteId: number;
  date: string;
  startTime: string;
  srpe: number;
  source: string;
  quality: string;
  isDemo: number;
};

type AthleteInfo = {
  athleteId: number;
  athleteName: string;
  team: string;
};

// 与教练待办同口径的正式训练筛选，排除演示、估算与异常记录。
function isOfficialSession(session: LoadSession) {
  return (
    !session.isDemo &&
    !['insufficient', 'outlier', 'estimated'].includes(session.quality) &&
    !/demo|seed|estimated/i.test(session.source)
  );
}

/**
 * 计算单个运动员的 ACWR 与负荷趋势。
 * - 急性负荷 = 近 7 天 SRPE 总和
 * - 慢性负荷 = 近 28 天 SRPE 日均 × 7
 * - ACWR = 急性 / 慢性（慢性为 0 时按急性 ÷ 7 归一化）
 */
export function buildLoadManagement(input: {
  athletes: AthleteInfo[];
  sessions: LoadSession[];
  now: Date;
}) {
  const { athletes, now } = input;
  const today = beijingDate(now);
  const acuteStart = beijingDate(new Date(now.getTime() - 6 * DAY_MS)); // 含今天共 7 天
  const chronicStart = beijingDate(new Date(now.getTime() - 27 * DAY_MS)); // 含今天共 28 天

  // 按运动员分组累计日负荷
  const dailyLoads = new Map<number, Map<string, number>>();
  for (const session of input.sessions) {
    if (!isOfficialSession(session)) continue;
    if (session.date < chronicStart || session.date > today) continue;
    if (!Number.isFinite(session.srpe) || session.srpe < 0) continue;
    if (!dailyLoads.has(session.athleteId)) dailyLoads.set(session.athleteId, new Map());
    const map = dailyLoads.get(session.athleteId)!;
    map.set(session.date, (map.get(session.date) || 0) + session.srpe);
  }

  const rows = athletes.map((athlete) => {
    const loads = dailyLoads.get(athlete.athleteId) || new Map<string, number>();
    // 急性负荷：近 7 天总和
    let acute = 0;
    for (const [date, load] of loads) {
      if (date >= acuteStart && date <= today) acute += load;
    }
    // 慢性负荷：近 28 天日均 × 7
    let chronicSum = 0;
    let chronicDays = 0;
    for (const [date, load] of loads) {
      if (date >= chronicStart && date <= today) {
        chronicSum += load;
        chronicDays += 1;
      }
    }
    const chronicAvg = chronicDays > 0 ? chronicSum / 28 : 0;
    const chronicWeekly = chronicAvg * 7;
    // ACWR：慢性为 0 时按急性 ÷ 7 归一化，避免除零
    const acwr = chronicWeekly > 0 ? acute / chronicWeekly : acute > 0 ? acute / 7 : 0;
    const zone =
      acwr < ACWR_ZONES.under ? 'under' : acwr <= ACWR_ZONES.optimal ? 'optimal' : 'danger';
    return {
      athleteId: athlete.athleteId,
      athleteName: athlete.athleteName,
      team: athlete.team,
      acuteLoad: Math.round(acute * 10) / 10,
      chronicLoad: Math.round(chronicWeekly * 10) / 10,
      acwr: Math.round(acwr * 100) / 100,
      zone,
      highLoad: acute >= HIGH_LOAD_AU,
    };
  });

  // 团队汇总：平均 ACWR 与风险分布
  const avgAcwr = rows.length
    ? Math.round((rows.reduce((s, r) => s + r.acwr, 0) / rows.length) * 100) / 100
    : 0;
  return {
    date: today,
    timezone: 'Asia/Shanghai',
    generatedAt: now.toISOString(),
    thresholds: ACWR_ZONES,
    summary: {
      total: rows.length,
      under: rows.filter((r) => r.zone === 'under').length,
      optimal: rows.filter((r) => r.zone === 'optimal').length,
      danger: rows.filter((r) => r.zone === 'danger').length,
      avgAcwr,
    },
    athletes: rows,
  };
}

export function readLoadManagement(
  db: DatabaseSync,
  input: { athleteIds: number[]; project: string; now: Date }
) {
  if (!input.athleteIds.length) {
    return buildLoadManagement({ athletes: [], sessions: [], now: input.now });
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
    return buildLoadManagement({ athletes, sessions: [], now: input.now });
  }
  const ids = athletes.map((a) => a.athleteId);
  const placeholders = ids.map(() => '?').join(',');
  const sessions = db
    .prepare(
      `
    SELECT athlete_id AS athleteId, session_date AS date, start_time AS startTime, srpe,
      source, quality, is_demo AS isDemo
    FROM training_sessions
    WHERE athlete_id IN (${placeholders}) AND session_date BETWEEN ? AND ?
  `
    )
    .all(
      ...ids,
      beijingDate(new Date(input.now.getTime() - 27 * DAY_MS)),
      beijingDate(input.now)
    ) as LoadSession[];
  return buildLoadManagement({ athletes, sessions, now: input.now });
}
