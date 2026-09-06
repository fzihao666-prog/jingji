import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import type { OverviewMeasurement, OverviewPayload, TrainingRecord } from '../types';
import { formatNumber, percentage } from '../utils';
import { TRAINING_CONTENT_CATEGORIES, trainingContentCategory } from '../../shared/training-content-category';
import { STRENGTH_INTENSITY_ZONES, TRAINING_INTENSITY_META } from '../../shared/strength-training';

type Period = 'day' | 'week' | 'month' | 'stage';
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'month', label: '月' }, { key: 'stage', label: '阶段' }
];
const colors = ['#0b7f7a', '#25aa9d', '#73c5ab', '#edaa32', '#df634d', '#66758a', '#8b6eb0', '#3d7db7', '#9a7f66'];

function dateMinus(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function usePeriodRecords(records: TrainingRecord[]) {
  const [period, setPeriod] = useState<Period>('week');
  const bounds = useMemo(() => {
    if (!records.length) return { min: '', max: '' };
    return records.reduce((result, item) => ({
      min: item.date < result.min ? item.date : result.min,
      max: item.date > result.max ? item.date : result.max
    }), { min: records[0].date, max: records[0].date });
  }, [records]);
  const [stageOpen, setStageOpen] = useState(false);
  const [stageStart, setStageStart] = useState('');
  const [stageEnd, setStageEnd] = useState('');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const changePeriod = (next: Period) => {
    if (next === 'stage') {
      const start = stageStart || bounds.min;
      const end = stageEnd || bounds.max;
      setDraftStart(start);
      setDraftEnd(end);
      setStageOpen(true);
      return;
    }
    setPeriod(next);
    setStageOpen(false);
  };
  const applyStage = () => {
    if (!draftStart || !draftEnd) return;
    const [start, end] = draftStart <= draftEnd ? [draftStart, draftEnd] : [draftEnd, draftStart];
    setStageStart(start);
    setStageEnd(end);
    setDraftStart(start);
    setDraftEnd(end);
    setPeriod('stage');
    setStageOpen(false);
  };
  const filtered = useMemo(() => {
    if (!records.length) return records;
    if (period === 'stage') {
      if (!stageStart || !stageEnd) return records;
      return records.filter((item) => item.date >= stageStart && item.date <= stageEnd);
    }
    const end = records.reduce((latest, item) => item.date > latest ? item.date : latest, records[0].date);
    const days = period === 'day' ? 0 : period === 'week' ? 6 : 29;
    const start = dateMinus(end, days);
    return records.filter((item) => item.date >= start && item.date <= end);
  }, [period, records, stageEnd, stageStart]);
  return {
    period, filtered, bounds, stageOpen, stageStart, stageEnd, draftStart, draftEnd,
    changePeriod, applyStage, cancelStage: () => setStageOpen(false), setDraftStart, setDraftEnd
  };
}

type PeriodController = ReturnType<typeof usePeriodRecords>;

export function PeriodTabs({ control }: { control: PeriodController }) {
  return <div className="analysis-period-control">
    <div className="analysis-period-tabs" aria-label="统计周期">{PERIODS.map((item) => (
      <button type="button" key={item.key} className={control.period === item.key ? 'active' : ''} onClick={() => control.changePeriod(item.key)}>{item.label}</button>
    ))}</div>
    {control.period === 'stage' && control.stageStart && control.stageEnd && !control.stageOpen && <button type="button" className="analysis-stage-range" onClick={() => control.changePeriod('stage')} title="重新选择阶段">{control.stageStart.slice(5).replace('-', '/')}—{control.stageEnd.slice(5).replace('-', '/')}</button>}
    {control.stageOpen && <div className="analysis-stage-calendar" role="dialog" aria-label="选择统计阶段">
      <div><label><span>开始日期</span><input aria-label="阶段开始日期" type="date" min={control.bounds.min} max={control.draftEnd || control.bounds.max} value={control.draftStart} onInput={(event) => control.setDraftStart(event.currentTarget.value)} /></label><i>至</i><label><span>结束日期</span><input aria-label="阶段结束日期" type="date" min={control.draftStart || control.bounds.min} max={control.bounds.max} value={control.draftEnd} onInput={(event) => control.setDraftEnd(event.currentTarget.value)} /></label></div>
      <p>可选范围：{control.bounds.min || '—'} 至 {control.bounds.max || '—'}</p>
      <footer><button type="button" onClick={control.cancelStage}>取消</button><button type="button" className="confirm" disabled={!control.draftStart || !control.draftEnd} onClick={control.applyStage}>应用阶段</button></footer>
    </div>}
  </div>;
}

export function trainingLoadCategory(record: TrainingRecord) {
  const text = `${record.trainingType} ${record.structureType} ${record.content}`;
  if (/专项|水上|划行|艇上|门区|竞速/.test(text) && !/力量训练/.test(record.trainingType)) return 'special';
  if (/力量|体能|跑步|功能|核心|恢复|陆上|测功仪/.test(text)) return 'physical';
  return record.distanceKm > 0 ? 'special' : 'physical';
}

function groupLabel(date: string, period: Period) {
  if (period === 'day') return date.slice(5).replace('-', '/');
  if (period === 'week') return date.slice(5).replace('-', '/');
  if (period === 'month') return date.slice(5, 7) + '月' + date.slice(8) + '日';
  const value = new Date(`${date}T12:00:00Z`);
  const week = Math.ceil((value.getUTCDate() + new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)).getUTCDay()) / 7);
  return `${date.slice(5, 7)}月W${week}`;
}

function aggregateByDate(records: TrainingRecord[], period: Period) {
  const map = new Map<string, { label: string; physical: number; special: number; duration: number; srpe: number; rpeSum: number; rpeCount: number }>();
  for (const record of records) {
    const label = groupLabel(record.date, period);
    const row = map.get(label) || { label, physical: 0, special: 0, duration: 0, srpe: 0, rpeSum: 0, rpeCount: 0 };
    row[trainingLoadCategory(record)] += record.srpe;
    row.duration += record.durationMin;
    row.srpe += record.srpe;
    if (record.rpe !== null) { row.rpeSum += record.rpe; row.rpeCount += 1; }
    map.set(label, row);
  }
  return [...map.values()].map((row) => ({ ...row, rpe: row.rpeCount ? Number((row.rpeSum / row.rpeCount).toFixed(1)) : null }));
}

export function TrainingLoadComparisonChart({ records }: { records: TrainingRecord[] }) {
  const range = usePeriodRecords(records);
  const data = useMemo(() => aggregateByDate(range.filtered, range.period), [range.filtered, range.period]);
  const physical = data.reduce((sum, row) => sum + row.physical, 0);
  const special = data.reduce((sum, row) => sum + row.special, 0);
  const total = physical + special;
  return <div className="analysis-chart-module">
    <div className="analysis-chart-toolbar"><div className="analysis-kpi-strip"><span>体能负荷<strong>{formatNumber(physical)} AU</strong></span><span>专项负荷<strong>{formatNumber(special)} AU</strong></span><span>专项占比<strong>{percentage(special, total)}%</strong></span></div><PeriodTabs control={range} /></div>
    <div className="analysis-chart-large"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
      <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false} minTickGap={18} /><YAxis tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false} />
      <Tooltip formatter={(value, name) => [`${formatNumber(Number(value))} AU`, name]} /><Legend wrapperStyle={{ fontSize: 10 }} />
      <Bar dataKey="physical" name="体能训练负荷" stackId="load" fill="#e5a72e" radius={[3, 3, 0, 0]} maxBarSize={34} /><Bar dataKey="special" name="专项训练负荷" stackId="load" fill="#168f8a" radius={[3, 3, 0, 0]} maxBarSize={34} />
      <Line dataKey="srpe" name="总负荷趋势" stroke="#0a4252" strokeWidth={2.2} dot={{ r: 2.4 }} />
    </ComposedChart></ResponsiveContainer></div>
  </div>;
}

type TrainingVolume = OverviewPayload['trainingVolume'];

export function TrainingVolumeChart({ data }: { data: TrainingVolume }) {
  const chartData = data.days.map((row) => ({ ...row, label: row.date.slice(5).replace('-', '/') }));
  const value = (number: number | null, digits = 1) => number === null ? '—' : formatNumber(number, digits);
  const hasData = data.totalDurationMin !== null || data.totalDistanceKm !== null;
  return <div className="analysis-chart-module training-volume-module">
    <div className="analysis-chart-toolbar"><span className="analysis-caption">按日期累计训练时长与公里数；统计范围沿用页面顶部筛选，空白数据不按 0 处理</span></div>
    <div className="training-volume-kpis">
      <article><span>累计训练时长</span><strong>{data.totalDurationMin === null ? '—' : value(data.totalDurationMin / 60)}<small>{data.totalDurationMin === null ? '' : ' h'}</small></strong></article>
      <article><span>累计公里数</span><strong>{value(data.totalDistanceKm)}<small>{data.totalDistanceKm === null ? '' : ' km'}</small></strong></article>
      <article><span>日均训练时长</span><strong>{data.averageDurationMin === null ? '—' : value(data.averageDurationMin / 60)}<small>{data.averageDurationMin === null ? '' : ' h'}</small><em>{data.durationDayCount ? `${data.durationDayCount} 个有效训练日` : ''}</em></strong></article>
      <article><span>日均公里数</span><strong>{value(data.averageDistanceKm)}<small>{data.averageDistanceKm === null ? '' : ' km'}</small><em>{data.distanceDayCount ? `${data.distanceDayCount} 个有效训练日` : ''}</em></strong></article>
    </div>
    <div className="analysis-chart-medium"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
      <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false} minTickGap={20}/><YAxis yAxisId="time" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="distance" orientation="right" tick={{ fontSize: 9, fill: '#62767d' }} axisLine={false} tickLine={false}/>
      <Tooltip formatter={(number, name) => [`${formatNumber(Number(number), name === '公里数' ? 1 : 0)} ${name === '公里数' ? 'km' : 'min'}`, name]} contentStyle={{border:'1px solid #d5e3e5',borderRadius:10,boxShadow:'0 10px 24px rgba(9,54,65,.12)'}}/><Legend wrapperStyle={{fontSize:10}}/>
      <Bar yAxisId="time" dataKey="durationMin" name="训练时长" fill="#69aebb" fillOpacity={.86} radius={[5,5,0,0]} maxBarSize={30}/>
      <Line yAxisId="distance" type="monotone" dataKey="distanceKm" name="公里数" stroke="#0b4d59" strokeWidth={3} dot={{r:3,fill:'#fff',stroke:'#0b4d59',strokeWidth:2}} activeDot={{r:5,fill:'#18a092',stroke:'#fff',strokeWidth:2}} />
    </ComposedChart></ResponsiveContainer></div>
    {!hasData && <p className="analysis-empty-note">暂无训练量数据</p>}
  </div>;
}

export function TrainingContentChart({ records }: { records: TrainingRecord[] }) {
  const range = usePeriodRecords(records);
  const data = useMemo(() => {
    const countByCategory = new Map(TRAINING_CONTENT_CATEGORIES.map((name) => [name, 0]));
    for (const row of range.filtered) {
      const category = trainingContentCategory(row);
      countByCategory.set(category, (countByCategory.get(category) || 0) + 1);
    }
    return TRAINING_CONTENT_CATEGORIES.map((name, index) => ({ name, value: countByCategory.get(name) || 0, fill: colors[index % colors.length] }));
  }, [range.filtered]);
  const total = data.reduce((sum,row)=>sum+row.value,0);
  const chartData = total ? data.filter((row) => row.value > 0) : [{ name: '暂无训练课次', value: 1, fill: '#dce7e9' }];
  return <div className="analysis-chart-module"><div className="analysis-chart-toolbar"><span className="analysis-caption">按训练课次统计；每条课次仅归入一个类别</span><PeriodTabs control={range}/></div><div className="content-chart-layout training-ratio-layout"><div className="content-pie training-ratio-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ value: 1 }]} dataKey="value" innerRadius={56} outerRadius={82} fill="#edf3f4" stroke="none"/><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={57} outerRadius={78} paddingAngle={total ? 2 : 0} cornerRadius={5}>{chartData.map(row=><Cell key={row.name} fill={row.fill}/>)}</Pie><Tooltip formatter={(value,name)=>[`${formatNumber(Number(value))} 课 · ${percentage(Number(value), total)}%`,name]} contentStyle={{border:'1px solid #d5e3e5',borderRadius:10,boxShadow:'0 10px 24px rgba(9,54,65,.12)'}}/></PieChart></ResponsiveContainer><div><strong>{formatNumber(total)}</strong><span>总课次</span></div></div><div className="content-legend training-ratio-legend">{data.map(row=><div key={row.name}><i style={{background:row.fill}}/><span>{row.name}</span><b>{formatNumber(row.value)}课</b><strong>{percentage(row.value,total)}%</strong></div>)}</div></div>{!total && <p className="analysis-empty-note">当前筛选条件下无训练记录</p>}</div>;
}

type IntensityDistribution = OverviewPayload['intensityDistribution'];
type WaterLandLoad = OverviewPayload['waterLandLoad'];

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

export function WaterLandLoadRatioChart({ data }: { data: WaterLandLoad }) {
  const [active, setActive] = useState<'water' | 'land' | null>(null);
  const hasLoad = data.totalLoad > 0;
  const segments = [
    { key: 'water' as const, label: '水上训练', load: data.waterLoad, percentage: data.waterPercentage },
    { key: 'land' as const, label: '陆上训练', load: data.landLoad, percentage: data.landPercentage }
  ];
  const selected = segments.find((item) => item.key === active);
  return <div className="analysis-chart-module water-land-ratio-module">
    <div className="analysis-chart-toolbar"><span className="analysis-caption">按 SRPE 训练负荷汇总；水上与陆上负荷占比</span></div>
    <div className={`water-land-ratio-bar${hasLoad ? '' : ' is-empty'}`} role="img" aria-label={`水上训练负荷 ${formatNumber(data.waterLoad)} AU，陆上训练负荷 ${formatNumber(data.landLoad)} AU`}>
      {hasLoad ? segments.map((item) => item.percentage > 0 && <div
        key={item.key}
        className={`water-land-ratio-segment ${item.key}`}
        style={{ flexBasis: `${item.percentage}%` }}
        role="button"
        tabIndex={0}
        onMouseEnter={() => setActive(item.key)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive(item.key)}
        onBlur={() => setActive(null)}
      ><strong>{formatNumber(item.percentage, 1)}%</strong><span>{item.key === 'water' ? '水上' : '陆上'}</span></div>) : <span>暂无有效训练负荷数据</span>}
    </div>
    <div className="water-land-ratio-summary">{segments.map((item) => <article key={item.key} className={item.key}>
      <span>{item.label}</span><strong>{formatNumber(item.percentage, 1)}<small>%</small></strong><em>{formatNumber(item.load, 1)} AU</em>
    </article>)}<aside><span>总训练负荷</span><strong>{formatNumber(data.totalLoad, 1)}<small> AU</small></strong></aside></div>
    {selected && <div className={`water-land-ratio-tooltip ${selected.key}`}><strong>{selected.label}</strong><span>训练负荷：{formatNumber(selected.load, 1)} AU</span><span>占比：{formatNumber(selected.percentage, 1)}%</span></div>}
    {data.unclassifiedLoad > 0 && <p className="analysis-method-note">未分类训练负荷：{formatNumber(data.unclassifiedLoad, 1)} AU，未计入水陆比例。</p>}
    {!hasLoad && <p className="analysis-empty-note">当前筛选条件下无有效训练负荷数据</p>}
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
  return <div className="fms-analysis-layout"><div className="analysis-chart-medium fms-team-chart"><div className="fms-team-legend"><span><i/>本次队均</span><span><i/>动作达标线 2分</span></div><div className="fms-team-plot"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{top:2,right:26,left:22,bottom:0}}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" horizontal={false}/><XAxis type="number" domain={[0,3]} ticks={[0,1,2,3]} tick={{fontSize:9}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={96} tick={{fontSize:9,fill:'#4d666e'}} axisLine={false} tickLine={false}/><Tooltip formatter={(value,name,entry)=>[`${formatNumber(Number(value),1)} 分 · n=${entry.payload.sampleCount}`,name]}/><ReferenceLine x={2} stroke="#d89222" strokeWidth={1.6} strokeDasharray="4 3"/><Bar dataKey="score" name="本次队均" fill="#178e87" radius={[0,5,5,0]} maxBarSize={18}>{data.map((row)=><Cell key={row.name} fill={row.score === null ? '#dce6e8' : row.score < 2 ? '#df634d' : row.score < 2.5 ? '#e1a12c' : '#178e87'}/>)}</Bar></BarChart></ResponsiveContainer></div></div><aside className="fms-summary"><strong>{total === null ? '—' : formatNumber(total,1)}<small>/21</small></strong><span>七项综合队均</span><div className="fms-summary-grid"><p><b>{achieved}</b><small>达标项目</small></p><p><b>{correction.length}</b><small>待纠正项目</small></p><p><b>{available.length}/7</b><small>有效项目</small></p></div><em>最近一次团队测试 · {sampleCount ? `最多 ${sampleCount} 人/项` : '暂无有效样本'}</em><p>{correction.length ? `优先复核：${correction.map((row)=>row.name).join('、')}。结合左右侧最低分安排纠正训练。` : complete ? '七个动作队均均达到2分，仍需继续关注个体低分和左右不对称。' : '测试项目不完整，补齐七项后再生成综合分。'}</p></aside></div>;
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
  return <div className="injury-analysis-layout"><div className="injury-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>{data.map(row=><Cell key={row.key} fill={row.fill}/>)}</Pie><Tooltip formatter={(value,name)=>[`${value} 人`,name]}/></PieChart></ResponsiveContainer><div><strong>{focus.length}</strong><span>重点关注</span></div></div><div className="injury-focus-list">{focus.length ? focus.map(row=><div key={row.athleteId}><span><strong>{row.athleteName}</strong><small>{row.bodyPart} · {row.injuryName}</small></span><b>{row.painScore}/10</b></div>) : <p>当前无活动性损伤记录</p>}</div></div>;
}

