import { db } from '../core/db.ts';
import { cleanString } from '../core/utils.ts';
import { strengthMetricKeyByCode } from './strength-metrics.ts';
import { STRENGTH_METRICS, type StrengthMetricValues } from '../../shared/strength-model.ts';
import { SLALOM_CHAMPION_METRICS, slalomComparison } from '../../shared/slalom-model.ts';

export function parseStrengthValues(input: unknown, targetsOnly = false) {
  const values: StrengthMetricValues = {};
  const errors: string[] = [];
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  for (const metric of STRENGTH_METRICS) {
    if (targetsOnly && !metric.targetEnabled) continue;
    const raw = source[metric.key];
    if (raw === '' || raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < metric.min || value > metric.max) {
      errors.push(`${metric.label}应在${metric.min}至${metric.max}${metric.unit}之间`);
      continue;
    }
    values[metric.key] = Math.round(value * 10) / 10;
  }
  return { values, errors };
}

export type StrengthAdviceContent = {
  title: string;
  overview: string;
  strengths: string[];
  priorities: string[];
  weeks: Array<{ week: number; focus: string; load: string; prescription: string[] }>;
  recovery: string[];
  cautions: string[];
};

export type AdviceTestRow = {
  strengthTestId: number;
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  gender: string;
  testDate: string;
  metricsJson: string;
  targetsJson: string;
};

export function adviceTestById(strengthTestId: number) {
  const session = db
    .prepare(
      `
    SELECT ts.id AS strengthTestId, ts.athlete_id AS athleteId, ts.test_date AS testDate,
      a.name AS athleteName, a.project, COALESCE(pt.name, '') AS team, a.gender
    FROM test_sessions ts JOIN athletes a ON a.id = ts.athlete_id
    LEFT JOIN project_teams pt ON pt.id = a.team_id
    WHERE ts.id = ? AND ts.test_type = '力量素质测试'
  `
    )
    .get(strengthTestId) as Omit<AdviceTestRow, 'metricsJson' | 'targetsJson'> | undefined;
  if (!session) return undefined;
  const metrics: StrengthMetricValues = {};
  const targets: StrengthMetricValues = {};
  const measurements = db
    .prepare(
      `SELECT metric_code AS metricCode, value_num AS valueNum, target_value AS targetValue FROM test_measurements WHERE test_session_id = ?`
    )
    .all(strengthTestId) as Array<{
    metricCode: string;
    valueNum: number;
    targetValue: number | null;
  }>;
  for (const measurement of measurements) {
    const key = strengthMetricKeyByCode.get(measurement.metricCode);
    if (!key) continue;
    metrics[key] = measurement.valueNum;
    if (measurement.targetValue !== null) targets[key] = measurement.targetValue;
  }
  return { ...session, metricsJson: JSON.stringify(metrics), targetsJson: JSON.stringify(targets) };
}

export function limitedText(value: unknown, fallback: string, max = 500) {
  const text = cleanString(value).replace(/\s+/g, ' ');
  return (text || fallback).slice(0, max);
}

export function limitedList(value: unknown, fallback: string[], maxItems = 6) {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .map((item) => limitedText(item, '', 240))
    .filter(Boolean)
    .slice(0, maxItems);
  return list.length ? list : fallback;
}

export function normalizeAdviceContent(input: unknown): StrengthAdviceContent {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const rawWeeks = Array.isArray(source.weeks) ? source.weeks : [];
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const raw =
      rawWeeks[index] && typeof rawWeeks[index] === 'object'
        ? (rawWeeks[index] as Record<string, unknown>)
        : {};
    return {
      week: index + 1,
      focus: limitedText(raw.focus, `第${index + 1}周训练重点`, 120),
      load: limitedText(raw.load, '负荷由教练结合当周状态确定', 160),
      prescription: limitedList(raw.prescription, ['根据测试短板安排专项练习，动作质量优先。'], 5),
    };
  });
  return {
    title: limitedText(source.title, '个人力量训练建议方案', 80),
    overview: limitedText(
      source.overview,
      '根据本次力量测试与教练目标生成，须经教练审核后执行。',
      800
    ),
    strengths: limitedList(source.strengths, ['本次数据不足，暂不判断优势项目。'], 5),
    priorities: limitedList(source.priorities, ['本次数据不足，建议补充测试后再确定训练重点。'], 5),
    weeks,
    recovery: limitedList(source.recovery, ['记录睡眠、疲劳和晨脉，根据恢复状态调整训练量。'], 5),
    cautions: limitedList(
      source.cautions,
      ['所有负荷调整须经负责教练确认；出现疼痛或异常疲劳时立即停止训练并复核。'],
      5
    ),
  };
}

export function buildRuleAdvice(test: AdviceTestRow): StrengthAdviceContent {
  const metrics = JSON.parse(test.metricsJson || '{}') as StrengthMetricValues;
  const targets = JSON.parse(test.targetsJson || '{}') as StrengthMetricValues;
  const comparisons = adviceComparisons(test, metrics, targets);
  const strengths = comparisons
    .filter((item) => item.difference >= 0)
    .sort((left, right) => right.difference - left.difference)
    .slice(0, 3)
    .map(
      (item) =>
        `${item.label}达到目标的${(100 + item.difference).toFixed(1)}%，可作为稳定能力继续保持。`
    );
  const gaps = comparisons
    .filter((item) => item.difference < 0)
    .sort((left, right) => left.difference - right.difference)
    .slice(0, 3);
  const priorities = gaps.map(
    (item) =>
      `${item.label}距离目标仍差${Math.abs(item.difference).toFixed(1)}%，列入本周期优先改善项。`
  );
  const focus = gaps.map((item) => item.label).join('、') || '动作质量与基础力量';
  return normalizeAdviceContent({
    title: `${test.testDate} 个人力量训练建议方案`,
    overview: comparisons.length
      ? `本次共有${comparisons.length}项指标可与目标比较，其中${strengths.length}项达到目标、${gaps.length}项列为优先改善项。方案以${focus}为主线，采用逐周递进并在末周复核。`
      : '本次尚未形成完整的目标对比。以下为建议训练框架，请先由教练补充目标值，再确认具体负荷。',
    strengths: strengths.length ? strengths : ['暂未发现同时具备实测值和目标值的达标项目。'],
    priorities: priorities.length
      ? priorities
      : ['补充关键项目目标值，并核对测试动作、单位和测试条件。'],
    weeks: [
      {
        week: 1,
        focus: '动作校准与基础适应',
        load: '中低负荷，主观用力RPE 5—6',
        prescription: [
          `围绕${focus}完成技术动作校准`,
          '主练动作3—4组，每组6—10次',
          '左右侧动作分别记录完成质量',
        ],
      },
      {
        week: 2,
        focus: '重点能力累积',
        load: '中等负荷，RPE 6—7',
        prescription: [
          `提高${focus}的有效训练量`,
          '主练动作4组，每组5—8次',
          '保留2—3次余力，避免力竭',
        ],
      },
      {
        week: 3,
        focus: '专项强化',
        load: '中高负荷，RPE 7—8',
        prescription: [
          `强化${focus}，减少无关训练量`,
          '主练动作3—5组，每组3—6次',
          '组间充分恢复并记录实际完成值',
        ],
      },
      {
        week: 4,
        focus: '减量巩固与复测',
        load: '较上周减量20%—30%',
        prescription: ['保持动作速度和质量', '避免新增高疲劳训练内容', '周期末按相同条件完成复测'],
      },
    ],
    recovery: [
      '每次训练记录RPE、睡眠和疲劳指数。',
      '同一重点力量能力之间建议保留足够恢复时间。',
      '若连续两天恢复指标明显变差，由教练下调当日总量。',
    ],
    cautions: [
      '本方案依据有限测试数据生成，必须由负责教练结合专项课表审核。',
      '单次测试结果仅用于训练调整，不用于选材定论。',
      '训练中出现疼痛、眩晕或异常疲劳时立即停止并复核。',
    ],
  });
}

export async function buildAiAdvice(test: AdviceTestRow) {
  const apiKey = cleanString(process.env.AI_API_KEY);
  const baseUrl = cleanString(process.env.AI_BASE_URL).replace(/\/+$/, '');
  const model = cleanString(process.env.AI_MODEL);
  if (!apiKey || !baseUrl || !model) {
    return { content: buildRuleAdvice(test), source: 'rules' as const, model: '内置规则' };
  }

  const metrics = JSON.parse(test.metricsJson || '{}') as StrengthMetricValues;
  const targets = JSON.parse(test.targetsJson || '{}') as StrengthMetricValues;
  const comparison = adviceComparisons(test, metrics, targets);
  const recentRecords = db
    .prepare(
      `
    SELECT ts.session_date AS date, ts.training_type AS trainingType, ts.duration_min AS durationMin, ts.rpe, ts.srpe,
      dw.sleep_hours AS sleepHours, dw.fatigue_index AS fatigueIndex, COALESCE(dw.status, 'missing') AS status
    FROM training_sessions ts
    LEFT JOIN daily_wellness dw ON dw.athlete_id = ts.athlete_id AND dw.wellness_date = ts.session_date
    WHERE ts.athlete_id = ? AND ts.session_date BETWEEN date(?, '-27 days') AND ?
    ORDER BY ts.session_date, ts.session_order
  `
    )
    .all(test.athleteId, test.testDate, test.testDate);
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
        max_completion_tokens: 12000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是${test.project}体能训练建议助手。只依据给定数据生成供教练审核的草案，不作医疗诊断，不虚构缺失数据，不把相关性写成因果。输出严格JSON，字段为title、overview、strengths、priorities、weeks、recovery、cautions；weeks固定4项，每项含week、focus、load、prescription。训练强度使用范围并强调动作质量和教练确认。`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              context: '匿名运动员力量测试与最近28天训练记录',
              testDate: test.testDate,
              project: test.project,
              team: test.team,
              gender: test.gender,
              targetType: test.project === '激流' ? '同性别冠军模型参考区间边界' : '教练确认目标值',
              comparison,
              recentRecords,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 180000),
    });
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = cleanString(payload.choices?.[0]?.message?.content).replace(
      /^```json\s*|\s*```$/g,
      ''
    );
    if (!raw) throw new Error('AI service returned empty content');
    return { content: normalizeAdviceContent(JSON.parse(raw)), source: 'ai' as const, model };
  } catch {
    return {
      content: buildRuleAdvice(test),
      source: 'rules' as const,
      model: 'AI服务不可用·规则兜底',
      fallbackReason: 'ai_unavailable' as const,
    };
  }
}

export function adviceComparisons(
  test: AdviceTestRow,
  metrics: StrengthMetricValues,
  targets: StrengthMetricValues
) {
  if (test.project === '激流') {
    return SLALOM_CHAMPION_METRICS.flatMap((metric) => {
      const comparison = slalomComparison(metric, metrics, test.gender);
      if (!comparison.range || comparison.value === null) return [];
      const target = metric.direction === 'higher' ? comparison.range[0] : comparison.range[1];
      const difference =
        metric.direction === 'higher'
          ? ((comparison.value - target) / target) * 100
          : ((target - comparison.value) / target) * 100;
      return [
        {
          key: metric.key,
          label: metric.label,
          unit: metric.unit,
          value: comparison.value,
          measured: comparison.value,
          target,
          referenceRange: comparison.range,
          direction: metric.direction,
          difference: Math.round(difference * 10) / 10,
        },
      ];
    });
  }
  return STRENGTH_METRICS.filter((metric) => metric.targetEnabled && !metric.projects).flatMap(
    (metric) => {
      const value = metrics[metric.key];
      const target = targets[metric.key];
      if (typeof value !== 'number' || typeof target !== 'number' || target <= 0) return [];
      return [
        {
          key: metric.key,
          label: metric.label,
          unit: metric.unit,
          value,
          measured: value,
          target,
          direction: 'higher' as const,
          difference: Math.round(((value - target) / target) * 1000) / 10,
        },
      ];
    }
  );
}

export function mapAdviceRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    strengthTestId: Number(row.strengthTestId),
    version: Number(row.version),
    content: normalizeAdviceContent(JSON.parse(String(row.contentJson || '{}'))),
    source: row.source,
    model: row.model,
    status: row.status,
    generatedAt: row.generatedAt,
    generatedBy: row.generatedBy,
    reviewedAt: row.reviewedAt || null,
    reviewedBy: row.reviewedBy || null,
  };
}

export function latestAdvice(strengthTestId: number, approvedOnly = false) {
  const row = db
    .prepare(
      `
    SELECT sa.id, sa.test_session_id AS strengthTestId, sa.version,
      sa.content_json AS contentJson, sa.source, sa.model, sa.status,
      sa.generated_at AS generatedAt, generator.display_name AS generatedBy,
      sa.reviewed_at AS reviewedAt, reviewer.display_name AS reviewedBy
    FROM strength_ai_advice sa
    JOIN users generator ON generator.id = sa.generated_by
    LEFT JOIN users reviewer ON reviewer.id = sa.reviewed_by
    WHERE sa.test_session_id = ? ${approvedOnly ? "AND sa.status = 'approved'" : ''}
    ORDER BY sa.version DESC LIMIT 1
  `
    )
    .get(strengthTestId) as Record<string, unknown> | undefined;
  return row ? mapAdviceRow(row) : null;
}
