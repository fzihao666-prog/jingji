import { useMemo, useState } from 'react';
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

export function SpecialPhysicalLoadRatioChart({ data }: { data: TrainingLoadRatio }) {
  const [active, setActive] = useState<'special' | 'physical' | null>(null);
  const hasLoad = data.totalLoad > 0;
  const segments = [
    { key: 'special' as const, label: '专项训练', load: data.specialLoad, percentage: data.specialPercentage },
    { key: 'physical' as const, label: '体能训练', load: data.physicalLoad, percentage: data.physicalPercentage }
  ];
  const selected = segments.find((item) => item.key === active);
  return <div className="analysis-chart-module training-load-ratio-module">
    <div className="analysis-chart-toolbar"><span className="analysis-caption">按 SRPE 训练负荷汇总；仅统计已归类的专项与体能训练</span></div>
    <div className={`training-load-ratio-bar${hasLoad ? '' : ' is-empty'}`} role="img" aria-label={`专项训练负荷 ${formatNumber(data.specialLoad)} AU，体能训练负荷 ${formatNumber(data.physicalLoad)} AU`}>
      {hasLoad ? segments.map((item) => item.percentage > 0 && <div
        key={item.key}
        className={`training-load-ratio-segment ${item.key}`}
        style={{ flexBasis: `${item.percentage}%` }}
        role="button"
        tabIndex={0}
        onMouseEnter={() => setActive(item.key)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive(item.key)}
        onBlur={() => setActive(null)}
      ><strong>{formatNumber(item.percentage, 1)}%</strong><span>{item.label}</span></div>) : <span>暂无训练负荷数据</span>}
    </div>
    <div className="training-load-ratio-summary">{segments.map((item) => <article key={item.key} className={item.key}>
      <span>{item.label}</span><strong>{formatNumber(item.percentage, 1)}<small>%</small></strong><em>{formatNumber(item.load, 1)} AU</em>
    </article>)}<aside><span>有效总训练负荷</span><strong>{formatNumber(data.totalLoad, 1)}<small> AU</small></strong></aside></div>
    {selected && <div className={`training-load-ratio-tooltip ${selected.key}`}><strong>{selected.label}</strong><span>训练负荷：{formatNumber(selected.load, 1)} AU</span><span>占比：{formatNumber(selected.percentage, 1)}%</span></div>}
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

