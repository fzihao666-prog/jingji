import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import type { OverviewMeasurement, OverviewPayload, TrainingRecord } from '../types';
import { formatNumber, percentage, startOfWeek } from '../utils';
import { TRAINING_CONTENT_CATEGORIES, trainingContentCategory, trainingLoadCategory as classifyTrainingLoad } from '../../shared/training-content-category';
import { STRENGTH_INTENSITY_ZONES, TRAINING_INTENSITY_META } from '../../shared/strength-training';

const colors = ['#0b7f7a', '#25aa9d', '#73c5ab', '#edaa32', '#df634d', '#66758a', '#8b6eb0', '#3d7db7', '#9a7f66'];

export const trainingLoadCategory = classifyTrainingLoad;

type TrainingVolume = OverviewPayload['trainingVolume'];

type TrendGranularity = 'auto' | 'day' | 'week' | 'month';

export function TrainingVolumeChart({ data, from, to }: { data: TrainingVolume; from: string; to: string }) {
  const [granularity, setGranularity] = useState<TrendGranularity>('auto');
  const [chartWidth, setChartWidth] = useState(0);
  const rangeDays = Math.max(1, Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1);
  const effectiveGranularity = granularity === 'auto' ? (rangeDays <= 31 ? 'day' : rangeDays <= 120 ? 'week' : 'month') : granularity;
  const chartData = useMemo(() => {
    const rows = new Map<string, { date: string; durationMin: number; distanceKm: number; durationCount: number; distanceCount: number }>();
    for (const row of data.days) {
      const date = effectiveGranularity === 'day' ? row.date : effectiveGranularity === 'week' ? startOfWeek(row.date) : `${row.date.slice(0, 7)}-01`;
      const target = rows.get(date) || { date, durationMin: 0, distanceKm: 0, durationCount: 0, distanceCount: 0 };
      if (row.durationMin !== null) { target.durationMin += row.durationMin; target.durationCount += 1; }
      if (row.distanceKm !== null) { target.distanceKm += row.distanceKm; target.distanceCount += 1; }
      rows.set(date, target);
    }
    return [...rows.values()].map((row) => ({ ...row, label: effectiveGranularity === 'month' ? row.date.slice(0, 7).replace('-', '/') : row.date.slice(5).replace('-', '/'), durationMin: row.durationCount ? row.durationMin : null, distanceKm: row.distanceCount ? row.distanceKm : null }));
  }, [data.days, effectiveGranularity]);
  const xAxisTicks = useMemo(() => {
    const labels = chartData.map((row) => row.label);
    const maxTicks = chartWidth > 0 ? Math.max(2, Math.floor(chartWidth / 50)) : 7;
    if (labels.length <= maxTicks) return labels;
    const step = Math.ceil((labels.length - 1) / (maxTicks - 1));
    return labels.filter((_, index) => index === 0 || index === labels.length - 1 || index % step === 0);
  }, [chartData, chartWidth]);
  const value = (number: number | null, digits = 1) => number === null ? '—' : formatNumber(number, digits);
  const hasData = data.totalDurationMin !== null || data.totalDistanceKm !== null;
  return <div className="analysis-chart-module training-volume-module">
    <div className="analysis-chart-toolbar"><span className="analysis-caption">按日期累计训练时长与公里数；空白数据不按 0 处理</span><label className="analysis-granularity">粒度<select aria-label="训练量趋势粒度" value={granularity} onChange={(event) => setGranularity(event.target.value as TrendGranularity)}><option value="auto">自动（{effectiveGranularity === 'day' ? '按天' : effectiveGranularity === 'week' ? '按周' : '按月'}）</option><option value="day">按天</option><option value="week">按周</option><option value="month">按月</option></select></label></div>
    <div className="training-volume-kpis">
      <article><span>累计训练时长</span><strong>{data.totalDurationMin === null ? '—' : value(data.totalDurationMin / 60)}<small>{data.totalDurationMin === null ? '' : ' h'}</small></strong></article>
      <article><span>累计公里数</span><strong>{value(data.totalDistanceKm)}<small>{data.totalDistanceKm === null ? '' : ' km'}</small></strong></article>
      <article><span>日均训练时长</span><strong>{data.averageDurationMin === null ? '—' : value(data.averageDurationMin / 60)}<small>{data.averageDurationMin === null ? '' : ' h'}</small><em>{data.durationDayCount ? `${data.durationDayCount} 个有效训练日` : ''}</em></strong></article>
      <article><span>日均公里数</span><strong>{value(data.averageDistanceKm)}<small>{data.averageDistanceKm === null ? '' : ' km'}</small><em>{data.distanceDayCount ? `${data.distanceDayCount} 个有效训练日` : ''}</em></strong></article>
    </div>
    <div className="analysis-chart-medium"><ResponsiveContainer width="100%" height="100%" onResize={(width) => setChartWidth((current) => current === width ? current : width)}><ComposedChart data={chartData} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
      <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" ticks={xAxisTicks} interval={0} tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="time" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="distance" orientation="right" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/>
      <Tooltip formatter={(number, name) => [`${formatNumber(Number(number), name === '公里数' ? 1 : 0)} ${name === '公里数' ? 'km' : 'min'}`, name]} contentStyle={{border:'1px solid #d5e3e5',borderRadius:10,boxShadow:'0 10px 24px rgba(9,54,65,.12)'}}/><Legend wrapperStyle={{fontSize:10}}/>
      <Bar yAxisId="time" dataKey="durationMin" name="训练时长" fill="#69aebb" fillOpacity={.86} radius={[5,5,0,0]} maxBarSize={30}/>
      <Line yAxisId="distance" type="monotone" dataKey="distanceKm" name="公里数" stroke="#0b4d59" strokeWidth={3} dot={{r:3,fill:'#fff',stroke:'#0b4d59',strokeWidth:2}} activeDot={{r:5,fill:'#18a092',stroke:'#fff',strokeWidth:2}} />
    </ComposedChart></ResponsiveContainer></div>
    {!hasData && <p className="analysis-empty-note">暂无训练量数据</p>}
  </div>;
}

type TrainingAnalytics = OverviewPayload['trainingAnalytics'];
type PhysiologyHeatmap = OverviewPayload['physiologyHeatmap'];
const chartTooltipStyle = { border: '1px solid #d5e3e5', borderRadius: 10, boxShadow: '0 10px 24px rgba(9,54,65,.12)', fontSize: 10 };

function TrainingAnalyticsEmpty({ text }: { text: string }) {
  return <p className="analysis-empty-note training-analytics-empty">{text}</p>;
}

const physiologyStatusMeta = {
  NORMAL: { label: '正常', color: '#7cb9a9' },
  FLUCTUATION: { label: '波动', color: '#d8ad59' },
  ATTENTION: { label: '关注', color: '#d47d4f' },
  ABNORMAL: { label: '异常', color: '#b74e4e' },
  MISSING: { label: '未监测', color: '#e7edef' }
} as const;

function PhysiologyBiochemistryHeatmap({ data }: { data: PhysiologyHeatmap }) {
  const [range, setRange] = useState<7 | 14 | 30>(7);
  const [active, setActive] = useState<{ metricIndex: number; dayIndex: number } | null>(null);
  const days = data.metrics[0]?.days.slice(-range) || [];
  const cell = active ? data.metrics[active.metricIndex]?.days.slice(-range)[active.dayIndex] : null;
  const metric = active ? data.metrics[active.metricIndex] : null;
  return <div className="physiology-heatmap">
    <div className="physiology-heatmap-toolbar"><span>团队状态趋势</span><label>周期<select value={range} onChange={(event) => setRange(Number(event.target.value) as 7 | 14 | 30)}><option value={7}>近7天</option><option value={14}>近14天</option><option value={30}>近30天</option></select></label></div>
    {data.metrics.length ? <div className="physiology-heatmap-table" style={{ '--physiology-days': days.length } as CSSProperties}>
      <div className="physiology-heatmap-head"><span>指标</span>{days.map((day) => <span key={day.date}>{day.date.slice(5).replace('-', '/')}</span>)}</div>
      {data.metrics.map((item, metricIndex) => <div className="physiology-heatmap-row" key={item.code}><span>{item.label}</span>{item.days.slice(-range).map((itemDay, dayIndex) => <button key={itemDay.date} type="button" className={`physiology-cell ${itemDay.status.toLowerCase()}`} aria-label={`${item.label} ${itemDay.date} ${physiologyStatusMeta[itemDay.status].label}`} onMouseEnter={() => setActive({ metricIndex, dayIndex })} onFocus={() => setActive({ metricIndex, dayIndex })} onClick={() => setActive({ metricIndex, dayIndex })}><i /></button>)}</div>)}
    </div> : <TrainingAnalyticsEmpty text="暂无生理生化数据" />}
    <div className="physiology-heatmap-legend">{Object.entries(physiologyStatusMeta).slice(0, 4).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
    {cell && metric && <div className="physiology-heatmap-detail"><strong>{metric.label} · {cell.date}</strong><span>{cell.isEstimated ? 'V1 模拟状态（等待实测导入）' : `团队中位数：${formatNumber(cell.median || 0, 1)} ${metric.unit}`} · 监测人数：{cell.sampleCount} 人</span><span>正常 {cell.normal} · 波动 {cell.fluctuation} · 关注 {cell.attention} · 异常 {cell.abnormal}{cell.abnormalRateChange === null ? '' : ` · 较前日异常率 ${cell.abnormalRateChange >= 0 ? '↑' : '↓'} ${formatNumber(Math.abs(cell.abnormalRateChange), 1)}%`}</span></div>}
  </div>;
}

export function TrainingVolumeDashboard({ data, physiology }: { data: TrainingAnalytics; physiology: PhysiologyHeatmap }) {
  const { summary, days } = data;
  const value = (number: number | null, digits = 1) => number === null ? '—' : formatNumber(number, digits);
  const physicalDays = days.filter((row) => row.physicalDurationMin !== null || row.physicalLoad !== null);
  const specialDays = days.filter((row) => row.specialDurationMin !== null || row.specialDistanceKm !== null);
  const rpeDays = days.filter((row) => row.averageRpe !== null);
  return <div className="training-analytics-dashboard">
    <section className="training-analytics-summary" aria-label="训练量统计核心摘要">
      <article><span>累计训练量</span><strong>{value(summary.totalDurationMin === null ? null : summary.totalDurationMin / 60)}<small>{summary.totalDurationMin === null ? '' : ' h'}</small></strong><em>训练时长</em></article>
      <article><span>测试</span><strong>{formatNumber(summary.testSessionCount)}<small> 场</small></strong><em>{summary.testedAthleteCount ? `${summary.testedAthleteCount} 人参与` : '当前周期无测试'}</em></article>
      <article><span>恢复</span><strong>{value(summary.recoveryDurationMin === null ? null : summary.recoveryDurationMin / 60)}<small>{summary.recoveryDurationMin === null ? '' : ' h'}</small></strong><em>恢复训练时长</em></article>
      <article><span>专项</span><div className="training-analytics-double-metric"><div><strong>{value(summary.specialDurationMin === null ? null : summary.specialDurationMin / 60)}<small>{summary.specialDurationMin === null ? '' : ' h'}</small></strong><em>时长</em></div><div><strong>{value(summary.specialDistanceKm)}<small>{summary.specialDistanceKm === null ? '' : ' km'}</small></strong><em>公里数</em></div></div></article>
      <article><span>体能</span><div className="training-analytics-double-metric"><div><strong>{value(summary.physicalDurationMin === null ? null : summary.physicalDurationMin / 60)}<small>{summary.physicalDurationMin === null ? '' : ' h'}</small></strong><em>时长</em></div><div><strong>{value(summary.physicalLoad)}<small>{summary.physicalLoad === null ? '' : ' AU'}</small></strong><em>负荷</em></div></div></article>
    </section>
    <section className="training-analytics-grid" aria-label="训练量统计分析图表">
      <article className="training-analytics-chart"><header><div><span>PHYSICAL TRAINING</span><h3>体能训练量</h3></div><small>时长 · 负荷</small></header><div className="training-analytics-canvas">{physicalDays.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={physicalDays} margin={{ top: 12, right: 10, left: -12, bottom: 0 }}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tickFormatter={(date) => String(date).slice(5).replace('-', '/')} tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="duration" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="load" orientation="right" tick={{ fontSize: 9, fill: '#b87822' }} axisLine={false} tickLine={false}/><Tooltip labelFormatter={(date) => String(date)} formatter={(number, name) => [`${formatNumber(Number(number), 1)} ${name === '训练负荷' ? 'AU' : 'min'}`, name]} contentStyle={chartTooltipStyle}/><Bar yAxisId="duration" dataKey="physicalDurationMin" name="训练时长" fill="#64aeb3" radius={[4, 4, 0, 0]} maxBarSize={28}/><Line yAxisId="load" type="monotone" dataKey="physicalLoad" name="训练负荷" stroke="#d59125" strokeWidth={2.4} dot={{ r: 2.5, fill: '#fff', stroke: '#d59125', strokeWidth: 2 }}/></ComposedChart></ResponsiveContainer> : <TrainingAnalyticsEmpty text="暂无体能训练量数据" />}</div></article>
      <article className="training-analytics-chart"><header><div><span>SPECIAL TRAINING</span><h3>专项训练量</h3></div><small>时长 · 距离</small></header><div className="training-analytics-canvas">{specialDays.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={specialDays} margin={{ top: 12, right: 10, left: -12, bottom: 0 }}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tickFormatter={(date) => String(date).slice(5).replace('-', '/')} tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="duration" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="distance" orientation="right" tick={{ fontSize: 9, fill: '#14746f' }} axisLine={false} tickLine={false}/><Tooltip labelFormatter={(date) => String(date)} formatter={(number, name) => [`${formatNumber(Number(number), 1)} ${name === '专项距离' ? 'km' : 'min'}`, name]} contentStyle={chartTooltipStyle}/><Bar yAxisId="duration" dataKey="specialDurationMin" name="专项时长" fill="#178e87" radius={[4, 4, 0, 0]} maxBarSize={28}/><Line yAxisId="distance" type="monotone" dataKey="specialDistanceKm" name="专项距离" stroke="#0b4d59" strokeWidth={2.4} dot={{ r: 2.5, fill: '#fff', stroke: '#0b4d59', strokeWidth: 2 }}/></ComposedChart></ResponsiveContainer> : <TrainingAnalyticsEmpty text="暂无专项训练量数据" />}</div></article>
      <article className="training-analytics-chart physiology-heatmap-card"><header><div><span>PHYSIOLOGY & BIOCHEMISTRY</span><h3>生理生化</h3></div><small>团队风险状态热力图</small></header><PhysiologyBiochemistryHeatmap data={physiology} /></article>
      <article className="training-analytics-chart training-analytics-rpe"><header><div><span>SUBJECTIVE EXERTION</span><h3>RPE</h3></div><div className="training-analytics-rpe-stats" aria-label="当前筛选范围内的RPE统计"><span>平均<b>{value(summary.rpeAverage)}<small>分</small></b></span><span>最高<b>{value(summary.rpeHighest)}<small>分</small></b></span><span>最低<b>{value(summary.rpeLowest)}<small>分</small></b></span></div></header><div className="training-analytics-canvas">{rpeDays.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rpeDays} margin={{ top: 12, right: 10, left: -12, bottom: 0 }}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tickFormatter={(date) => String(date).slice(5).replace('-', '/')} tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><Tooltip labelFormatter={(date) => String(date)} formatter={(number) => [`${formatNumber(Number(number), 1)} 分`, '平均 RPE']} contentStyle={chartTooltipStyle}/><ReferenceLine y={7} stroke="#d59125" strokeDasharray="4 3"/><Line type="monotone" dataKey="averageRpe" name="平均 RPE" stroke="#b86447" strokeWidth={2.8} dot={{ r: 3, fill: '#fff', stroke: '#b86447', strokeWidth: 2 }} activeDot={{ r: 5 }}/></ComposedChart></ResponsiveContainer> : <TrainingAnalyticsEmpty text="暂无 RPE 数据" />}</div></article>
    </section>
  </div>;
}

export function TrainingContentChart({ records }: { records: TrainingRecord[] }) {
  const data = useMemo(() => {
    const countByCategory = new Map(TRAINING_CONTENT_CATEGORIES.map((name) => [name, 0]));
    for (const row of records) {
      const category = trainingContentCategory(row);
      countByCategory.set(category, (countByCategory.get(category) || 0) + 1);
    }
    return TRAINING_CONTENT_CATEGORIES.map((name, index) => ({ name, value: countByCategory.get(name) || 0, fill: colors[index % colors.length] }));
  }, [records]);
  const total = data.reduce((sum,row)=>sum+row.value,0);
  const chartData = total ? data.filter((row) => row.value > 0) : [{ name: '暂无训练课次', value: 1, fill: '#dce7e9' }];
  return <div className="analysis-chart-module"><div className="analysis-chart-toolbar"><span className="analysis-caption">按当前页面时间范围统计；每条课次仅归入一个类别</span></div><div className="content-chart-layout training-ratio-layout"><div className="content-pie training-ratio-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ value: 1 }]} dataKey="value" innerRadius={56} outerRadius={82} fill="#edf3f4" stroke="none"/><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={57} outerRadius={78} paddingAngle={total ? 2 : 0} cornerRadius={5}>{chartData.map(row=><Cell key={row.name} fill={row.fill}/>)}</Pie><Tooltip formatter={(value,name)=>[`${formatNumber(Number(value))} 课 · ${percentage(Number(value), total)}%`,name]} contentStyle={{border:'1px solid #d5e3e5',borderRadius:10,boxShadow:'0 10px 24px rgba(9,54,65,.12)'}}/></PieChart></ResponsiveContainer><div><strong>{formatNumber(total)}</strong><span>总课次</span></div></div><div className="content-legend training-ratio-legend">{data.map(row=><div key={row.name}><i style={{background:row.fill}}/><span>{row.name}</span><b>{formatNumber(row.value)}课</b><strong>{percentage(row.value,total)}%</strong></div>)}</div></div>{!total && <p className="analysis-empty-note">当前筛选条件下无训练记录</p>}</div>;
}

type IntensityDistribution = OverviewPayload['intensityDistribution'];
type TrainingLoadRatio = OverviewPayload['trainingLoadRatio'];

export function TrainingIntensityChart({ data }: { data: IntensityDistribution }) {
  const normalizedData = STRENGTH_INTENSITY_ZONES.map((zone) => data.find((row) => row.zone === zone) || ({ zone, durationMin: 0, sessionCount: 0, percentage: 0 }));
  const totalDuration = normalizedData.reduce((sum, row) => sum + row.durationMin, 0);
  const chartData = totalDuration ? normalizedData.filter((row) => row.durationMin > 0) : [{ zone: '暂无训练强度数据', durationMin: 1, sessionCount: 0, percentage: 0 }];
  return <div className="analysis-chart-module">
    <div className="analysis-chart-toolbar"><span className="analysis-caption">按原始强度区间汇总训练时长；不根据桨频或乳酸重新推导</span></div>
    <div className="content-chart-layout intensity-ratio-layout">
      <div className="content-pie intensity-ratio-pie">
        <ResponsiveContainer width="100%" height="100%"><PieChart>
          <Pie data={[{ durationMin: 1 }]} dataKey="durationMin" innerRadius={56} outerRadius={82} fill="#edf3f4" stroke="none" />
          <Pie data={chartData} dataKey="durationMin" nameKey="zone" innerRadius={57} outerRadius={78} paddingAngle={totalDuration ? 2 : 0} cornerRadius={5}>
            {chartData.map((row, index) => <Cell key={row.zone} fill={colors[index % colors.length]} />)}
          </Pie>
          <Tooltip content={({ active, payload }) => {
            const row = active ? payload?.[0]?.payload as IntensityDistribution[number] | undefined : undefined;
            if (!row || !TRAINING_INTENSITY_META[row.zone]) return null;
            const meta = TRAINING_INTENSITY_META[row.zone];
            return <div className="intensity-tooltip"><strong>{row.zone} · {meta.label}</strong><span>训练量：{formatNumber(row.durationMin, 1)} 分钟</span><span>占比：{formatNumber(row.percentage, 1)}%</span><small>桨频：{meta.strokeRate} · 血乳酸：{meta.lactate}</small><em>{meta.purpose}</em></div>;
          }} />
        </PieChart></ResponsiveContainer>
        <div><strong>{formatNumber(totalDuration / 60, 1)}</strong><span>总小时</span></div>
      </div>
      <div className="content-legend intensity-ratio-legend">{normalizedData.map((row, index) => {
        const meta = TRAINING_INTENSITY_META[row.zone];
        return <div key={row.zone} title={`${meta.label}｜桨频：${meta.strokeRate}｜血乳酸：${meta.lactate}｜目的：${meta.purpose}`}><i style={{ background: colors[index % colors.length] }} /><span><b>{row.zone}</b>{meta.label}</span><em>{formatNumber(row.durationMin, 1)} 分</em><strong>{formatNumber(row.percentage, 1)}%</strong></div>;
      })}</div>
    </div>
    {!totalDuration && <p className="analysis-empty-note">当前筛选条件下无有效训练强度数据</p>}
  </div>;
}

export function TrainingLoadEnergyChart({ data }: { data: TrainingLoadRatio }) {
  const [active, setActive] = useState<'special' | 'physical' | 'recovery' | null>(null);
  const hasLoad = data.totalLoad > 0;
  const segments = [
    { key: 'special' as const, label: '专项', load: data.specialLoad, percentage: data.specialPercentage },
    { key: 'physical' as const, label: '体能', load: data.physicalLoad, percentage: data.physicalPercentage },
    { key: 'recovery' as const, label: '恢复', load: data.recoveryLoad, percentage: data.recoveryPercentage }
  ];
  const selected = segments.find((item) => item.key === active);
  return <div className="analysis-chart-module training-load-energy-module">
    <div className="analysis-chart-toolbar"><span className="analysis-caption">按 SRPE 训练负荷汇总；仅统计已明确归类的训练记录</span><span className="training-load-total"><b>有效总训练负荷</b><strong>{formatNumber(data.totalLoad, 1)} <small>AU</small></strong></span></div>
    <div className="training-load-energy-grid" aria-label={`专项负荷 ${formatNumber(data.specialLoad)} AU，体能负荷 ${formatNumber(data.physicalLoad)} AU，恢复负荷 ${formatNumber(data.recoveryLoad)} AU`}>
      {segments.map((item) => <div
        key={item.key}
        tabIndex={0}
        className={`training-load-energy-column ${item.key}`}
        aria-label={`${item.label}训练负荷 ${formatNumber(item.load, 1)} AU，占比 ${formatNumber(item.percentage, 1)}%`}
        onMouseEnter={() => setActive(item.key)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive(item.key)}
        onBlur={() => setActive(null)}
      >
        <span className="training-load-energy-label">{item.label}</span>
        <strong className="training-load-energy-percentage">{formatNumber(item.percentage, 1)}<small>%</small></strong>
        <span className="training-load-energy-tank" aria-hidden="true"><i style={{ height: `${Math.max(0, Math.min(100, item.percentage))}%` }} /></span>
        <span className="training-load-energy-value">{formatNumber(item.load, 1)}<small>训练负荷 · AU</small></span>
      </div>)}
    </div>
    {selected && <div className={`training-load-energy-tooltip ${selected.key}`}><strong>{selected.label}</strong><span>训练负荷：{formatNumber(selected.load, 1)} AU</span><span>占比：{formatNumber(selected.percentage, 1)}%</span></div>}
    {!hasLoad && <p className="analysis-empty-note">暂无训练负荷数据</p>}
  </div>;
}

export function FmsTeamChart({ measurements }: { measurements: OverviewMeasurement[] }) {
  const keys = ['fms_deep_squat','fms_hurdle_step','fms_inline_lunge','fms_shoulder_mobility','fms_active_straight_leg_raise','fms_trunk_stability_pushup','fms_rotary_stability'];
  const data = keys.map((key) => {
    const row = measurements.find((item) => item.code === key);
    const score = row?.value ?? null;
    return { name: row?.label || key, score, sampleCount: row?.sampleCount || 0 };
  });
  const available = data.filter((row) => row.score !== null);
  const complete = available.length === keys.length;
  const total = complete ? available.reduce((sum, row) => sum + Number(row.score), 0) : null;
  const achieved = available.filter((row) => Number(row.score) >= 2).length;
  const correction = available.filter((row) => Number(row.score) < 2);
  const sampleCount = Math.max(0, ...available.map((row) => row.sampleCount));
  return <div className="fms-analysis-layout"><div className="analysis-chart-medium fms-team-chart"><div className="fms-team-legend"><span><i/>本次队均</span><span><i/>动作达标线 2分</span></div><div className="fms-team-plot"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" barCategoryGap="14%" margin={{top:2,right:26,left:22,bottom:0}}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" horizontal={false}/><XAxis type="number" domain={[0,3]} ticks={[0,1,2,3]} tick={{fontSize:9}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={96} tick={{fontSize:9,fill:'#4d666e'}} axisLine={false} tickLine={false}/><Tooltip formatter={(value,name,entry)=>[`${formatNumber(Number(value),1)} 分 · n=${entry.payload.sampleCount}`,name]}/><ReferenceLine x={2} stroke="#d89222" strokeWidth={1.6} strokeDasharray="4 3"/><Bar dataKey="score" name="本次队均" fill="#178e87" radius={[0,5,5,0]}>{data.map((row)=><Cell key={row.name} fill={row.score === null ? '#dce6e8' : row.score < 2 ? '#df634d' : row.score < 2.5 ? '#e1a12c' : '#178e87'}/>)}</Bar></BarChart></ResponsiveContainer></div></div><aside className="fms-summary"><strong>{total === null ? '—' : formatNumber(total,1)}<small>/21</small></strong><span>七项综合队均</span><div className="fms-summary-grid"><p><b>{achieved}</b><small>达标项目</small></p><p><b>{correction.length}</b><small>待纠正项目</small></p><p><b>{available.length}/7</b><small>有效项目</small></p></div><em>最近一次团队测试 · {sampleCount ? `最多 ${sampleCount} 人/项` : '暂无有效样本'}</em><p>{correction.length ? `优先复核：${correction.map((row)=>row.name).join('、')}。结合左右侧最低分安排纠正训练。` : complete ? '七个动作队均均达到2分，仍需继续关注个体低分和左右不对称。' : '测试项目不完整，补齐七项后再生成综合分。'}</p></aside></div>;
}

export function FmsPersonalChart({ measurements }: { measurements: OverviewMeasurement[] }) {
  const keys = ['fms_deep_squat','fms_hurdle_step','fms_inline_lunge','fms_shoulder_mobility','fms_active_straight_leg_raise','fms_trunk_stability_pushup','fms_rotary_stability'];
  const data = keys.map((key, index) => {
    const row = measurements.find((item) => item.code === key);
    const score = row?.value ?? null;
    const target = row?.target ?? 2;
    return { name: row?.label || key, score, target, gap: score === null ? null : score - target, fill: colors[index % colors.length] };
  });
  const available = data.filter((row) => typeof row.score === 'number');
  const total = available.length ? available.reduce((sum, row) => sum + (row.score || 0), 0) : null;
  const weakest = [...available].sort((left, right) => (left.gap || 0) - (right.gap || 0)).slice(0, 2);
  return <div className="fms-personal-layout">
    <div className="fms-personal-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 6, right: 18, left: 18, bottom: 2 }}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" horizontal={false}/><XAxis type="number" domain={[0,3]} tick={{fontSize:9}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={106} tick={{fontSize:9,fill:'#4d666e'}} axisLine={false} tickLine={false}/><Tooltip formatter={(value,name)=>[`${formatNumber(Number(value),1)} 分`,name]}/><Legend wrapperStyle={{fontSize:10}}/><Bar dataKey="score" name="个人得分" fill="#178e87" radius={[0,5,5,0]} maxBarSize={17}/><Bar dataKey="target" name="单项目标" fill="#dce7e8" radius={[0,5,5,0]} maxBarSize={17}/></BarChart></ResponsiveContainer></div>
    <aside className="fms-personal-summary">
      <article><span>FMS总分</span><strong>{total === null ? '—' : formatNumber(total, 1)}<small>/21</small></strong><em>{available.length}/7 项有效</em></article>
      <div>{weakest.length ? weakest.map((row) => <p key={row.name}><b>{row.name}</b><span>{(row.score || 0) >= 2 ? '达到单项目标' : `单项 ${formatNumber(row.score || 0, 1)} 分，需纠正`}</span></p>) : <p><b>暂无测试</b><span>录入标准FMS七项后生成动作短板</span></p>}</div>
    </aside>
  </div>;
}

export function InjuryAssessmentChart({ injuries, athleteCount }: { injuries: OverviewPayload['injuries']; athleteCount: number }) {
  const meta = [
    { key:'healthy',name:'健康',fill:'#27a596' }, { key:'observation',name:'观察',fill:'#e5a72e' }, { key:'restricted',name:'受限',fill:'#e67c49' }, { key:'rehab',name:'康复',fill:'#8b6eb0' }, { key:'suspended',name:'停训',fill:'#d84f4f' }
  ];
  const data = meta.map(item=>({...item,value:injuries.filter(row=>row.status===item.key).length}));
  const recorded = injuries.length; if (athleteCount > recorded) data[0].value += athleteCount-recorded;
  const focus = injuries.filter(row=>row.status!=='healthy').slice(0,4);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const chartData = total ? data.filter((row) => row.value > 0) : [{ name: '暂无伤病记录', value: 1, fill: '#dce7e9' }];
  return <div className="analysis-chart-module injury-analysis-module">
    <div className="analysis-chart-toolbar"><span className="analysis-caption">按每名运动员最新伤病记录统计；未录入者计入健康</span></div>
    <div className="content-chart-layout training-ratio-layout injury-ratio-layout">
      <div className="content-pie training-ratio-pie">
        <ResponsiveContainer width="100%" height="100%"><PieChart>
          <Pie data={[{ value: 1 }]} dataKey="value" innerRadius={56} outerRadius={82} fill="#edf3f4" stroke="none" />
          <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={57} outerRadius={78} paddingAngle={total ? 2 : 0} cornerRadius={5}>{chartData.map((row) => <Cell key={row.name} fill={row.fill} />)}</Pie>
          <Tooltip formatter={(value, name) => [`${formatNumber(Number(value))} 人 · ${percentage(Number(value), total)}%`, name]} contentStyle={{ border: '1px solid #d5e3e5', borderRadius: 10, boxShadow: '0 10px 24px rgba(9,54,65,.12)' }} />
        </PieChart></ResponsiveContainer>
        <div><strong>{formatNumber(focus.length)}</strong><span>重点关注</span></div>
      </div>
      <div className="content-legend training-ratio-legend">{data.map((row) => <div key={row.key}><i style={{ background: row.fill }} /><span>{row.name}</span><b>{formatNumber(row.value)}人</b><strong>{percentage(row.value, total)}%</strong></div>)}</div>
    </div>
    <div className="injury-focus-list injury-focus-list-inline">{focus.length ? focus.map((row) => <div key={row.athleteId}><span><strong>{row.athleteName}</strong><small>{row.bodyPart} · {row.injuryName}</small></span><b>{row.painScore}/10</b></div>) : <p>当前无活动性损伤记录</p>}</div>
    {!total && <p className="analysis-empty-note">当前筛选范围内暂无运动员数据</p>}
  </div>;
}

