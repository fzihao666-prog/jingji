import {
  WEEKLY_FOCUS_EXERCISES,
  type CombinedTeamWeeklyReport,
  type TeamWeeklyReport,
} from './team-weekly-report.js';
export const weeklyNumber = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(n);
export type WeeklySection = {
  title: string;
  paragraphs: string[];
  commentaryKey?: 'summary' | 'training' | 'strength' | 'recovery' | 'nextWeek';
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
  if (r.templateVersion === 'weekly-v3') return combinedSections(r);
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

function combinedSections(r: CombinedTeamWeeklyReport): WeeklySection[] {
  const f = weeklyNumber;
  const missing = '未记录';
  const value = (n: number | null) => (n === null ? missing : f(n));
  const old = legacySections(r);
  const planRows = (plans: CombinedTeamWeeklyReport['plans']) =>
    plans.map((p) => [
      p.date,
      p.period || missing,
      { special: '专项', physical: '体能', recovery: '恢复' }[p.category],
      p.content,
      `组数 ${value(p.sets)}；次数 ${value(p.reps)}；负重 ${value(p.load)}；${p.notes || ''}`,
      p.items.map((i) => `${i.title}：${i.description}`).join('；') || missing,
      status[p.status] || p.status,
    ]);
  const compare = (key: string, current: number | null, previous: number | null, unit = '') => {
    const comparable = r.comparison.metrics.find((m) => m.key === key);
    return [
      value(current) + unit,
      value(previous) + unit,
      comparable && previous !== null && previous !== 0 && current !== null
        ? `${f(((current - previous) / Math.abs(previous)) * 100)}%`
        : '—',
    ];
  };
  const physicalPlans = r.plans.filter((p) => p.category === 'physical');
  const categories = { special: '专项', physical: '体能', recovery: '恢复' };
  const strengthRows = WEEKLY_FOCUS_EXERCISES.map((exercise) => {
    const current = r.strength?.filter((s) => s.exercise === exercise) || [];
    const previous = r.strengthPrevious.filter((s) => s.exercise === exercise);
    const details = r.strengthDetails.filter((s) => s.exercise === exercise && s.completed);
    const valid =
      details.length > 0 &&
      details.every(
        (s) =>
          s.reps !== null &&
          s.weightKg !== null &&
          s.reps >= 0 &&
          s.weightKg >= 0 &&
          !((s.durationMin ?? 0) > 0 && s.reps === 0)
      );
    const same =
      r.strengthComparable &&
      current.length > 0 &&
      current.length === previous.length &&
      current.every((s) => previous.some((p) => p.athleteId === s.athleteId));
    return [
      exercise,
      valid ? f(current.reduce((n, s) => n + s.volumeKg, 0)) : missing,
      same ? f(previous.reduce((n, s) => n + s.volumeKg, 0)) : '—',
      '—',
      current.length ? '外部重量×实际次数之和（kg·次）；容量不代表能力' : '本周暂无有效记录',
    ];
  });
  const sections: WeeklySection[] = [
    { title: '01｜本周训练概览', paragraphs: [] },
    {
      title: '1.1 本周核心指标',
      paragraphs: [
        '时长和SRPE为队员个人累计量，课次按队伍去重。仅在覆盖与口径一致时计算变化；缺失为“未记录”，不视为0。',
      ],
      headers: ['指标', '本周', '上周', '变化'],
      rows: [
        ['训练课次', ...compare('sessions', r.totals.sessions, r.previous.sessions, ' 节')],
        [
          '专项训练时长',
          value(r.breakdown.special.totals.duration) + ' min',
          value(r.breakdown.special.previous.duration) + ' min',
          '—',
        ],
        [
          '体能训练时长',
          value(r.breakdown.physical.totals.duration) + ' min',
          value(r.breakdown.physical.previous.duration) + ' min',
          '—',
        ],
        ['恢复训练时长', missing, missing, '—'],
        ['训练负荷 / SRPE', ...compare('srpe', r.totals.srpe, r.previous.srpe, ' AU')],
        ['平均 RPE', value(r.totals.rpe), value(r.previous.rpe), '—'],
        [
          '有效参与人数',
          `${r.athletes.filter((a) => a.data.totals.sessions > 0).length} 人`,
          missing,
          '—',
        ],
      ],
    },
    {
      title: '1.2 本周训练目标及完成评价',
      commentaryKey: 'summary',
      paragraphs: [
        `训练阶段：${r.stage || missing}。本周主要目标及评价见教练文案；未记录时不推测，不能以计划实施状态推断目标达成。`,
        ...r.summary,
        '目标完成情况、主要进展及总体评价：结合下列正式记录和教练文案说明；未提供依据时不作效果结论。',
        ...r.concerns,
      ],
    },
    { title: '02｜训练计划与执行分析', paragraphs: [] },
    {
      title: '2.1 周训练安排',
      paragraphs: [
        r.plansAvailable
          ? '已发布计划及其实施确认；未关联记录不等于未训练。未识别时段保留原文，不猜为上午或下午。'
          : '当前可见范围不含整队计划。',
      ],
      headers: ['日期', '上午训练', '下午训练', '恢复安排', '执行情况'],
      rows: weeklySevenDays(r.range.from).map((date, i) => {
        const plans = r.plans.filter((p) => p.date === date);
        const describe = (p: CombinedTeamWeeklyReport['plans'][number]) =>
          `${p.period || '时段未记录'}：${p.content}`;
        return [
          `${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i]} ${date.slice(5)}`,
          plans
            .filter(
              (p) => p.category !== 'recovery' && /上午|早|morning|^am$/i.test(p.period || '')
            )
            .map(describe)
            .join('；') || missing,
          plans
            .filter(
              (p) => p.category !== 'recovery' && /下午|晚|afternoon|^pm$/i.test(p.period || '')
            )
            .map(describe)
            .join('；') || missing,
          plans
            .filter((p) => p.category === 'recovery')
            .map(describe)
            .join('；') || missing,
          plans
            .map(
              (p) =>
                `${status[p.status] || p.status}${!/上午|早|morning|^am$|下午|晚|afternoon|^pm$/i.test(p.period || '') ? `；时段未分配：${p.content}` : ''}`
            )
            .join('；') || missing,
        ];
      }),
    },
    {
      title: '2.2 周训练量和负荷',
      paragraphs: [
        '不同单位分别作图。恢复与混合记录目前未独立拆分，不将“恢复及未分类”全部标为恢复；强度分区无可靠记录时只展示既有训练分类。',
      ],
    },
    {
      title: '2.3 计划与实际差异',
      paragraphs: [
        '计划课次与已识别的队伍正式课次并列参考，统计口径可能不同；不计算虚假完成率。调整原因由教练补充。',
      ],
      headers: ['训练内容', '已发布计划课次', '正式记录课次', '差异及原因'],
      rows: (['special', 'physical', 'recovery'] as const).map((key) => [
        categories[key],
        r.plansAvailable ? f(r.plans.filter((p) => p.category === key).length) : missing,
        key === 'recovery' ? missing : f(r.breakdown[key].totals.sessions),
        '原因未记录',
      ]),
    },
    { title: '03｜重点训练内容与运动员表现', paragraphs: [] },
    {
      title: '3.1 本周重点训练内容 · 专项训练',
      commentaryKey: 'training',
      paragraphs: [
        r.breakdown.special.totals.participations
          ? `专项记录 ${f(r.breakdown.special.totals.participations)} 人次，累计 ${value(r.breakdown.special.totals.duration)} 分钟、${value(r.breakdown.special.totals.distance)} km。`
          : '本周暂无可识别专项训练记录。',
        ...r.plans.filter((p) => p.category === 'special').map((p) => `${p.date}：${p.content}`),
      ],
    },
    {
      title: '3.1 本周重点训练内容 · 体能训练',
      commentaryKey: 'strength',
      paragraphs: [
        `体能记录 ${f(r.breakdown.physical.totals.participations)} 人次，累计 ${value(r.breakdown.physical.totals.duration)} 分钟。`,
        `训练技术与动作质量：${r.coachNotes || missing}`,
      ],
      ...(physicalPlans.length
        ? {
            headers: ['日期', '时段', '类型', '内容', '已有处方', '内容项与间歇原文', '实施确认'],
            rows: planRows(physicalPlans),
          }
        : {}),
    },
    {
      title: '3.2 关键力量训练统计',
      paragraphs: [
        '固定卧拉、卧推、深蹲、硬拉，不自动替换。按规范全名匹配；总容量为有效已完成组重量×次数之和；重量、次数、组数在附录分别保留。',
      ],
      headers: ['动作', '本周容量 / kg·次', '上周容量 / kg·次', '变化', '备注'],
      rows: strengthRows,
    },
    {
      title: '3.3 运动员表现与全员对比',
      paragraphs: [
        '全体在册可见队员按同一动作分组展示，不截断名单、不混用不同指标排名；未知值留空。重点发现由教练结合记录说明，不自动评选重点人员。',
        ...(r.athletes.some((a) => a.data.tests.length)
          ? ['同协议测试成绩详见附录。']
          : ['本周暂无有效测试成绩。']),
      ],
    },
    { title: '04｜训练反应、恢复与风险管理', paragraphs: [] },
    {
      title: '4.1 运动员状态变化',
      commentaryKey: 'recovery',
      paragraphs: [
        '睡眠、晨脉及疲劳分别以有效日报均值展示；样本可能不同，缺失不视为正常。恢复安排的实施以正式计划确认为准。',
        ...(r.recovery?.some((d) => d.samples > 0) ? [] : ['本周暂无有效恢复测量。']),
      ],
    },
    {
      title: '4.2 异常情况与处理',
      paragraphs: [
        '仅展示当前权限内必要训练管理记录；无新增记录不代表无人伤病，不由AI推断诊断、措施或负责人。',
      ],
      ...(r.injuries.length
        ? {
            headers: ['对象', '异常或问题', '已采取措施', '后续跟进'],
            rows: r.injuries.map((i) => [
              i.athlete,
              `${i.date} ${i.name}（${status[i.status] || i.status}）`,
              missing,
              missing,
            ]),
          }
        : { paragraphs: ['本周暂无新增异常记录；不代表无人伤病。'] }),
    },
    {
      title: '4.3 本周综合评价',
      paragraphs: [
        ...r.concerns,
        '有效做法、存在不足及需要持续观察：结合教练观察与已有记录填写，单周变化不等于训练效果。',
      ],
    },
    { title: '05｜下周训练目标与调整计划', paragraphs: [] },
    {
      title: '5.1 下周主要目标',
      commentaryKey: 'nextWeek',
      paragraphs: ['以下仅依据已有下周正式计划及教练文案，不自动开具训练处方。'],
    },
    {
      title: '5.2 训练安排与调整',
      paragraphs: r.nextPlans.length ? [] : ['下周暂无已发布安排。'],
      ...(r.nextPlans.length
        ? {
            headers: ['日期', '时段', '类型', '内容', '已有处方', '内容项与间歇原文', '实施确认'],
            rows: planRows(r.nextPlans),
          }
        : {}),
    },
    {
      title: '5.3 下周重点监测',
      paragraphs: ['重点监测事项及原因未单独记录，请教练根据实际需要补充。'],
    },
    {
      title: '5.4 教练总结',
      paragraphs: [
        r.coachNotes || '未记录；可直接在下载的Word中补充本周判断、下周方向与需支持事项。',
      ],
    },
    ...(r.plans.length
      ? [
          {
            title: '附录 A｜训练计划与处方明细',
            paragraphs: ['计划不代表实际完成；间歇保留已有原文，不补推缺失值。'],
            headers: ['日期', '时段', '类型', '内容', '已有处方', '内容项与间歇原文', '实施确认'],
            rows: planRows(r.plans),
          },
        ]
      : []),
    ...old
      .filter(
        (s) =>
          s.rows?.length &&
          [
            '四、体能与专项测试',
            '五、恢复反馈',
            '本周新增伤病与疼痛记录',
            '附表：队员训练记录',
          ].includes(s.title)
      )
      .map((s) => ({ ...s, title: `附录 · ${s.title}` })),
    ...(r.trainingDetails.length
      ? [
          {
            title: '附录 · 全员正式训练明细',
            paragraphs: ['恢复、混合和未分类保留原始课内容及个人累计数值，不分摊时长。'],
            headers: ['队员', '日期', '课次序号', '范围', '训练内容', '分钟', 'km', 'SRPE / AU'],
            rows: r.trainingDetails.map((s) => [
              s.athleteName,
              s.date,
              String(s.order),
              { special: '专项', physical: '体能', unclassified: '恢复 / 混合 / 未分类' }[
                s.category
              ],
              s.content || '—',
              f(s.duration),
              f(s.distance),
              f(s.srpe),
            ]),
          },
        ]
      : []),
    ...(r.strengthDetails.length
      ? [
          {
            title: '附录 · 全员力量组明细',
            paragraphs: ['完整保留已完成和未完成组；缺失不填零。'],
            headers: ['队员', '日期', '动作', '实际次数', '实际kg', '分钟', 'km', '备注', '完成'],
            rows: r.strengthDetails.map((s) => [
              s.athleteName,
              s.date,
              s.exercise,
              f(s.reps),
              f(s.weightKg),
              f(s.durationMin),
              f(s.distanceKm),
              s.note || '—',
              s.completed ? '是' : '否',
            ]),
          },
        ]
      : []),
    ...(r.strength?.some((s) => !WEEKLY_FOCUS_EXERCISES.some((e) => e === s.exercise))
      ? [
          {
            title: '附录 · 其他力量动作',
            paragraphs: ['仅展示本周已记录动作，不自动替换正文固定动作。'],
          },
        ]
      : []),
    {
      title: '附录 D｜数据来源、指标口径及缺失说明',
      paragraphs: [
        '编制人：未记录；审核人：未记录。此建议模板并非国家统一强制格式。',
        ...r.dataNotes,
        ...r.comparison.notes,
        ...r.sourceNotes,
      ],
    },
  ];
  return sections;
}
function weeklySevenDays(from: string) {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10)
  );
}

/** 报告日期取上海日期；训练周次按ISO周，不依赖运行机器时区。 */
export function weeklyReportMetadata(r: TeamWeeklyReport): [string, string][] {
  const d = new Date(`${r.range.from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return [
    ['队伍', r.teamName],
    ['报告周期', `${r.range.from} ～ ${r.range.to}`],
    ['训练周次', `第 ${week} 周（ISO日历周）`],
    ['训练阶段', r.stage || '未记录'],
    ['训练地点', '未记录'],
    ['负责人 / 教练', '未记录'],
    [
      '报告生成日期',
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(
        new Date(r.generatedAt)
      ),
    ],
  ];
}
