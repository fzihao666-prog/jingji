import type { TeamWeeklyReport } from './team-weekly-report.js';

export type WeeklyChart = {
  id: string;
  section: string;
  title: string;
  unit: string;
  note: string;
  kind: 'bar' | 'line';
  domain?: { min: number; max: number };
  points: { label: string; value: number | null }[];
};
/** 不合并不同测试条件，不填补缺失值；网页与PDF使用同一组数值。 */
export function teamWeeklyCharts(r: TeamWeeklyReport): WeeklyChart[] {
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
