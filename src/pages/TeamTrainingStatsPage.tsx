import { useEffect, useState } from 'react';
import { Upload, RotateCcw } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { api } from '../api';
import { EChart } from '../components/EChart';
import { AppCard, ContentState, PageContainer, PageHeader } from '../components/PageLayout';
import { projectCapability, projectLabel } from '../../shared/projects';
import type {
  TeamTrainingMeasure,
  TeamTrainingStatistics,
  TeamTrainingWeek,
} from '../../shared/team-training-stats';
import type { Project, ProjectTeam } from '../types';
import '../components/TeamTrainingStats.css';

const formatNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const showNumber = (value: number | null) => (value === null ? '—' : formatNumber.format(value));
const total = (values: Array<number | null>) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
};
type Point = { name: string; value: number | null };
const chartFormat = (points: Point[], type: 'bar' | 'line' | 'pie'): EChartsOption => {
  if (type === 'pie') {
    return {
      animation: false,
      tooltip: { trigger: 'item', renderMode: 'richText', formatter: '{b}：{c} min（{d}%）' },
      series: [
        {
          type: 'pie',
          radius: ['42%', '66%'],
          stillShowZeroSum: false,
          label: { formatter: '{b} {d}%' },
          data: points
            .filter((point) => point.value !== null)
            .map(({ name, value }) => ({ name, value: value! })),
        },
      ],
    };
  }
  return {
    animation: false,
    tooltip: { trigger: 'axis', renderMode: 'richText' },
    grid: { left: 44, right: 18, top: 34, bottom: 64 },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.name),
      axisLabel: { hideOverlap: true, rotate: points.length > 7 ? 25 : 0 },
    },
    yAxis: { type: 'value', name: 'min', min: 0 },
    series: [
      {
        name: '时长（min）',
        type,
        data: points.map((point) => point.value),
        ...(type === 'line' ? { connectNulls: false, symbolSize: 5 } : {}),
      },
    ],
  };
};

function TrainingChart({
  title,
  points,
  type,
  description,
}: {
  title: string;
  points: Point[];
  type: 'bar' | 'line' | 'pie';
  description?: string;
}) {
  const empty = !points.some(
    (point) => point.value !== null && (type !== 'pie' || point.value > 0)
  );
  return (
    <AppCard variant="chart" className="team-training-chart">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      <EChart
        option={chartFormat(points, type)}
        label={`${title}，数值可在下方统计表查看`}
        isPlaceholder={empty}
      />
    </AppCard>
  );
}

function categoryPoints(categories: TeamTrainingMeasure[], group?: 'water' | 'land') {
  const points = new Map<string, number>();
  for (const measure of categories) {
    if (measure.unit !== 'min' || (group && measure.waterGroup !== group)) continue;
    points.set(measure.category, (points.get(measure.category) ?? 0) + measure.value);
  }
  return [...points].map(([name, value]) => ({ name, value }));
}

const waterAnnual: {
  key: Exclude<keyof TeamTrainingWeek, 'start'>;
  title: string;
  description?: string;
}[] = [
  { key: 'water', title: '全年水上时长' },
  {
    key: 'slalomProxy',
    title: '全年激流训练口径时长',
    description: '按原表口径合计无氧能力、无氧功率与测功仪时长。',
  },
  { key: 'maxStrength', title: '全年大力量时长' },
  { key: 'endurance', title: '全年力量耐力时长' },
  { key: 'explosive', title: '全年爆发力时长' },
  { key: 'functionalCore', title: '全年功能与核心训练时长' },
];

function StatisticsCharts({ stats, water }: { stats: TeamTrainingStatistics; water: boolean }) {
  const duration = stats.categories.filter((item) => item.unit === 'min');
  const waterPoints = categoryPoints(duration, 'water');
  const landPoints = categoryPoints(duration, 'land');
  const generalPoints = categoryPoints(duration);
  const waterGroups = [
    {
      name: '水上',
      value: total(
        duration.filter((item) => item.waterGroup === 'water').map((item) => item.value)
      ),
    },
    {
      name: '陆上',
      value: total(duration.filter((item) => item.waterGroup === 'land').map((item) => item.value)),
    },
    {
      name: '未分类',
      value: total(duration.filter((item) => item.waterGroup === null).map((item) => item.value)),
    },
  ];
  const lessonGroups = [
    {
      name: '主课',
      value: total(
        duration.filter((item) => item.lessonGroup === 'main').map((item) => item.value)
      ),
    },
    {
      name: '辅课',
      value: total(
        duration.filter((item) => item.lessonGroup === 'auxiliary').map((item) => item.value)
      ),
    },
    {
      name: '未分类',
      value: total(duration.filter((item) => item.lessonGroup === null).map((item) => item.value)),
    },
  ];
  const annual = water
    ? waterAnnual
    : [{ key: 'minutes' as const, title: '全年每周训练时长', description: undefined }];
  return (
    <>
      <section aria-label="周训练统计">
        <h2>周训练统计</h2>
        <p>
          {stats.weekStart} 至 {stats.weekEnd} · 时长{' '}
          {showNumber(total(stats.daily.map((day) => day.minutes)))} min · 距离{' '}
          {showNumber(total(stats.daily.map((day) => day.distance)))} km
        </p>
        <div className="team-training-chart-grid">
          <TrainingChart
            title="周内每日训练时长"
            type="bar"
            points={stats.daily.map((day) => ({ name: day.date.slice(5), value: day.minutes }))}
          />
          {water ? (
            <>
              <TrainingChart
                title="主课与辅课时长占比"
                type="pie"
                points={lessonGroups}
                description="沿用原表分组，辅课为耐力、爆发力和功能训练。"
              />
              <TrainingChart
                title="水上与陆上时长占比"
                type="pie"
                points={waterGroups}
                description="沿用原表分组，测功仪计入水上。"
              />
              <TrainingChart title="水上各分项时长" type="bar" points={waterPoints} />
              <TrainingChart title="水上各分项时长占比" type="pie" points={waterPoints} />
              <TrainingChart title="陆上各分项时长" type="bar" points={landPoints} />
              <TrainingChart title="陆上各分项时长占比" type="pie" points={landPoints} />
            </>
          ) : (
            <>
              <TrainingChart title="各分项训练时长" type="bar" points={generalPoints} />
              <TrainingChart title="各分项训练时长占比" type="pie" points={generalPoints} />
            </>
          )}
        </div>
        <details className="team-training-table">
          <summary>查看周统计数值</summary>
          <table>
            <caption>每日训练统计</caption>
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th scope="col">时长（min）</th>
                <th scope="col">距离（km）</th>
              </tr>
            </thead>
            <tbody>
              {stats.daily.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>{showNumber(day.minutes)}</td>
                  <td>{showNumber(day.distance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>分项统计</caption>
            <thead>
              <tr>
                <th scope="col">分项</th>
                <th scope="col">数值</th>
                <th scope="col">单位</th>
                {water && (
                  <>
                    <th scope="col">水陆分组</th>
                    <th scope="col">主辅分组</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {stats.categories.map((item, index) => (
                <tr key={index}>
                  <th scope="row">{item.category}</th>
                  <td>{showNumber(item.value)}</td>
                  <td>{item.unit}</td>
                  {water && (
                    <>
                      <td>
                        {item.waterGroup === 'water'
                          ? '水上'
                          : item.waterGroup === 'land'
                            ? '陆上'
                            : '—'}
                      </td>
                      <td>
                        {item.lessonGroup === 'main'
                          ? '主课'
                          : item.lessonGroup === 'auxiliary'
                            ? '辅课'
                            : '—'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {stats.otherMeasures.length > 0 && (
            <table>
              <caption>其他单位的原始数值</caption>
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">分项</th>
                  <th scope="col">数值</th>
                  <th scope="col">单位</th>
                </tr>
              </thead>
              <tbody>
                {stats.otherMeasures.map((item) => (
                  <tr key={JSON.stringify([item.date, item.category, item.unit])}>
                    <th scope="row">{item.date}</th>
                    <td>{item.category}</td>
                    <td>{showNumber(item.value)}</td>
                    <td>{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      </section>
      <section aria-label="年度训练趋势">
        <h2>{stats.weekYear} 年度训练趋势</h2>
        <p>每周从星期一开始，缺失周保留为空。</p>
        <div className="team-training-chart-grid">
          {annual.map((chart) => (
            <TrainingChart
              key={chart.key}
              title={chart.title}
              description={chart.description}
              type="line"
              points={stats.weekly.map((week, index) => ({
                name: `第${index + 1}周`,
                value: week[chart.key],
              }))}
            />
          ))}
        </div>
        <details className="team-training-table">
          <summary>查看年度统计数值</summary>
          <table>
            <caption>年度逐周统计（min）</caption>
            <thead>
              <tr>
                <th scope="col">周起始日</th>
                {annual.map((chart) => (
                  <th scope="col" key={chart.key}>
                    {chart.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.weekly.map((week) => (
                <tr key={week.start}>
                  <th scope="row">{week.start}</th>
                  {annual.map((chart) => (
                    <td key={chart.key}>{showNumber(week[chart.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </>
  );
}

export function TeamTrainingStatsPage({
  project,
  teamId,
  onImport,
}: {
  project: Project;
  teamId: number | null;
  onImport: () => void;
}) {
  const [teams, setTeams] = useState<ProjectTeam[]>();
  const [teamsError, setTeamsError] = useState('');
  const [selected, setSelected] = useState<number | null>(teamId);
  const [date, setDate] = useState('');
  const [state, setState] = useState<{
    key: string;
    data?: TeamTrainingStatistics;
    error?: string;
  }>({ key: '' });
  const [reload, setReload] = useState(0);
  const selectedId = teams?.some((team) => team.id === selected)
    ? selected
    : teams?.length === 1
      ? teams[0].id
      : null;
  const key = `${selectedId}:${date}:${reload}`;
  const data = state.key === key ? state.data : undefined;
  const error = state.key === key ? state.error : undefined;

  useEffect(() => {
    let live = true;
    api
      .adminTeams()
      .then((result) => {
        if (live) setTeams(result.teams.filter((team) => team.project === project));
      })
      .catch((failure) => {
        if (live) setTeamsError(failure instanceof Error ? failure.message : '队伍列表读取失败。');
      });
    return () => {
      live = false;
    };
  }, [project]);
  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    api
      .teamTrainingStats(project, selectedId, date || undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setState({ key, error: failure instanceof Error ? failure.message : '统计读取失败。' });
      });
    return () => controller.abort();
  }, [project, selectedId, date, key]);

  const water = Boolean(projectCapability(project));
  return (
    <PageContainer className="team-training-page">
      <PageHeader
        title="队伍训练统计"
        eyebrow="TEAM TRAINING"
        actions={
          <button type="button" className="secondary-button" onClick={onImport}>
            <Upload size={16} aria-hidden="true" />
            导入 Excel
          </button>
        }
      />
      <p>{projectLabel(project)} · 统计来源为已导入的队级分项，与个人课次分别计算。</p>
      <div className="team-training-controls">
        <label>
          <span>队伍</span>
          <select
            value={selectedId ?? ''}
            onChange={(event) => setSelected(Number(event.target.value) || null)}
          >
            <option value="">请选择队伍</option>
            {teams?.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>选择一周中的日期</span>
          <input
            type="date"
            value={date || data?.weekStart || ''}
            disabled={selectedId === null}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
      </div>
      {teamsError ? (
        <ContentState kind="error" title={teamsError} />
      ) : !teams ? (
        <ContentState kind="loading" title="正在读取队伍" />
      ) : selectedId === null ? (
        <ContentState kind="empty" title={teams.length ? '请选择队伍' : '当前项目暂无授权队伍'} />
      ) : error ? (
        <>
          <ContentState kind="error" title={error} />
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReload((value) => value + 1)}
          >
            <RotateCcw size={16} aria-hidden="true" />
            重试
          </button>
        </>
      ) : !data ? (
        <ContentState kind="loading" title="正在读取队伍训练统计" />
      ) : (
        <StatisticsCharts stats={data} water={water} />
      )}
    </PageContainer>
  );
}
