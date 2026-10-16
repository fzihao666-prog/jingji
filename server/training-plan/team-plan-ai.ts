import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { chatJson } from '../core/ai-client.ts';
import { beijingDate } from '../core/coach-daily-todos.ts';
import { teamPlanInput } from './team-plan-service.ts';
import { readTeamPlanChecks } from '../core/team-plan-checks.ts';
import type { TeamPlanData, TeamPlanSession } from '../../shared/team-plan.ts';
import { INTENSITY_ZONE_SYSTEMS } from '../../shared/training-intensity.ts';

const PROMPT_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'prompts',
  'training-plan-system.md'
);
const HISTORY_LIMIT = 10;
const VALID_INTENSITIES = new Set(
  INTENSITY_ZONE_SYSTEMS.flatMap((system) => [...system.zones, ''])
);

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
});

export class TeamPlanAiError extends Error {}

// AI 返回结果为不可信输入：解析、编号、强度与单位校验后映射到既有计划结构。
export function normalizeAiPlan(
  raw: unknown,
  targetDate: string
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
    if (session.date !== targetDate)
      throw new TeamPlanAiError('AI输出包含非目标日期的训练课');
    const id = session.id?.trim() || `s${index + 1}`;
    if (sessionIds.has(id)) throw new TeamPlanAiError('AI输出的训练课标识重复');
    sessionIds.add(id);
    const intensity = session.intensity.trim();
    if (!VALID_INTENSITIES.has(intensity)) {
      warnings.push(`训练课「${session.content}」强度“${intensity}”不在竞迹强度体系内，已清空`);
    }
    const itemIds = new Set<string>();
    return {
      id,
      date: targetDate,
      category: session.category,
      period: session.period,
      content: session.content,
      durationMin: session.durationMin,
      distanceKm: session.distanceKm,
      intensity: VALID_INTENSITIES.has(intensity) ? intensity : '',
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
    overrides: [],
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
    if (Object.keys(changes).length) modified.push({ id: session.id, content: session.content, changes });
  }
  return { added, removed, modified };
}

// —— 真实数据摘要：只整理与制定次日计划有关的信息，缺失显式标注，不把原始查询直接丢给模型。 ——

export type TeamAiContext = Record<string, unknown>;

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
      'SELECT id,name FROM athletes WHERE team_id=? AND active=1 ORDER BY name'
    )
    .all(input.teamId) as Array<{ id: number; name: string }>;
  if (!athletes.length) throw new TeamPlanAiError('队伍暂无在训运动员');
  const athleteIds = athletes.map((athlete) => athlete.id);
  const placeholders = athleteIds.map(() => '?').join(',');
  const missing: string[] = [];

  // 当前周期计划（阶段目标、周约束）。
  const published = db
    .prepare(
      `SELECT title,start_date AS startDate,end_date AS endDate,plan_data AS planData
      FROM training_plans WHERE model='team' AND team_id=? AND status='published'
      ORDER BY published_at DESC LIMIT 1`
    )
    .get(input.teamId) as
    | { title: string; startDate: string; endDate: string; planData: string }
    | undefined;
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
  const windowStart = beijingDate(new Date(Date.parse(`${input.date}T00:00:00Z`) - 27 * 86400_000));
  const rows = db
    .prepare(
      `SELECT session_date AS date,
        COUNT(*) AS sessions,
        SUM(duration_min) AS durationMin,
        SUM(distance_km) AS distanceKm,
        SUM(srpe) AS load,
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
  for (let offset = 27; offset >= 1; offset--) {
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
  const sum = (list: Array<Record<string, unknown>>, key: string) =>
    list.reduce<number>((total, item) => total + Number(item[key] || 0), 0);
  const loadTrend = {
    recent7: {
      sessions: sum(recent7, 'sessions'),
      durationMin: Math.round(sum(recent7, 'durationMin')),
      distanceKm: Math.round(sum(recent7, 'distanceKm') * 10) / 10,
      load: Math.round(sum(recent7, 'load') * 10) / 10,
    },
    prior7: {
      sessions: sum(prior7, 'sessions'),
      durationMin: Math.round(sum(prior7, 'durationMin')),
      distanceKm: Math.round(sum(prior7, 'distanceKm') * 10) / 10,
      load: Math.round(sum(prior7, 'load') * 10) / 10,
    },
  };

  // 昨日计划、队伍执行确认与实际记录（严格区分三个层次）。
  const yesterday = beijingDate(new Date(Date.parse(`${input.date}T00:00:00Z`) - 86400_000));
  const yesterdayPlanRow = db
    .prepare(
      `SELECT id,plan_data AS planData FROM training_plans
      WHERE model='team' AND team_id=? AND status IN ('published','archived')
        AND start_date<=? AND end_date>=? AND published_at IS NOT NULL
      ORDER BY published_at DESC LIMIT 1`
    )
    .get(input.teamId, yesterday, yesterday) as
    | { id: number; planData: string }
    | undefined;
  let yesterdaySummary: unknown = null;
  if (yesterdayPlanRow) {
    const data = JSON.parse(yesterdayPlanRow.planData) as TeamPlanData;
    const sessions = data.sessions.filter((session) => session.date === yesterday);
    const checks = readTeamPlanChecks(db, yesterdayPlanRow.id);
    const actual = db
      .prepare(
        `SELECT COUNT(*) AS sessions,SUM(duration_min) AS durationMin,SUM(distance_km) AS distanceKm,
          AVG(rpe) AS avgRpe
        FROM training_sessions WHERE athlete_id IN (${placeholders}) AND session_date=?
          AND is_demo=0 AND quality NOT IN ('insufficient','outlier','estimated')`
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
    avgSleepHours: wellnessRows.sleepHours === null ? null : Math.round(wellnessRows.sleepHours * 10) / 10,
    avgMorningPulse: wellnessRows.morningPulse === null ? null : Math.round(wellnessRows.morningPulse * 10) / 10,
    avgFatigue: wellnessRows.fatigue === null ? null : Math.round(wellnessRows.fatigue * 10) / 10,
    attentionCount: wellnessRows.alerts,
    note: wellnessRows.sleepHours === null && wellnessRows.morningPulse === null
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
      WHERE e.project=? AND e.test_date < ?
      GROUP BY e.id ORDER BY e.test_date DESC LIMIT 5`
    )
    .all(team.project, input.date) as Array<Record<string, unknown>>;
  if (!specialTests.length) missing.push('近期专项测试数据缺失');
  const strengthTests = db
    .prepare(
      `SELECT COUNT(*) AS sets,SUM(actual_weight_kg*actual_reps) AS volumeKg
      FROM strength_result_sets s JOIN training_sessions t ON t.id=s.training_session_id
      WHERE t.athlete_id IN (${placeholders}) AND t.session_date BETWEEN ? AND ? AND s.completed=1`
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
  const context = buildTeamAiContext(input.db, {
    teamId: input.teamId,
    date: input.date,
    constraints: input.constraints,
  });
  const previous = input.existingDraft;
  const messages = [
    { role: 'system' as const, content: prompt.text },
    {
      role: 'user' as const,
      content: [
        `目标训练日：${input.date}`,
        previous
          ? '以下是当前草稿。教练提出了修改要求，请只调整被要求的部分，保留其余训练课与内容项，输出完整修改后的计划。'
          : '请为该队伍生成明日训练计划草稿。',
        `当前草稿：${previous ? JSON.stringify(previous.data) : '无'}`,
        `教练要求：${input.instruction?.trim() || input.constraints?.trim() || '按阶段目标与近期负荷常规安排'}`,
        `训练数据摘要：${JSON.stringify(context)}`,
        '请严格按系统指令中的 JSON 结构输出。',
      ].join('\n\n'),
    },
  ];
  const { data: raw, modelUsed } = await chatJson<unknown>({
    messages,
    temperature: 0.2,
    maxCompletionTokens: 16_000,
  });
  const { data, dataNotes, warnings } = normalizeAiPlan(raw, input.date);
  const now = new Date().toISOString();
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
      ...(previous ? [{ at: now, instruction: input.instruction || '重新生成', data: previous.data }] : []),
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
