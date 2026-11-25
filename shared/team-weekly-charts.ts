import {
  WEEKLY_FOCUS_EXERCISES,
  type CombinedTeamWeeklyReport,
  type TeamWeeklyReport,
} from './team-weekly-report.js';

export type WeeklyChart = {
  id: string;
  section: string;
  title: string;
  unit: string;
  note: string;
  kind: 'bar' | 'line';
  domain?: { min: number; max: number };
  points: { label: string; value: number | null }[];
  series?: { name: string; values: (number | null)[] }[];
};
/** 不合并不同测试条件，不填补缺失值；综合Word保留预设图表供本地补填。 */
export function teamWeeklyCharts(r: TeamWeeklyReport): WeeklyChart[] {
  if (r.templateVersion === 'weekly-v3') return combinedCharts(r);
  const charts: WeeklyChart[] = [
    ...(['duration', 'srpe'] as const).map((key): WeeklyChart => ({
      id: key,
      section: '每日训练与负荷',
      title: key === 'duration' ? '每日个人累计训练时长' : '每日个人累计训练负荷',
      unit: key === 'duration' ? '分钟' : 'AU',
      kind: 'bar',
      note: '按已记录的个人数值累计；缺失不计为零。',
      points: r.daily.map((d) => ({ label: d.date.slice(5), value: d[key] })),
    })),
    {
      id: 'structure',
      section: '训练内容结构',
      title: '训练内容时长分布',
      unit: '分钟',
      kind: 'bar',
      note: '按训练类型汇总个人累计时长。',
      points: r.categories.map((c) => ({ label: c.label, value: c.duration })),
    },
  ];
  const exercises = [...new Set((r.strength || []).map((s) => s.exercise))];
  for (const exercise of exercises)
    charts.push({
      id: `strength:${exercise}`,
      section: '力量训练个人与动作对比',
      title: `${exercise} · 个人训练容量`,
      unit: 'kg·次',
      kind: 'bar',
      note: '仅对比同一动作的已记录重量×次数总和；容量不代表最大力量。',
      points: (r.strength || [])
        .filter((s) => s.exercise === exercise)
        .map((s) => ({ label: s.athleteName, value: s.volumeKg })),
    });
  if (!exercises.length)
    charts.push({
      id: 'strength-empty',
      section: '力量训练个人与动作对比',
      title: '力量训练个人与动作对比',
      unit: 'kg·次',
      kind: 'bar',
      note: '暂无有效力量结果。',
      points: [],
    });
  for (const [key, title, unit] of [
    ['sleep', '睡眠时长', '小时'],
    ['pulse', '晨脉', '次/分钟'],
    ['fatigue', '疲劳评分', '分'],
  ] as const) {
    charts.push({
      id: key,
      section: '每日恢复趋势',
      title: `${title} · 每日有效均值`,
      unit,
      kind: 'line',
      note: '每日样本可能不同；缺失处断开，不代表全队恢复状态。',
      points: r.daily.map((d) => ({
        label: d.date.slice(5),
        value: r.recovery?.find((v) => v.date === d.date)?.[key] ?? null,
      })),
    });
  }
  for (const athlete of r.athletes)
    for (const test of athlete.data.tests)
      charts.push({
        id: `test:${athlete.id}:${test.key}`,
        section: '四、体能与专项测试',
        title: `${athlete.name} · ${test.label}${test.change === null ? ' · 原始记录' : ''}`,
        unit: test.unit,
        kind: test.change === null ? 'bar' : 'line',
        note: `${test.protocol || '协议未记录'} / ${test.side}；${test.change === null ? '可比条件或记录不足，仅展示原始值，不比较趋势。' : '同一指标条件独立展示，数值变化不等于训练效果。'}`,
        points: test.points.map((p) => ({ label: p.date, value: p.value })),
      });
  if (!charts.some((c) => c.section === '四、体能与专项测试'))
    charts.push({
      id: 'test-empty',
      section: '四、体能与专项测试',
      title: '测试趋势',
      unit: '',
      kind: 'line',
      note: '暂无有效测试记录。',
      points: [],
    });
  if (r.templateVersion !== 'weekly-v2') return charts;
  const selected = charts.filter(
    (c) =>
      !c.id.startsWith('test:') &&
      !c.id.endsWith('-empty') &&
      (r.reportType === 'physical' || !c.id.startsWith('strength:'))
  );
  const groups = new Map<string, WeeklyChart>();
  for (const athlete of [...r.athletes].sort((a, b) => a.id - b.id)) {
    for (const test of athlete.data.tests) {
      // key 包含协议、侧别、版本与条件；柱图集中展示原始记录，不连接队员趋势。
      const key = `${test.key}:${test.unit}:${test.protocol}:${test.side}`;
      let chart = groups.get(key);
      if (!chart) {
        chart = {
          id: `test:${key}`,
          section: '四、体能与专项测试',
          title: `${test.label} · 周内记录`,
          unit: test.unit,
          kind: 'bar',
          note: `${test.protocol || '协议未记录'} / ${test.side}；展示各队员周内末次原始记录，详细条件及首末次见附录；协议未知时不作比较，数值不作为能力排名。`,
          points: [],
        };
        groups.set(key, chart);
      }
      chart.points.push({ label: athlete.name, value: test.last.value });
    }
  }
  return [...selected, ...groups.values()]
    .filter((c) => c.points.some((p) => p.value !== null))
    .flatMap((c) => {
      if (c.kind !== 'bar' || c.points.length <= 12) return [c];
      const values = c.points.flatMap((p) => (p.value === null ? [] : [p.value]));
      const domain = { min: Math.min(0, ...values), max: Math.max(1, ...values) };
      return Array.from({ length: Math.ceil(c.points.length / 12) }, (_, i) => ({
        domain,
        ...c,
        id: `${c.id}:part${i}`,
        title: `${c.title}（${i + 1}/${Math.ceil(c.points.length / 12)}）`,
        points: c.points.slice(i * 12, (i + 1) * 12),
      }));
    });
}
export function weeklyTimetable(r: TeamWeeklyReport, next = false) {
  const start = Date.parse(r.range.from) + (next ? 7 : 0) * 86400000;
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    return {
      date,
      day: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i],
      sessions: (next ? r.nextPlans : r.plans).filter((p) => p.date === date),
    };
  });
}

function combinedCharts(r: CombinedTeamWeeklyReport): WeeklyChart[] {
  const athletes = [...r.athletes].sort((a, b) => a.id - b.id);
  const charts: WeeklyChart[] = (['duration', 'srpe'] as const).map((key) => ({
    id: key,
    section: '2.2 周训练量和负荷',
    title: key === 'duration' ? '每日个人累计时长' : '每日个人累计SRPE',
    unit: key === 'duration' ? '分钟' : 'AU',
    kind: 'bar',
    note: '缺失保留为空；整体包含恢复及未分类，不推算分项时长。',
    points: r.daily.map((d) => ({ label: d.date.slice(5), value: d[key] })),
  }));
  charts.push(
    {
      id: 'composition',
      section: '2.2 周训练量和负荷',
      title: '训练时长构成',
      kind: 'bar',
      unit: '分钟',
      note: '按正式记录分类；恢复与未分类未可靠拆分，保留合并名称。个人累计时长，不等于队伍课时。',
      points: [
        ['专项', r.breakdown.special.totals.duration],
        ['体能', r.breakdown.physical.totals.duration],
        ['恢复及未分类', r.breakdown.unclassified.totals.duration],
      ].map(([label, value]) => ({ label: String(label), value: value as number | null })),
    },
    {
      id: 'categories',
      section: '2.2 周训练量和负荷',
      title: '训练分类分布',
      kind: 'bar',
      unit: '分钟',
      note: '采用已有训练分类，不将训练类型代替生理强度分区。',
      points: r.categories.length
        ? r.categories.map((c) => ({ label: c.label, value: c.duration }))
        : [{ label: '训练分类（待填写）', value: null }],
    },
    {
      id: 'rpe',
      section: '4.1 运动员状态变化',
      title: '每日记录平均 RPE',
      kind: 'line',
      unit: '分',
      note: '仅有效记录均值，与SRPE分别展示，不混用单位。',
      points: r.daily.map((d) => ({ label: d.date.slice(5), value: d.rpe })),
    }
  );
  const exercises = WEEKLY_FOCUS_EXERCISES;
  for (const exercise of exercises) {
    const current = (r.strength || []).filter((s) => s.exercise === exercise);
    const previous = r.strengthPrevious.filter((s) => s.exercise === exercise);
    const same =
      r.strengthComparable &&
      previous.length === current.length &&
      current.every((s) => previous.some((p) => p.athleteId === s.athleteId));
    const timedOnly = (athleteId: number) => {
      const details = r.strengthDetails.filter(
        (s) => s.athleteId === athleteId && s.exercise === exercise && s.completed
      );
      return (
        details.length > 0 && details.every((s) => (s.durationMin ?? 0) > 0 && (s.reps ?? 0) === 0)
      );
    };
    const points = athletes.map((a) => ({
      label: a.name,
      value:
        timedOnly(a.id) ||
        r.strengthDetails.some(
          (s) =>
            s.athleteId === a.id &&
            s.exercise === exercise &&
            s.completed &&
            (s.reps === null || s.weightKg === null || s.reps < 0 || s.weightKg < 0)
        )
          ? null
          : (current.find((s) => s.athleteId === a.id)?.volumeKg ?? null),
    }));
    if (
      !WEEKLY_FOCUS_EXERCISES.some((e) => e === exercise) &&
      !points.some((p) => p.value !== null)
    )
      continue;
    const series = [
      { name: '本周', values: points.map((p) => p.value) },
      {
        name: '上周',
        values: athletes.map((a) =>
          same ? (previous.find((s) => s.athleteId === a.id)?.volumeKg ?? null) : null
        ),
      },
    ];
    const values = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    const domain = values.length
      ? { min: Math.min(0, ...values), max: Math.max(1, ...values) }
      : undefined;
    const section = '3.3 运动员表现与全员对比';
    for (let start = 0; start < points.length; start += 12)
      charts.push({
        id: `strength:${exercise}:part${start / 12}`,
        section,
        title: `${exercise} · 全员训练容量${points.length > 12 ? `（${start / 12 + 1}/${Math.ceil(points.length / 12)}）` : ''}`,
        unit: 'kg·次',
        kind: 'bar',
        domain,
        note:
          '仅已完成有效组的外部重量×次数；缺失不填零，容量不代表能力排名。' +
          (same
            ? '两周该动作记录人员一致；并列原始量，不计算百分比。'
            : '上周覆盖或人员不可比，数据留空，供教练在下载后补填。'),
        points: points.slice(start, start + 12),
        series: series.map((s) => ({ ...s, values: s.values.slice(start, start + 12) })),
      });
  }
  const focusPoints = WEEKLY_FOCUS_EXERCISES.map((exercise) => {
    const details = r.strengthDetails.filter((s) => s.exercise === exercise && s.completed);
    return {
      label: exercise,
      value:
        details.length &&
        details.every(
          (s) =>
            s.reps !== null &&
            s.weightKg !== null &&
            s.reps >= 0 &&
            s.weightKg >= 0 &&
            !((s.durationMin ?? 0) > 0 && s.reps === 0)
        )
          ? details.reduce((n, s) => n + s.reps! * s.weightKg!, 0)
          : null,
    };
  });
  charts.push({
    id: 'focus-summary',
    section: '3.2 关键力量训练统计',
    title: '四个固定动作 · 有效容量对比',
    unit: 'kg·次',
    kind: 'bar',
    note: '有效已完成组外部重量×次数；存在缺失重量或次数时不计算该动作容量。不比较不同动作的能力。',
    points: focusPoints,
    series: [
      { name: '本周总容量', values: focusPoints.map((p) => p.value) },
      {
        name: '上周总容量',
        values: focusPoints.map((p) => {
          const current = (r.strength || []).filter((s) => s.exercise === p.label);
          const previous = r.strengthPrevious.filter((s) => s.exercise === p.label);
          return r.strengthComparable &&
            p.value !== null &&
            current.length === previous.length &&
            current.every((s) => previous.some((v) => v.athleteId === s.athleteId))
            ? previous.reduce((n, s) => n + s.volumeKg, 0)
            : null;
        }),
      },
    ],
  });
  for (const [key, title, unit] of [
    ['sleep', '睡眠', '小时'],
    ['pulse', '晨脉', '次/分钟'],
    ['fatigue', '疲劳', '分'],
  ] as const)
    charts.push({
      id: key,
      section: '4.1 运动员状态变化',
      title: `${title} · 每日有效均值`,
      unit,
      kind: 'line',
      note: '各日样本可能不同；缺失不填零，不作健康推断。',
      points: r.daily.map((d) => ({
        label: d.date.slice(5),
        value: r.recovery?.find((v) => v.date === d.date)?.[key] ?? null,
      })),
    });
  return charts;
}
