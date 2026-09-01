import { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { ArrowUpRight, Dumbbell, Scale, TrendingUp } from 'lucide-react';
import type { OverviewMeasurement, OverviewPayload, TrainingRecord } from '../types';
import { formatNumber, percentage } from '../utils';

type Period = 'day' | 'week' | 'month' | 'stage';
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'month', label: '月' }, { key: 'stage', label: '阶段' }
];
const colors = ['#0b7f7a', '#25aa9d', '#73c5ab', '#edaa32', '#df634d', '#66758a', '#8b6eb0'];

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

function classify(record: TrainingRecord) {
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
    row[classify(record)] += record.srpe;
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

export function TrainingVolumeChart({ records }: { records: TrainingRecord[] }) {
  const range = usePeriodRecords(records);
  const data = useMemo(() => aggregateByDate(range.filtered, range.period), [range.filtered, range.period]);
  return <div className="analysis-chart-module"><div className="analysis-chart-toolbar"><span className="analysis-caption">训练时长柱 + SRPE负荷折线，悬浮查看单点训练量</span><PeriodTabs control={range} /></div>
    <div className="analysis-chart-medium"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
      <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={20}/><YAxis yAxisId="time" tick={{ fontSize: 9 }} axisLine={false} tickLine={false}/><YAxis yAxisId="load" orientation="right" tick={{ fontSize: 9 }} axisLine={false} tickLine={false}/>
      <Tooltip formatter={(value, name) => [`${formatNumber(Number(value))}${name === '训练时长' ? ' min' : ' AU'}`, name]} contentStyle={{border:'1px solid #d5e3e5',borderRadius:10,boxShadow:'0 10px 24px rgba(9,54,65,.12)'}}/><Legend wrapperStyle={{fontSize:10}}/>
      <Bar yAxisId="time" dataKey="duration" name="训练时长" fill="#79b9c1" fillOpacity={.82} radius={[5,5,0,0]} maxBarSize={28}/>
      <Line yAxisId="load" type="monotone" dataKey="srpe" name="训练负荷" stroke="#0b4d59" strokeWidth={3} dot={{r:3,fill:'#fff',stroke:'#0b4d59',strokeWidth:2}} activeDot={{r:5,fill:'#18a092',stroke:'#fff',strokeWidth:2}} connectNulls />
    </ComposedChart></ResponsiveContainer></div></div>;
}

export function TrainingContentChart({ records }: { records: TrainingRecord[] }) {
  const range = usePeriodRecords(records);
  const data = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of range.filtered) { const name = row.structureType || row.trainingType || '其他'; map.set(name, (map.get(name) || 0) + row.durationMin); }
    return [...map].map(([name, value], index) => ({ name, value, fill: colors[index % colors.length] })).sort((a,b)=>b.value-a.value).slice(0,7);
  }, [range.filtered]);
  const total = data.reduce((sum,row)=>sum+row.value,0);
  return <div className="analysis-chart-module"><div className="analysis-chart-toolbar"><span className="analysis-caption">按训练内容时长构成</span><PeriodTabs control={range}/></div><div className="content-chart-layout"><div className="content-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}>{data.map(row=><Cell key={row.name} fill={row.fill}/>)}</Pie><Tooltip formatter={(value,name)=>[`${formatNumber(Number(value))} min`,name]}/></PieChart></ResponsiveContainer><div><strong>{formatNumber(total/60,1)}</strong><span>小时</span></div></div><div className="content-legend">{data.map(row=><div key={row.name}><i style={{background:row.fill}}/><span>{row.name}</span><strong>{percentage(row.value,total)}%</strong></div>)}</div></div></div>;
}

export function RpeStatisticsChart({ records }: { records: TrainingRecord[] }) {
  const range = usePeriodRecords(records);
  const data = useMemo(() => aggregateByDate(range.filtered, range.period), [range.filtered, range.period]);
  const zones = useMemo(() => [
    { name: '低强度 1–3', value: range.filtered.filter(r => r.rpe !== null && r.rpe <= 3).length, fill: '#73c5ab' },
    { name: '中强度 4–6', value: range.filtered.filter(r => r.rpe !== null && r.rpe >= 4 && r.rpe <= 6).length, fill: '#e5a72e' },
    { name: '高强度 7–10', value: range.filtered.filter(r => r.rpe !== null && r.rpe >= 7).length, fill: '#df634d' }
  ], [range.filtered]);
  return <div className="analysis-chart-module"><div className="analysis-chart-toolbar"><span className="analysis-caption">主观用力程度 0–10 分</span><PeriodTabs control={range}/></div><div className="rpe-chart-layout"><div><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{top:8,right:8,left:-24,bottom:0}}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{fontSize:9}} axisLine={false} tickLine={false}/><YAxis domain={[0,10]} tick={{fontSize:9}} axisLine={false} tickLine={false}/><Tooltip formatter={(value)=>[`${value} 分`,'平均RPE']}/><Area type="monotone" dataKey="rpe" stroke="#8064a8" strokeWidth={2.4} fill="#8b6eb0" fillOpacity={.18}/></AreaChart></ResponsiveContainer></div><div className="rpe-zone-list">{zones.map(row=><div key={row.name}><i style={{background:row.fill}}/><span>{row.name}</span><strong>{row.value}<small>堂</small></strong></div>)}</div></div></div>;
}

export function FmsTeamChart({ measurements }: { measurements: OverviewMeasurement[] }) {
  const keys = ['fms_deep_squat','fms_hurdle_step','fms_inline_lunge','fms_shoulder_mobility','fms_active_straight_leg_raise','fms_trunk_stability_pushup','fms_rotary_stability'];
  const data = keys.map((key, index) => { const row = measurements.find(item=>item.code===key); return { name: row?.label || key, score: row?.value ?? 0, target: row?.target ?? 2, fill: colors[index % colors.length] }; });
  const total = data.reduce((sum,row)=>sum+row.score,0);
  return <div className="fms-analysis-layout"><div className="analysis-chart-medium"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{top:4,right:18,left:22,bottom:0}}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" horizontal={false}/><XAxis type="number" domain={[0,3]} tick={{fontSize:9}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={96} tick={{fontSize:9,fill:'#4d666e'}} axisLine={false} tickLine={false}/><Tooltip formatter={(value,name)=>[`${formatNumber(Number(value),1)} 分`,name]}/><Legend wrapperStyle={{fontSize:10}}/><Bar dataKey="score" name="全队均分" fill="#178e87" radius={[0,4,4,0]} maxBarSize={16}/><Bar dataKey="target" name="单项目标" fill="#dce7e8" radius={[0,4,4,0]} maxBarSize={16}/></BarChart></ResponsiveContainer></div><div className="fms-summary"><strong>{formatNumber(total,1)}<small>/21</small></strong><span>FMS综合均分</span><p>{total >= 14 ? 'FMS总分达到常用风险筛查参考线，继续关注单项低分和左右侧对称。' : 'FMS总分低于14分，建议优先安排纠正性训练并复测。'}</p></div></div>;
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

export function BasicStrengthAnalysis({ changes, relative }: { changes: Array<{ key:string;label:string;unit:string;current:number;previous:number|null;change:number|null }>; relative: Array<{label:string;current:number;previous:number|null}> }) {
  const changeData = changes.filter(row=>row.change!==null).slice(0,6);
  const comparable = changeData.filter((row) => row.change !== null);
  const averageChange = comparable.length ? comparable.reduce((sum, row) => sum + (row.change || 0), 0) / comparable.length : 0;
  const improvedCount = comparable.filter((row) => (row.change || 0) > 0).length;
  const bestRelative = relative.reduce((best, row) => row.current > best.current ? row : best, { label: '暂无', current: 0, previous: null as number | null });
  const largestGain = comparable.reduce((best, row) => (row.change || 0) > (best?.change || -Infinity) ? row : best, comparable[0]);
  return <div className="strength-analysis-layout">
    <div className="strength-summary-strip">
      <article><span className="strength-summary-icon teal"><TrendingUp size={16}/></span><div><small>平均变化</small><strong className={averageChange >= 0 ? 'positive' : 'negative'}>{averageChange >= 0 ? '+' : ''}{formatNumber(averageChange,1)}%</strong><p>最近两次基础力量测试</p></div></article>
      <article><span className="strength-summary-icon navy"><ArrowUpRight size={16}/></span><div><small>提升指标</small><strong>{improvedCount}<em> / {comparable.length || '—'}</em></strong><p>{largestGain ? `${largestGain.label}提升最明显` : '等待补充前后测数据'}</p></div></article>
      <article><span className="strength-summary-icon gold"><Scale size={16}/></span><div><small>最高相对力量</small><strong>{formatNumber(bestRelative.current,2)}<em> 倍体重</em></strong><p>{bestRelative.label}</p></div></article>
    </div>
    <section className="strength-chart-card strength-change-card"><header><span><Dumbbell size={15}/></span><div><h3>基础力量前后测变化</h3><p>正值代表较前测提升</p></div><b>{comparable.length}项指标</b></header><div className="strength-chart-canvas"><ResponsiveContainer width="100%" height="100%"><BarChart data={changeData} margin={{top:16,right:8,left:-12,bottom:2}}><defs><linearGradient id="strengthGain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#15a092"/><stop offset="1" stopColor="#65c4b4"/></linearGradient></defs><CartesianGrid stroke="#e1eaeb" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{fontSize:9,fill:'#526b73',fontWeight:700}} axisLine={false} tickLine={false}/><YAxis unit="%" tick={{fontSize:8,fill:'#82949a'}} axisLine={false} tickLine={false}/><Tooltip formatter={(value)=>`${formatNumber(Number(value),1)}%`} contentStyle={{border:'1px solid #d5e3e5',borderRadius:10,boxShadow:'0 10px 24px rgba(9,54,65,.12)'}}/><Bar dataKey="change" name="变化率" radius={[6,6,1,1]} maxBarSize={36}>{changeData.map(row=><Cell key={row.key} fill={(row.change||0)>=0?'url(#strengthGain)':'#df634d'}/>)}</Bar></BarChart></ResponsiveContainer></div></section>
    <section className="strength-chart-card relative-strength-card"><header><span><Scale size={15}/></span><div><h3>相对力量水平</h3><p>1RM ÷ 体重，观察力量效率</p></div><b>倍体重</b></header><div className="strength-chart-canvas"><ResponsiveContainer width="100%" height="100%"><BarChart data={relative} margin={{top:16,right:8,left:-12,bottom:2}}><defs><linearGradient id="relativeCurrent" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0c5968"/><stop offset="1" stopColor="#278b91"/></linearGradient></defs><CartesianGrid stroke="#e1eaeb" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{fontSize:9,fill:'#526b73',fontWeight:700}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:8,fill:'#82949a'}} axisLine={false} tickLine={false}/><Tooltip formatter={(value)=>`${formatNumber(Number(value),2)} 倍体重`} contentStyle={{border:'1px solid #d5e3e5',borderRadius:10,boxShadow:'0 10px 24px rgba(9,54,65,.12)'}}/><Legend wrapperStyle={{fontSize:9}}/><Bar dataKey="previous" name="前测" fill="#cbd7d9" radius={[5,5,1,1]} maxBarSize={25}/><Bar dataKey="current" name="本次" fill="url(#relativeCurrent)" radius={[5,5,1,1]} maxBarSize={25}/></BarChart></ResponsiveContainer></div></section>
  </div>;
}
