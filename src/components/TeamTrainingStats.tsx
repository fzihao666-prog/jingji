import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { api } from '../api';
import { EChart } from './EChart';
import { ChartCard, ContentState, SectionHeader } from './PageLayout';
import { projectCapability } from '../../shared/projects';
import {
  TEAM_TRAINING_PERIODS,
  type TeamTrainingBucket,
  type TeamTrainingMeasure,
  type TeamTrainingPeriod,
  type TeamTrainingStatistics,
} from '../../shared/team-training-stats';
import type { Project, ProjectTeam } from '../types';
import './TeamTrainingStats.css';

const periodLabels = { week: '周', month: '月', year: '年' };
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const showNumber = (value: number | null) => (value === null ? '—' : numberFormat.format(value));
type Point = { name: string; value: number | null };
type ChartType = 'bar' | 'line' | 'pie';

function chartOption(
  points: Point[],
  type: ChartType,
  unit: string,
  pointLabel: string
): EChartsOption {
  if (type === 'pie') {
    return {
      animation: false,
      tooltip: { trigger: 'item', renderMode: 'richText', formatter: `{b}：{c} ${unit}（{d}%）` },
      series: [
        {
          type: 'pie',
          radius: ['40%', '64%'],
          stillShowZeroSum: false,
          label: { formatter: '{b} {d}%', overflow: 'truncate' },
          data: points.flatMap(({ name, value }) => (value === null ? [] : [{ name, value }])),
        },
      ],
    };
  }
  return {
    animation: false,
    tooltip: { trigger: 'axis', renderMode: 'richText' },
    grid: { left: 56, right: 20, top: 32, bottom: 54 },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.name),
      axisLabel: {
        hideOverlap: true,
        rotate: pointLabel === '分项' && points.length > 6 ? 30 : 0,
        formatter: (name: string) => {
          if (pointLabel === '日期') return name.slice(5);
          if (pointLabel === '月份') return `${Number(name.slice(5))} 月`;
          return name;
        },
      },
    },
    yAxis: { type: 'value', name: unit, min: 0 },
    series: [
      {
        name: `数值（${unit}）`,
        type,
        data: points.map((point) => point.value),
        ...(type === 'line'
          ? { connectNulls: false, symbolSize: 6, showSymbol: points.length <= 40 }
          : { barMaxWidth: 32 }),
      },
    ],
  };
}

function TrainingChart({
  title,
  points,
  unit,
  type,
  description,
  pointLabel = '分项',
}: {
  title: string;
  points: Point[];
  unit: string;
  type: ChartType;
  description?: string;
  pointLabel?: string;
}) {
  const hasValues = points.some(({ value }) => value !== null);
  const hasChart = hasValues && (type !== 'pie' || points.some(({ value }) => (value ?? 0) > 0));
  const sum = type === 'pie' ? points.reduce((value, point) => value + (point.value ?? 0), 0) : 0;
  return (
    <ChartCard title={title} description={description} className="team-training-chart">
      {hasChart ? (
        <EChart
          option={chartOption(points, type, unit, pointLabel)}
          label={`${title}，下方可查看数据表`}
        />
      ) : (
        <ContentState kind="empty" title={hasValues ? '数值均为 0，暂无占比' : '此周期暂无数据'} />
      )}
      {hasValues && (
        <details className="team-training-table">
          <summary aria-label={`查看数据表 · ${title}`}>查看数据表</summary>
          <div
            className="team-training-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={`${title}数据表`}
          >
            <table aria-label={title}>
              <thead>
                <tr>
                  <th scope="col">{pointLabel}</th>
                  <th scope="col">数值（{unit}）</th>
                  {type === 'pie' && <th scope="col">占比</th>}
                </tr>
              </thead>
              <tbody>
                {points.map(({ name, value }) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{showNumber(value)}</td>
                    {type === 'pie' && (
                      <td>
                        {value === null || !sum ? '—' : `${showNumber((value / sum) * 100)}%`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </ChartCard>
  );
}

function categoryPoints(categories: TeamTrainingMeasure[], group?: 'water' | 'land') {
  const values = new Map<string, number>();
  for (const measure of categories) {
    if (group && measure.waterGroup !== group) continue;
    values.set(measure.category, (values.get(measure.category) ?? 0) + measure.value);
  }
  return [...values].map(([name, value]) => ({ name, value }));
}

const annualMetrics: {
  key: Exclude<keyof TeamTrainingBucket, 'start' | 'distance'>;
  title: string;
  description?: string;
}[] = [
  { key: 'water', title: '水上训练时长' },
  {
    key: 'slalomProxy',
    title: '激流训练口径时长',
    description: '按原表口径合计无氧能力、无氧功率与测功仪时长。',
  },
  { key: 'maxStrength', title: '大力量训练时长' },
  { key: 'endurance', title: '力量耐力时长' },
  { key: 'explosive', title: '爆发力训练时长' },
  { key: 'functionalCore', title: '功能与核心训练时长' },
];

function StatisticsCharts({
  stats,
  period,
  water,
}: {
  stats: TeamTrainingStatistics;
  period: TeamTrainingPeriod;
  water: boolean;
}) {
  const duration = stats.categories.filter(({ unit }) => unit === 'min');
  const distance = stats.categories.filter(({ unit }) => unit === 'km');
  const rangeTotal = (values: TeamTrainingMeasure[]) =>
    values.length ? values.reduce((sum, item) => sum + item.value, 0) : null;
  const groupTotal = (matches: (item: TeamTrainingMeasure) => boolean) =>
    rangeTotal(duration.filter(matches));
  const waterPoints = categoryPoints(duration, 'water');
  const landPoints = categoryPoints(duration, 'land');
  const trendType = period === 'year' ? 'line' : 'bar';
  const timeLabel = period === 'year' ? '月份' : '日期';
  const trend = (metric: Exclude<keyof TeamTrainingBucket, 'start'>) =>
    stats.buckets.map((bucket) => ({
      name: period === 'year' ? bucket.start.slice(0, 7) : bucket.start,
      value: bucket[metric],
    }));

  return (
    <>
      <p className="team-training-range">
        {stats.start} 至 {stats.end} · {period === 'year' ? '按月汇总' : '按日汇总'}
        {duration.length > 0 && (
          <>
            {' '}
            · 总时长 <strong>{showNumber(rangeTotal(duration))}</strong> min
          </>
        )}
        {distance.length > 0 && (
          <>
            {' '}
            · 总距离 <strong>{showNumber(rangeTotal(distance))}</strong> km
          </>
        )}
      </p>
      {stats.categories.length === 0 && stats.otherMeasures.length === 0 ? (
        <ContentState
          kind="empty"
          title="此周期暂无队伍训练数据"
          description="可切换统计周期、日期或队伍，也可以上传训练 Excel。"
        />
      ) : (
        <div className="team-training-chart-grid">
          {duration.length > 0 && (
            <TrainingChart
              title="训练时长趋势"
              unit="min"
              type={trendType}
              points={trend('minutes')}
              pointLabel={timeLabel}
            />
          )}
          {distance.length > 0 && (
            <TrainingChart
              title="训练距离趋势"
              unit="km"
              type={trendType}
              points={trend('distance')}
              pointLabel={timeLabel}
            />
          )}
          {water && duration.length > 0 && (
            <>
              <TrainingChart
                title="主课与辅课时长占比"
                unit="min"
                type="pie"
                description="辅课为耐力、爆发力和功能训练。"
                points={[
                  { name: '主课', value: groupTotal((item) => item.lessonGroup === 'main') },
                  { name: '辅课', value: groupTotal((item) => item.lessonGroup === 'auxiliary') },
                  { name: '未分类', value: groupTotal((item) => item.lessonGroup === null) },
                ]}
              />
              <TrainingChart
                title="水上与陆上时长占比"
                unit="min"
                type="pie"
                description="测功仪计入水上。"
                points={[
                  { name: '水上', value: groupTotal((item) => item.waterGroup === 'water') },
                  { name: '陆上', value: groupTotal((item) => item.waterGroup === 'land') },
                  { name: '未分类', value: groupTotal((item) => item.waterGroup === null) },
                ]}
              />
              <TrainingChart title="水上各分项时长" unit="min" type="bar" points={waterPoints} />
              <TrainingChart
                title="水上各分项时长占比"
                unit="min"
                type="pie"
                points={waterPoints}
              />
              <TrainingChart title="陆上各分项时长" unit="min" type="bar" points={landPoints} />
              <TrainingChart title="陆上各分项时长占比" unit="min" type="pie" points={landPoints} />
            </>
          )}
          {duration.length > 0 && (!water || duration.some((item) => item.waterGroup === null)) && (
            <>
              <TrainingChart
                title="各分项训练时长"
                unit="min"
                type="bar"
                points={categoryPoints(duration)}
              />
              <TrainingChart
                title="各分项训练时长占比"
                unit="min"
                type="pie"
                points={categoryPoints(duration)}
              />
            </>
          )}
          {distance.length > 0 && (
            <TrainingChart
              title="各分项训练距离"
              unit="km"
              type="bar"
              points={categoryPoints(distance)}
            />
          )}
          {period === 'year' &&
            water &&
            duration.length > 0 &&
            annualMetrics.map(({ key, title, description }) => (
              <TrainingChart
                key={key}
                title={title}
                description={description}
                unit="min"
                type="line"
                points={trend(key)}
                pointLabel={timeLabel}
              />
            ))}
          {stats.otherMeasures.length > 0 && <OtherMeasures measures={stats.otherMeasures} />}
        </div>
      )}
    </>
  );
}

function OtherMeasures({ measures }: { measures: TeamTrainingStatistics['otherMeasures'] }) {
  const options = new Map<string, { category: string; unit: string; points: Point[] }>();
  for (const { date, category, unit, value } of measures) {
    const key = JSON.stringify([category, unit]);
    const option = options.get(key) ?? { category, unit, points: [] };
    option.points.push({ name: date, value });
    options.set(key, option);
  }
  const [selected, setSelected] = useState('');
  const first = options.keys().next().value!;
  const selectedKey = options.has(selected) ? selected : first;
  const option = options.get(selectedKey)!;
  return (
    <div className="team-training-other">
      <div className="team-training-controls">
        <label>
          <span>其他训练指标</span>
          <select value={selectedKey} onChange={(event) => setSelected(event.target.value)}>
            {[...options].map(([key, item]) => (
              <option key={key} value={key}>
                {item.category}（{item.unit}）
              </option>
            ))}
          </select>
        </label>
      </div>
      <TrainingChart
        title={`${option.category}原始数值`}
        unit={option.unit}
        type="bar"
        points={option.points}
        pointLabel="日期"
        description="按原始记录日期展示。"
      />
    </div>
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
    data?: TeamTrainingStatistics;
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

  const water = Boolean(projectCapability(project));
  const anchor = date || data?.anchorDate || '';
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
            队伍训练统计 <small>Excel 导入</small>
          </span>
        }
        description="统计教练填报的队级分项，与上方课次数据分别计算。"
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
        <StatisticsCharts key={key} stats={data} period={period} water={water} />
      )}
    </section>
  );
}
