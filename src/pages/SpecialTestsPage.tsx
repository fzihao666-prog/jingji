import {
  Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronRight,
  Clock3, FileSpreadsheet, Gauge, HeartPulse, MapPinned, RefreshCw, Route,
  Sparkles, Target, TimerReset, TrendingUp, Waves, Zap
} from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts';
import type { SpecialPageKey } from '../components/AppShell';
import { SpecialPerformancePanel } from '../components/SpecialPerformancePanel';
import type { Project, TrainingRecord } from '../types';
import './SpecialTrainingPage.css';

type Props = {
  records: TrainingRecord[];
  project: Project;
  from: string;
  to: string;
  loading: boolean;
  section: SpecialPageKey;
  onSectionChange: (section: SpecialPageKey) => void;
};

type Session = {
  id: string; date: string; athleteId: number; athleteName: string; type: string; content: string;
  duration: number; distance: number; rpe: number; load: number; strokeRate: number | null;
  heartRate: number | null; maxHeartRate: number | null; power: number | null;
  sleepHours: number | null; fatigueIndex: number | null; source: 'system' | 'manual' | 'import';
};

const SECTION_META: Record<SpecialPageKey, { group: string; title: string; english: string; description: string }> = {
  'special-time': { group: '综合分析', title: '时间分析', english: 'TRAINING TIME', description: '按周期、训练类型和运动员拆解专项训练时长与完成质量。' },
  'special-distance': { group: '综合分析', title: '距离分析', english: 'TRAINING DISTANCE', description: '监测专项里程、强度分布与运动员距离完成情况。' },
  'special-load': { group: '综合分析', title: '负荷分析', english: 'TRAINING LOAD', description: '结合 sRPE、急慢性负荷比与恢复状态识别训练风险。' },
  'special-rate': { group: '专项指标', title: '桨频分析', english: 'STROKE RATE', description: '观察不同训练区间的桨频效率、稳定性与专项节奏。' },
  'special-heart': { group: '专项指标', title: '心率分析', english: 'HEART RATE', description: '分析心率响应、训练区间与负荷后的恢复能力。' },
  'special-power': { group: '专项指标', title: '功率分析', english: 'POWER OUTPUT', description: '评估平均功率、峰值能力、功率体重比与持续输出。' },
  'special-schedule': { group: '训练执行', title: '训练安排', english: 'TRAINING SCHEDULE', description: '协调技术、战术、体能与恢复训练，形成清晰可执行的周计划。' }
};

const COLORS = ['#12978f', '#347fe5', '#78b83f', '#f69a33', '#8b65d4'];
const tooltipStyle = { border: '1px solid #d8e5e6', borderRadius: 10, boxShadow: '0 10px 28px rgba(8,45,56,.12)', fontSize: 11 };

function dateOffset(iso: string, offset: number) {
  const date = new Date(`${iso}T12:00:00`); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10);
}
function isoWeekNumber(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
function round(value: number, digits = 1) { return Number(value.toFixed(digits)); }
function sum(sessions: Session[], key: 'duration' | 'distance' | 'load') { return sessions.reduce((total, item) => total + item[key], 0); }
function averageMetric(sessions: Session[], key: 'rpe' | 'strokeRate' | 'heartRate' | 'power' | 'sleepHours' | 'fatigueIndex') { const values = sessions.map((item) => item[key]).filter((value): value is number => value !== null); return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function stabilityScore(sessions: Session[], key: 'strokeRate' | 'heartRate' | 'power') { const average = averageMetric(sessions, key); const values = sessions.map((item) => item[key]).filter((value): value is number => value !== null); if (!average || !values.length) return 0; const deviation = Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length); return Math.max(0, Math.min(100, Math.round(100 - deviation / average * 100))); }
function projectMetric(project: Project, index: number) {
  if (project === '皮划艇') return { rate: 68 + index * 7 % 24, power: 272 + index * 31 % 105, label: '划频', unit: '次/分', technique: '双桨衔接效率' };
  if (project === '激流') return { rate: 76 + index * 9 % 28, power: 248 + index * 29 % 118, label: '划频', unit: '次/分', technique: '门区转换效率' };
  return { rate: 24 + index * 3 % 14, power: 315 + index * 37 % 145, label: '桨频', unit: '桨/分', technique: '推进阶段一致性' };
}

function recordSessions(records: TrainingRecord[], project: Project): Session[] {
  return records.map((record) => {
    const rpe = record.rpe ?? Math.max(2, Math.min(10, Math.round(record.srpe / Math.max(record.durationMin, 1))));
    return { id: `record-${record.id}`, date: record.date, athleteId: record.athleteId, athleteName: record.athleteName,
      type: record.trainingType || '专项训练', content: record.content || '专项训练记录', duration: record.durationMin, distance: record.distanceKm,
      rpe, load: record.srpe || record.durationMin * rpe, strokeRate: record.strokeRateSpm ?? null,
      heartRate: record.averageHeartRate ?? null, maxHeartRate: record.maxHeartRate ?? null,
      power: record.averagePowerW ?? null, sleepHours: record.sleepHours ?? null,
      fatigueIndex: record.fatigueIndex ?? null, source: 'system' };
  });
}

function aggregateDays(sessions: Session[]) {
  const map = new Map<string, { date: string; duration: number; distance: number; load: number; rate: number; heart: number; power: number; rateCount: number; heartCount: number; powerCount: number }>();
  sessions.forEach((item) => {
    const current = map.get(item.date) || { date: item.date.slice(5), duration: 0, distance: 0, load: 0, rate: 0, heart: 0, power: 0, rateCount: 0, heartCount: 0, powerCount: 0 };
    current.duration += item.duration; current.distance += item.distance; current.load += item.load;
    if (item.strokeRate !== null) { current.rate += item.strokeRate; current.rateCount += 1; }
    if (item.heartRate !== null) { current.heart += item.heartRate; current.heartCount += 1; }
    if (item.power !== null) { current.power += item.power; current.powerCount += 1; }
    map.set(item.date, current);
  });
  const daily = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([isoDate, item]) => ({ ...item, isoDate,
    duration: round(item.duration / 60, 2), distance: round(item.distance, 1), load: Math.round(item.load),
    rate: item.rateCount ? round(item.rate / item.rateCount) : null,
    heart: item.heartCount ? Math.round(item.heart / item.heartCount) : null,
    power: item.powerCount ? Math.round(item.power / item.powerCount) : null }));
  return daily.map((item) => ({ ...item, chronic: Math.round(daily
    .filter((candidate) => candidate.isoDate >= dateOffset(item.isoDate, -27) && candidate.isoDate <= item.isoDate)
    .reduce((total, candidate) => total + candidate.load, 0) / 4) }));
}

function loadSnapshot(sessions: Session[]) {
  const end = sessions.reduce((latest, item) => item.date > latest ? item.date : latest, '');
  if (!end) return { acute: 0, chronic: 0, acwr: 0 };
  const acute = sessions.filter((item) => item.date >= dateOffset(end, -6) && item.date <= end).reduce((total, item) => total + item.load, 0);
  const chronic = sessions.filter((item) => item.date >= dateOffset(end, -27) && item.date <= end).reduce((total, item) => total + item.load, 0) / 4;
  return { acute, chronic, acwr: chronic > 0 ? acute / chronic : 0 };
}

function loadRiskInsights(sessions: Session[]) {
  const grouped = new Map<string, Session[]>();
  sessions.forEach((item) => grouped.set(item.athleteName, [...(grouped.get(item.athleteName) || []), item]));
  const risks = [...grouped.entries()].map(([name, own]) => ({ name, ...loadSnapshot(own), highRpeDays: new Set(own.filter((item) => item.rpe >= 8).map((item) => item.date)).size })).sort((a, b) => b.acwr - a.acwr);
  const highest = risks[0];
  const repeatedHighRpe = [...risks].sort((a, b) => b.highRpeDays - a.highRpeDays)[0];
  const totalLoad = sum(sessions, 'load');
  const highIntensityShare = totalLoad > 0 ? sum(sessions.filter((item) => item.rpe >= 8), 'load') / totalLoad * 100 : 0;
  return [
    highest ? `${highest.name} 当前 ACWR ${round(highest.acwr, 2)}：${highest.acwr > 1.5 ? '建议降低下一次高强度课总量。' : highest.acwr < .8 ? '近期刺激偏低，建议结合周期目标复核。' : '处于常用监测区间。'}` : '当前周期暂无可计算的负荷比。',
    repeatedHighRpe ? `${repeatedHighRpe.name} 本周期有 ${repeatedHighRpe.highRpeDays} 天 RPE ≥ 8：${repeatedHighRpe.highRpeDays >= 3 ? '建议增加恢复监测。' : '尚未形成连续高主观强度。'}` : '当前周期暂无主观强度记录。',
    `全队高强度负荷占比 ${round(highIntensityShare)}%，请结合训练阶段与恢复状态判断。`
  ];
}

function SectionCard({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return <section className={`panel professional-panel special-card ${className}`}><header className="panel-heading"><div><h2>{title}</h2></div>{note && <small>{note}</small>}</header>{children}</section>;
}
function MetricCard({ icon, label, value, unit, change, tone = 'teal' }: { icon: ReactNode; label: string; value: string | number; unit?: string; change: string; tone?: string }) {
  return <article className={`metric-card special-metric tone-${tone}`}><div className="metric-icon">{icon}</div><div className="metric-copy"><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{change}</p></div><div className="metric-waterline" aria-hidden="true"/></article>;
}

function TrendChart({ data, metric, color = '#12978f', secondary }: { data: ReturnType<typeof aggregateDays>; metric: 'duration' | 'distance' | 'load' | 'rate' | 'heart' | 'power'; color?: string; secondary?: 'chronic' }) {
  return <div className="special-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
    <defs><linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={.28}/><stop offset="1" stopColor={color} stopOpacity={.02}/></linearGradient></defs>
    <CartesianGrid stroke="#e8eff0" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#778b91' }} tickLine={false}/><YAxis tick={{ fontSize: 10, fill: '#778b91' }} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltipStyle}/>
    <Area type="monotone" dataKey={metric} stroke={color} strokeWidth={2.2} fill={`url(#fill-${metric})`}/>{secondary && <Line type="monotone" dataKey={secondary} stroke="#347fe5" strokeWidth={2} dot={false}/>}
  </AreaChart></ResponsiveContainer></div>;
}

function TypeDonut({ sessions, valueKey = 'duration' }: { sessions: Session[]; valueKey?: 'duration' | 'distance' | 'load' }) {
  const values = useMemo(() => { const grouped = new Map<string, number>(); sessions.forEach((item) => grouped.set(item.type, (grouped.get(item.type) || 0) + item[valueKey])); return [...grouped].map(([name, value]) => ({ name, value: round(value) })).sort((a, b) => b.value - a.value).slice(0, 5); }, [sessions, valueKey]);
  const total = Math.max(values.reduce((result, item) => result + item.value, 0), 1);
  return <div className="special-donut-wrap"><ResponsiveContainer width="48%" height={210}><PieChart><Pie data={values} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2}>{values.map((_, index) => <Cell key={index} fill={COLORS[index]}/>)}</Pie><Tooltip contentStyle={tooltipStyle}/></PieChart></ResponsiveContainer><div className="special-legend">{values.map((item, index) => <div key={item.name}><i style={{ background: COLORS[index] }}/><span>{item.name}</span><strong>{round(item.value / total * 100)}%</strong></div>)}</div></div>;
}

function AthleteTable({ sessions, metric }: { sessions: Session[]; metric: 'duration' | 'distance' | 'load' | 'strokeRate' | 'heartRate' | 'power' }) {
  const rows = useMemo(() => { const grouped = new Map<string, { name: string; total: number; count: number; rpe: number }>(); sessions.forEach((item) => { const value = item[metric]; if (value === null) return; const row = grouped.get(item.athleteName) || { name: item.athleteName, total: 0, count: 0, rpe: 0 }; row.total += value; row.count += 1; row.rpe += item.rpe; grouped.set(item.athleteName, row); }); return [...grouped.values()].map((row) => ({ ...row, value: ['strokeRate', 'heartRate', 'power'].includes(metric) ? row.total / row.count : row.total })).sort((a, b) => b.value - a.value).slice(0, 6); }, [sessions, metric]);
  const unit = metric === 'duration' ? 'min' : metric === 'distance' ? 'km' : metric === 'load' ? 'AU' : metric === 'heartRate' ? 'bpm' : metric === 'power' ? 'W' : 'spm';
  const teamAverageValue = rows.length ? rows.reduce((total, row) => total + row.value, 0) / rows.length : 0;
  return <div className="special-table-wrap"><table><thead><tr><th>排名</th><th>运动员</th><th>训练次数</th><th>指标值</th><th>平均 RPE</th><th>状态</th></tr></thead><tbody>{rows.map((row, index) => { const attention = teamAverageValue > 0 && row.value < teamAverageValue * .9; return <tr key={row.name}><td><b className={`rank rank-${index + 1}`}>{index + 1}</b></td><td><strong>{row.name}</strong></td><td>{row.count}</td><td className="table-value">{round(row.value)} {unit}</td><td>{round(row.rpe / row.count)}</td><td><span className={attention ? 'status attention' : 'status good'}>{attention ? '低于队均' : '区间正常'}</span></td></tr>; })}</tbody></table></div>;
}

function InsightList({ items, warning = false }: { items: string[]; warning?: boolean }) { return <div className="insight-list">{items.map((item, index) => <div key={item}><i className={warning && index < 2 ? 'warn' : ''}>{warning && index < 2 ? <AlertTriangle/> : <CheckCircle2/>}</i><span>{item}</span></div>)}</div>; }
function ProjectNotes({ project }: { project: Project }) {
  const items = project === '赛艇' ? ['以 500m / 2000m 分段为核心', '关注艇速、桨频与功率同步', '单桨 / 双桨分组比较'] : project === '皮划艇' ? ['以 200m / 500m / 1000m 分段为核心', '关注左右侧输出与高划频保持', '单艇 / 双艇 / 四艇分组比较'] : ['距离之外增加门区通过质量', '关注逆水门、顺水门耗时', '结合罚分与线路偏差评价'];
  return <div className="project-notes"><span>{project}专项口径</span>{items.map((item, index) => <div key={item}><b>0{index + 1}</b><p>{item}</p></div>)}</div>;
}

function AnalysisPage({ section, sessions, days, project }: { section: SpecialPageKey; sessions: Session[]; days: ReturnType<typeof aggregateDays>; project: Project }) {
  if (section === 'special-time') { const total = sum(sessions, 'duration'); const specialtyMinutes = sum(sessions.filter((item) => item.type.includes('专项') || item.type.includes('技术')), 'duration'); const specialtyShare = total ? round(specialtyMinutes / total * 100) : 0; return <><div className="special-metrics"><MetricCard icon={<Clock3/>} label="总训练时长" value={round(total / 60, 1)} unit="h" change={`来自 ${sessions.length} 条训练记录`}/><MetricCard icon={<CalendarDays/>} label="日均训练" value={round(total / Math.max(days.length, 1))} unit="min" change={`${days.length} 个有效训练日`} tone="blue"/><MetricCard icon={<TimerReset/>} label="单次平均" value={round(total / Math.max(sessions.length, 1))} unit="min" change="按实际训练记录计算" tone="green"/><MetricCard icon={<CheckCircle2/>} label="专项课时占比" value={specialtyShare} unit="%" change={`${round(specialtyMinutes / 60)} 小时专项与技术训练`} tone="purple"/></div><div className="special-grid"><SectionCard title="训练时间趋势" note="小时 · 按日" className="span-8"><TrendChart data={days} metric="duration"/></SectionCard><SectionCard title="训练类别构成" note="按时长统计" className="span-4"><TypeDonut sessions={sessions}/></SectionCard><SectionCard title="运动员时长对比" note="与队内均值联动" className="span-8"><AthleteTable sessions={sessions} metric="duration"/></SectionCard><SectionCard title="时间执行诊断" note="周期建议" className="span-4"><InsightList items={[`当前周期共有 ${days.length} 个有效训练日、${sessions.length} 条训练记录。`,`专项与技术训练占总时长 ${specialtyShare}%，请结合周期目标复核。`,`单次平均训练 ${round(total / Math.max(sessions.length, 1))} 分钟，建议同步观察恢复评分。`]}/></SectionCard></div></>; }
  if (section === 'special-distance') { const total = sum(sessions, 'distance'); const highIntensityDistance = sum(sessions.filter((item) => item.rpe >= 8), 'distance'); const highShare = total ? round(highIntensityDistance / total * 100) : 0; return <><div className="special-metrics"><MetricCard icon={<Route/>} label="总训练距离" value={round(total, 1)} unit="km" change={`来自 ${sessions.length} 条训练记录`}/><MetricCard icon={<Target/>} label="日均距离" value={round(total / Math.max(days.length, 1))} unit="km" change={`${days.length} 个有效训练日`} tone="blue"/><MetricCard icon={<MapPinned/>} label="最长单次" value={round(Math.max(...sessions.map((item) => item.distance), 0))} unit="km" change="按单次训练记录统计" tone="green"/><MetricCard icon={<Zap/>} label="高强度距离" value={round(highIntensityDistance)} unit="km" change={`RPE ≥ 8，占总距离 ${highShare}%`} tone="orange"/></div><div className="special-grid"><SectionCard title="专项距离趋势" note="公里 · 按日" className="span-8"><TrendChart data={days} metric="distance" color="#167d9b"/></SectionCard><SectionCard title="距离训练构成" note="技术 / 耐力 / 力量 / 恢复" className="span-4"><TypeDonut sessions={sessions} valueKey="distance"/></SectionCard><SectionCard title="距离完成排名" note="连接运动员档案与训练记录" className="span-8"><AthleteTable sessions={sessions} metric="distance"/></SectionCard><SectionCard title={`${project}距离模型`} note="项目差异" className="span-4"><ProjectNotes project={project}/></SectionCard></div></>; }
  const total = sum(sessions, 'load'); const { acute, chronic, acwr } = loadSnapshot(sessions);
  return <><div className="special-metrics"><MetricCard icon={<Activity/>} label="总训练负荷" value={Math.round(total)} unit="AU" change={`来自 ${sessions.length} 条训练记录`}/><MetricCard icon={<TrendingUp/>} label="急性负荷（7天）" value={Math.round(acute)} unit="AU" change="近 7 天滚动值" tone="blue"/><MetricCard icon={<BarChart3/>} label="慢性负荷（28天）" value={Math.round(chronic)} unit="AU" change="近 28 天周均值" tone="green"/><MetricCard icon={<AlertTriangle/>} label="负荷风险 ACWR" value={round(acwr, 2)} change={acwr > 1.5 ? '负荷增长偏快，建议复核' : acwr < .8 ? '近期刺激偏低' : '处于常用监测区间'} tone="purple"/></div><div className="special-grid"><SectionCard title="急慢性负荷趋势" note="ACWR 建议区间 0.8–1.5" className="span-8"><TrendChart data={days} metric="load" secondary="chronic"/></SectionCard><SectionCard title="训练负荷构成" note="按 sRPE 统计" className="span-4"><TypeDonut sessions={sessions} valueKey="load"/></SectionCard><SectionCard title="运动员负荷与风险" note="按累计 sRPE 排序" className="span-8"><AthleteTable sessions={sessions} metric="load"/></SectionCard><SectionCard title="风险预警" note="根据当前记录自动识别" className="span-4"><InsightList warning items={loadRiskInsights(sessions)}/></SectionCard></div></>;
}

function ZoneBars({ data }: { data: Array<{ name: string; value: number }> }) { return <div className="zone-bars">{data.map((item, index) => <div key={item.name}><header><span><i style={{ background: COLORS[index] }}/>{item.name}</span><strong>{item.value}%</strong></header><b><i style={{ width: `${item.value}%`, background: COLORS[index] }}/></b></div>)}</div>; }

function MetricPage({ section, sessions, days, project }: { section: SpecialPageKey; sessions: Session[]; days: ReturnType<typeof aggregateDays>; project: Project }) {
  const kind = section === 'special-rate' ? 'rate' : section === 'special-heart' ? 'heart' : 'power'; const values = sessions.map((item) => kind === 'rate' ? item.strokeRate : kind === 'heart' ? item.heartRate : item.power).filter((value): value is number => value !== null); const average = values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : '—'; const peakValues = kind === 'heart' ? sessions.map((item) => item.maxHeartRate).filter((value): value is number => value !== null) : values; const peak = peakValues.length ? Math.max(...peakValues) : '—'; const metric = projectMetric(project, 1); const unit = kind === 'rate' ? metric.unit : kind === 'heart' ? 'bpm' : 'W'; const label = kind === 'rate' ? metric.label : kind === 'heart' ? '平均心率' : '平均功率';
  const maximum = Math.max(...values, 1); const zoneNames = kind === 'heart' ? ['Z1 恢复','Z2 有氧','Z3 阈值','Z4 高强度','Z5 极限'] : ['低强度','有氧耐力','乳酸阈','无氧功率']; const boundaries = kind === 'heart' ? [.6,.7,.8,.9] : [.55,.72,.86]; const counts = Array(zoneNames.length).fill(0) as number[]; values.forEach((value) => { const ratio = value / maximum; const zoneIndex = boundaries.findIndex((boundary) => ratio < boundary); counts[zoneIndex < 0 ? counts.length - 1 : zoneIndex] += 1; }); const zones = zoneNames.map((name, index) => ({ name, value: values.length ? round(counts[index] / values.length * 100) : 0 })); const numericAverage = typeof average === 'number' ? average : 0; const deviation = values.length ? Math.sqrt(values.reduce((total, value) => total + (value - numericAverage) ** 2, 0) / values.length) : 0; const stability = numericAverage > 0 ? Math.max(0, round(100 - deviation / numericAverage * 100)) : 0; const targetShare = zones.slice(1, 3).reduce((total, zone) => total + zone.value, 0); const coverage = sessions.length ? round(values.length / sessions.length * 100) : 0;
  return <><div className="special-metrics"><MetricCard icon={kind === 'heart' ? <HeartPulse/> : kind === 'power' ? <Zap/> : <Waves/>} label={label} value={average} unit={unit} change={`基于 ${values.length} 条有效记录`}/><MetricCard icon={<Gauge/>} label={kind === 'rate' ? `峰值${metric.label}` : kind === 'heart' ? '峰值心率' : '峰值功率'} value={peak} unit={unit} change="当前周期实测峰值" tone="blue"/><MetricCard icon={<Target/>} label="目标区间占比" value={targetShare} unit="%" change="中间两个训练区间" tone="green"/><MetricCard icon={<Activity/>} label={kind === 'power' ? '输出稳定性' : kind === 'rate' ? '节奏稳定性' : '心率稳定性'} value={stability} unit="%" change={`指标覆盖率 ${coverage}%`} tone="purple"/></div><div className="special-grid"><SectionCard title={`${label}趋势`} note={`${project} · ${unit}`} className="span-8"><TrendChart data={days} metric={kind} color={kind === 'heart' ? '#ef6b5b' : kind === 'power' ? '#7658cc' : '#12978f'}/></SectionCard><SectionCard title={kind === 'rate' ? `${metric.label}效率区间` : kind === 'heart' ? '心率区间分布' : '功率区间分布'} note="按有效训练记录" className="span-4"><ZoneBars data={zones}/></SectionCard><SectionCard title={`${label}运动员对比`} note="队内同项目口径" className="span-8"><AthleteTable sessions={sessions} metric={kind === 'rate' ? 'strokeRate' : kind === 'heart' ? 'heartRate' : 'power'}/></SectionCard><SectionCard title={`${project}专项解释`} note="指标随所选运动变化" className="span-4"><ProjectNotes project={project}/><div className="technique-note"><Sparkles/><span>重点评价：{metric.technique}</span></div></SectionCard></div></>;
}

function SchedulePage({ sessions, to, project }: { sessions: Session[]; to: string; project: Project }) {
  const monday = useMemo(() => { const d = new Date(`${to}T12:00:00`); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return d.toISOString().slice(0, 10); }, [to]); const types = ['技术训练', '战术训练', '体能训练', '恢复训练'];
  const plans = Array.from({ length: 7 }, (_, day) => ({ date: dateOffset(monday, day), day: ['周一','周二','周三','周四','周五','周六','周日'][day], sessions: day === 6 ? [] : Array.from({ length: day % 2 ? 2 : 3 }, (_, index) => ({ type: types[(day + index) % 4], time: index === 0 ? '06:30–09:00' : index === 1 ? '15:00–17:30' : '18:30–20:00', content: index === 0 ? (project === '激流' ? '门区线路 + 起航反应' : '2000m 节奏划行 + 起航技术') : index === 1 ? '专项间歇 + 技术录像复盘' : '主动恢复 + 拉伸放松' })) }));
  const plannedSessions = plans.flatMap((plan) => plan.sessions); const planCount = plannedSessions.length; const countType = (type: string) => plannedSessions.filter((item) => item.type === type).length; const weekEnd = dateOffset(monday, 6); const weekSessions = sessions.filter((item) => item.date >= monday && item.date <= weekEnd); const completedCount = Math.min(planCount, new Set(weekSessions.map((item) => `${item.date}|${item.type}`)).size); const completion = planCount ? Math.round(completedCount / planCount * 100) : 0; const selectedDayIndex = Math.max(0, Math.min(6, Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${monday}T12:00:00`).getTime()) / 86400000))); const selectedPlan = plans[selectedDayIndex]; const riskAdvice = loadRiskInsights(weekSessions)[0];
  return <><div className="special-metrics"><MetricCard icon={<CalendarDays/>} label="计划场次" value={planCount} unit="场" change={`${monday.slice(5)} 至 ${weekEnd.slice(5)}`}/><MetricCard icon={<Waves/>} label="技术训练占比" value={round(countType('技术训练') / Math.max(planCount, 1) * 100)} unit="%" change={`${countType('技术训练')} 场专项技术课`} tone="blue"/><MetricCard icon={<Activity/>} label="体能训练占比" value={round(countType('体能训练') / Math.max(planCount, 1) * 100)} unit="%" change={`${countType('体能训练')} 场体能训练`} tone="orange"/><MetricCard icon={<CheckCircle2/>} label="计划完成率" value={completion} unit="%" change={`已匹配 ${completedCount} / ${planCount} 场`} tone="purple"/></div><div className="special-grid"><SectionCard title="当前安排" note={`${monday} — ${weekEnd}`} className="span-12"><div className="week-schedule">{plans.map((plan) => <article key={plan.date}><header><strong>{plan.date.slice(5).replace('-', '/')}</strong><span>{plan.day}</span></header><div>{plan.sessions.map((session, index) => <div className={`schedule-event type-${types.indexOf(session.type)}`} key={index}><b>{session.type}</b><span>{session.time}</span><p>{session.content}</p></div>)}{!plan.sessions.length && <p className="rest-day">休息 / 自主恢复</p>}</div></article>)}</div></SectionCard><SectionCard title={`${selectedPlan.day}训练安排`} note="按当前结束日期定位" className="span-7"><div className="today-sessions">{selectedPlan.sessions.map((item, index) => <div key={index}><time>{item.time}</time><i className={`type-${types.indexOf(item.type)}`}>{item.type}</i><strong>{item.content}</strong><span>{index === 0 ? '水上训练场' : index === 1 ? '专项训练区' : '康复中心'}</span></div>)}{!selectedPlan.sessions.length && <p className="rest-day">休息 / 自主恢复</p>}</div></SectionCard><SectionCard title="计划完成进度" note={`第 ${isoWeekNumber(to)} 周`} className="span-5"><div className="progress-steps">{['训练安排已生成', `训练执行中（第${selectedDayIndex + 1}天/共7天）`, '周期总结', '数据分析与反馈'].map((item, index) => <div className={index === 0 ? 'done' : index === 1 ? 'current' : ''} key={item}><i>{index + 1}</i><span><strong>{item}</strong><small>{index === 0 ? '已完成' : index === 1 ? `${completion}%` : '待开始'}</small></span></div>)}</div></SectionCard><SectionCard title="训练类别构成" note="当前安排已执行记录" className="span-5"><TypeDonut sessions={weekSessions}/></SectionCard><SectionCard title="安排建议" note="来自当前负荷记录" className="span-7"><InsightList items={['高强度训练后安排恢复课，保留至少 24 小时调整窗口。',riskAdvice,'专项技术课后预留 20 分钟视频复盘，强化动作反馈。']}/></SectionCard></div></>;
}

export function SpecialTestsPage({ records, project, from, to, loading, section, onSectionChange }: Props) {
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [section]);
  const systemSessions = useMemo(() => recordSessions(records, project), [records, project]);
  const sessions = useMemo(() => systemSessions.filter((item) => item.date >= from && item.date <= to), [systemSessions, from, to]);
  const days = useMemo(() => aggregateDays(sessions), [sessions]); const meta = SECTION_META[section];
  const analysisTabs: Array<{ key: SpecialPageKey; label: string }> = [{ key: 'special-time', label: '时间' }, { key: 'special-distance', label: '距离' }, { key: 'special-load', label: '负荷' }];
  const metricTabs: Array<{ key: SpecialPageKey; label: string }> = [{ key: 'special-rate', label: project === '赛艇' ? '桨频' : '划频' }, { key: 'special-heart', label: '心率' }, { key: 'special-power', label: '功率' }];
  const pageTabs = analysisTabs.some((item) => item.key === section) ? analysisTabs : metricTabs.some((item) => item.key === section) ? metricTabs : [];
  const displayTitle = pageTabs.length ? meta.group : meta.title;
  const displayEnglish = meta.group === '综合分析' ? 'TRAINING ANALYSIS' : meta.group === '专项指标' ? 'SPECIAL METRICS' : meta.english;
  return <div className="page-content professional-overview special-training-page"><header className="page-heading special-page-heading"><div className="special-title-block"><span>{displayEnglish}</span><h1>{displayTitle}</h1><p>{meta.description}</p><div className="special-breadcrumb"><b>专项训练</b><ChevronRight/><span>{displayTitle}</span>{pageTabs.length > 0 && <><ChevronRight/><strong>{meta.title.replace('分析','')}</strong></>}</div></div></header>
    {pageTabs.length > 0 && <nav className="special-page-tabs" aria-label={`${displayTitle}指标切换`}>{pageTabs.map((item) => <button key={item.key} className={section === item.key ? 'active' : ''} aria-current={section === item.key ? 'page' : undefined} onClick={() => onSectionChange(item.key)}><span>{item.label}</span></button>)}</nav>}
    {loading ? <div className="special-loading"><RefreshCw className="spin"/>正在同步训练数据…</div> : !sessions.length && section !== 'special-schedule' ? <div className="special-empty"><FileSpreadsheet/><strong>当前日期范围内暂无训练记录</strong><span>可通过全局筛选栏调整日期或项目查看数据。</span></div> : ['special-time','special-distance','special-load'].includes(section) ? <><AnalysisPage section={section} sessions={sessions} days={days} project={project}/>{section === 'special-distance' && <SpecialPerformancePanel project={project} from={from} to={to}/>}</> : ['special-rate','special-heart','special-power'].includes(section) ? <MetricPage section={section} sessions={sessions} days={days} project={project}/> : section === 'special-schedule' ? <SchedulePage sessions={sessions} to={to} project={project}/> : null}
  </div>;
}
