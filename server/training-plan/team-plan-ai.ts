import { projectRules, SPORT_RULES_VERSION } from '../../shared/sport-rules.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { chatJson } from '../core/ai-client.ts';
import { beijingDate } from '../core/coach-daily-todos.ts';
import { teamPlanInput, validateTeamPlanContext } from './team-plan-service.ts';
import { readTeamPlanChecks } from '../core/team-plan-checks.ts';
import type { TeamPlanData, TeamPlanSession } from '../../shared/team-plan.ts';

const PROMPT_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'prompts',
  'training-plan-system.md'
);
const HISTORY_LIMIT = 10;

let promptCache: { text: string; version: string } | null = null;
export function loadTrainingPlanPrompt() {
  if (!promptCache) {
    const text = readFileSync(PROMPT_PATH, 'utf8');
    promptCache = { text, version: createHash('sha256').update(text).digest('hex').slice(0, 12) };
  }
  return promptCache;
}

// AI 输出的结构化草稿：与 shared/team-plan.ts 的 TeamPlanData 对齐，不另建计划模型。
const aiSession = z.object({
  activityCode: z.string().trim().max(40).optional(),
  intensitySystem: z.string().trim().max(40).optional(),
  id: z.string().trim().min(1).max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['special', 'physical', 'recovery']),
  period: z.string().max(80).default(''),
  content: z.string().trim().min(1).max(4000),
  durationMin: z.number().finite().min(0).max(100000).nullable().default(null),
  distanceKm: z.number().finite().min(0).max(100000).nullable().default(null),
  intensity: z.string().max(200).default(''),
  sets: z.number().finite().min(0).max(10000).nullable().default(null),
  reps: z.number().finite().min(0).max(10000).nullable().default(null),
  load: z.number().finite().min(0).max(10000).nullable().default(null),
  notes: z.string().max(4000).default(''),
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100).optional(),
        title: z.string().trim().min(1).max(200),
        description: z.string().max(2000).default(''),
      })
    )
    .max(50)
    .optional(),
});
const aiPlanOutput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  focus: z.string().max(4000).default(''),
  goal: z.string().max(4000).default(''),
  dataNotes: z.array(z.string().max(1000)).max(20).default([]),
  sessions: z.array(aiSession).min(1).max(50),
  overrides: teamPlanInput.shape.data.shape.overrides.default([]),
});

export class TeamPlanAiError extends Error {}

// AI 返回结果为不可信输入：解析、编号、强度与单位校验后映射到既有计划结构。
export function normalizeAiPlan(
  raw: unknown,
  targetDate: string,
  project?: string
): { data: TeamPlanData; dataNotes: string[]; warnings: string[] } {
  const parsed = aiPlanOutput.safeParse(raw);
  if (!parsed.success)
    throw new TeamPlanAiError(
      'AI输出不符合计划结构：' + parsed.error.issues.map((issue) => issue.message).join('；')
    );
  const warnings: string[] = [];
  const output = parsed.data;
  if (output.date !== targetDate)
    throw new TeamPlanAiError(`AI输出日期${output.date}与目标日期${targetDate}不一致`);
  const sessionIds = new Set<string>();
  const sessions: TeamPlanSession[] = output.sessions.map((session, index) => {
    if (session.date !== targetDate) throw new TeamPlanAiError('AI输出包含非目标日期的训练课');
    const id = session.id?.trim() || `s${index + 1}`;
    if (sessionIds.has(id)) throw new TeamPlanAiError('AI输出的训练课标识重复');
    sessionIds.add(id);
    const intensity = session.intensity.trim();
    if (intensity && !session.intensitySystem)
      warnings.push(
        `训练课「${session.content}」强度“${intensity}”未声明体系，仅保留原文，不进行阈值或分区换算`
      );
    const itemIds = new Set<string>();
    return {
      id,
      date: targetDate,
      category: session.category,
      period: session.period,
      content: session.content,
      durationMin: session.durationMin,
      distanceKm: session.distanceKm,
      intensity,
      ...(session.activityCode ? { activityCode: session.activityCode } : {}),
      ...(session.intensitySystem ? { intensitySystem: session.intensitySystem } : {}),
      ...(project ? { rulesVersion: SPORT_RULES_VERSION } : {}),
      sets: session.sets,
      reps: session.reps,
      load: session.load,
      notes: session.notes,
      items: session.items?.map((item, itemIndex) => {
        const itemId = item.id?.trim() || `${id}-${itemIndex + 1}`;
        if (itemIds.has(itemId)) throw new TeamPlanAiError('AI输出的内容项标识重复');
        itemIds.add(itemId);
        return { id: itemId, title: item.title, description: item.description };
      }),
    };
  });
  // 复用既有计划校验（日期范围、字段边界、标识唯一性）。
  const data: TeamPlanData = {
    goal: output.goal,
    focus: output.focus,
    sessions,
    overrides: output.overrides.map((override) => ({
      ...override,
      createdBy: override.createdBy || 1,
      updatedBy: override.updatedBy || 1,
      createdAt: override.createdAt || '',
      updatedAt: override.updatedAt || '',
    })),
  };
  const check = teamPlanInput.safeParse({
    title: `AI草稿 ${targetDate}`,
    startDate: targetDate,
    endDate: targetDate,
    data,
  });
  if (!check.success)
    throw new TeamPlanAiError(
      'AI输出未通过计划校验：' + check.error.issues.map((issue) => issue.message).join('；')
    );
  if (project) {
    try {
      validateTeamPlanContext(project, check.data.data);
    } catch (error) {
      throw new TeamPlanAiError(error instanceof Error ? error.message : 'AI计划的项目活动不适用');
    }
  }
  return { data: check.data.data as TeamPlanData, dataNotes: output.dataNotes, warnings };
}

export type TeamPlanAiMetadata = {
  source: 'ai_generated';
  promptVersion: string;
  model: string;
  generatedAt: string;
  targetDate: string;
  dataNotes: string[];
  warnings: string[];
  conversation: Array<{ role: 'coach' | 'ai'; text: string; at: string }>;
  history: Array<{ at: string; instruction: string; data: TeamPlanData }>;
};

// 修改差异：按训练课 id 比对新增、删除与字段级修改，供教练审核。
export type TeamPlanDiff = {
  added: TeamPlanSession[];
  removed: TeamPlanSession[];
  modified: Array<{ id: string; content: string; changes: Record<string, unknown> }>;
  personal?: Array<{
    athleteId: number;
    sessionId: string;
    changes: TeamPlanData['overrides'][number]['changes'];
    reason: string;
  }>;
};

export function diffTeamPlanData(prev: TeamPlanData, next: TeamPlanData): TeamPlanDiff {
  const prevById = new Map(prev.sessions.map((session) => [session.id, session]));
  const nextById = new Map(next.sessions.map((session) => [session.id, session]));
  const added = next.sessions.filter((session) => !prevById.has(session.id));
  const removed = prev.sessions.filter((session) => !nextById.has(session.id));
  const modified: TeamPlanDiff['modified'] = [];
  for (const session of next.sessions) {
    const before = prevById.get(session.id);
    if (!before) continue;
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(session) as Array<keyof TeamPlanSession>) {
      if (JSON.stringify(before[key]) !== JSON.stringify(session[key]))
        changes[key] = { from: before[key], to: session[key] };
    }
    if (Object.keys(changes).length)
      modified.push({ id: session.id, content: session.content, changes });
  }
  const personal = next.overrides
    .filter((item) => {
      const old = prev.overrides.find(
        (row) => row.athleteId === item.athleteId && row.sessionId === item.sessionId
      );
      return (
        !old ||
        JSON.stringify(old.changes) !== JSON.stringify(item.changes) ||
        old.reason !== item.reason
      );
    })
    .map(({ athleteId, sessionId, changes, reason }) => ({
      athleteId,
      sessionId,
      changes,
      reason,
    }));
  return { added, removed, modified, ...(personal.length ? { personal } : {}) };
}

// 保留未涉及的个人差异，合并教练指定调整；删除关联课次时拒绝覆盖旧草稿。
export function preserveAiOverrides(
  previous: TeamPlanData,
  next: TeamPlanData
): TeamPlanData['overrides'] {
  const sessionIds = new Set(next.sessions.map((session) => session.id));
  if (previous.overrides.some((override) => !sessionIds.has(override.sessionId)))
    throw new TeamPlanAiError('AI修订移除了已有个人调整的训练课，请先由教练处理该课个人调整');
  const nextByKey = new Map(
    next.overrides.map((item) => [`${item.athleteId}:${item.sessionId}`, item])
  );
  return [
    ...previous.overrides.map((item) => {
      const key = `${item.athleteId}:${item.sessionId}`;
      const update = nextByKey.get(key);
      nextByKey.delete(key);
      return update
        ? { ...item, ...update, changes: { ...item.changes, ...update.changes } }
        : item;
    }),
    ...nextByKey.values(),
  ];
}

// —— 真实数据摘要：只整理与制定次日计划有关的信息，缺失显式标注，不把原始查询直接丢给模型。 ——

export type TeamAiContext = Record<string, unknown> & {
  team: { id: number; project: string; name: string; athleteCount: number; trainingDate: string };
};

export function buildTeamAiContext(
  db: DatabaseSync,
  input: { teamId: number; date: string; constraints?: string }
): TeamAiContext {
  const team = db
    .prepare('SELECT id,project,name FROM project_teams WHERE id=? AND active=1')
    .get(input.teamId) as { id: number; project: string; name: string } | undefined;
  if (!team) throw new TeamPlanAiError('队伍不存在或已停用');
  const athletes = db
    .prepare(
      'SELECT id,name FROM athletes WHERE team_id=? AND project=? AND active=1 ORDER BY name'
    )
    .all(input.teamId, team.project) as Array<{ id: number; name: string }>;
  if (!athletes.length) throw new TeamPlanAiError('队伍暂无在训运动员');
  const athleteIds = athletes.map((athlete) => athlete.id);
  const placeholders = athleteIds.map(() => '?').join(',');
  const missing: string[] = [];

  // 当前周期计划（阶段目标、周约束）。
  const published = db
    .prepare(
      `SELECT title,start_date AS startDate,end_date AS endDate,plan_data AS planData
      FROM training_plans WHERE model='team' AND team_id=? AND status='published'
      AND start_date<=? AND end_date>=?
      ORDER BY published_at DESC LIMIT 1`
    )
    .get(input.teamId, input.date, input.date) as
    { title: string; startDate: string; endDate: string; planData: string } | undefined;
  let currentPlan: unknown = null;
  if (published) {
    const data = JSON.parse(published.planData) as TeamPlanData;
    currentPlan = {
      title: published.title,
      startDate: published.startDate,
      endDate: published.endDate,
      goal: data.goal || null,
      focus: data.focus || null,
    };
  } else {
    missing.push('当前无已发布周期计划，阶段目标缺失');
  }

  // 近 28 天逐日负荷（正式课次口径），并给出近 7 天对比。
  const windowStart = beijingDate(new Date(Date.parse(`${input.date}T00:00:00Z`) - 28 * 86400_000));
  const rows = db
    .prepare(
      `SELECT session_date AS date,
        COUNT(*) AS sessions,
        SUM(CASE WHEN duration_reported=1 THEN duration_min END) AS durationMin,
        SUM(CASE WHEN distance_reported=1 THEN distance_km END) AS distanceKm,
        SUM(CASE WHEN rpe IS NOT NULL AND duration_reported=1 THEN srpe END) AS load,
        AVG(rpe) AS avgRpe
      FROM training_sessions
      WHERE athlete_id IN (${placeholders}) AND session_date BETWEEN ? AND ? AND session_date < ?
        AND is_demo=0 AND quality NOT IN ('insufficient','outlier','estimated')
        AND LOWER(source) NOT LIKE '%demo%' AND LOWER(source) NOT LIKE '%seed%'
        AND LOWER(source) NOT LIKE '%estimated%'
      GROUP BY session_date ORDER BY session_date`
    )
    .all(...athleteIds, windowStart, input.date, input.date) as Array<{
    date: string;
    sessions: number;
    durationMin: number | null;
    distanceKm: number | null;
    load: number | null;
    avgRpe: number | null;
  }>;
  const dayMap = new Map(rows.map((row) => [row.date, row]));
  const dailyLoads = [] as Array<Record<string, unknown>>;
  for (let offset = 28; offset >= 1; offset--) {
    const day = beijingDate(new Date(Date.parse(`${input.date}T00:00:00Z`) - offset * 86400_000));
    const row = dayMap.get(day);
    dailyLoads.push(
      row
        ? {
            date: day,
            sessions: row.sessions,
            durationMin: row.durationMin,
            distanceKm: row.distanceKm,
            load: row.load,
            avgRpe: row.avgRpe === null ? null : Math.round(row.avgRpe * 10) / 10,
          }
        : { date: day, sessions: 0, durationMin: null, distanceKm: null, load: null, avgRpe: null }
    );
  }
  const recent7 = dailyLoads.slice(-7);
  const prior7 = dailyLoads.slice(-14, -7);
  const summarize = (list: Array<Record<string, unknown>>) => {
    const sum = (key: string, digits = 0): number | null => {
      const values = list
        .map((item) => item[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      return values.length
        ? Number(values.reduce((total, value) => total + value, 0).toFixed(digits))
        : null;
    };
    return {
      sessions: sum('sessions'),
      durationMin: sum('durationMin'),
      distanceKm: sum('distanceKm', 1),
      load: sum('load', 1),
    };
  };
  const loadTrend = { recent7: summarize(recent7), prior7: summarize(prior7) };

  // 昨日计划、队伍执行确认与实际记录（严格区分三个层次）。
  const yesterday = beijingDate(new Date(Date.parse(`${input.date}T00:00:00Z`) - 86400_000));
  const yesterdayPlanRow = db
    .prepare(
      `SELECT id,plan_data AS planData FROM training_plans
      WHERE model='team' AND team_id=? AND status IN ('published','archived')
        AND start_date<=? AND end_date>=? AND published_at IS NOT NULL
      ORDER BY published_at DESC LIMIT 1`
    )
    .get(input.teamId, yesterday, yesterday) as { id: number; planData: string } | undefined;
  let yesterdaySummary: unknown = null;
  if (yesterdayPlanRow) {
    const data = JSON.parse(yesterdayPlanRow.planData) as TeamPlanData;
    const sessions = data.sessions.filter((session) => session.date === yesterday);
    const checks = readTeamPlanChecks(db, yesterdayPlanRow.id);
    const actual = db
      .prepare(
        `SELECT COUNT(*) AS sessions,
          SUM(CASE WHEN duration_reported=1 THEN duration_min END) AS durationMin,
          SUM(CASE WHEN distance_reported=1 THEN distance_km END) AS distanceKm,
          AVG(rpe) AS avgRpe
        FROM training_sessions WHERE athlete_id IN (${placeholders}) AND session_date=?
          AND is_demo=0 AND quality NOT IN ('insufficient','outlier','estimated')
          AND LOWER(source) NOT LIKE '%demo%' AND LOWER(source) NOT LIKE '%seed%'
          AND LOWER(source) NOT LIKE '%estimated%'`
      )
      .get(...athleteIds, yesterday) as {
      sessions: number;
      durationMin: number | null;
      distanceKm: number | null;
      avgRpe: number | null;
    };
    yesterdaySummary = {
      date: yesterday,
      planned: sessions.map((session) => ({
        id: session.id,
        category: session.category,
        content: session.content,
        durationMin: session.durationMin,
        distanceKm: session.distanceKm,
        intensity: session.intensity,
        // 队伍执行确认：仅表示教练确认组织实施，不代表个人完成量。
        checkStatus:
          checks.find((check) => check.sessionId === session.id && !check.itemId)?.status ||
          'pending',
      })),
      actual: {
        sessions: actual.sessions,
        durationMin: actual.durationMin,
        distanceKm: actual.distanceKm,
        avgRpe: actual.avgRpe === null ? null : Math.round(actual.avgRpe * 10) / 10,
        note: actual.sessions ? '个人实际执行以训练记录为准' : '昨日暂无实际训练记录',
      },
    };
  } else {
    missing.push('昨日无已发布计划');
  }

  // 晨检与恢复（近 7 天均值，缺失保持 null）。
  const wellnessRows = db
    .prepare(
      `SELECT AVG(sleep_hours) AS sleepHours,AVG(morning_pulse) AS morningPulse,
        AVG(fatigue_index) AS fatigue,SUM(CASE WHEN status IN ('attention','alert') THEN 1 ELSE 0 END) AS alerts
      FROM daily_wellness WHERE athlete_id IN (${placeholders})
        AND wellness_date BETWEEN ? AND ? AND is_demo=0 AND quality NOT IN ('insufficient','outlier','estimated')`
    )
    .get(
      ...athleteIds,
      beijingDate(new Date(Date.parse(`${input.date}T00:00:00Z`) - 7 * 86400_000)),
      yesterday
    ) as {
    sleepHours: number | null;
    morningPulse: number | null;
    fatigue: number | null;
    alerts: number;
  };
  const wellness = {
    windowDays: 7,
    avgSleepHours:
      wellnessRows.sleepHours === null ? null : Math.round(wellnessRows.sleepHours * 10) / 10,
    avgMorningPulse:
      wellnessRows.morningPulse === null ? null : Math.round(wellnessRows.morningPulse * 10) / 10,
    avgFatigue: wellnessRows.fatigue === null ? null : Math.round(wellnessRows.fatigue * 10) / 10,
    attentionCount: wellnessRows.alerts,
    note:
      wellnessRows.sleepHours === null && wellnessRows.morningPulse === null
        ? '近7天无有效晨检数据'
        : null,
  };
  if (wellness.note) missing.push('晨检数据不足');

  // 近期专项测试（队伍项目口径）与体能测试摘要。
  const specialTests = db
    .prepare(
      `SELECT e.test_date AS date,e.distance_m AS distanceM,e.boat_class AS boatClass,
        ROUND(AVG(r.best_ms)/1000.0,2) AS avgBestSeconds
      FROM special_test_results r JOIN special_test_events e ON e.id=r.event_id
      WHERE e.project=? AND e.test_date BETWEEN ? AND ?
        AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(r.member_athlete_ids) THEN r.member_athlete_ids ELSE '[]' END) m WHERE m.value IN (${placeholders}))
      GROUP BY e.id ORDER BY e.test_date DESC LIMIT 5`
    )
    .all(team.project, windowStart, yesterday, ...athleteIds) as Array<Record<string, unknown>>;
  if (!specialTests.length) missing.push('近期专项测试数据缺失');
  const strengthTests = db
    .prepare(
      `SELECT COUNT(*) AS sets,SUM(actual_weight_kg*actual_reps) AS volumeKg
      FROM strength_result_sets s JOIN training_sessions t ON t.id=s.training_session_id
      WHERE t.athlete_id IN (${placeholders}) AND t.session_date BETWEEN ? AND ? AND s.completed=1
        AND t.is_demo=0 AND t.quality NOT IN ('insufficient','outlier','estimated')
        AND LOWER(t.source) NOT LIKE '%demo%' AND LOWER(t.source) NOT LIKE '%seed%'
        AND LOWER(t.source) NOT LIKE '%estimated%'`
    )
    .get(...athleteIds, windowStart, yesterday) as { sets: number; volumeKg: number | null };
  if (!strengthTests.sets) missing.push('近28天体能训练结果缺失');

  return {
    team: {
      id: team.id,
      project: team.project,
      name: team.name,
      athleteCount: athletes.length,
      trainingDate: input.date,
    },
    projectRules: projectRules(team.project),
    currentPlan,
    loadTrend,
    dailyLoads,
    yesterday: yesterdaySummary,
    wellness,
    specialTests,
    strengthSummary: {
      windowDays: 28,
      completedSets: strengthTests.sets,
      volumeKg: strengthTests.volumeKg === null ? null : Math.round(strengthTests.volumeKg),
    },
    coachConstraints: input.constraints?.trim() || null,
    missingData: missing,
  };
}

// —— 生成与修订 ——

export type GenerateInput = {
  db: DatabaseSync;
  teamId: number;
  date: string;
  constraints?: string;
  userId: number;
  existingDraft?: { id: number; data: TeamPlanData; metadata: TeamPlanAiMetadata | null };
  instruction?: string;
};

export type GenerateResult = {
  data: TeamPlanData;
  metadata: TeamPlanAiMetadata;
  diff: TeamPlanDiff | null;
  modelUsed: string;
};

// 生成或修订草稿的纯计算部分：组装上下文、调用模型、规范化输出、保留历史。
export async function generateTeamPlanDraft(input: GenerateInput): Promise<GenerateResult> {
  const prompt = loadTrainingPlanPrompt();
  const members = input.db
    .prepare(
      'SELECT a.id,a.name FROM athletes a JOIN project_teams t ON t.id=a.team_id AND t.project=a.project WHERE a.team_id=? AND a.active=1'
    )
    .all(input.teamId) as Array<{ id: number; name: string }>;
  const anonymize = (text: string) =>
    members
      .slice()
      .sort((a, b) => b.name.length - a.name.length)
      .reduce(
        (result, member) =>
          member.name ? result.split(member.name).join(`队员#${member.id}`) : result,
        text
      );
  const context = buildTeamAiContext(input.db, {
    teamId: input.teamId,
    date: input.date,
    constraints: input.constraints ? anonymize(input.constraints) : undefined,
  });
  context.athletes = members.map((member) => ({ id: member.id, label: `队员#${member.id}` }));
  const previous = input.existingDraft;
  const messages = [
    { role: 'system' as const, content: prompt.text },
    {
      role: 'user' as const,
      content: [
        `目标训练日：${input.date}`,
        previous
          ? '以下是当前草稿。教练提出了修改要求，请只调整被要求的部分，保留其余训练课与内容项，输出完整修改后的计划。'
          : '请为该队伍生成指定训练日的计划草稿。',
        `当前草稿：${previous ? anonymize(JSON.stringify(previous.data)) : '无'}`,
        `教练要求：${anonymize(input.instruction?.trim() || input.constraints?.trim() || '按阶段目标与近期负荷常规安排')}`,
        `训练数据摘要：${anonymize(JSON.stringify(context))}`,
        '请严格按系统指令中的 JSON 结构输出。',
      ].join('\n\n'),
    },
  ];
  const { data: raw, modelUsed } = await chatJson<unknown>({
    messages,
    temperature: 0.2,
    maxCompletionTokens: 16_000,
  });
  const { data, dataNotes, warnings } = normalizeAiPlan(raw, input.date, context.team.project);
  if (previous) data.overrides = preserveAiOverrides(previous.data, data);
  const now = new Date().toISOString();
  const allowedIds = new Set(members.map((member) => member.id));
  data.overrides = data.overrides.map((override) => {
    if (!allowedIds.has(override.athleteId))
      throw new TeamPlanAiError('AI个人调整包含非本队运动员');
    const existing = previous?.data.overrides.find(
      (item) => item.athleteId === override.athleteId && item.sessionId === override.sessionId
    );
    return {
      ...override,
      createdBy: existing?.createdBy || input.userId,
      updatedBy: input.userId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  });
  const validated = teamPlanInput.safeParse({
    title: 'AI草稿',
    startDate: input.date,
    endDate: input.date,
    data,
  });
  if (!validated.success) throw new TeamPlanAiError('AI修订未通过计划校验');
  validateTeamPlanContext(context.team.project, validated.data.data as TeamPlanData);
  data.sessions = validated.data.data.sessions;
  data.overrides = validated.data.data.overrides as TeamPlanData['overrides'];
  const oldMetadata = previous?.metadata;
  const metadata: TeamPlanAiMetadata = {
    source: 'ai_generated',
    promptVersion: prompt.version,
    model: modelUsed,
    generatedAt: now,
    targetDate: input.date,
    dataNotes,
    warnings,
    conversation: [
      ...(oldMetadata?.conversation || []),
      ...(input.instruction
        ? [
            { role: 'coach' as const, text: input.instruction.slice(0, 1000), at: now },
            {
              role: 'ai' as const,
              text: `已按要求修订（${dataNotes.length ? dataNotes.join('；') : '无额外说明'}）`,
              at: now,
            },
          ]
        : []),
    ].slice(-20),
    history: [
      ...(oldMetadata?.history || []),
      ...(previous
        ? [{ at: now, instruction: input.instruction || '重新生成', data: previous.data }]
        : []),
    ].slice(-HISTORY_LIMIT),
  };
  return {
    data,
    metadata,
    diff: previous ? diffTeamPlanData(previous.data, data) : null,
    modelUsed,
  };
}

// 撤销上一次 AI 修改：从历史快照恢复，没有历史则报错。
export function undoTeamPlanAiChange(current: {
  data: TeamPlanData;
  metadata: TeamPlanAiMetadata | null;
}): { data: TeamPlanData; metadata: TeamPlanAiMetadata } {
  const metadata = current.metadata;
  if (!metadata?.history?.length) throw new TeamPlanAiError('没有可撤销的AI修改');
  const last = metadata.history[metadata.history.length - 1];
  return {
    data: last.data,
    metadata: {
      ...metadata,
      generatedAt: new Date().toISOString(),
      conversation: [
        ...metadata.conversation,
        {
          role: 'ai' as const,
          text: '已撤销上一次修改，恢复为修改前的草稿',
          at: new Date().toISOString(),
        },
      ].slice(-20),
      history: metadata.history.slice(0, -1),
    },
  };
}

export function parseAiMetadata(value: string | null): TeamPlanAiMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as TeamPlanAiMetadata;
    return parsed && parsed.source === 'ai_generated' ? parsed : null;
  } catch {
    return null;
  }
}
