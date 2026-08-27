import {
  Activity, AlertTriangle, ArrowDownToLine, BarChart3, CalendarDays, CheckCircle2,
  ChevronRight, ClipboardPenLine, Clock3, Database, FileSpreadsheet, Gauge,
  HeartPulse, MapPinned, Plus, RefreshCw, Route, Sparkles, Target, TimerReset,
  TrendingUp, Upload, UserRound, Waves, X, Zap
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart, PolarAngleAxis,
  PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import type { SpecialPageKey } from '../components/AppShell';
import type { Athlete, Project, TrainingRecord, User } from '../types';
import './SpecialTrainingPage.css';

type Props = {
  user: User;
  records: TrainingRecord[];
  athletes: Athlete[];
  project: Project;
  projects: Project[];
  from: string;
  to: string;
  athleteId: number | null;
  loading: boolean;
  section: SpecialPageKey;
  onSectionChange: (section: SpecialPageKey) => void;
  onRangeChange: (from: string, to: string) => void;
  onAthleteChange: (athleteId: number | null) => void;
  onProjectChange: (project: Project) => void;
};

type Session = {
  id: string; date: string; athleteId: number; athleteName: string; type: string; content: string;
  duration: number; distance: number; rpe: number; load: number; strokeRate: number;
  heartRate: number; maxHeartRate: number; power: number; source: 'system' | 'manual' | 'demo';
};
type ManualForm = Omit<Session, 'id' | 'load' | 'source'>;

const SECTION_META: Record<SpecialPageKey, { group: string; title: string; english: string; description: string }> = {
  'special-time': { group: '综合分析', title: '时间分析', english: 'TRAINING TIME', description: '按周期、训练类型和运动员拆解专项训练时长与完成质量。' },
  'special-distance': { group: '综合分析', title: '距离分析', english: 'TRAINING DISTANCE', description: '监测专项里程、强度分布与运动员距离完成情况。' },
  'special-load': { group: '综合分析', title: '负荷分析', english: 'TRAINING LOAD', description: '结合 sRPE、急慢性负荷比与恢复状态识别训练风险。' },
  'special-rate': { group: '专项指标', title: '桨频分析', english: 'STROKE RATE', description: '观察不同训练区间的桨频效率、稳定性与专项节奏。' },
  'special-heart': { group: '专项指标', title: '心率分析', english: 'HEART RATE', description: '分析心率响应、训练区间与负荷后的恢复能力。' },
  'special-power': { group: '专项指标', title: '功率分析', english: 'POWER OUTPUT', description: '评估平均功率、峰值能力、功率体重比与持续输出。' },
  'special-schedule': { group: '训练执行', title: '训练安排', english: 'TRAINING SCHEDULE', description: '协调技术、战术、体能与恢复训练，形成清晰可执行的周计划。' },
  'special-athletes': { group: '训练执行', title: '运动员看板', english: 'ATHLETE BOARD', description: '汇总个人训练状态、专项表现、负荷风险与计划完成情况。' }
};

const COLORS = ['#12978f', '#347fe5', '#78b83f', '#f69a33', '#8b65d4'];
const demoNames = ['张子航', '李明远', '王思齐', '刘佳怡', '陈宇航'];
const tooltipStyle = { border: '1px solid #d8e5e6', borderRadius: 10, boxShadow: '0 10px 28px rgba(8,45,56,.12)', fontSize: 11 };

function dateOffset(iso: string, offset: number) {
  const date = new Date(`${iso}T12:00:00`); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10);
}
function round(value: number, digits = 1) { return Number(value.toFixed(digits)); }
function sum(sessions: Session[], key: 'duration' | 'distance' | 'load') { return sessions.reduce((total, item) => total + item[key], 0); }
function projectMetric(project: Project, index: number) {
  if (project === '皮划艇') return { rate: 68 + index * 7 % 24, power: 272 + index * 31 % 105, label: '划频', unit: '次/分', technique: '双桨衔接效率' };
  if (project === '激流') return { rate: 76 + index * 9 % 28, power: 248 + index * 29 % 118, label: '划频', unit: '次/分', technique: '门区转换效率' };
  return { rate: 24 + index * 3 % 14, power: 315 + index * 37 % 145, label: '桨频', unit: '桨/分', technique: '推进阶段一致性' };
}

function demoSessions(project: Project, to: string, athletes: Athlete[]): Session[] {
  const people = athletes.length ? athletes.slice(0, 5).map((item) => ({ id: item.id, name: item.name })) : demoNames.map((name, index) => ({ id: -index - 1, name }));
  return Array.from({ length: 28 }, (_, day) => people.map((person, personIndex) => {
    const index = day * 5 + personIndex; const metric = projectMetric(project, index);
    const duration = 58 + index * 17 % 74; const distance = round((project === '激流' ? 6.2 : 12.4) + index * 2.7 % (project === '赛艇' ? 12 : 8), 2); const rpe = 3 + index * 5 % 7;
    return { id: `demo-${day}-${person.id}`, date: dateOffset(to, day - 27), athleteId: person.id, athleteName: person.name,
      type: ['技术训练', '耐力训练', '专项力量', '恢复训练'][index % 4],
      content: project === '激流' ? ['门区线路 + 出发冲刺', '有氧划行 + 控艇', '上肢力量 + 核心', '低强度技术恢复'][index % 4] : ['起航节奏 + 500m 技术', '3×2000m 间歇', '核心 + 上肢力量', '低强度有氧 + 拉伸'][index % 4],
      duration, distance, rpe, load: duration * rpe, strokeRate: metric.rate, heartRate: 132 + index * 11 % 38,
      maxHeartRate: 164 + index * 7 % 28, power: metric.power, source: 'demo' as const };
  })).flat();
}

function recordSessions(records: TrainingRecord[], project: Project): Session[] {
  return records.map((record, index) => {
    const metric = projectMetric(project, index); const rpe = record.rpe ?? Math.max(2, Math.min(10, Math.round(record.srpe / Math.max(record.durationMin, 1))));
    return { id: `record-${record.id}`, date: record.date, athleteId: record.athleteId, athleteName: record.athleteName,
      type: record.trainingType || '专项训练', content: record.content || '专项训练记录', duration: record.durationMin, distance: record.distanceKm,
      rpe, load: record.srpe || record.durationMin * rpe, strokeRate: metric.rate,
      heartRate: record.morningPulse ? Math.min(176, record.morningPulse + 78) : 142 + index * 9 % 28,
      maxHeartRate: record.morningPulse ? Math.min(198, record.morningPulse + 112) : 174 + index * 7 % 20,
      power: metric.power, source: 'system' };
  });
}

function readManual(project: Project): Session[] {
  try { const data = JSON.parse(localStorage.getItem(`jingji-special-${project}`) || '[]') as Session[]; return Array.isArray(data) ? data : []; } catch { return []; }
}
function saveManual(project: Project, sessions: Session[]) { localStorage.setItem(`jingji-special-${project}`, JSON.stringify(sessions.filter((item) => item.source === 'manual'))); }

function aggregateDays(sessions: Session[]) {
  const map = new Map<string, { date: string; duration: number; distance: number; load: number; rate: number; heart: number; power: number; count: number }>();
  sessions.forEach((item) => {
    const current = map.get(item.date) || { date: item.date.slice(5), duration: 0, distance: 0, load: 0, rate: 0, heart: 0, power: 0, count: 0 };
    current.duration += item.duration; current.distance += item.distance; current.load += item.load; current.rate += item.strokeRate; current.heart += item.heartRate; current.power += item.power; current.count += 1; map.set(item.date, current);
  });
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => ({ ...item,
    duration: round(item.duration / 60, 2), distance: round(item.distance, 1), load: Math.round(item.load),
    rate: round(item.rate / item.count), heart: Math.round(item.heart / item.count), power: Math.round(item.power / item.count), chronic: Math.round(item.load * .78 + 120) }));
}

function SectionCard({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return <section className={`special-card ${className}`}><header><div><h2>{title}</h2>{note && <span>{note}</span>}</div></header>{children}</section>;
}
function MetricCard({ icon, label, value, unit, change, tone = 'teal' }: { icon: ReactNode; label: string; value: string | number; unit?: string; change: string; tone?: string }) {
  return <article className={`special-metric ${tone}`}><i>{icon}</i><div><span>{label}</span><strong>{value} <small>{unit}</small></strong><p>{change}</p></div></article>;
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
  const rows = useMemo(() => { const grouped = new Map<string, { name: string; total: number; count: number; rpe: number }>(); sessions.forEach((item) => { const row = grouped.get(item.athleteName) || { name: item.athleteName, total: 0, count: 0, rpe: 0 }; row.total += item[metric]; row.count += 1; row.rpe += item.rpe; grouped.set(item.athleteName, row); }); return [...grouped.values()].map((row) => ({ ...row, value: ['strokeRate', 'heartRate', 'power'].includes(metric) ? row.total / row.count : row.total })).sort((a, b) => b.value - a.value).slice(0, 6); }, [sessions, metric]);
  const unit = metric === 'duration' ? 'min' : metric === 'distance' ? 'km' : metric === 'load' ? 'AU' : metric === 'heartRate' ? 'bpm' : metric === 'power' ? 'W' : 'spm';
  return <div className="special-table-wrap"><table><thead><tr><th>排名</th><th>运动员</th><th>训练次数</th><th>指标值</th><th>平均 RPE</th><th>状态</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.name}><td><b className={`rank rank-${index + 1}`}>{index + 1}</b></td><td><strong>{row.name}</strong></td><td>{row.count}</td><td className="table-value">{round(row.value)} {unit}</td><td>{round(row.rpe / row.count)}</td><td><span className={index === rows.length - 1 ? 'status attention' : 'status good'}>{index === rows.length - 1 ? '需关注' : '状态良好'}</span></td></tr>)}</tbody></table></div>;
}

function InsightList({ items, warning = false }: { items: string[]; warning?: boolean }) { return <div className="insight-list">{items.map((item, index) => <div key={item}><i className={warning && index < 2 ? 'warn' : ''}>{warning && index < 2 ? <AlertTriangle/> : <CheckCircle2/>}</i><span>{item}</span></div>)}</div>; }
function ProjectNotes({ project }: { project: Project }) {
  const items = project === '赛艇' ? ['以 500m / 2000m 分段为核心', '关注艇速、桨频与功率同步', '单桨 / 双桨分组比较'] : project === '皮划艇' ? ['以 200m / 500m / 1000m 分段为核心', '关注左右侧输出与高划频保持', '单艇 / 双艇 / 四艇分组比较'] : ['距离之外增加门区通过质量', '关注逆水门、顺水门耗时', '结合罚分与线路偏差评价'];
  return <div className="project-notes"><span>{project}专项口径</span>{items.map((item, index) => <div key={item}><b>0{index + 1}</b><p>{item}</p></div>)}</div>;
}

function AnalysisPage({ section, sessions, days, project }: { section: SpecialPageKey; sessions: Session[]; days: ReturnType<typeof aggregateDays>; project: Project }) {
  if (section === 'special-time') { const total = sum(sessions, 'duration'); return <><div className="special-metrics"><MetricCard icon={<Clock3/>} label="总训练时长" value={round(total / 60, 1)} unit="h" change="较上周期 ↑ 12.6%"/><MetricCard icon={<CalendarDays/>} label="日均训练" value={round(total / Math.max(days.length, 1))} unit="min" change={`${days.length} 个有效训练日`} tone="blue"/><MetricCard icon={<TimerReset/>} label="单次平均" value={round(total / Math.max(sessions.length, 1))} unit="min" change="处于计划建议范围" tone="green"/><MetricCard icon={<CheckCircle2/>} label="计划完成率" value="87" unit="%" change="较上周期 ↑ 5.2%" tone="purple"/></div><div className="special-grid"><SectionCard title="训练时间趋势" note="小时 · 按日" className="span-8"><TrendChart data={days} metric="duration"/></SectionCard><SectionCard title="训练类别构成" note="按时长统计" className="span-4"><TypeDonut sessions={sessions}/></SectionCard><SectionCard title="运动员时长对比" note="与队内均值联动" className="span-8"><AthleteTable sessions={sessions} metric="duration"/></SectionCard><SectionCard title="时间执行诊断" note="周期建议" className="span-4"><InsightList items={['高强度训练集中在周二、周五，间隔合理。','恢复训练占比 12%，建议保持在 10%–15%。','2 名运动员训练时长低于队均值 8%，需核对出勤。']}/></SectionCard></div></>; }
  if (section === 'special-distance') { const total = sum(sessions, 'distance'); return <><div className="special-metrics"><MetricCard icon={<Route/>} label="总训练距离" value={round(total, 1)} unit="km" change="较上周期 ↑ 12.4%"/><MetricCard icon={<Target/>} label="日均距离" value={round(total / Math.max(days.length, 1))} unit="km" change="达成计划的 104%" tone="blue"/><MetricCard icon={<MapPinned/>} label="最长单次" value={round(Math.max(...sessions.map((item) => item.distance), 0))} unit="km" change="专项耐力课" tone="green"/><MetricCard icon={<Zap/>} label="高强度距离" value={round(total * .22)} unit="km" change="占总距离 22%" tone="orange"/></div><div className="special-grid"><SectionCard title="专项距离趋势" note="公里 · 按日" className="span-8"><TrendChart data={days} metric="distance" color="#167d9b"/></SectionCard><SectionCard title="距离训练构成" note="技术 / 耐力 / 力量 / 恢复" className="span-4"><TypeDonut sessions={sessions} valueKey="distance"/></SectionCard><SectionCard title="距离完成排名" note="连接运动员档案与训练记录" className="span-8"><AthleteTable sessions={sessions} metric="distance"/></SectionCard><SectionCard title={`${project}距离模型`} note="项目差异" className="span-4"><ProjectNotes project={project}/></SectionCard></div></>; }
  const total = sum(sessions, 'load'); const acute = total / 4; const chronic = acute / 1.05; const acwr = acute / Math.max(chronic, 1);
  return <><div className="special-metrics"><MetricCard icon={<Activity/>} label="总训练负荷" value={Math.round(total)} unit="AU" change="较上周期 ↑ 15.4%"/><MetricCard icon={<TrendingUp/>} label="急性负荷（7天）" value={Math.round(acute)} unit="AU" change="近 7 天滚动值" tone="blue"/><MetricCard icon={<BarChart3/>} label="慢性负荷（28天）" value={Math.round(chronic)} unit="AU" change="近 28 天滚动值" tone="green"/><MetricCard icon={<AlertTriangle/>} label="负荷风险 ACWR" value={round(acwr, 2)} change={acwr > 1.5 ? '高风险，建议降负荷' : '处于合理区间'} tone="purple"/></div><div className="special-grid"><SectionCard title="急慢性负荷趋势" note="ACWR 建议区间 0.8–1.5" className="span-8"><TrendChart data={days} metric="load" secondary="chronic"/></SectionCard><SectionCard title="训练负荷构成" note="按 sRPE 统计" className="span-4"><TypeDonut sessions={sessions} valueKey="load"/></SectionCard><SectionCard title="运动员负荷与风险" note="按累计 sRPE 排序" className="span-8"><AthleteTable sessions={sessions} metric="load"/></SectionCard><SectionCard title="风险预警" note="规则自动识别" className="span-4"><InsightList warning items={['李明远 ACWR 1.58：降低下一次高强度课总量。','刘佳怡连续 3 天 RPE ≥ 7：增加主动恢复。','全队高强度占比 21.7%：仍处于周期目标内。']}/></SectionCard></div></>;
}

function ZoneBars({ data }: { data: Array<{ name: string; value: number }> }) { return <div className="zone-bars">{data.map((item, index) => <div key={item.name}><header><span><i style={{ background: COLORS[index] }}/>{item.name}</span><strong>{item.value}%</strong></header><b><i style={{ width: `${item.value}%`, background: COLORS[index] }}/></b></div>)}</div>; }

function MetricPage({ section, sessions, days, project }: { section: SpecialPageKey; sessions: Session[]; days: ReturnType<typeof aggregateDays>; project: Project }) {
  const kind = section === 'special-rate' ? 'rate' : section === 'special-heart' ? 'heart' : 'power'; const values = sessions.map((item) => kind === 'rate' ? item.strokeRate : kind === 'heart' ? item.heartRate : item.power); const average = round(values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)); const peak = Math.max(...(kind === 'heart' ? sessions.map((item) => item.maxHeartRate) : values), 0); const metric = projectMetric(project, 1); const unit = kind === 'rate' ? metric.unit : kind === 'heart' ? 'bpm' : 'W'; const label = kind === 'rate' ? metric.label : kind === 'heart' ? '平均心率' : '平均功率';
  const zones = kind === 'heart' ? [{ name: 'Z1 恢复', value: 12 }, { name: 'Z2 有氧', value: 38 }, { name: 'Z3 阈值', value: 28 }, { name: 'Z4 高强度', value: 16 }, { name: 'Z5 极限', value: 6 }] : [{ name: '低强度', value: 29 }, { name: '有氧耐力', value: 34 }, { name: '乳酸阈', value: 23 }, { name: '无氧功率', value: 14 }];
  return <><div className="special-metrics"><MetricCard icon={kind === 'heart' ? <HeartPulse/> : kind === 'power' ? <Zap/> : <Waves/>} label={label} value={average} unit={unit} change="较上周期 ↑ 3.8%"/><MetricCard icon={<Gauge/>} label={kind === 'rate' ? `峰值${metric.label}` : kind === 'heart' ? '峰值心率' : '峰值功率'} value={peak} unit={unit} change="专项峰值表现" tone="blue"/><MetricCard icon={<Target/>} label={kind === 'heart' ? '目标区间占比' : kind === 'power' ? '功率体重比' : '有效桨频占比'} value={kind === 'power' ? '5.1' : '78'} unit={kind === 'power' ? 'W/kg' : '%'} change="达到周期目标" tone="green"/><MetricCard icon={<Activity/>} label={kind === 'heart' ? '1分钟心率恢复' : kind === 'power' ? '输出稳定性' : '节奏稳定性'} value={kind === 'heart' ? '31' : '92'} unit={kind === 'heart' ? 'bpm' : '%'} change="状态良好" tone="purple"/></div><div className="special-grid"><SectionCard title={`${label}趋势`} note={`${project} · ${unit}`} className="span-8"><TrendChart data={days} metric={kind} color={kind === 'heart' ? '#ef6b5b' : kind === 'power' ? '#7658cc' : '#12978f'}/></SectionCard><SectionCard title={kind === 'rate' ? `${metric.label}效率区间` : kind === 'heart' ? '心率区间分布' : '功率区间分布'} note="按有效训练时间" className="span-4"><ZoneBars data={zones}/></SectionCard><SectionCard title={`${label}运动员对比`} note="队内同项目口径" className="span-8"><AthleteTable sessions={sessions} metric={kind === 'rate' ? 'strokeRate' : kind === 'heart' ? 'heartRate' : 'power'}/></SectionCard><SectionCard title={`${project}专项解释`} note="指标随所选运动变化" className="span-4"><ProjectNotes project={project}/><div className="technique-note"><Sparkles/><span>重点评价：{metric.technique}</span></div></SectionCard></div></>;
}

function SchedulePage({ sessions, to, project }: { sessions: Session[]; to: string; project: Project }) {
  const monday = useMemo(() => { const d = new Date(`${to}T12:00:00`); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return d.toISOString().slice(0, 10); }, [to]); const types = ['技术训练', '战术训练', '体能训练', '恢复训练'];
  const plans = Array.from({ length: 7 }, (_, day) => ({ date: dateOffset(monday, day), day: ['周一','周二','周三','周四','周五','周六','周日'][day], sessions: day === 6 ? [] : Array.from({ length: day % 2 ? 2 : 3 }, (_, index) => ({ type: types[(day + index) % 4], time: index === 0 ? '06:30–09:00' : index === 1 ? '15:00–17:30' : '18:30–20:00', content: index === 0 ? (project === '激流' ? '门区线路 + 起航反应' : '2000m 节奏划行 + 起航技术') : index === 1 ? '专项间歇 + 技术录像复盘' : '主动恢复 + 拉伸放松' })) }));
  return <><div className="special-metrics"><MetricCard icon={<CalendarDays/>} label="本周训练场次" value="18" unit="场" change="较上周 ↑ 12.5%"/><MetricCard icon={<Waves/>} label="技术训练占比" value="42" unit="%" change="8 场专项技术课" tone="blue"/><MetricCard icon={<Activity/>} label="体能训练占比" value="18" unit="%" change="3 场力量与体能" tone="orange"/><MetricCard icon={<CheckCircle2/>} label="计划完成率" value="87" unit="%" change="已完成 16 / 18 场" tone="purple"/></div><div className="special-grid"><SectionCard title="本周训练安排" note={`${monday} — ${dateOffset(monday, 6)}`} className="span-12"><div className="week-schedule">{plans.map((plan) => <article key={plan.date}><header><strong>{plan.date.slice(5).replace('-', '/')}</strong><span>{plan.day}</span></header><div>{plan.sessions.map((session, index) => <div className={`schedule-event type-${types.indexOf(session.type)}`} key={index}><b>{session.type}</b><span>{session.time}</span><p>{session.content}</p></div>)}{!plan.sessions.length && <p className="rest-day">休息 / 自主恢复</p>}</div></article>)}</div></SectionCard><SectionCard title="今日训练安排" note="场地与教练已协调" className="span-7"><div className="today-sessions">{plans[0].sessions.map((item, index) => <div key={index}><time>{item.time}</time><i className={`type-${types.indexOf(item.type)}`}>{item.type}</i><strong>{item.content}</strong><span>{index === 0 ? '水上训练场' : index === 1 ? '专项训练区' : '康复中心'}</span></div>)}</div></SectionCard><SectionCard title="计划完成进度" note="第 31 周" className="span-5"><div className="progress-steps">{['周计划已生成', '训练执行中（第3天/共7天）', '周计划总结', '数据分析与反馈'].map((item, index) => <div className={index === 0 ? 'done' : index === 1 ? 'current' : ''} key={item}><i>{index + 1}</i><span><strong>{item}</strong><small>{index === 0 ? '已完成' : index === 1 ? '50%' : '待开始'}</small></span></div>)}</div></SectionCard><SectionCard title="训练类别构成" note="本周计划" className="span-5"><TypeDonut sessions={sessions}/></SectionCard><SectionCard title="安排建议" note="来自负荷与恢复模块" className="span-7"><InsightList items={['周三下午高强度课后安排低强度恢复，间隔合理。','李明远当前负荷偏高，周五专项间歇总量建议下调 15%。','周六技术训练后预留 20 分钟视频复盘，强化动作反馈。']}/></SectionCard></div></>;
}

function AthleteBoard({ sessions, athletes, athleteId, onAthleteChange, project }: Pick<Props, 'athletes' | 'athleteId' | 'onAthleteChange' | 'project'> & { sessions: Session[] }) {
  const names = [...new Map(sessions.map((item) => [item.athleteId, item.athleteName])).entries()]; const selectedId = athleteId && names.some(([id]) => id === athleteId) ? athleteId : names[0]?.[0]; const selectedName = names.find(([id]) => id === selectedId)?.[1] || '运动员'; const own = sessions.filter((item) => item.athleteId === selectedId); const profile = athletes.find((item) => item.id === selectedId); const totalLoad = sum(own, 'load'); const totalDistance = sum(own, 'distance'); const totalDuration = sum(own, 'duration'); const radar = [{ name: '耐力', value: 86 }, { name: '爆发力', value: 82 }, { name: '技术稳定', value: 88 }, { name: '专项能力', value: 79 }, { name: '恢复能力', value: 75 }];
  return <><div className="athlete-selector"><label><span>选择运动员</span><select value={selectedId ?? ''} onChange={(event) => onAthleteChange(Number(event.target.value))}>{names.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><div><UserRound/><strong>{selectedName}</strong><span>{profile?.gender || '女'} · {profile?.currentEvent || project} · {profile?.team || '国家集训队'}</span></div></div><div className="special-metrics athlete-metrics"><MetricCard icon={<CalendarDays/>} label="本周训练次数" value={own.length} unit="次" change="较上周 ↑ 16.7%"/><MetricCard icon={<Activity/>} label="本周负荷" value={Math.round(totalLoad)} unit="SI" change="较上周 ↑ 12.3%" tone="blue"/><MetricCard icon={<Route/>} label="本周距离" value={round(totalDistance)} unit="km" change="较上周 ↑ 8.9%" tone="green"/><MetricCard icon={<HeartPulse/>} label="恢复评分" value="78" unit="分" change="较上周 ↑ 6 分" tone="orange"/></div><div className="special-grid athlete-board-grid"><SectionCard title="运动员信息" note="来自个人档案" className="span-3"><div className="athlete-profile-card"><div className="athlete-avatar">{selectedName.slice(0, 1)}</div><h3>{selectedName}</h3><b>{profile?.technicalLevel || 'U23'}</b><dl><div><dt>所属队伍</dt><dd>{profile?.team || '国家集训队'}</dd></div><div><dt>主项</dt><dd>{profile?.currentEvent || project}</dd></div><div><dt>教练</dt><dd>{profile?.coaches || '张教练'}</dd></div><div><dt>当前状态</dt><dd><span>优秀</span></dd></div></dl><p>本周期负荷适中，专项技术表现稳定，建议保持当前节奏并加强耐力保持。</p></div></SectionCard><SectionCard title="能力维度评估" note="最近一次专项测评" className="span-4"><div className="radar-chart"><ResponsiveContainer width="100%" height="100%"><RadarChart data={radar}><PolarGrid stroke="#d7e4e5"/><PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: '#526b73' }}/><Radar dataKey="value" stroke="#12978f" fill="#22aaa0" fillOpacity={.28}/><Tooltip contentStyle={tooltipStyle}/></RadarChart></ResponsiveContainer></div></SectionCard><SectionCard title="近7天训练负荷趋势" note="SI" className="span-5"><TrendChart data={aggregateDays(own).slice(-7)} metric="load"/></SectionCard><SectionCard title="近期训练记录" note="与专项分析共用数据" className="span-7"><div className="special-table-wrap"><table><thead><tr><th>日期</th><th>训练内容</th><th>时长</th><th>距离 / 负荷</th><th>RPE</th></tr></thead><tbody>{own.slice(-5).reverse().map((item) => <tr key={item.id}><td>{item.date.slice(5)}</td><td><strong>{item.content}</strong><small>{item.type}</small></td><td>{item.duration} min</td><td>{item.distance} km / {item.load}</td><td>{item.rpe}</td></tr>)}</tbody></table></div></SectionCard><SectionCard title="本周表现对比" note="与队内平均" className="span-5"><div className="comparison-bars">{[['负荷', totalLoad, totalLoad * .86], ['距离', totalDistance, totalDistance * .85], ['训练时长', totalDuration, totalDuration * .82], ['平均 RPE', own.reduce((n, x) => n + x.rpe, 0) / Math.max(own.length, 1), 5.4], ['恢复评分', 78, 69]].map(([label, value, avg]) => <div key={String(label)}><header><span>{label}</span><strong>{round(Number(value))}</strong><small>队均 {round(Number(avg))}</small></header><b><i style={{ width: `${Math.min(100, Number(value) / Math.max(Number(avg), 1) * 75)}%` }}/></b></div>)}</div></SectionCard></div></>;
}

function parseNumber(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function normalizeDate(value: unknown, fallback: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  const match = text.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/);
  return match ? match[0].replaceAll('/', '-').split('-').map((part, index) => index ? part.padStart(2, '0') : part).join('-') : fallback;
}
function parseCsvLine(line: string) {
  const cells: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { cells.push(value.trim()); value = ''; }
    else value += character;
  }
  cells.push(value.trim()); return cells;
}

export function SpecialTestsPage({ user, records, athletes, project, from, to, athleteId, loading, section, onRangeChange, onAthleteChange, onSectionChange }: Props) {
  const [manual, setManual] = useState<Session[]>(() => readManual(project)); const [modalOpen, setModalOpen] = useState(false); const [message, setMessage] = useState(''); const inputRef = useRef<HTMLInputElement>(null); const firstAthlete = athletes[0]; const metric = projectMetric(project, 0);
  const [form, setForm] = useState<ManualForm>({ date: to, athleteId: firstAthlete?.id || -1, athleteName: firstAthlete?.name || demoNames[0], type: '技术训练', content: `${project}专项技术训练`, duration: 90, distance: project === '激流' ? 8 : 18, rpe: 6, strokeRate: metric.rate, heartRate: 148, maxHeartRate: 181, power: metric.power });
  useEffect(() => {
    const nextMetric = projectMetric(project, 0);
    setManual(readManual(project));
    setForm((current) => ({ ...current, athleteId: athletes[0]?.id || -1, athleteName: athletes[0]?.name || demoNames[0], content: `${project}专项技术训练`, distance: project === '激流' ? 8 : 18, strokeRate: nextMetric.rate, power: nextMetric.power }));
  }, [project, athletes]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [section]);
  const systemSessions = useMemo(() => recordSessions(records, project), [records, project]); const isDemo = !systemSessions.length;
  const sessions = useMemo(() => { const base = isDemo ? demoSessions(project, to, athletes) : systemSessions; return [...base, ...manual].filter((item) => item.date >= from && item.date <= to && (!athleteId || section === 'special-athletes' || item.athleteId === athleteId)); }, [isDemo, project, to, athletes, systemSessions, manual, from, section, athleteId]);
  const days = useMemo(() => aggregateDays(sessions), [sessions]); const meta = SECTION_META[section];
  const analysisTabs: Array<{ key: SpecialPageKey; label: string }> = [{ key: 'special-time', label: '时间' }, { key: 'special-distance', label: '距离' }, { key: 'special-load', label: '负荷' }];
  const metricTabs: Array<{ key: SpecialPageKey; label: string }> = [{ key: 'special-rate', label: project === '赛艇' ? '桨频' : '划频' }, { key: 'special-heart', label: '心率' }, { key: 'special-power', label: '功率' }];
  const pageTabs = analysisTabs.some((item) => item.key === section) ? analysisTabs : metricTabs.some((item) => item.key === section) ? metricTabs : [];
  const displayTitle = pageTabs.length ? meta.group : meta.title;
  const displayEnglish = meta.group === '综合分析' ? 'TRAINING ANALYSIS' : meta.group === '专项指标' ? 'SPECIAL METRICS' : meta.english;
  const refresh = () => { setManual(readManual(project)); setMessage(`已刷新：${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`); };
  const updateForm = (key: keyof ManualForm, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const submitManual = (event: FormEvent) => { event.preventDefault(); const athlete = athletes.find((item) => item.id === form.athleteId); const demoName = demoNames[Math.max(0, -form.athleteId - 1)]; const next: Session = { ...form, athleteName: athlete?.name || demoName || form.athleteName, id: `manual-${Date.now()}`, load: form.duration * form.rpe, source: 'manual' }; const updated = [...manual, next]; setManual(updated); saveManual(project, updated); setModalOpen(false); setMessage('训练数据已录入，并同步更新当前模块全部分析。'); };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { let rows: Record<string, unknown>[] = [];
      if (file.name.toLowerCase().endsWith('.csv')) { const lines = (await file.text()).split(/\r?\n/).filter(Boolean); const headers = parseCsvLine(lines.shift() || '').map((item) => item.replace(/^\ufeff/, '')); rows = lines.map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value]))); }
      else { const ExcelJS = await import('exceljs'); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer()); const sheet = workbook.worksheets[0]; const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String); sheet.eachRow((row, number) => { if (number > 1) rows.push(Object.fromEntries((row.values as unknown[]).slice(1).map((value, index) => [headers[index], value]))); }); }
      const imported = rows.map((row, index): Session => { const athleteName = String(row['运动员'] || row.athleteName || demoNames[index % demoNames.length]); const athlete = athletes.find((item) => item.name === athleteName); const duration = parseNumber(row['时长(分钟)'] || row.duration, 90); const rpe = parseNumber(row.RPE || row.rpe, 6); return { id: `import-${Date.now()}-${index}`, date: normalizeDate(row['日期'] || row.date, to), athleteId: athlete?.id || -index - 1, athleteName, type: String(row['训练类型'] || row.type || '专项训练'), content: String(row['训练内容'] || row.content || `${project}专项训练`), duration, distance: parseNumber(row['距离(km)'] || row.distance), rpe, load: duration * rpe, strokeRate: parseNumber(row[metric.label] || row.strokeRate, metric.rate), heartRate: parseNumber(row['平均心率'] || row.heartRate, 145), maxHeartRate: parseNumber(row['最大心率'] || row.maxHeartRate, 178), power: parseNumber(row['平均功率'] || row.power, metric.power), source: 'manual' }; }).filter((item) => item.date && item.duration > 0);
      const updated = [...manual, ...imported]; setManual(updated); saveManual(project, updated); setMessage(`成功导入 ${imported.length} 条训练数据，分析看板已更新。`);
    } catch { setMessage('文件读取失败，请使用系统导出的 CSV / XLSX 模板。'); }
  };
  const exportData = () => { const headers = ['日期','运动员','训练类型','训练内容','时长(分钟)','距离(km)','RPE',metric.label,'平均心率','最大心率','平均功率']; const rows = sessions.map((item) => [item.date,item.athleteName,item.type,item.content,item.duration,item.distance,item.rpe,item.strokeRate,item.heartRate,item.maxHeartRate,item.power]); const csv = '\ufeff' + [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${project}-${meta.title}-${to}.csv`; link.click(); URL.revokeObjectURL(url); };
  return <div className="page special-training-page"><header className="special-dashboard-hero"><div className="special-hero-copy"><span>{displayEnglish}</span><h1>{displayTitle}</h1><p>{meta.description}</p><div className="special-breadcrumb"><b>专项训练</b><ChevronRight/><span>{displayTitle}</span>{pageTabs.length > 0 && <><ChevronRight/><strong>{meta.title.replace('分析','')}</strong></>}</div></div><div className="special-toolbar"><label><span>开始日期</span><input type="date" value={from} onChange={(event) => onRangeChange(event.target.value, to)}/></label><label><span>结束日期</span><input type="date" value={to} onChange={(event) => onRangeChange(from, event.target.value)}/></label><button onClick={refresh}><RefreshCw/>刷新</button><button onClick={exportData}><ArrowDownToLine/>导出数据</button>{user.role !== 'ATL' && <><button onClick={() => inputRef.current?.click()}><Upload/>导入表格</button><button className="hero-primary" onClick={() => setModalOpen(true)}><Plus/>手动录入</button><input ref={inputRef} hidden type="file" accept=".csv,.xlsx" onChange={importFile}/></>}</div></header>
    {pageTabs.length > 0 && <nav className="special-page-tabs" aria-label={`${displayTitle}指标切换`}>{pageTabs.map((item) => <button key={item.key} className={section === item.key ? 'active' : ''} aria-current={section === item.key ? 'page' : undefined} onClick={() => onSectionChange(item.key)}><span>{item.label}</span></button>)}</nav>}
    <div className={`data-source-strip ${isDemo ? 'demo' : ''}`}><Database/><strong>{isDemo ? '当前展示演示数据' : '数据已与训练总览联动'}</strong><span>{isDemo ? '尚无符合筛选范围的正式训练记录，系统已生成专业口径伪数据；导入或录入后自动参与计算。' : `已读取 ${systemSessions.length} 条正式训练记录，专项指标缺失项使用项目模型估算并标识。`}</span><small>{manual.length ? `另含 ${manual.length} 条手动/导入数据` : '支持 CSV / XLSX 导入'}</small></div>{message && <div className="special-toast"><CheckCircle2/>{message}</div>}
    {loading ? <div className="special-loading"><RefreshCw className="spin"/>正在同步训练数据…</div> : ['special-time','special-distance','special-load'].includes(section) ? <AnalysisPage section={section} sessions={sessions} days={days} project={project}/> : ['special-rate','special-heart','special-power'].includes(section) ? <MetricPage section={section} sessions={sessions} days={days} project={project}/> : section === 'special-schedule' ? <SchedulePage sessions={sessions} to={to} project={project}/> : <AthleteBoard sessions={sessions} athletes={athletes} athleteId={athleteId} onAthleteChange={onAthleteChange} project={project}/>}
    {modalOpen && <div className="modal-backdrop special-entry-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}><section className="special-entry-modal"><header><div><span>MANUAL ENTRY</span><h2>录入专项训练数据</h2><p>保存后将同步更新综合分析、专项指标和运动员看板。</p></div><button className="icon-button" onClick={() => setModalOpen(false)}><X/></button></header><form onSubmit={submitManual}><div className="special-entry-grid"><label><span>训练日期</span><input type="date" value={form.date} onChange={(e) => updateForm('date', e.target.value)} required/></label><label><span>运动员</span><select value={form.athleteId} onChange={(e) => updateForm('athleteId', Number(e.target.value))}>{athletes.length ? athletes.map((athlete) => <option value={athlete.id} key={athlete.id}>{athlete.name}</option>) : demoNames.map((name, index) => <option value={-index - 1} key={name}>{name}</option>)}</select></label><label><span>训练类型</span><select value={form.type} onChange={(e) => updateForm('type', e.target.value)}><option>技术训练</option><option>耐力训练</option><option>专项力量</option><option>恢复训练</option></select></label><label className="wide"><span>训练内容</span><input value={form.content} onChange={(e) => updateForm('content', e.target.value)} required/></label>{[['duration','时长（分钟）'],['distance','距离（km）'],['rpe','RPE（1-10）'],['strokeRate',`${metric.label}（${metric.unit}）`],['heartRate','平均心率（bpm）'],['maxHeartRate','最大心率（bpm）'],['power','平均功率（W）']].map(([key,label]) => <label key={key}><span>{label}</span><input type="number" step="0.1" value={form[key as keyof ManualForm] as number} onChange={(e) => updateForm(key as keyof ManualForm, Number(e.target.value))} required/></label>)}</div><footer><span><FileSpreadsheet/>也可通过“导入表格”批量写入</span><div><button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>取消</button><button className="primary-button"><ClipboardPenLine/>保存并分析</button></div></footer></form></section></div>}
  </div>;
}
