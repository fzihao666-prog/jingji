import type { DatabaseSync } from 'node:sqlite';
import type { TeamWeeklyQuery, TeamWeeklyReport } from '../../shared/team-weekly-report.ts';
import { reportPeriod } from '../../shared/training-report.ts';
import { trainingLoadCategory } from '../../shared/training-content-category.ts';
import { readReportSnapshot } from './report-service.ts';
import { readTeamPlans } from '../training-plan/team-plan-service.ts';

export class TeamWeeklyAccessError extends Error {}
const valid = (alias: string) => `${alias}.is_demo=0 AND ${alias}.quality IN ('valid','partial')
  AND lower(${alias}.source) NOT LIKE '%demo%' AND lower(${alias}.source) NOT LIKE '%seed%'
  AND lower(${alias}.source) NOT LIKE '%estimated%' AND lower(${alias}.source) NOT LIKE '%synthetic%'
  AND lower(${alias}.source) NOT LIKE '%simulation%'`;
const sum = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return present.length ? Math.round(present.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};
const mean = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return present.length
    ? Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 100) / 100
    : null;
};
type Session = {
  date: string;
  order: number;
  athleteId: number;
  duration: number | null;
  distance: number | null;
  srpe: number | null;
  rpe: number | null;
  trainingType: string;
  structureType: string;
  content: string;
  activityCode: string | null;
  trainingCategory: string | null;
  teamPlanId: number | null;
  planSessionId: string | null;
};
const summarize = (rows: Session[]) => ({
  sessions: new Set(rows.map((r) => `${r.date}:${r.order}`)).size,
  participations: rows.length,
  duration: sum(rows.map((r) => r.duration)),
  distance: sum(rows.map((r) => r.distance)),
  srpe: sum(rows.map((r) => r.srpe)),
  rpe: mean(rows.map((r) => r.rpe)),
  durationCount: rows.filter((r) => r.duration !== null).length,
  distanceCount: rows.filter((r) => r.distance !== null).length,
  srpeCount: rows.filter((r) => r.srpe !== null).length,
  rpeCount: rows.filter((r) => r.rpe !== null).length,
});

/** 一个只读事务内生成统计，正式事实及历史个人报告均不改写。 */
export function readTeamWeeklyReport(
  db: DatabaseSync,
  query: TeamWeeklyQuery,
  accessibleIds: number[]
): TeamWeeklyReport {
  db.exec('BEGIN');
  try {
    const team = db
      .prepare('SELECT name FROM project_teams WHERE id=? AND project=? AND active=1')
      .get(query.teamId, query.project) as { name: string } | undefined;
    const allowed = new Set(accessibleIds);
    const members = db
      .prepare('SELECT id,name,project FROM athletes WHERE active=1 AND team_id=? ORDER BY name,id')
      .all(query.teamId) as { id: number; name: string; project: string }[];
    const athletes = members
      .filter((a) => a.project === query.project && allowed.has(a.id))
      .map(({ id, name }) => ({ id, name }));
    const plansAvailable = members.length > 0 && members.every((a) => allowed.has(a.id));
    if (!team || !athletes.length)
      throw new TeamWeeklyAccessError('无权查看该项目队伍报告，或队伍暂无可访问运动员。');
    const range = reportPeriod('week', query.date);
    const shift = (date: string, days: number) =>
      new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
    const placeholders = athletes.map(() => '?').join(',');
    const readSessions = (from: string, to: string) =>
      db
        .prepare(
          `SELECT s.session_date AS date,s.session_order AS "order",s.athlete_id AS athleteId,
      CASE WHEN s.duration_reported=1 THEN s.duration_min END AS duration,
      CASE WHEN s.distance_reported=1 THEN s.distance_km END AS distance,
      CASE WHEN s.duration_reported=1 AND s.rpe IS NOT NULL THEN s.srpe END AS srpe,
      s.rpe,s.training_type AS trainingType,s.structure_type AS structureType,s.content,s.activity_code AS activityCode,s.training_category AS trainingCategory,
      l.plan_id AS teamPlanId,l.session_id AS planSessionId
      FROM training_sessions s LEFT JOIN training_plan_execution_links l ON l.training_session_id=s.id WHERE s.athlete_id IN (${placeholders}) AND s.project_code=? AND s.project_status='confirmed'
      AND s.session_date BETWEEN ? AND ? AND ${valid('s')} ORDER BY s.session_date,s.session_order`
        )
        .all(...athletes.map((a) => a.id), query.project, from, to) as Session[];
    const rows = readSessions(range.from, range.to);
    const totals = summarize(rows),
      previous = summarize(readSessions(shift(range.from, -7), shift(range.from, -1)));
    const daily = Array.from({ length: 7 }, (_, i) => {
      const date = shift(range.from, i);
      const d = summarize(rows.filter((r) => r.date === date));
      return {
        date,
        sessions: d.sessions,
        participations: d.participations,
        duration: d.duration,
        srpe: d.srpe,
        rpe: d.rpe,
      };
    });
    const details = athletes.map((a) => ({
      ...a,
      data: readReportSnapshot(db, a.id, query.project, range),
    }));
    const injuries = db
      .prepare(
        `SELECT a.name AS athlete,i.onset_date AS date,i.injury_name AS name,i.status,i.pain_score AS pain
      FROM injury_records i JOIN athletes a ON a.id=i.athlete_id WHERE i.athlete_id IN (${placeholders}) AND i.onset_date BETWEEN ? AND ? ORDER BY i.onset_date,a.name`
      )
      .all(...athletes.map((a) => a.id), range.from, range.to) as TeamWeeklyReport['injuries'];
    const plans = (plansAvailable ? readTeamPlans(db, query.teamId) : []).filter(
      (p) => p.project === query.project && p.teamId === query.teamId && p.status === 'published'
    );
    const checks = db
      .prepare(
        `SELECT c.plan_id AS planId,c.session_id AS sessionId,c.item_id AS itemId,c.status FROM team_plan_item_checks c JOIN training_plans p ON p.id=c.plan_id WHERE p.team_id=? AND p.status='published'`
      )
      .all(query.teamId) as { planId: number; sessionId: string; itemId: string; status: string }[];
    const planRows = (from: string, to: string): TeamWeeklyReport['plans'] =>
      plans
        .flatMap((p) =>
          p.data.sessions
            .filter((s) => s.date >= from && s.date <= to)
            .map((s) => {
              const sessionChecks = checks.filter((c) => c.planId === p.id && c.sessionId === s.id);
              const whole = sessionChecks.find((c) => !c.itemId);
              const itemStatuses = (s.items || []).map(
                (item) => sessionChecks.find((c) => c.itemId === item.id)?.status || 'pending'
              );
              const status =
                whole?.status ||
                (itemStatuses.length && itemStatuses.every((v) => v === 'executed')
                  ? 'executed'
                  : itemStatuses.length && itemStatuses.every((v) => v === 'cancelled')
                    ? 'cancelled'
                    : itemStatuses.some((v) => v !== 'pending')
                      ? 'partial'
                      : 'pending');
              return {
                date: s.date,
                content: s.content,
                duration: s.durationMin,
                distance: s.distanceKm,
                status,
                linkedRecords: rows.filter(
                  (r) => r.teamPlanId === p.id && r.planSessionId === s.id && r.date === s.date
                ).length,
              };
            })
        )
        .sort((a, b) => a.date.localeCompare(b.date));
    const categories = [
      ['special', '专项训练'],
      ['physical', '体能训练'],
      ['recovery', '恢复训练'],
      ['other', '未分类'],
    ].map(([key, label]) => {
      const selected = rows.filter((r) => (trainingLoadCategory(r) || 'other') === key);
      return {
        label,
        participations: selected.length,
        duration: sum(selected.map((r) => r.duration)),
      };
    });
    const participating = details.filter((a) => a.data.totals.sessions > 0).length;
    const summary = totals.participations
      ? [
          `当前权限范围内 ${athletes.length} 名队员中，${participating} 人有有效训练记录；本周记录 ${totals.sessions} 个队伍课次、${totals.participations} 人次。`,
          `已报告个人累计训练时长 ${totals.duration ?? '—'} 分钟、距离 ${totals.distance ?? '—'} km、SRPE 累计 ${totals.srpe ?? '—'} AU。`,
        ]
      : ['本周暂无有效训练记录，暂不能评价训练开展情况。'];
    const concerns = [
      `有效时长 ${totals.durationCount}/${totals.participations} 人次，距离 ${totals.distanceCount}/${totals.participations} 人次，SRPE ${totals.srpeCount}/${totals.participations} 人次。记录覆盖不代表完成率。`,
      `恢复日报 ${details.reduce((n, a) => n + a.data.wellnessDays, 0)} 人天；本周新增伤病/疼痛记录 ${injuries.length} 条，需结合具体记录由教练进一步了解。`,
    ];
    const report: TeamWeeklyReport = {
      project: query.project,
      teamId: query.teamId,
      teamName: team.name,
      generatedAt: new Date().toISOString(),
      range,
      totals,
      previous,
      daily,
      categories,
      athletes: details,
      injuries,
      plansAvailable,
      plans: planRows(range.from, range.to),
      nextPlans: planRows(shift(range.from, 7), shift(range.to, 7)),
      summary,
      concerns,
      sourceNotes: [
        '仅汇总当前权限内、当前队伍在册运动员；并非历史队伍花名册。训练和测试只取发生时项目已确认的正式事实，排除演示、模拟、估算和无效记录。',
        '队伍课次按同队同日同课次序号去重；时长、距离、SRPE为个人累计量，不能解释为队伍训练时长。RPE为有效记录均值。',
        '缺失显示“—”，不代表零或未训练。上周仅列原始统计，不在覆盖不明时推算环比或训练效果。',
        '计划章节仅展示当前已发布版本及教练实施确认；关联记录人次不代表完成率，个人调整和目标达成不在此推算。伤病仅列本周起始日期的记录，不代表全部在伤人数。',
        '模板参考国家体育总局训练总结要求及澳大利亚体育学院AMS监控方法，非官方统一模板；不生成医学判断、正式评分或自动训练处方。',
      ],
    };
    db.exec('COMMIT');
    return report;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
