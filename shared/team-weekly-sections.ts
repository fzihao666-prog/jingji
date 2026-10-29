import type { TeamWeeklyReport } from './team-weekly-report.js';
export const weeklyNumber = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(n);
export type WeeklySection = {
  title: string;
  paragraphs: string[];
  headers?: string[];
  rows?: string[][];
};
const status: Record<string, string> = {
  executed: '已组织实施',
  cancelled: '已取消',
  pending: '待确认',
  partial: '部分确认',
  healthy: '健康',
  observation: '观察',
  restricted: '受限',
  rehab: '康复',
  suspended: '暂停',
};
function legacySections(r: TeamWeeklyReport): WeeklySection[] {
  const f = weeklyNumber;
  const planTable = (plans: TeamWeeklyReport['plans']) =>
    plans.map((p) => [
      p.date,
      p.period || '—',
      p.content,
      `${f(p.duration)} / ${f(p.distance)}`,
      status[p.status] || p.status,
      String(p.linkedRecords),
    ]);
  const testRows = r.athletes.flatMap((a) =>
    a.data.tests.map((t) => [
      a.name,
      `${t.label} (${t.unit})`,
      `${t.protocol || '协议未记录'} / ${{ left: '左侧', right: '右侧', center: '中立', bilateral: '双侧', unspecified: '未指定' }[t.side] || t.side}`,
      `${t.first.date}: ${f(t.first.value)}`,
      `${t.last.date}: ${f(t.last.value)}`,
      f(t.change),
    ])
  );
  const wellness = r.athletes.flatMap((a) =>
    a.data.wellness
      .filter((w) => w.points.length > 0)
      .map((w) => [a.name, w.label, `${f(w.average)} ${w.unit}`, String(w.points.length)])
  );
  return [
    { title: '一、本周训练摘要', paragraphs: r.summary },
    {
      title: '二、训练开展与结构',
      paragraphs: [
        '时长、距离和负荷为个人累计量；队伍课次已去重。上周统计仅作资料参照，记录覆盖未知时不计算环比。',
      ],
      headers: ['指标', '本周', '上周'],
      rows: [
        ['队伍课次', f(r.totals.sessions), f(r.previous.sessions)],
        ['训练记录人次', f(r.totals.participations), f(r.previous.participations)],
        ['个人累计时长 / 分钟', f(r.totals.duration), f(r.previous.duration)],
        ['个人累计距离 / km', f(r.totals.distance), f(r.previous.distance)],
        ['个人累计SRPE / AU', f(r.totals.srpe), f(r.previous.srpe)],
        ['记录平均RPE', f(r.totals.rpe), f(r.previous.rpe)],
      ],
    },
    {
      title: '每日训练与负荷',
      paragraphs: [],
      headers: ['日期', '队伍课次', '记录人次', '累计分钟', '累计SRPE', '平均RPE'],
      rows: r.daily.map((d) => [
        d.date,
        f(d.sessions),
        f(d.participations),
        f(d.duration),
        f(d.srpe),
        f(d.rpe),
      ]),
    },
    {
      title: '训练内容结构',
      paragraphs: [],
      headers: ['类型', '训练记录人次', '个人累计分钟'],
      rows: r.categories.map((c) => [c.label, f(c.participations), f(c.duration)]),
    },
    {
      title: '三、计划与实施',
      paragraphs: [
        !r.plansAvailable
          ? '当前仅有部分队员访问权限，队伍计划不在可见范围。'
          : r.plans.length
            ? '仅展示当前已发布版本；关联人次不是完成率，未关联不推算个人完成情况。'
            : '本周暂无已发布队伍计划。',
      ],
      headers: ['日期', '时段', '训练内容', '计划分钟 / km', '队伍实施', '关联记录人次'],
      rows: planTable(r.plans),
    },
    {
      title: '力量训练个人与动作对比',
      paragraphs: [
        '仅汇总已完成组的实际次数与外部重量；容量为次数×kg之和，不能直接作为能力排名。',
        ...((r.strength || []).length ? [] : ['本周暂无有效力量结果。']),
      ],
      headers: ['队员', '动作', '完成组数', '累计次数', '容量 / kg·次'],
      rows: (r.strength || []).map((s) => [
        s.athleteName,
        s.exercise,
        f(s.sets),
        f(s.reps),
        f(s.volumeKg),
      ]),
    },
    {
      title: '四、体能与专项测试',
      paragraphs: [
        '同一运动员按项目、指标、单位、侧别、协议、版本及条件分别展示；缺少可比条件显示“—”，数值变化不等于训练效果。',
        ...(testRows.length ? [] : ['本周暂无有效测试记录。']),
      ],
      headers: ['队员', '测试指标', '协议 / 侧别', '首次', '末次', '变化'],
      rows: testRows,
    },
    {
      title: '五、恢复反馈',
      paragraphs: [
        '仅统计已报告数值，不将未填报视为恢复正常。',
        ...(wellness.length ? [] : ['本周暂无有效恢复测量。']),
      ],
      headers: ['队员', '指标', '周内有效均值', '测量条数'],
      rows: wellness,
    },
    {
      title: '每日恢复趋势',
      paragraphs: [
        '各指标分别按当日有效填报求均值，样本数为至少填报一项的日报人次；缺失显示“—”，不推断健康状态或训练因果。',
      ],
      headers: ['日期', '睡眠 / 小时', '晨脉 / bpm', '疲劳指数', '日报样本数'],
      rows: (r.recovery || []).map((d) => [
        d.date,
        f(d.sleep),
        f(d.pulse),
        f(d.fatigue),
        f(d.samples),
      ]),
    },
    {
      title: '本周新增伤病与疼痛记录',
      paragraphs: [
        '按起始日期落在本周的记录展示，不代表全队当前伤病名单或医学诊断。',
        ...(r.injuries.length ? [] : ['本周无新增记录；不代表无人伤病。']),
      ],
      headers: ['队员', '起始日期', '记录名称', '状态', '疼痛评分'],
      rows: r.injuries.map((i) => [
        i.athlete,
        i.date,
        i.name,
        status[i.status] || i.status,
        f(i.pain),
      ]),
    },
    { title: '六、需要关注的事项', paragraphs: r.concerns },
    {
      title: '七、下周已发布安排',
      paragraphs: [
        !r.plansAvailable
          ? '当前仅有部分队员访问权限，下周队伍计划不在可见范围。'
          : r.nextPlans.length
            ? '以下为已有正式计划，不由报告自动开具训练处方。'
            : '下周尚未发布队伍计划，请由教练结合训练目标安排。',
      ],
      headers: ['日期', '时段', '训练内容', '计划分钟 / km', '队伍实施', '关联记录人次'],
      rows: planTable(r.nextPlans),
    },
    {
      title: '附表：队员训练记录',
      paragraphs: ['只列当前权限内在册队员；无记录不代表未参加训练。'],
      headers: ['队员', '记录人次', '累计分钟', '累计km', '累计SRPE', '恢复日报人天'],
      rows: r.athletes.map((a) => [
        a.name,
        f(a.data.totals.sessions),
        f(a.data.totals.duration),
        f(a.data.totals.distance),
        f(a.data.totals.srpe),
        f(a.data.wellnessDays),
      ]),
    },
    {
      title: '数据口径与模板参考',
      paragraphs: [
        ...r.sourceNotes,
        '国内案例：2026年全国青少年足球冬训以周例会串联每日复盘、每周总结和动态优化，参考其总结到安排的组织结构。https://www.sport.org.cn/shouye/qmjs/2026/0205/687944.html',
        '国内参考：国家体育总局《关于开展“国家高水平体育后备人才基地”认定工作的通知》相关训练总结要求（2006，作为结构参考，不作为现行政策判定依据）。https://www.sport.gov.cn/jts/n4998/c656100/content.html',
        '国外案例：Australian Institute of Sport，AMS Coach Dashboard 的 Weekly Overview：按周集中呈现队员训练量、负荷与恢复资料，参考其队伍总览及个人明细结构。https://support.sportsintel.ausport.gov.au/hc/en-us/articles/4409472623503-AMS-Coach-Dashboard',
      ],
    },
  ];
}

/** 领导阅读顺序：概括、训练全貌、表现、下周、完整附录。 */
export function teamWeeklySections(r: TeamWeeklyReport): WeeklySection[] {
  const sections = legacySections(r);
  if (r.templateVersion !== 'weekly-v2') return sections;
  const find = (title: string) => sections.find((s) => s.title === title)!;
  const compact = (title: string) => ({ ...find(title), headers: undefined, rows: undefined });
  const details = sections.filter((s) => {
    if (!s.rows?.length || s.title === '七、下周已发布安排') return false;
    if (s.title === '每日训练与负荷' || s.title === '二、训练开展与结构')
      return r.totals.participations > 0;
    if (s.title === '每日恢复趋势') return r.recovery?.some((d) => d.samples > 0);
    if (s.title === '训练内容结构') return r.categories.some((c) => c.duration !== null);
    if (s.title === '附表：队员训练记录')
      return r.athletes.some(
        (a) => a.data.totals.sessions > 0 || a.data.wellnessDays > 0 || a.data.tests.length > 0
      );
    if (s.title === '力量训练个人与动作对比') return r.reportType === 'physical';
    return true;
  });
  return [
    { title: '一、本周训练摘要', paragraphs: r.summary },
    ...(r.comparison?.metrics.length
      ? [
          {
            title: '本周与上周同口径对比',
            paragraphs: [],
            headers: ['指标', '本周', '上周'],
            rows: r.comparison.metrics.map((m) => [
              `${m.label} / ${m.unit}`,
              weeklyNumber(m.current),
              weeklyNumber(m.previous),
            ]),
          },
        ]
      : []),
    ...(r.coachNotes ? [{ title: '教练现场观察', paragraphs: [r.coachNotes] }] : []),
    ...(r.concerns.length ? [{ title: '本周关注事项', paragraphs: r.concerns }] : []),
    ...(r.daily.some((d) => d.duration !== null || d.srpe !== null)
      ? [compact('每日训练与负荷')]
      : []),
    ...(r.categories.some((c) => c.duration !== null) ? [compact('训练内容结构')] : []),
    ...(r.plans.length && r.plansAvailable ? [compact('三、计划与实施')] : []),
    ...(r.reportType === 'physical' && r.strength?.length
      ? [compact('力量训练个人与动作对比')]
      : []),
    ...(r.athletes.some((a) => a.data.tests.length) ? [compact('四、体能与专项测试')] : []),
    ...(r.recovery?.some((d) => d.sleep !== null || d.pulse !== null || d.fatigue !== null)
      ? [compact('每日恢复趋势')]
      : []),
    {
      ...compact('七、下周已发布安排'),
      paragraphs: r.nextPlans.length ? [] : ['下周尚无已发布安排，请结合训练目标确定重点。'],
    },
    ...details.map((s) => ({ ...s, title: `附录 · ${s.title}`, paragraphs: [] })),
    {
      title: '数据情况与口径',
      paragraphs: [...(r.dataNotes || []), ...(r.comparison?.notes || []), ...r.sourceNotes],
    },
  ];
}
