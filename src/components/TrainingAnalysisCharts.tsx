import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import type { OverviewMeasurement, OverviewPayload, TrainingRecord } from '../types';
import { addDays, formatNumber, percentage, startOfWeek } from '../utils';
import {
  TRAINING_CONTENT_CATEGORIES,
  trainingContentCategory,
  trainingLoadCategory as classifyTrainingLoad,
} from '../../shared/training-content-category';
import { STRENGTH_INTENSITY_ZONES, TRAINING_INTENSITY_META } from '../../shared/strength-training';
import { placeholderTrend } from './chart-placeholder';
import './EChart.css';

const colors = [
  '#0b7f7a',
  '#25aa9d',
  '#73c5ab',
  '#edaa32',
  '#df634d',
  '#66758a',
  '#8b6eb0',
  '#3d7db7',
  '#9a7f66',
];

export const trainingLoadCategory = classifyTrainingLoad;

type TrainingVolume = OverviewPayload['trainingVolume'];

type TrendGranularity = 'auto' | 'day' | 'week' | 'month';

export function TrainingVolumeChart({
  data,
  from,
  to,
}: {
  data: TrainingVolume;
  from: string;
  to: string;
}) {
  const [granularity, setGranularity] = useState<TrendGranularity>('auto');
  const [chartWidth, setChartWidth] = useState(0);
  const rangeDays = Math.max(
    1,
    Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1
  );
  const effectiveGranularity =
    granularity === 'auto'
      ? rangeDays <= 31
        ? 'day'
        : rangeDays <= 120
          ? 'week'
          : 'month'
      : granularity;
  const chartData = useMemo(() => {
    const rows = new Map<
      string,
      {
        date: string;
        durationMin: number;
        distanceKm: number;
        durationCount: number;
        distanceCount: number;
      }
    >();
    for (const row of data.days) {
      const date =
        effectiveGranularity === 'day'
          ? row.date
          : effectiveGranularity === 'week'
            ? startOfWeek(row.date)
            : `${row.date.slice(0, 7)}-01`;
      const target = rows.get(date) || {
        date,
        durationMin: 0,
        distanceKm: 0,
        durationCount: 0,
        distanceCount: 0,
      };
      if (row.durationMin !== null) {
        target.durationMin += row.durationMin;
        target.durationCount += 1;
      }
      if (row.distanceKm !== null) {
        target.distanceKm += row.distanceKm;
        target.distanceCount += 1;
      }
      rows.set(date, target);
    }
    return [...rows.values()].map((row) => ({
      ...row,
      label:
        effectiveGranularity === 'month'
          ? row.date.slice(0, 7).replace('-', '/')
          : row.date.slice(5).replace('-', '/'),
      durationMin: row.durationCount ? row.durationMin : null,
      distanceKm: row.distanceCount ? row.distanceKm : null,
    }));
  }, [data.days, effectiveGranularity]);
  const hasData = data.totalDurationMin !== null || data.totalDistanceKm !== null;
  const displayChartData = hasData ? chartData : placeholderTrend.map((sample, index) => ({
    date: `示例${index + 1}`, label: `${index + 1}日`, durationMin: sample * 2,
    distanceKm: sample / 10, durationCount: 0, distanceCount: 0,
  }));
  const xAxisTicks = useMemo(() => {
    const labels = displayChartData.map((row) => row.label);
    const maxTicks = chartWidth > 0 ? Math.max(2, Math.floor(chartWidth / 50)) : 7;
    if (labels.length <= maxTicks) return labels;
    const step = Math.ceil((labels.length - 1) / (maxTicks - 1));
    return labels.filter(
      (_, index) => index === 0 || index === labels.length - 1 || index % step === 0
    );
  }, [displayChartData, chartWidth]);
  const value = (number: number | null, digits = 1) =>
    number === null ? '—' : formatNumber(number, digits);
  return (
    <div className="analysis-chart-module training-volume-module">
      <div className="analysis-chart-toolbar">
        <span className="analysis-caption">按日期累计训练时长与公里数；空白数据不按 0 处理</span>
        <label className="analysis-granularity">
          粒度
          <select
            aria-label="训练量趋势粒度"
            value={granularity}
            onChange={(event) => setGranularity(event.target.value as TrendGranularity)}
          >
            <option value="auto">
              自动（
              {effectiveGranularity === 'day'
                ? '按天'
                : effectiveGranularity === 'week'
                  ? '按周'
                  : '按月'}
              ）
            </option>
            <option value="day">按天</option>
            <option value="week">按周</option>
            <option value="month">按月</option>
          </select>
        </label>
      </div>
      <div className="training-volume-kpis">
        <article>
          <span>累计训练时长</span>
          <strong>
            {data.totalDurationMin === null ? '—' : value(data.totalDurationMin / 60)}
            <small>{data.totalDurationMin === null ? '' : ' h'}</small>
          </strong>
        </article>
        <article>
          <span>累计公里数</span>
          <strong>
            {value(data.totalDistanceKm)}
            <small>{data.totalDistanceKm === null ? '' : ' km'}</small>
          </strong>
        </article>
        <article>
          <span>日均训练时长</span>
          <strong>
            {data.averageDurationMin === null ? '—' : value(data.averageDurationMin / 60)}
            <small>{data.averageDurationMin === null ? '' : ' h'}</small>
            <em>{data.durationDayCount ? `${data.durationDayCount} 个有效训练日` : ''}</em>
          </strong>
        </article>
        <article>
          <span>日均公里数</span>
          <strong>
            {value(data.averageDistanceKm)}
            <small>{data.averageDistanceKm === null ? '' : ' km'}</small>
            <em>{data.distanceDayCount ? `${data.distanceDayCount} 个有效训练日` : ''}</em>
          </strong>
        </article>
      </div>
      <div className="analysis-chart-medium">
        {!hasData && <span className="app-chart-example">示例数据</span>}
        <ResponsiveContainer
          width="100%"
          height="100%"
          onResize={(width) => setChartWidth((current) => (current === width ? current : width))}
        >
          <ComposedChart data={displayChartData} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="label"
              ticks={xAxisTicks}
              interval={0}
              tick={{ fontSize: 9, fill: '#62767d' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="time"
              tick={{ fontSize: 9, fill: '#62767d' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="distance"
              orientation="right"
              tick={{ fontSize: 9, fill: '#62767d' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              labelFormatter={(label) => `${!hasData ? '示例数据，仅用于展示图表效果 · ' : ''}${label}`}
              formatter={(number, name) => [
                `${formatNumber(Number(number), name === '公里数' ? 1 : 0)} ${name === '公里数' ? 'km' : 'min'}`,
                name,
              ]}
              contentStyle={{
                border: '1px solid #d5e3e5',
                borderRadius: 10,
                boxShadow: '0 10px 24px rgba(9,54,65,.12)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar
              yAxisId="time"
              dataKey="durationMin"
              name="训练时长"
              fill="#69aebb"
              fillOpacity={0.86}
              radius={[5, 5, 0, 0]}
              maxBarSize={30}
            />
            <Line
              yAxisId="distance"
              type="monotone"
              dataKey="distanceKm"
              name="公里数"
              stroke="#0b4d59"
              strokeWidth={3}
              dot={{ r: 3, fill: '#fff', stroke: '#0b4d59', strokeWidth: 2 }}
              activeDot={{
                r: 5,
                fill: '#18a092',
                stroke: '#fff',
                strokeWidth: 2,
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!hasData && <p className="analysis-empty-note">暂无当前周期真实数据 · 当前图表为示例效果</p>}
    </div>
  );
}

type TrainingAnalytics = OverviewPayload['trainingAnalytics'];
type PhysiologyHeatmap = OverviewPayload['physiologyHeatmap'];
const chartTooltipStyle = {
  border: '1px solid #d5e3e5',
  borderRadius: 10,
  boxShadow: '0 10px 24px rgba(9,54,65,.12)',
  fontSize: 10,
};

function TrainingAnalyticsEmpty({ text }: { text: string }) {
  return <p className="analysis-empty-note training-analytics-empty">{text}</p>;
}

const physiologyStatusMeta = {
  NORMAL: { label: '正常', color: '#7cb9a9' },
  FLUCTUATION: { label: '波动', color: '#d8ad59' },
  ATTENTION: { label: '关注', color: '#d47d4f' },
  ABNORMAL: { label: '异常', color: '#b74e4e' },
  MISSING: { label: '未监测', color: '#e7edef' },
} as const;

function PhysiologyBiochemistryHeatmap({ data }: { data: PhysiologyHeatmap }) {
  const [active, setActive] = useState<{
    metricIndex: number;
    dayIndex: number;
  } | null>(null);
  const isPlaceholder = !data.metrics.some((item) => item.days.length > 0);
  const displayMetrics: PhysiologyHeatmap['metrics'] = isPlaceholder
    ? ['指标一', '指标二', '指标三', '指标四'].map((label, metricIndex) => ({
        code: `sample-${metricIndex}`, label, unit: '', direction: 'higher' as const,
        thresholds: [0, 0, 0] as [number, number, number], baseline: 0,
        days: placeholderTrend.map((_, dayIndex) => ({
          date: `2026-01-${String(dayIndex + 1).padStart(2, '0')}`,
          status: 'MISSING' as const, median: null, sampleCount: 0, normal: 0,
          fluctuation: 0, attention: 0, abnormal: 0, abnormalRateChange: null,
          isEstimated: false,
        })),
        trend: [], summary: { latest: null, trendDirection: 'stable' as const,
          minValue: null, maxValue: null, avgValue: null, dataDays: 0 },
      }))
    : data.metrics;
  const days = displayMetrics[0]?.days || [];
  const cell = active ? displayMetrics[active.metricIndex]?.days[active.dayIndex] : null;
  const metric = active ? displayMetrics[active.metricIndex] : null;
  return (
    <div className="physiology-heatmap">
      <div className="physiology-heatmap-toolbar">
        <span>团队状态趋势</span>
        {isPlaceholder && <span className="app-chart-example">示例数据</span>}
      </div>
      {displayMetrics.length ? (
        <div
          className="physiology-heatmap-table"
          style={{ '--physiology-days': days.length } as CSSProperties}
        >
          <div className="physiology-heatmap-head">
            <span>指标</span>
            {days.map((day) => (
              <span key={day.date}>{day.date.slice(5).replace('-', '/')}</span>
            ))}
          </div>
          {displayMetrics.map((item, metricIndex) => (
            <div className="physiology-heatmap-row" key={item.code}>
              <span>{item.label}</span>
              {item.days.map((itemDay, dayIndex) => (
                <button
                  key={itemDay.date}
                  type="button"
                  className={`physiology-cell ${isPlaceholder ? 'sample' : itemDay.status.toLowerCase()}`}
                  aria-label={isPlaceholder ? `${item.label} ${itemDay.date} 示例数据，仅用于展示图表效果` : `${item.label} ${itemDay.date} ${physiologyStatusMeta[itemDay.status].label}`}
                  onMouseEnter={() => setActive({ metricIndex, dayIndex })}
                  onFocus={() => setActive({ metricIndex, dayIndex })}
                  onClick={() => setActive({ metricIndex, dayIndex })}
                >
                  <i />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <TrainingAnalyticsEmpty text="暂无生理生化数据" />
      )}
      <div className="physiology-heatmap-legend">
        {Object.entries(physiologyStatusMeta)
          .slice(0, 4)
          .map(([key, item]) => (
            <span key={key}>
              <i style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
      </div>
      {cell && metric && (
        <div className="physiology-heatmap-detail">
          {isPlaceholder ? <span>示例数据，仅用于展示图表效果；不表示真实监测结果。</span> : <>
          <strong>
            {metric.label} · {cell.date}
          </strong>
          <span>
            {cell.isEstimated
              ? 'V1 模拟状态（等待实测导入）'
              : `团队中位数：${formatNumber(cell.median || 0, 1)} ${metric.unit}`}{' '}
            · 监测人数：{cell.sampleCount} 人
          </span>
          <span>
            正常 {cell.normal} · 波动 {cell.fluctuation} · 关注 {cell.attention} · 异常{' '}
            {cell.abnormal}
            {cell.abnormalRateChange === null
              ? ''
              : ` · 较前日异常率 ${cell.abnormalRateChange >= 0 ? '↑' : '↓'} ${formatNumber(Math.abs(cell.abnormalRateChange), 1)}%`}
          </span>
          </>}
        </div>
      )}
      {isPlaceholder && <p className="app-chart-example-note">暂无真实生理生化数据 · 当前分布为示例效果</p>}
    </div>
  );
}

export function TrainingVolumeDashboard({
  data,
  physiology,
  from,
  to,
}: {
  data: TrainingAnalytics;
  physiology: PhysiologyHeatmap;
  from: string;
  to: string;
}) {
  const { summary, days } = data;
  const value = (number: number | null, digits = 1) =>
    number === null ? '—' : formatNumber(number, digits);
  const [hiddenVolumeSeries, setHiddenVolumeSeries] = useState({ physical: false, special: false });
  const loadByDate = new Map(days.map((row) => [row.date, row]));
  const trainingLoadDays: Array<{
    date: string;
    specialLoad: number | null;
    physicalLoad: number | null;
  }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const row = loadByDate.get(date);
    trainingLoadDays.push({
      date,
      specialLoad: row?.specialLoad ?? null,
      physicalLoad: row?.physicalLoad ?? null,
    });
  }
  const sampleDates = trainingLoadDays.length > 1
    ? trainingLoadDays.filter((_, index) => index % Math.max(1, Math.ceil(trainingLoadDays.length / 7)) === 0).slice(-7)
    : [{ date: from, specialLoad: null, physicalLoad: null }];
  const hasVolumeData = days.some((row) =>
    row.physicalDurationMin !== null || row.specialDurationMin !== null ||
    row.specialDistanceKm !== null || row.physicalLoad !== null || row.specialLoad !== null
  );
  const volumeChartDays = trainingLoadDays.map(({ date }) => ({
    date,
    physicalDurationMin: loadByDate.get(date)?.physicalDurationMin ?? null,
    specialDurationMin: loadByDate.get(date)?.specialDurationMin ?? null,
    specialDistanceKm: loadByDate.get(date)?.specialDistanceKm ?? null,
  }));
  const displayVolumeDays = hasVolumeData ? volumeChartDays : sampleDates.map((row, index) => ({
    date: row.date,
    physicalDurationMin: placeholderTrend[index % placeholderTrend.length] * 2,
    specialDurationMin: placeholderTrend[(index + 2) % placeholderTrend.length] * 2,
    specialDistanceKm: null,
  }));
  const hasTrainingLoad = trainingLoadDays.some((row) => row.specialLoad !== null || row.physicalLoad !== null);
  const trainingLoadChartDays = hasTrainingLoad ? trainingLoadDays : sampleDates.map((row, index) => ({
    date: row.date, specialLoad: placeholderTrend[index % placeholderTrend.length] * 5,
    physicalLoad: placeholderTrend[(index + 2) % placeholderTrend.length] * 4,
  }));
  const rpeByDate = new Map(days.map((row) => [row.date, row]));
  const rpeDays: Array<{
    date: string;
    averageRpe: number | null;
    stdRpe: number | null;
    rpeCount: number;
    rpeRange: [number, number] | null;
  }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const row = rpeByDate.get(date);
    rpeDays.push({
      date,
      averageRpe: row?.averageRpe ?? null,
      stdRpe: row?.stdRpe ?? null,
      rpeCount: row?.rpeCount ?? 0,
      rpeRange:
        row?.lowerRpe != null && row?.upperRpe != null ? [row.lowerRpe, row.upperRpe] : null,
    });
  }
  const hasRpe = rpeDays.some((row) => row.averageRpe !== null);
  const rpeChartDays = hasRpe ? rpeDays : sampleDates.map((row, index) => ({
    date: row.date, averageRpe: 4 + placeholderTrend[index % placeholderTrend.length] / 25,
    stdRpe: null, rpeCount: 0, rpeRange: null,
  }));
  return (
    <div className="training-analytics-dashboard">
      <section className="training-analytics-summary" aria-label="训练量统计核心摘要">
        <article>
          <span>累计训练量</span>
          <strong>
            {value(summary.totalDurationMin === null ? null : summary.totalDurationMin / 60)}
            <small>{summary.totalDurationMin === null ? '' : ' h'}</small>
          </strong>
          <em>训练时长</em>
        </article>
        <article>
          <span>测试</span>
          <strong>
            {value(summary.testDurationMin === null ? null : summary.testDurationMin / 60)}
            <small>{summary.testDurationMin === null ? '' : ' h'}</small>
          </strong>
          <em>{summary.testDurationMin === null ? '未录入测试时长' : '按队伍测试日去重累计'}</em>
        </article>
        <article>
          <span>恢复时长</span>
          <strong>
            {value(summary.recoveryDurationMin === null ? null : summary.recoveryDurationMin / 60)}
            <small>{summary.recoveryDurationMin === null ? '' : ' 小时'}</small>
          </strong>
          <em>累计恢复训练时间</em>
        </article>
        <article>
          <span>专项</span>
          <div className="training-analytics-double-metric">
            <div>
              <strong>
                {value(
                  summary.specialDurationMin === null ? null : summary.specialDurationMin / 60
                )}
                <small>{summary.specialDurationMin === null ? '' : ' h'}</small>
              </strong>
              <em>时长</em>
            </div>
            <div>
              <strong>
                {value(summary.specialDistanceKm)}
                <small>{summary.specialDistanceKm === null ? '' : ' km'}</small>
              </strong>
              <em>公里数</em>
            </div>
          </div>
        </article>
        <article>
          <span>体能</span>
          <div className="training-analytics-double-metric">
            <div>
              <strong>
                {value(
                  summary.physicalDurationMin === null ? null : summary.physicalDurationMin / 60
                )}
                <small>{summary.physicalDurationMin === null ? '' : ' h'}</small>
              </strong>
              <em>时长</em>
            </div>
            <div>
              <strong>
                {value(summary.physicalLoad)}
                <small>{summary.physicalLoad === null ? '' : ' AU'}</small>
              </strong>
              <em>负荷</em>
            </div>
          </div>
        </article>
      </section>
      <section className="training-analytics-grid" aria-label="训练量统计分析图表">
        <article className="training-analytics-chart training-analytics-volume-comparison">
          <header>
            <div>
              <span>TRAINING DURATION</span>
              <h3>体能与专项训练量对比</h3>
            </div>
            <small>训练时长 · 分钟 · 按日</small>
          </header>
          <p className="analysis-caption">比较每日体能与专项训练时长；缺失留空，已记录的 0 保留为 0。</p>
          <div className="training-volume-legend" role="group" aria-label="训练类型图例">
            <button type="button" aria-pressed={!hiddenVolumeSeries.physical}
              onClick={() => setHiddenVolumeSeries((current) => ({ ...current, physical: !current.physical }))}>
              <i className="training-volume-physical-key" aria-hidden="true" />体能训练
            </button>
            <button type="button" aria-pressed={!hiddenVolumeSeries.special}
              onClick={() => setHiddenVolumeSeries((current) => ({ ...current, special: !current.special }))}>
              <i className="training-volume-special-key" aria-hidden="true" />专项训练
            </button>
          </div>
          <div className="training-analytics-canvas">
            {!hasVolumeData && <p className="analysis-empty-note">示例数据 · 暂无当前周期真实数据</p>}
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={displayVolumeDays} accessibilityLayer
                margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" minTickGap={24}
                  tickFormatter={(date) => String(date).slice(5).replace('-', '/')}
                  tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false} />
                <YAxis unit=" min" domain={[0, 'auto']}
                  tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false} />
                <Tooltip content={({ active, label }) => {
                  const row = displayVolumeDays.find((item) => item.date === String(label));
                  if (!active || !row) return null;
                  return <div className="training-volume-tooltip">
                    <strong>{!hasVolumeData ? '示例数据 · ' : ''}{row.date}</strong>
                    {!hiddenVolumeSeries.physical && <p>体能训练：{row.physicalDurationMin === null ? '缺失' : `${value(row.physicalDurationMin)} 分钟`}</p>}
                    {!hiddenVolumeSeries.special && <p>专项训练：{row.specialDurationMin === null ? '缺失' : `${value(row.specialDurationMin)} 分钟`}</p>}
                    {row.specialDistanceKm !== null && <p>专项距离：{value(row.specialDistanceKm)} km</p>}
                  </div>;
                }} />
                <Bar dataKey="physicalDurationMin" name="体能训练" fill="#64aeb3"
                  hide={hiddenVolumeSeries.physical} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="specialDurationMin" name="专项训练" fill="#178e87"
                  hide={hiddenVolumeSeries.special} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="training-volume-data">
            <summary>查看训练时长数据{!hasVolumeData ? '（示例）' : ''}</summary>
            <div className="training-volume-table-scroll" tabIndex={0} role="region" aria-label="每日训练量数据表">
              <table>
                <caption>{!hasVolumeData ? '示例数据，仅用于展示，不参与统计' : '当前筛选范围的每日训练量；缺失不代表 0'}</caption>
                <thead><tr><th scope="col">日期</th><th scope="col">体能（分钟）</th><th scope="col">专项（分钟）</th><th scope="col">专项距离（km）</th></tr></thead>
                <tbody>{displayVolumeDays.map((row) => <tr key={row.date}>
                  <th scope="row">{row.date}</th><td>{row.physicalDurationMin === null ? '缺失' : value(row.physicalDurationMin)}</td>
                  <td>{row.specialDurationMin === null ? '缺失' : value(row.specialDurationMin)}</td>
                  <td>{row.specialDistanceKm === null ? '缺失' : value(row.specialDistanceKm)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
        </article>
        <article className="training-analytics-chart training-analytics-load-trend">
          <header>
            <div>
              <span>TRAINING LOAD</span>
              <h3>训练负荷分析</h3>
            </div>
            <small>sRPE · AU</small>
          </header>
          <div className="training-analytics-canvas">
            {!hasTrainingLoad && <p className="analysis-empty-note">示例数据 · 暂无当前周期真实数据</p>}
            {(
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={trainingLoadChartDays}
                  margin={{ top: 12, right: 12, left: 6, bottom: 0 }}
                >
                  <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(date) => String(date).slice(5).replace('-', '/')}
                    tick={{ fontSize: 9, fill: '#62767d' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    label={{
                      value: 'sRPE（AU）',
                      angle: -90,
                      position: 'insideLeft',
                      fill: '#62767d',
                      fontSize: 9,
                    }}
                    tick={{ fontSize: 9, fill: '#62767d' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      const row = payload?.[0]?.payload as
                        (typeof trainingLoadDays)[number] | undefined;
                      if (!active || !row) return null;
                      return (
                        <div
                          style={{
                            ...chartTooltipStyle,
                            background: '#fff',
                            padding: '10px 12px',
                            color: '#3d5c65',
                          }}
                        >
                          {!hasTrainingLoad && <div>示例数据，仅用于展示图表效果</div>}
                          <div>日期：{String(label).slice(5).replace('-', '/')}</div>
                          <div>专项训练 sRPE：{value(row.specialLoad)} AU</div>
                          <div>体能训练 sRPE：{value(row.physicalLoad)} AU</div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="specialLoad"
                    name="专项训练 sRPE"
                    stroke="#0b7f7a"
                    strokeWidth={2.6}
                    dot={{
                      r: 2.5,
                      fill: '#fff',
                      stroke: '#0b7f7a',
                      strokeWidth: 2,
                    }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="physicalLoad"
                    name="体能训练 sRPE"
                    stroke="#d59125"
                    strokeWidth={2.6}
                    dot={{
                      r: 2.5,
                      fill: '#fff',
                      stroke: '#d59125',
                      strokeWidth: 2,
                    }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
        <article className="training-analytics-chart physiology-heatmap-card">
          <header>
            <div>
              <span>PHYSIOLOGY & BIOCHEMISTRY</span>
              <h3>生理生化</h3>
            </div>
            <small>团队风险状态热力图</small>
          </header>
          <PhysiologyBiochemistryHeatmap data={physiology} />
        </article>
        <article className="training-analytics-chart training-analytics-rpe">
          <header>
            <div>
              <span>SUBJECTIVE EXERTION</span>
              <h3>RPE</h3>
            </div>
          </header>
          <div className="training-analytics-canvas">
            {!hasRpe && <p className="analysis-empty-note">示例数据 · 暂无当前周期真实数据</p>}
            {(
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rpeChartDays} margin={{ top: 12, right: 10, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(date) => String(date).slice(5).replace('-', '/')}
                    tick={{ fontSize: 9, fill: '#62767d' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 10]}
                    allowDataOverflow
                    ticks={[0, 2, 4, 6, 8, 10]}
                    tick={{ fontSize: 9, fill: '#62767d' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      const row = payload?.[0]?.payload as (typeof rpeDays)[number] | undefined;
                      if (!active || !row || row.averageRpe === null) return null;
                      return (
                        <div
                          style={{
                            ...chartTooltipStyle,
                            background: '#fff',
                            padding: '10px 12px',
                            color: '#3d5c65',
                          }}
                        >
                          {!hasRpe && <div>示例数据，仅用于展示图表效果</div>}
                          <div>日期：{String(label).slice(5).replace('-', '/')}</div>
                          <div>全队平均 RPE：{value(row.averageRpe)}</div>
                          <div>标准差：{value(row.stdRpe)}</div>
                          <div>
                            波动范围：{value(row.rpeRange?.[0] ?? null)} -{' '}
                            {value(row.rpeRange?.[1] ?? null)}
                          </div>
                          <div>有效人数：{row.rpeCount}</div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="linear"
                    dataKey="rpeRange"
                    name="±1 标准差"
                    stroke="none"
                    fill="#b86447"
                    fillOpacity={0.18}
                    connectNulls={false}
                    isAnimationActive={false}
                    tooltipType="none"
                  />
                  <Line
                    type="linear"
                    dataKey="averageRpe"
                    name="全队平均 RPE"
                    stroke="#b86447"
                    strokeWidth={2.8}
                    dot={{
                      r: 3,
                      fill: '#fff',
                      stroke: '#b86447',
                      strokeWidth: 2,
                    }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

export function TrainingContentChart({ records }: { records: TrainingRecord[] }) {
  const data = useMemo(() => {
    const countByCategory = new Map(TRAINING_CONTENT_CATEGORIES.map((name) => [name, 0]));
    for (const row of records) {
      const category = trainingContentCategory(row);
      countByCategory.set(category, (countByCategory.get(category) || 0) + 1);
    }
    return TRAINING_CONTENT_CATEGORIES.map((name, index) => ({
      name,
      value: countByCategory.get(name) || 0,
      fill: colors[index % colors.length],
    }));
  }, [records]);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const chartData = total
    ? data.filter((row) => row.value > 0)
    : data.slice(0, 4).map((row, index) => ({ ...row, value: [42, 27, 19, 12][index] }));
  return (
    <div className="analysis-chart-module">
      <div className="analysis-chart-toolbar">
        <span className="analysis-caption">按当前页面时间范围统计；每条课次仅归入一个类别</span>
      </div>
      <div className="content-chart-layout training-ratio-layout">
        {!total && <span className="app-chart-example">示例数据</span>}
        <div className="content-pie training-ratio-pie">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{ value: 1 }]}
                dataKey="value"
                innerRadius={56}
                outerRadius={82}
                fill="#edf3f4"
                stroke="none"
              />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={57}
                outerRadius={78}
                paddingAngle={2}
                cornerRadius={5}
              >
                {chartData.map((row) => (
                  <Cell key={row.name} fill={row.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [
                  total ? `${formatNumber(Number(value))} 课 · ${percentage(Number(value), total)}%` : '示例数据，仅用于展示图表效果',
                  name,
                ]}
                contentStyle={{
                  border: '1px solid #d5e3e5',
                  borderRadius: 10,
                  boxShadow: '0 10px 24px rgba(9,54,65,.12)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div>
            <strong>{formatNumber(total)}</strong>
            <span>总课次</span>
          </div>
        </div>
        <div className="content-legend training-ratio-legend">
          {data.map((row) => (
            <div key={row.name}>
              <i style={{ background: row.fill }} />
              <span>{row.name}</span>
              <b>{formatNumber(row.value)}课</b>
              <strong>{percentage(row.value, total)}%</strong>
            </div>
          ))}
        </div>
      </div>
      {!total && <p className="analysis-empty-note">暂无真实训练课次 · 当前图表为示例效果</p>}
    </div>
  );
}

type IntensityDistribution = OverviewPayload['intensityDistribution'];
type TrainingLoadRatio = OverviewPayload['trainingLoadRatio'];

export function TrainingIntensityChart({ data }: { data: IntensityDistribution }) {
  const normalizedData = STRENGTH_INTENSITY_ZONES.map(
    (zone) =>
      data.find((row) => row.zone === zone) || {
        zone,
        durationMin: 0,
        sessionCount: 0,
        percentage: 0,
      }
  );
  const totalDuration = normalizedData.reduce((sum, row) => sum + row.durationMin, 0);
  const chartData = totalDuration
    ? normalizedData.filter((row) => row.durationMin > 0)
    : normalizedData.slice(0, 4).map((row, index) => ({ ...row, durationMin: [42, 27, 19, 12][index], percentage: [42, 27, 19, 12][index] }));
  return (
    <div className="analysis-chart-module">
      <div className="analysis-chart-toolbar">
        <span className="analysis-caption">
          按原始强度区间汇总训练时长；不根据桨频或乳酸重新推导
        </span>
      </div>
      <div className="content-chart-layout intensity-ratio-layout">
        {!totalDuration && <span className="app-chart-example">示例数据</span>}
        <div className="content-pie intensity-ratio-pie">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{ durationMin: 1 }]}
                dataKey="durationMin"
                innerRadius={56}
                outerRadius={82}
                fill="#edf3f4"
                stroke="none"
              />
              <Pie
                data={chartData}
                dataKey="durationMin"
                nameKey="zone"
                innerRadius={57}
                outerRadius={78}
                paddingAngle={2}
                cornerRadius={5}
              >
                {chartData.map((row, index) => (
                  <Cell key={row.zone} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const row = active
                    ? (payload?.[0]?.payload as IntensityDistribution[number] | undefined)
                    : undefined;
                  if (!row || !TRAINING_INTENSITY_META[row.zone]) return null;
                  if (!totalDuration) return <div className="intensity-tooltip">示例数据，仅用于展示图表效果</div>;
                  const meta = TRAINING_INTENSITY_META[row.zone];
                  return (
                    <div className="intensity-tooltip">
                      <strong>
                        {row.zone} · {meta.label}
                      </strong>
                      <span>训练量：{formatNumber(row.durationMin, 1)} 分钟</span>
                      <span>占比：{formatNumber(row.percentage, 1)}%</span>
                      <small>
                        桨频：{meta.strokeRate} · 血乳酸：{meta.lactate}
                      </small>
                      <em>{meta.purpose}</em>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div>
            <strong>{formatNumber(totalDuration / 60, 1)}</strong>
            <span>总小时</span>
          </div>
        </div>
        <div className="content-legend intensity-ratio-legend">
          {normalizedData.map((row, index) => {
            const meta = TRAINING_INTENSITY_META[row.zone];
            return (
              <div
                key={row.zone}
                title={`${meta.label}｜桨频：${meta.strokeRate}｜血乳酸：${meta.lactate}｜目的：${meta.purpose}`}
              >
                <i style={{ background: colors[index % colors.length] }} />
                <span>
                  <b>{row.zone}</b>
                  {meta.label}
                </span>
                <em>{formatNumber(row.durationMin, 1)} 分</em>
                <strong>{formatNumber(row.percentage, 1)}%</strong>
              </div>
            );
          })}
        </div>
      </div>
      {!totalDuration && <p className="analysis-empty-note">当前筛选条件下无有效训练强度数据</p>}
    </div>
  );
}

export function TrainingLoadEnergyChart({ data }: { data: TrainingLoadRatio }) {
  const [active, setActive] = useState<'special' | 'physical' | 'recovery' | null>(null);
  const hasLoad = data.totalLoad > 0;
  const segments = [
    {
      key: 'special' as const,
      label: '专项',
      load: data.specialLoad,
      percentage: data.specialPercentage,
    },
    {
      key: 'physical' as const,
      label: '体能',
      load: data.physicalLoad,
      percentage: data.physicalPercentage,
    },
    {
      key: 'recovery' as const,
      label: '恢复',
      load: data.recoveryLoad,
      percentage: data.recoveryPercentage,
    },
  ];
  const selected = segments.find((item) => item.key === active);
  return (
    <div className="analysis-chart-module training-load-energy-module">
      <div className="analysis-chart-toolbar">
        <span className="analysis-caption">按 SRPE 训练负荷汇总；仅统计已明确归类的训练记录</span>
        <span className="training-load-total">
          <b>有效总训练负荷</b>
          <strong>
            {formatNumber(data.totalLoad, 1)} <small>AU</small>
          </strong>
        </span>
      </div>
      <div
        className="training-load-energy-grid"
        aria-label={hasLoad ? `专项负荷 ${formatNumber(data.specialLoad)} AU，体能负荷 ${formatNumber(data.physicalLoad)} AU，恢复负荷 ${formatNumber(data.recoveryLoad)} AU` : '示例数据，仅用于展示图表效果'}
      >
        {!hasLoad && <span className="app-chart-example">示例数据</span>}
        {segments.map((item, index) => (
          <div
            key={item.key}
            tabIndex={0}
            className={`training-load-energy-column ${item.key}`}
            aria-label={hasLoad ? `${item.label}训练负荷 ${formatNumber(item.load, 1)} AU，占比 ${formatNumber(item.percentage, 1)}%` : `${item.label}示例图形，无真实负荷`}
            onMouseEnter={() => setActive(item.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(item.key)}
            onBlur={() => setActive(null)}
          >
            <span className="training-load-energy-label">{item.label}</span>
            <strong className="training-load-energy-percentage">
              {hasLoad ? formatNumber(item.percentage, 1) : '—'}
              <small>%</small>
            </strong>
            <span className="training-load-energy-tank" aria-hidden="true">
              <i
                style={{
                  height: `${hasLoad ? Math.max(0, Math.min(100, item.percentage)) : [50, 30, 20][index]}%`,
                }}
              />
            </span>
            <span className="training-load-energy-value">
              {formatNumber(item.load, 1)}
              <small>训练负荷 · AU</small>
            </span>
          </div>
        ))}
      </div>
      {selected && (
        <div className={`training-load-energy-tooltip ${selected.key}`}>
          {!hasLoad ? <span>示例数据，仅用于展示图表效果</span> : <>
          <strong>{selected.label}</strong>
          <span>训练负荷：{formatNumber(selected.load, 1)} AU</span>
          <span>占比：{formatNumber(selected.percentage, 1)}%</span>
          </>}
        </div>
      )}
      {!hasLoad && <p className="analysis-empty-note">暂无训练负荷数据</p>}
    </div>
  );
}

export function FmsTeamChart({ measurements }: { measurements: OverviewMeasurement[] }) {
  const keys = [
    'fms_deep_squat',
    'fms_hurdle_step',
    'fms_inline_lunge',
    'fms_shoulder_mobility',
    'fms_active_straight_leg_raise',
    'fms_trunk_stability_pushup',
    'fms_rotary_stability',
  ];
  const data = keys.map((key) => {
    const row = measurements.find((item) => item.code === key);
    const score = row?.value ?? null;
    return {
      name: row?.label || key,
      score,
      sampleCount: row?.sampleCount || 0,
    };
  });
  const available = data.filter((row) => row.score !== null);
  const isPlaceholder = available.length === 0;
  const chartData = isPlaceholder
    ? data.map((row, index) => ({ ...row, score: [1.6, 2.1, 1.8, 2.4, 2.0, 1.7, 2.2][index] }))
    : data;
  const complete = available.length === keys.length;
  const total = complete ? available.reduce((sum, row) => sum + Number(row.score), 0) : null;
  const achieved = available.filter((row) => Number(row.score) >= 2).length;
  const correction = available.filter((row) => Number(row.score) < 2);
  const sampleCount = Math.max(0, ...available.map((row) => row.sampleCount));
  return (
    <div className="fms-analysis-layout">
      <div className="analysis-chart-medium fms-team-chart">
        {isPlaceholder && <span className="app-chart-example">示例数据</span>}
        <div className="fms-team-legend">
          <span>
            <i />
            本次队均
          </span>
          <span>
            <i />
            动作达标线 2分
          </span>
        </div>
        <div className="fms-team-plot">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              barCategoryGap="14%"
              margin={{ top: 2, right: 26, left: 22, bottom: 0 }}
            >
              <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 3]}
                ticks={[0, 1, 2, 3]}
                tick={{ fontSize: 9 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={96}
                tick={{ fontSize: 9, fill: '#4d666e' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value, name, entry) => [
                  isPlaceholder ? '示例数据，仅用于展示图表效果' : `${formatNumber(Number(value), 1)} 分 · n=${entry.payload.sampleCount}`,
                  name,
                ]}
              />
              {!isPlaceholder && <ReferenceLine x={2} stroke="#d89222" strokeWidth={1.6} strokeDasharray="4 3" />}
              <Bar dataKey="score" name="本次队均" fill="#178e87" radius={[0, 5, 5, 0]}>
                {chartData.map((row) => (
                  <Cell
                    key={row.name}
                    fill={
                      isPlaceholder ? '#b7d3d0' : row.score === null
                        ? '#dce6e8'
                        : row.score < 2
                          ? '#df634d'
                          : row.score < 2.5
                            ? '#e1a12c'
                            : '#178e87'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <aside className="fms-summary">
        <strong>
          {total === null ? '—' : formatNumber(total, 1)}
          <small>/21</small>
        </strong>
        <span>七项综合队均</span>
        <div className="fms-summary-grid">
          <p>
            <b>{isPlaceholder ? '—' : achieved}</b>
            <small>达标项目</small>
          </p>
          <p>
            <b>{isPlaceholder ? '—' : correction.length}</b>
            <small>待纠正项目</small>
          </p>
          <p>
            <b>{isPlaceholder ? '—' : `${available.length}/7`}</b>
            <small>有效项目</small>
          </p>
        </div>
        <em>最近一次团队测试 · {sampleCount ? `最多 ${sampleCount} 人/项` : '暂无有效样本'}</em>
        <p>
          {correction.length
            ? `优先复核：${correction.map((row) => row.name).join('、')}。结合左右侧最低分安排纠正训练。`
            : complete
              ? '七个动作队均均达到2分，仍需继续关注个体低分和左右不对称。'
              : '测试项目不完整，补齐七项后再生成综合分。'}
        </p>
      </aside>
    </div>
  );
}

export function FmsPersonalChart({ measurements }: { measurements: OverviewMeasurement[] }) {
  const keys = [
    'fms_deep_squat',
    'fms_hurdle_step',
    'fms_inline_lunge',
    'fms_shoulder_mobility',
    'fms_active_straight_leg_raise',
    'fms_trunk_stability_pushup',
    'fms_rotary_stability',
  ];
  const labels: Record<string, string> = {
    fms_deep_squat: '深蹲',
    fms_hurdle_step: '跨栏步',
    fms_inline_lunge: '弓箭步',
    fms_shoulder_mobility: '肩灵活',
    fms_active_straight_leg_raise: '直腿抬高',
    fms_trunk_stability_pushup: '躯干俯卧撑',
    fms_rotary_stability: '旋转稳定',
  };
  const data = keys.map((key, index) => {
    const row = measurements.find((item) => item.code === key);
    const score = row?.value ?? null;
    const target = row?.target ?? 2;
    return {
      name: labels[key] || row?.label || key,
      score,
      target,
      gap: score === null ? null : score - target,
      fill: colors[index % colors.length],
    };
  });
  const available = data.filter((row) => typeof row.score === 'number');
  const isPlaceholder = available.length === 0;
  const chartData = isPlaceholder
    ? data.map((row, index) => ({ ...row, score: [1.8, 2.1, 1.9, 2.3, 2.0, 1.7, 2.2][index] }))
    : data;
  const total = available.length ? available.reduce((sum, row) => sum + (row.score || 0), 0) : null;
  const weakest = [...available]
    .sort((left, right) => (left.gap || 0) - (right.gap || 0))
    .slice(0, 2);
  const lowScoreCount = available.filter((row) => (row.score ?? 0) < 2).length;

  const status =
    total === null
      ? { label: '待评估', className: 'pending' }
      : lowScoreCount >= 2
        ? { label: '优先纠正', className: 'attention' }
        : lowScoreCount === 1 || total < 14
          ? { label: '需关注', className: 'watch' }
          : { label: '整体良好', className: 'good' };
  return (
    <div className="fms-personal-layout">
      <div className="fms-personal-chart">
        {isPlaceholder && <span className="app-chart-example">示例数据</span>}
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={chartData}
            outerRadius="72%"
            margin={{ top: 28, right: 42, bottom: 28, left: 42 }}
          >
            <PolarGrid stroke="#d9e5e7" strokeWidth={1} />

            <PolarAngleAxis
              dataKey="name"
              tick={{
                fontSize: 11,
                fill: '#36545d',
                fontWeight: 600,
              }}
            />

            <PolarRadiusAxis
              domain={[0, 3]}
              tickCount={4}
              axisLine={false}
              tick={{
                fontSize: 9,
                fill: '#8aa0a6',
              }}
            />

            <Tooltip formatter={(value, name) => [isPlaceholder ? '示例数据，仅用于展示图表效果' : `${formatNumber(Number(value), 1)} 分`, name]} />

            <Radar
              dataKey="score"
              name="个人得分"
              stroke="#178e87"
              strokeWidth={2.4}
              fill="#178e87"
              fillOpacity={0.18}
              dot={{
                r: 3.5,
                fill: '#ffffff',
                stroke: '#178e87',
                strokeWidth: 2,
              }}
            />
          </RadarChart>
        </ResponsiveContainer>

        <div className="fms-radar-center">
          <span>FMS</span>
          <strong>{total === null ? '—' : formatNumber(total, 1)}</strong>
        </div>
      </div>
      <aside className="fms-personal-summary">
        <article>
          <div className="fms-summary-top">
            <span>综合评分</span>

            <i className={`fms-status ${status.className}`}>{status.label}</i>
          </div>

          <strong>
            {total === null ? '—' : formatNumber(total, 1)}
            <small>/21</small>
          </strong>

          <em>已完成 {available.length}/7 项筛查</em>
        </article>

        <div>
          {weakest.length ? (
            weakest.map((row) => (
              <p key={row.name}>
                <b>{row.name}</b>
                <span>
                  {(row.score || 0) >= 2
                    ? '动作质量达标'
                    : `${formatNumber(row.score || 0, 1)} 分，建议优先纠正`}
                </span>
              </p>
            ))
          ) : (
            <p>
              <b>暂无测试</b>
              <span>录入标准FMS七项后生成动作短板</span>
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

export function InjuryAssessmentChart({
  injuries,
  athleteCount,
}: {
  injuries: OverviewPayload['injuries'];
  athleteCount: number;
}) {
  const meta = [
    { key: 'healthy', name: '健康', fill: '#27a596' },
    { key: 'observation', name: '观察', fill: '#e5a72e' },
    { key: 'restricted', name: '受限', fill: '#e67c49' },
    { key: 'rehab', name: '康复', fill: '#8b6eb0' },
    { key: 'suspended', name: '停训', fill: '#d84f4f' },
  ];
  const data = meta.map((item) => ({
    ...item,
    value: injuries.filter((row) => row.status === item.key).length,
  }));
  const recorded = injuries.length;
  if (athleteCount > recorded) data[0].value += athleteCount - recorded;
  const focus = injuries.filter((row) => row.status !== 'healthy').slice(0, 4);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const chartData = total
    ? data.filter((row) => row.value > 0)
    : [{ name: '暂无伤病记录', value: 1, fill: '#dce7e9' }];
  return (
    <div className="analysis-chart-module injury-analysis-module">
      <div className="analysis-chart-toolbar">
        <span className="analysis-caption">按每名运动员最新伤病记录统计；未录入者计入健康</span>
      </div>
      <div className="content-chart-layout training-ratio-layout injury-ratio-layout">
        <div className="content-pie training-ratio-pie">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{ value: 1 }]}
                dataKey="value"
                innerRadius={56}
                outerRadius={82}
                fill="#edf3f4"
                stroke="none"
              />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={57}
                outerRadius={78}
                paddingAngle={total ? 2 : 0}
                cornerRadius={5}
              >
                {chartData.map((row) => (
                  <Cell key={row.name} fill={row.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [
                  `${formatNumber(Number(value))} 人 · ${percentage(Number(value), total)}%`,
                  name,
                ]}
                contentStyle={{
                  border: '1px solid #d5e3e5',
                  borderRadius: 10,
                  boxShadow: '0 10px 24px rgba(9,54,65,.12)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div>
            <strong>{formatNumber(focus.length)}</strong>
            <span>重点关注</span>
          </div>
        </div>
        <div className="content-legend training-ratio-legend">
          {data.map((row) => (
            <div key={row.key}>
              <i style={{ background: row.fill }} />
              <span>{row.name}</span>
              <b>{formatNumber(row.value)}人</b>
              <strong>{percentage(row.value, total)}%</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="injury-focus-list injury-focus-list-inline">
        {focus.length ? (
          focus.map((row) => (
            <div key={row.athleteId}>
              <span>
                <strong>{row.athleteName}</strong>
                <small>
                  {row.bodyPart} · {row.injuryName}
                </small>
              </span>
              <b>{row.painScore}/10</b>
            </div>
          ))
        ) : (
          <p>当前无活动性损伤记录</p>
        )}
      </div>
      {!total && <p className="analysis-empty-note">当前筛选范围内暂无运动员数据</p>}
    </div>
  );
}
