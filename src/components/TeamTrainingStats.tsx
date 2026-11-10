import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { api } from '../api';
import { EChart } from './EChart';
import { ChartCard, ContentState, SectionHeader } from './PageLayout';
import {
  TEAM_TRAINING_PERIODS,
  type TeamTrainingBoard,
  type TeamTrainingBoardGroup,
  type TeamTrainingPeriod,
} from '../../shared/team-training-stats';
import type { Project, ProjectTeam } from '../types';
import './TeamTrainingStats.css';

const periodLabels = { week: '周', month: '月', year: '年' };
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const show = (value: number | null | undefined) =>
  value == null ? '—' : numberFormat.format(value);
const labelFor = (date: string, year: boolean) =>
  year ? `${Number(date.slice(5, 7))} 月` : date.slice(5);
const ratioColor = (name: string) =>
  name === '未分类' ? '#737e88' : name === '主课' || name === '水上' ? '#176f7f' : '#be7329';

const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' });
const weekLabel = (date: string) => weekday.format(new Date(`${date}T00:00:00Z`));
const percent = (value: number | null | undefined) => (value == null ? '—' : `${show(value)}%`);

function VolumeChart({
  stats,
  period,
  metric,
  unit,
  title,
}: {
  stats: TeamTrainingBoard;
  period: TeamTrainingPeriod;
  metric: 'minutes' | 'distance';
  unit: string;
  title: string;
}) {
  const option: EChartsOption = {
    animation: false,
    tooltip: { trigger: 'axis', renderMode: 'richText' },
    grid: { left: 48, right: 16, top: 30, bottom: 32 },
    xAxis: {
      type: 'category',
      data: stats.buckets.map(({ start }) => (period === 'year' ? start.slice(0, 7) : start)),
      axisLabel: {
        hideOverlap: true,
        formatter: (value: string) =>
          period === 'week' ? weekLabel(value) : labelFor(value, period === 'year'),
      },
    },
    yAxis: { type: 'value', name: unit, min: 0 },
    series: [
      {
        type: 'bar',
        name: `${title}（${unit}）`,
        data: stats.buckets.map((bucket) => bucket[metric]),
        barMaxWidth: 32,
        barMinHeight: 2,
        itemStyle: {
          color: metric === 'minutes' ? '#2458a6' : '#b44716',
          borderRadius: [4, 4, 0, 0],
        },
        label: { show: period === 'week', position: 'top' },
      },
    ],
  };
  return (
    <section className="team-training-volume-chart" aria-label={title}>
      <h4>
        {title} · {show(stats.totals[metric])} {unit}
      </h4>
      {stats.totals[metric] === null ? (
        <p>此周期未填报{title}。</p>
      ) : (
        <EChart option={option} label={`${title}，分项数值见具体训练统计`} />
      )}
    </section>
  );
}

function Donut({
  title,
  groups,
  colors,
  total,
}: {
  title: string;
  groups: TeamTrainingBoardGroup[];
  colors: string[];
  total: number | null | undefined;
}) {
  if (!total) return <p>{groups.length ? '时长均为 0，暂无占比。' : '此周期暂无训练时长。'}</p>;
  return (
    <div className="team-training-donut">
      <EChart
        label={title}
        option={{
          animation: false,
          color: colors,
          tooltip: { trigger: 'item', renderMode: 'richText', formatter: '{b}：{c} min（{d}%）' },
          series: [
            {
              type: 'pie',
              radius: ['58%', '84%'],
              label: { show: false },
              itemStyle: { borderColor: '#fff', borderWidth: 2 },
              data: groups.flatMap((group, index) =>
                group.value > 0 ? [{ ...group, itemStyle: { color: colors[index] } }] : []
              ),
            },
          ],
        }}
      />
      <div className="team-training-donut-total" aria-hidden="true">
        <strong>{show(total)}</strong>
        <span className="team-training-donut-unit">min</span>
      </div>
    </div>
  );
}

function RatioChart({
  title,
  groups,
  total,
}: {
  title: string;
  groups: TeamTrainingBoardGroup[];
  total: number | null;
}) {
  return (
    <ChartCard title={title} className="team-training-chart team-training-ratio">
      <Donut
        title={title}
        groups={groups}
        colors={groups.map(({ name }) => ratioColor(name))}
        total={total}
      />
      <ul className="team-training-ratio-legend">
        {groups.map(({ name, value, percentage }) => (
          <li key={name}>
            <span>
              <i style={{ background: ratioColor(name) }} aria-hidden="true" />
              {name}
            </span>
            <strong>
              {show(value)} min · {percent(percentage)}
            </strong>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

const analysisPalettes = [
  ['#2458a6', '#167381', '#387c68', '#5d5fa3', '#427ca9', '#536171'],
  ['#b44716', '#9a4d70', '#75599a', '#ac6542', '#996334', '#536171'],
];

function TimeAnalysis({
  group,
  index,
  water,
}: {
  group: TeamTrainingBoard['timeAnalysis'][number];
  index: number;
  water: boolean;
}) {
  const maximum = Math.max(0, ...group.points.map(({ value }) => value));
  const palette = analysisPalettes[index % analysisPalettes.length];
  const colors = group.points.map((_, i) => palette[i % palette.length]);
  return (
    <ChartCard title={`${group.title}（min）`} className="team-training-chart">
      {group.points.length === 0 ? (
        <p>此周期暂无该类训练时长。</p>
      ) : (
        <div className={water ? 'team-training-analysis-grid' : ''}>
          <ul className="team-training-bars">
            {group.points.map(({ name, value, percentage }, i) => (
              <li key={name}>
                <span>{name}</span>
                <strong>
                  {show(value)} min · {percent(percentage)}
                </strong>
                <span className="team-training-bar-track" aria-hidden="true">
                  <i
                    style={{
                      width: maximum ? `${(value / maximum) * 100}%` : '0%',
                      background: colors[i],
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
          {water && (
            <Donut
              title={`${group.title}分项占比`}
              groups={group.points}
              colors={colors}
              total={group.total}
            />
          )}
        </div>
      )}
    </ChartCard>
  );
}

function TrainingDetails({
  stats,
  period,
}: {
  stats: TeamTrainingBoard;
  period: TeamTrainingPeriod;
}) {
  const totals = stats.details.filter(({ total }) => total !== null);
  const raw = stats.details.filter(({ total }) => total === null);
  const [showRaw, setShowRaw] = useState(totals.length === 0);
  const [page, setPage] = useState(0);
  const rows = showRaw ? raw : totals;
  const dates = showRaw
    ? [...new Set(raw.flatMap(({ values }) => Object.keys(values)))].sort()
    : stats.buckets.map(({ start }) => start);
  const size = showRaw || period !== 'year' ? 7 : 12;
  const visible = dates.slice(page * size, (page + 1) * size);
  const year = period === 'year' && !showRaw;
  const rowGroups = stats.waterProject
    ? [
        { name: '水上', rows: rows.filter(({ waterGroup }) => waterGroup === 'water') },
        { name: '陆上', rows: rows.filter(({ waterGroup }) => waterGroup === 'land') },
        { name: '未分类', rows: rows.filter(({ waterGroup }) => !waterGroup) },
      ].filter((group) => group.rows.length)
    : [{ name: '', rows }];
  return (
    <ChartCard title="具体训练统计" className="team-training-chart">
      {totals.length > 0 && raw.length > 0 && (
        <label className="team-training-controls">
          <span>数值类型</span>
          <select
            value={showRaw ? 'raw' : 'total'}
            onChange={(event) => {
              setShowRaw(event.target.value === 'raw');
              setPage(0);
            }}
          >
            <option value="total">训练时长与距离</option>
            <option value="raw">其他单位的每日原值</option>
          </select>
        </label>
      )}
      {showRaw && <p>按日显示原值。</p>}
      <div
        className="team-training-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="具体训练统计，可横向滚动"
      >
        <table aria-label="具体训练统计">
          <thead>
            <tr>
              <th scope="col">分项 · 单位</th>
              {visible.map((date) => (
                <th key={date} scope="col" title={date}>
                  {period === 'week' ? weekLabel(date) : labelFor(date, year)}
                </th>
              ))}
              {!showRaw && <th scope="col">周期合计</th>}
            </tr>
          </thead>
          {rowGroups.map((group) => (
            <tbody key={group.name}>
              {group.name && (
                <tr className="team-training-table-group">
                  <th scope="rowgroup">{group.name}</th>
                  <td colSpan={visible.length + Number(!showRaw)} />
                </tr>
              )}
              {group.rows.map((row) => (
                <tr key={JSON.stringify([row.category, row.unit])}>
                  <th scope="row">
                    {row.category} · {row.unit}
                  </th>
                  {visible.map((date) => (
                    <td key={date}>{show(row.values[date])}</td>
                  ))}
                  {!showRaw && <td>{show(row.total)}</td>}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {dates.length > size && (
        <div className="team-training-controls">
          <button
            type="button"
            className="secondary-button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            前一段
          </button>
          <span>
            {visible[0]} 至 {visible.at(-1)}
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={(page + 1) * size >= dates.length}
            onClick={() => setPage(page + 1)}
          >
            后一段
          </button>
        </div>
      )}
    </ChartCard>
  );
}

function TrainingBoard({
  stats,
  period,
}: {
  stats: TeamTrainingBoard;
  period: TeamTrainingPeriod;
}) {
  const [metric, setMetric] = useState<'minutes' | 'distance'>(
    stats.totals.minutes === null && stats.totals.distance !== null ? 'distance' : 'minutes'
  );
  if (!stats.details.length)
    return <ContentState kind="empty" title="此周期暂无已导入的队伍训练数据" />;
  const summary = [
    { name: '总训练时长', value: stats.totals.minutes, unit: 'min' },
    ...(stats.waterProject
      ? ['水上', '陆上'].map((name) => ({
          name,
          value: stats.waterRatio.find((group) => group.name === name)?.value,
          unit: 'min',
        }))
      : [{ name: '总训练距离', value: stats.totals.distance, unit: 'km' }]),
  ];
  return (
    <>
      <dl className="team-training-kpis">
        {summary.map(({ name, value, unit }) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>
              {show(value)} <small className="team-training-kpi-unit">{unit}</small>
            </dd>
          </div>
        ))}
      </dl>
      <div
        className={`team-training-overview ${stats.waterProject ? 'team-training-overview-water' : ''}`}
      >
        <ChartCard title="训练量统计" className="team-training-chart">
          <div className="team-training-metric-switch" aria-label="训练量指标">
            <button
              type="button"
              className="secondary-button"
              aria-pressed={metric === 'minutes'}
              onClick={() => setMetric('minutes')}
            >
              训练时长
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={metric === 'distance'}
              onClick={() => setMetric('distance')}
            >
              训练距离
            </button>
          </div>
          {metric === 'minutes' ? (
            <VolumeChart
              stats={stats}
              period={period}
              metric="minutes"
              unit="min"
              title="训练时长"
            />
          ) : (
            <VolumeChart
              stats={stats}
              period={period}
              metric="distance"
              unit="km"
              title="训练距离"
            />
          )}
        </ChartCard>
        <RatioChart title="主辅训练比例" groups={stats.lessonRatio} total={stats.totals.minutes} />
        {stats.waterProject && (
          <RatioChart title="水陆训练比例" groups={stats.waterRatio} total={stats.totals.minutes} />
        )}
      </div>
      {stats.timeAnalysis.map((group, index) => (
        <TimeAnalysis key={group.title} group={group} index={index} water={stats.waterProject} />
      ))}
      <TrainingDetails stats={stats} period={period} />
    </>
  );
}

export function TeamTrainingStats({
  project,
  teamId,
  initialDate,
  focusOnOpen,
  onImport,
}: {
  project: Project;
  teamId: number | null;
  initialDate?: string;
  focusOnOpen: boolean;
  onImport: () => void;
}) {
  const [teams, setTeams] = useState<ProjectTeam[]>();
  const [teamsError, setTeamsError] = useState('');
  const [selected, setSelected] = useState<number | null>(teamId);
  const [date, setDate] = useState(initialDate ?? '');
  const [period, setPeriod] = useState<TeamTrainingPeriod>('week');
  const [yearDraft, setYearDraft] = useState<string>();
  const section = useRef<HTMLElement>(null);
  const positioned = useRef(false);
  useEffect(() => {
    if (!focusOnOpen || positioned.current) return;
    positioned.current = true;
    section.current?.scrollIntoView({ block: 'start' });
    section.current?.focus({ preventScroll: true });
  }, [focusOnOpen]);
  const [state, setState] = useState<{
    key: string;
    data?: TeamTrainingBoard;
    error?: string;
  }>({ key: '' });
  const [reload, setReload] = useState(0);
  const selectedId = teams?.some((team) => team.id === selected)
    ? selected
    : teams?.length === 1
      ? teams[0].id
      : null;
  const key = `${selectedId}:${period}:${date}:${reload}`;
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
      .teamTrainingStats(project, selectedId, period, date || undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data });
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setState({ key, error: failure instanceof Error ? failure.message : '统计读取失败。' });
      });
    return () => controller.abort();
  }, [project, selectedId, period, date, key]);

  const anchor = date || data?.anchorDate || '';
  const moveWeek = (step: number) => {
    const next = new Date(`${anchor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + step * 7);
    const value = next.toISOString().slice(0, 10);
    if (value >= '0002-01-01' && value <= '9998-12-31') setDate(value);
  };
  return (
    <section
      id="team-training-statistics"
      className="team-training-module"
      ref={section}
      tabIndex={-1}
      aria-labelledby="team-training-heading"
    >
      <SectionHeader
        title={
          <span id="team-training-heading">
            周训练数据看板 <small>Excel 导入</small>
          </span>
        }
        description={
          data
            ? `${teams?.find((team) => team.id === selectedId)?.name ?? ''} · ${data.start} 至 ${data.end} · ${periodLabels[period]}统计`
            : '统计教练填报的队级分项，与上方课次数据分别计算。'
        }
        actions={
          <button type="button" className="secondary-button" onClick={onImport}>
            <Upload size={16} aria-hidden="true" />
            导入 Excel
          </button>
        }
      />
      <div className="team-training-controls">
        <label>
          <span>队伍</span>
          <select
            value={selectedId ?? ''}
            onChange={(event) => {
              setSelected(Number(event.target.value) || null);
              setDate('');
              setYearDraft(undefined);
            }}
          >
            <option value="">请选择队伍</option>
            {teams?.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="team-training-periods">
          <legend>统计周期</legend>
          {TEAM_TRAINING_PERIODS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="team-training-period"
                checked={period === option}
                onChange={() => {
                  setDate(anchor);
                  setYearDraft(undefined);
                  setPeriod(option);
                }}
              />
              <span>{periodLabels[option]}</span>
            </label>
          ))}
        </fieldset>
        <label>
          <span>{period === 'week' ? '周内日期' : period === 'month' ? '月份' : '年份'}</span>
          {period === 'year' ? (
            <input
              type="number"
              min={2}
              max={9998}
              step={1}
              value={yearDraft ?? anchor.slice(0, 4)}
              disabled={selectedId === null}
              onChange={(event) => {
                const value = event.target.value;
                setYearDraft(value);
                if (event.target.validity.valid && /^\d{4}$/.test(value)) {
                  setDate(`${value.padStart(4, '0')}-01-01`);
                }
              }}
              onBlur={() => setYearDraft(undefined)}
            />
          ) : (
            <input
              type={period === 'week' ? 'date' : 'month'}
              min={period === 'week' ? '0002-01-01' : '0002-01'}
              max={period === 'week' ? '9998-12-31' : '9998-12'}
              value={period === 'week' ? anchor : anchor.slice(0, 7)}
              disabled={selectedId === null}
              onChange={(event) => {
                if (!event.target.validity.valid) return;
                const value = event.target.value;
                setDate(period === 'month' && value ? `${value}-01` : value);
              }}
            />
          )}
        </label>
        {period === 'week' && (
          <div className="team-training-week-navigation">
            <button
              type="button"
              className="secondary-button"
              disabled={!anchor || selectedId === null}
              onClick={() => moveWeek(-1)}
            >
              上一周
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!anchor || selectedId === null}
              onClick={() => moveWeek(1)}
            >
              下一周
            </button>
          </div>
        )}
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
        <ContentState kind="loading" title="正在读取周训练数据看板" />
      ) : (
        <TrainingBoard key={key} stats={data} period={period} />
      )}
    </section>
  );
}
