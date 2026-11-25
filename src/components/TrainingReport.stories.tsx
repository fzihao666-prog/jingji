import { TrainingReport, TrainingReportFigures } from './TrainingReport';
import type { ReportData } from '../../shared/training-report';

const empty: ReportData = {
  version: 1,
  project: 'ROWING',
  range: { from: '2026-10-05', to: '2026-10-11', kind: 'week' },
  totals: {
    sessions: 0,
    duration: null,
    distance: null,
    srpe: null,
    durationCount: 0,
    distanceCount: 0,
    srpeCount: 0,
  },
  previous: {
    sessions: 0,
    duration: null,
    distance: null,
    srpe: null,
    durationCount: 0,
    distanceCount: 0,
    srpeCount: 0,
  },
  daily: [],
  categories: [],
  tests: [],
  wellness: [],
  days: 7,
  trainingDays: 0,
  wellnessDays: 0,
};
export default { title: '运动员档案/训练报告', component: TrainingReportFigures };
export const Empty = { args: { data: empty } };
export const Partial = {
  args: {
    data: {
      ...empty,
      totals: { ...empty.totals, sessions: 1, duration: 60, durationCount: 1 },
      categories: [{ key: 'special', label: '专项', sessions: 1, duration: 60 }],
      trainingDays: 1,
      daily: [
        {
          date: '2026-10-05',
          sessions: 1,
          special: 60,
          physical: null,
          recovery: null,
          other: null,
          duration: 60,
          srpe: null,
        },
      ],
    },
  },
};
export const Controls = {
  render: () => <TrainingReport athleteId={1} athleteName="合成示例" initialDate="2026-10-05" />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const select = canvasElement.querySelector('select');
    if (!select) throw new Error('报告类型控件缺失');
    select.focus();
    if (document.activeElement !== select) throw new Error('报告类型控件无法获得键盘焦点');
    if (canvasElement.querySelector('textarea')) throw new Error('未预览时不应显示点评表单');
  },
};
