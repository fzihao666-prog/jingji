import { TeamWeeklyReportPreview } from './TeamWeeklyReportPreview';
import type { TeamWeeklyReport } from '../../shared/team-weekly-report';
const totals = {
  sessions: 0,
  participations: 0,
  duration: null,
  distance: null,
  srpe: null,
  durationCount: 0,
  distanceCount: 0,
  srpeCount: 0,
  rpe: null,
  rpeCount: 0,
};
const empty: TeamWeeklyReport = {
  reportType: 'special',
  stage: '',
  coachNotes: '',
  templateVersion: 'weekly-v2',
  comparison: { metrics: [], notes: [] },
  dataNotes: ['本周暂无有效训练和恢复数据。'],
  project: 'ROWING',
  teamId: 1,
  teamName: '合成示例队',
  generatedAt: '2026-10-29T03:00:00Z',
  range: { kind: 'week', from: '2026-10-19', to: '2026-10-25' },
  totals,
  previous: totals,
  daily: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-${19 + i}`,
    sessions: 0,
    participations: 0,
    duration: null,
    srpe: null,
    rpe: null,
  })),
  categories: [],
  athletes: [],
  injuries: [],
  plansAvailable: true,
  plans: [],
  nextPlans: [],
  summary: ['本周暂无有效训练记录，暂不能评价训练开展情况。'],
  concerns: ['记录缺失不代表未训练。'],
  sourceNotes: ['此故事仅使用合成数据。'],
};
export default { title: '数据管理/队伍周总结', component: TeamWeeklyReportPreview };
export const Empty = { args: { report: empty } };
export const Partial = {
  args: {
    report: {
      ...empty,
      totals: { ...totals, sessions: 1, participations: 1, duration: 60, durationCount: 1 },
      summary: ['本周有1人次训练记录，个人累计时长60分钟；负荷待补充。'],
    },
  },
};
export const RestrictedPlans = { args: { report: { ...empty, plansAvailable: false } } };
export const KeyboardTables = {
  args: { report: empty },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const region = canvasElement.querySelector<HTMLElement>('[role="region"]');
    if (!region) throw new Error('缺少可键盘访问的数据表区域');
    region.focus();
    if (document.activeElement !== region) throw new Error('表格区域不能通过键盘获得焦点');
    if (!region.querySelector('caption') || !region.querySelector('th[scope="col"]'))
      throw new Error('表格标题或列头缺失');
  },
};

export const ChartsAndTimetable = {
  args: {
    report: {
      ...empty,
      daily: empty.daily.map((d, i) => ({
        ...d,
        duration: i === 2 ? null : i * 30,
        srpe: i === 2 ? null : i * 120,
      })),
      categories: [
        { label: '专项训练', participations: 8, duration: 240 },
        { label: '力量训练', participations: 4, duration: 120 },
      ],
      strength: [
        {
          athleteId: 1,
          athleteName: '示例队员甲',
          exercise: '深蹲',
          sets: 3,
          reps: 15,
          volumeKg: 900,
        },
        {
          athleteId: 2,
          athleteName: '示例队员乙',
          exercise: '深蹲',
          sets: 3,
          reps: 15,
          volumeKg: 750,
        },
      ],
      recovery: empty.daily.map((d, i) => ({
        date: d.date,
        sleep: i === 2 ? null : 7 + i / 10,
        pulse: i === 2 ? null : 60 + i,
        fatigue: i === 2 ? null : 3,
        samples: i === 2 ? 0 : 2,
      })),
      plans: [
        {
          date: '2026-10-19',
          period: '上午',
          content: '有氧技术训练',
          duration: 60,
          distance: null,
          status: 'pending',
          linkedRecords: 0,
        },
      ],
    } satisfies TeamWeeklyReport,
  },
};
export const LongRoster = {
  args: {
    report: {
      ...empty,
      reportType: 'physical' as const,
      stage: '合成训练阶段',
      coachNotes: '本周围绕既定目标完成训练，现场观察作为教练意见保留。',
      strength: Array.from({ length: 35 }, (_, i) => ({
        athleteId: i + 1,
        athleteName: `合成运动员完整姓名第${i + 1}位`,
        exercise: '深蹲',
        sets: 3,
        reps: 15,
        volumeKg: i * 30,
      })),
    },
  },
};

const combined: TeamWeeklyReport = {
  ...empty,
  reportType: 'combined',
  templateVersion: 'weekly-v3',
  breakdown: {
    special: { totals, previous: totals, daily: empty.daily, categories: [] },
    physical: { totals, previous: totals, daily: empty.daily, categories: [] },
    unclassified: { totals, previous: totals, daily: empty.daily, categories: [] },
  },
  strengthPrevious: [],
  strengthComparable: false,
  strengthDetails: [],
  trainingDetails: [],
  plans: [],
  nextPlans: [],
};
export const CombinedEmpty = { args: { report: combined } };
export const CombinedEditable = {
  args: {
    report: combined,
    commentary: {
      summary: '周概述',
      training: '专项分析',
      strength: '体能分析',
      recovery: '恢复分析',
      nextWeek: '下周安排',
    },
    onCommentaryChange: () => {},
  },
};
