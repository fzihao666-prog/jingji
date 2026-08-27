import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Gauge,
  Target,
  TrendingUp
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useMemo, useState } from 'react';
import {
  STRENGTH_BODY_POSITIONS,
  STRENGTH_INTENSITY_ZONES,
  STRENGTH_TRAINING_CATEGORIES,
  inferStrengthBodyPosition,
  inferStrengthCategory,
  type StrengthBodyPosition,
  type StrengthTrainingCategory
} from '../../shared/strength-training';
import { STRENGTH_METRICS, type StrengthMetricKey } from '../../shared/strength-model';
import type { StrengthTest, StrengthTrainingSession, TrainingPlanData } from '../types';
import './StrengthTrainingInsights.css';

const palette = ['#0d9488', '#21b7aa', '#3b82f6', '#f59e0b', '#f97316', '#ef4444', '#6366f1'];
const categoryPalette = ['#0d9488', '#2db7a8', '#55c7bb', '#83d6ca', '#b1e4dc'];

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function conicGradient(items: Array<{ value: number }>, colors: string[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return '#e8efef';
  let cursor = 0;
  return `conic-gradient(${items.map((item, index) => {
    const start = cursor;
    cursor += item.value / total * 100;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(',')})`;
}

function radarPoints(values: number[], radius = 86, center = 110) {
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
    const scaled = radius * Math.max(0, Math.min(110, value)) / 110;
    return `${center + Math.cos(angle) * scaled},${center + Math.sin(angle) * scaled}`;
  }).join(' ');
}

function sessionLoad(session: StrengthTrainingSession) {
  if (session.srpe > 0) return session.srpe;
  return (session.rpe || 0) * (session.durationMin || 0);
}

function categoryOf(exerciseName: string, category?: string): StrengthTrainingCategory {
  return STRENGTH_TRAINING_CATEGORIES.includes(category as StrengthTrainingCategory)
    ? category as StrengthTrainingCategory
    : inferStrengthCategory(exerciseName);
}

function bodyPositionOf(exerciseName: string, bodyPosition?: string): StrengthBodyPosition {
  return STRENGTH_BODY_POSITIONS.includes(bodyPosition as StrengthBodyPosition)
    ? bodyPosition as StrengthBodyPosition
    : inferStrengthBodyPosition(exerciseName);
}

function metricCards(sessions: StrengthTrainingSession[]) {
  const sets = sessions.flatMap((session) => session.sets);
  const rpeValues = sets.map((set) => set.rpe).filter((value): value is number => value !== null);
  const completed = sets.filter((set) => set.completed).length;
  const duration = sessions.reduce((sum, session) => sum + (session.durationMin || 0), 0);
  const load = sessions.reduce((sum, session) => sum + sessionLoad(session), 0);
  const intensityValues = sets.map((set) => set.intensityPercent).filter((value): value is number => value !== null);
  return {
    rpe: rpeValues.length ? round(rpeValues.reduce((sum, value) => sum + value, 0) / rpeValues.length, 1) : 0,
    duration: round(duration),
    load: round(load),
    intensity: intensityValues.length ? round(intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length) : 0,
    completion: sets.length ? round(completed / sets.length * 100) : 0,
    volume: round(sessions.reduce((sum, session) => sum + (session.volume || 0), 0)),
    distance: round(sessions.reduce((sum, session) => sum + (session.distanceKm || 0), 0), 1)
  };
}

function EmptyChart({ text }: { text: string }) {
  return <div className="strength-insight-empty"><BarChart3 size={24} /><span>{text}</span></div>;
}

function OverviewCards({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const stats = useMemo(() => metricCards(sessions), [sessions]);
  const cards = [
    { label: '平均 RPE', value: stats.rpe || '—', suffix: '', icon: Activity },
    { label: '训练时间', value: stats.duration, suffix: 'min', icon: Clock3 },
    { label: '训练负荷', value: stats.load, suffix: 'AU', icon: Gauge, featured: true },
    { label: '训练强度', value: stats.intensity, suffix: '%', icon: TrendingUp },
    { label: '完成率', value: stats.completion, suffix: '%', icon: CheckCircle2 }
  ];
  return <section className="strength-kpi-grid">{cards.map(({ icon: Icon, ...card }) => <article className={card.featured ? 'featured' : ''} key={card.label}><i><Icon size={20} /></i><div><span>{card.label}</span><strong>{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}<small>{card.suffix}</small></strong></div></article>)}</section>;
}

export function StrengthOverviewPanel({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const { trend, categories, positions, completion } = useMemo(() => {
    const recent = [...sessions].sort((a, b) => a.trainingDate.localeCompare(b.trainingDate)).slice(-7);
    const trend = recent.map((session) => ({ date: session.trainingDate.slice(5), load: round(sessionLoad(session)), rpe: session.rpe || 0 }));
    const categoryMap = new Map(STRENGTH_TRAINING_CATEGORIES.map((name) => [name, 0]));
    const positionMap = new Map(STRENGTH_BODY_POSITIONS.map((name) => [name, 0]));
    const completionMap = new Map(STRENGTH_TRAINING_CATEGORIES.map((name) => [name, { total: 0, done: 0 }]));
    sessions.flatMap((session) => session.sets).forEach((set) => {
      const category = categoryOf(set.exerciseName, set.trainingCategory);
      const bodyPosition = bodyPositionOf(set.exerciseName, set.bodyPosition);
      categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
      positionMap.set(bodyPosition, (positionMap.get(bodyPosition) || 0) + 1);
      const item = completionMap.get(category)!;
      item.total += 1;
      if (set.completed) item.done += 1;
    });
    return {
      trend,
      categories: [...categoryMap].map(([name, value]) => ({ name, value })),
      positions: [...positionMap].map(([name, value]) => ({ name, value })),
      completion: [...completionMap].map(([name, value]) => ({ name, count: value.total, percent: value.total ? round(value.done / value.total * 100) : 0 }))
    };
  }, [sessions]);

  return <>
    <OverviewCards sessions={sessions} />
    <section className="strength-dashboard-grid">
      <article className="strength-chart-card"><header><div><span>最近 7 日</span><h2>训练负荷趋势</h2></div><small>柱状：训练负荷 · 折线：RPE</small></header><div className="strength-chart-area">{trend.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={trend}><CartesianGrid stroke="#e8efef" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis yAxisId="load" tick={{ fontSize: 10 }} /><YAxis yAxisId="rpe" orientation="right" domain={[0, 10]} tick={{ fontSize: 10 }} /><Tooltip /><Bar yAxisId="load" dataKey="load" name="训练负荷 AU" fill="#0d9488" radius={[5, 5, 0, 0]} maxBarSize={30} /><Line yAxisId="rpe" dataKey="rpe" name="RPE" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} /></ComposedChart></ResponsiveContainer> : <EmptyChart text="导入训练记录后显示近 7 日趋势" />}</div></article>
      <article className="strength-chart-card"><header><div><span>训练内容</span><h2>五类体能训练构成</h2></div></header><div className="strength-donut-layout">{categories.some((item) => item.value) ? <div className="strength-css-donut" style={{ background: conicGradient(categories, categoryPalette) }}><i><strong>{categories.reduce((sum, item) => sum + item.value, 0)}</strong><small>训练项</small></i></div> : <EmptyChart text="暂无训练类型数据" />}<div className="strength-chart-list">{categories.map((item, index) => <div key={item.name}><i style={{ background: categoryPalette[index] }} /><span>{item.name}</span><strong>{item.value}项</strong></div>)}</div></div></article>
      <article className="strength-chart-card"><header><div><span>动作覆盖</span><h2>身体位置训练分布</h2></div></header><div className="strength-chart-area compact">{positions.some((item) => item.value) ? <ResponsiveContainer width="100%" height="100%"><BarChart data={positions} layout="vertical" margin={{ left: 10, right: 24 }}><CartesianGrid stroke="#e8efef" horizontal={false} /><XAxis type="number" hide /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={42} /><Tooltip /><Bar dataKey="value" name="训练项" fill="#21b7aa" radius={[0, 6, 6, 0]} barSize={16} /></BarChart></ResponsiveContainer> : <EmptyChart text="暂无身体位置数据" />}</div></article>
      <article className="strength-chart-card"><header><div><span>本周期</span><h2>训练完成情况</h2></div></header><div className="strength-completion-list">{completion.map((item) => <div key={item.name}><div><strong>{item.name}</strong><span>{item.count}项</span><em>{item.percent}%</em></div><i><b style={{ width: `${item.percent}%` }} /></i></div>)}</div></article>
    </section>
  </>;
}

export function StrengthAnalysisPanel({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'cycle'>('cycle');
  const stats = useMemo(() => metricCards(sessions), [sessions]);
  const data = useMemo(() => {
    const ordered = [...sessions].sort((a, b) => a.trainingDate.localeCompare(b.trainingDate));
    const limited = period === 'week' ? ordered.slice(-7) : period === 'month' ? ordered.slice(-30) : ordered;
    const daily = limited.map((session) => ({ date: session.trainingDate.slice(5), volume: round(session.distanceKm || session.volume / 1000, 1), duration: round(session.durationMin || 0) }));
    const intensity = STRENGTH_INTENSITY_ZONES.map((zone) => ({ name: zone, value: limited.reduce((sum, session) => sum + session.sets.filter((set) => (set.intensityZone || session.intensityZone) === zone).length, 0) }));
    const environmentMap = new Map<string, number>();
    limited.forEach((session) => session.sets.forEach((set) => {
      const environment = set.trainingEnvironment || (session.structureType.includes('水') ? '水上' : '陆上');
      environmentMap.set(environment, (environmentMap.get(environment) || 0) + (set.durationMin || session.durationMin / Math.max(1, session.sets.length) || 1));
    }));
    const water = [...environmentMap].filter(([name]) => ['水上', '泳池'].includes(name)).reduce((sum, [, value]) => sum + value, 0);
    const land = [...environmentMap].filter(([name]) => !['水上', '泳池'].includes(name)).reduce((sum, [, value]) => sum + value, 0);
    const sessionTypes = [...environmentMap].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    return { daily, intensity, water, land, sessionTypes };
  }, [period, sessions]);
  const intensityTotal = data.intensity.reduce((sum, item) => sum + item.value, 0);
  const environmentTotal = data.water + data.land;

  return <>
    <section className="strength-analysis-summary"><article><span>总训练量</span><strong>{stats.distance > 0 ? stats.distance.toLocaleString() : round(stats.volume / 1000, 1).toLocaleString()} <small>{stats.distance > 0 ? 'km' : '千kg·reps'}</small></strong></article><article><span>训练时间</span><strong>{stats.duration.toLocaleString()} <small>min</small></strong></article><article><span>平均 RPE</span><strong>{stats.rpe || '—'}</strong></article><article className="load"><span>累计训练负荷</span><strong>{stats.load.toLocaleString()} <small>AU</small></strong></article></section>
    <section className="strength-dashboard-grid analysis">
      <article className="strength-chart-card"><header><div><span>训练节奏</span><h2>每日训练量与训练时间</h2></div><div className="strength-period-switch"><button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>周</button><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>月</button><button className={period === 'cycle' ? 'active' : ''} onClick={() => setPeriod('cycle')}>周期</button></div></header><div className="strength-chart-area">{data.daily.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.daily}><CartesianGrid stroke="#e8efef" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis yAxisId="volume" tick={{ fontSize: 9 }} /><YAxis yAxisId="time" orientation="right" tick={{ fontSize: 9 }} /><Tooltip /><Bar yAxisId="volume" dataKey="volume" name={stats.distance > 0 ? '训练距离 km' : '训练量 千kg·reps'} fill="#0d9488" radius={[4, 4, 0, 0]} /><Line yAxisId="time" dataKey="duration" name="训练时间 min" stroke="#84cc16" strokeWidth={2} dot={{ r: 2.5 }} /></ComposedChart></ResponsiveContainer> : <EmptyChart text="导入训练记录后生成日趋势" />}</div></article>
      <article className="strength-chart-card"><header><div><span>U3 / U2 / U1 / AT / TPT / AN / ATP</span><h2>训练强度分布</h2></div></header><div className="strength-donut-layout">{intensityTotal ? <div className="strength-css-donut" style={{ background: conicGradient(data.intensity, palette) }}><i><strong>{round(Math.max(...data.intensity.map((item) => item.value)) / intensityTotal * 100, 1)}%</strong><small>主强度区</small></i></div> : <EmptyChart text="暂无强度区间数据" />}<div className="strength-chart-list">{data.intensity.map((item, index) => <div key={item.name}><i style={{ background: palette[index] }} /><span>{item.name}</span><strong>{intensityTotal ? round(item.value / intensityTotal * 100, 1) : 0}%</strong></div>)}</div></div></article>
      <article className="strength-chart-card ratio-card"><header><div><span>环境结构</span><h2>水陆训练负荷占比</h2></div></header><div className="water-land-ratio"><strong>{environmentTotal ? round(data.water / environmentTotal * 100) : 0}<small>:</small>{environmentTotal ? round(data.land / environmentTotal * 100) : 0}</strong><div className="ratio-track"><i style={{ width: `${environmentTotal ? data.water / environmentTotal * 100 : 0}%` }} /></div><div><span>水上训练 <b>{environmentTotal ? round(data.water / environmentTotal * 100) : 0}%</b></span><span>陆上训练 <b>{environmentTotal ? round(data.land / environmentTotal * 100) : 0}%</b></span></div><small>按训练时间与动作记录汇总</small></div></article>
      <article className="strength-chart-card"><header><div><span>训练环境与课型</span><h2>训练课类型构成</h2></div></header><div className="strength-chart-area compact">{data.sessionTypes.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data.sessionTypes} layout="vertical" margin={{ left: 14, right: 38 }}><CartesianGrid stroke="#e8efef" horizontal={false} /><XAxis type="number" hide /><YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={50} /><Tooltip /><Bar dataKey="value" name="训练时间 min" fill="#0d9488" radius={[0, 6, 6, 0]} barSize={14} /></BarChart></ResponsiveContainer> : <EmptyChart text="暂无训练课类型数据" />}</div></article>
    </section>
  </>;
}

const assessmentMetrics: Array<{ key: StrengthMetricKey; label: string; domain: string }> = [
  { key: 'squatKg', label: '深蹲 1RM', domain: '基础力量' },
  { key: 'benchPressKg', label: '卧推 1RM', domain: '基础力量' },
  { key: 'frontPlankSec', label: '核心稳定', domain: '核心力量' },
  { key: 'highPullKg', label: '专项拉力', domain: '专项力量' },
  { key: 'wingatePeakPowerWkg', label: '代谢能力', domain: '代谢能力' }
];

export function StrengthAssessmentPanel({ tests }: { tests: StrengthTest[] }) {
  const current = tests[0];
  const previous = tests[1];
  const cards = assessmentMetrics.map((item) => {
    const definition = STRENGTH_METRICS.find((metric) => metric.key === item.key);
    const value = current?.metrics[item.key];
    const old = previous?.metrics[item.key];
    const change = typeof value === 'number' && typeof old === 'number' && old !== 0 ? round((value - old) / old * 100, 1) : null;
    return { ...item, unit: definition?.unit || '', value, old, change };
  });
  const history = [...tests].reverse().map((test) => ({ date: test.testDate.slice(5), squat: test.metrics.squatKg, bench: test.metrics.benchPressKg, core: test.metrics.frontPlankSec }));
  const radarData = cards.map((item) => {
    const target = current?.targets[item.key];
    const score = typeof item.value === 'number' && typeof target === 'number' && target > 0 ? Math.min(110, round(item.value / target * 100)) : typeof item.value === 'number' ? 80 : 0;
    const previousScore = typeof item.old === 'number' && typeof target === 'number' && target > 0 ? Math.min(110, round(item.old / target * 100)) : typeof item.old === 'number' ? 72 : 0;
    return { domain: item.domain, current: score, previous: previousScore };
  });

  if (!current) return <section className="strength-empty results"><Target size={30} /><strong>还没有体能测试记录</strong><span>请先在个人档案中录入体能测试，之后这里会显示当前能力与历史变化。</span></section>;
  return <>
    <section className="strength-assessment-meta"><div><span>本次测试</span><strong>{current.testDate}</strong></div><div><span>对比周期</span><strong>{previous ? `${previous.testDate} → ${current.testDate}` : '暂无上次测试'}</strong></div><div><span>测试指标</span><strong>{Object.keys(current.metrics).length} 项</strong></div></section>
    <section className="strength-assessment-cards">{cards.map((item, index) => <article key={item.key}><i><Dumbbell size={18} /></i><span>{item.label}</span><strong>{item.value ?? '—'} <small>{item.unit}</small></strong><em className={item.change !== null && item.change < 0 ? 'down' : ''}>{item.change === null ? '待形成对比' : `${item.change >= 0 ? '↑' : '↓'} ${Math.abs(item.change)}%`}</em></article>)}</section>
    <section className="strength-dashboard-grid assessment"><article className="strength-chart-card"><header><div><span>历史测试</span><h2>关键能力趋势</h2></div></header><div className="strength-chart-area">{history.length > 1 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={history}><CartesianGrid stroke="#e8efef" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend /><Line dataKey="squat" name="深蹲 kg" stroke="#0d9488" strokeWidth={2.5} connectNulls /><Line dataKey="bench" name="卧推 kg" stroke="#3b82f6" strokeWidth={2.5} connectNulls /><Line dataKey="core" name="核心 秒" stroke="#84cc16" strokeWidth={2.5} connectNulls /></LineChart></ResponsiveContainer> : <EmptyChart text="至少两次测试后显示历史趋势" />}</div></article><article className="strength-chart-card"><header><div><span>目标达成度</span><h2>能力提升对比</h2></div></header><div className="strength-radar-wrap"><svg className="strength-native-radar" viewBox="0 0 220 220" role="img" aria-label="本次测试与上次测试能力雷达图">{[22, 43, 65, 86].map((radius) => <polygon key={radius} points={radarPoints(radarData.map(() => 110), radius)} className="radar-ring" />)}{radarData.map((_, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / radarData.length; return <line key={index} x1="110" y1="110" x2={110 + Math.cos(angle) * 86} y2={110 + Math.sin(angle) * 86} />; })}<polygon points={radarPoints(radarData.map((item) => item.previous))} className="radar-previous" /><polygon points={radarPoints(radarData.map((item) => item.current))} className="radar-current" />{radarData.map((item, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / radarData.length; return <text key={`${item.domain}-${index}`} x={110 + Math.cos(angle) * 104} y={114 + Math.sin(angle) * 99} textAnchor={Math.cos(angle) > .2 ? 'start' : Math.cos(angle) < -.2 ? 'end' : 'middle'}>{item.domain}</text>; })}</svg><div className="strength-radar-legend"><span><i />上次测试</span><span><i />本次测试</span></div></div></article></section>
    <section className="strength-assessment-table"><header><div><span>评估结果</span><h2>五类能力摘要</h2></div></header><div className="assessment-head"><span>能力维度</span><span>指标</span><span>上次</span><span>本次</span><span>变化</span><span>结论</span></div>{cards.map((item) => <div className="assessment-row" key={item.key}><strong>{item.domain}</strong><span>{item.label}</span><span>{item.old ?? '—'} {item.old !== undefined ? item.unit : ''}</span><span>{item.value ?? '—'} {item.value !== undefined ? item.unit : ''}</span><span className={item.change !== null && item.change < 0 ? 'down' : 'up'}>{item.change === null ? '—' : `${item.change >= 0 ? '+' : ''}${item.change}%`}</span><em>{item.change === null ? '待对比' : item.change >= 0 ? '提升' : '关注'}</em></div>)}</section>
  </>;
}

export function StrengthPlanCategoryTabs({ value, onChange }: { value: StrengthTrainingCategory; onChange: (category: StrengthTrainingCategory) => void }) {
  return <nav className="strength-category-tabs" aria-label="体能训练类型">{STRENGTH_TRAINING_CATEGORIES.map((category) => <button className={value === category ? 'active' : ''} key={category} onClick={() => onChange(category)}>{category}</button>)}</nav>;
}
