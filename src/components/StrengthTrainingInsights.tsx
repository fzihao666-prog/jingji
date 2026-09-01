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
import type { CSSProperties, MouseEvent } from 'react';
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
const loadRatioPalette = ['#0d9488', '#dc4f45'];
const lessonPalette = ['#0d9488', '#3b82f6', '#84cc16', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#64748b'];
const lessonTypes = ['水上', '测功仪功能', '拉伸再生', '力量耐力', '最大力量', '速度力量', '跑步', '其他'];
type LoadBreakdownItem = { name: string; value: number; percent: number; sessions: number; duration: number; distance: number; rpe: number; color: string };
type LessonBreakdownItem = LoadBreakdownItem & { sets: number; completion: number };
type CategoryExecutionItem = { name: StrengthTrainingCategory; count: number; percent: number; completion: number; done: number; color: string };

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

function isoDateFromTime(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

function isoDateTime(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
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

function lessonTypeOf(session: StrengthTrainingSession) {
  const text = `${session.sessionLabel} ${session.trainingType} ${session.structureType} ${session.sets.map((set) => `${set.exerciseName} ${set.trainingCategory}`).join(' ')}`;
  if (/水上|划行|专项耐力/.test(text)) return '水上';
  if (/测功仪|划船机|erg/i.test(text)) return '测功仪功能';
  if (/拉伸|再生|恢复|放松/.test(text)) return '拉伸再生';
  if (/力量耐力|循环力量|耐力力量/.test(text)) return '力量耐力';
  if (/最大力量|深蹲|硬拉|卧推|卧拉/.test(text)) return '最大力量';
  if (/速度力量|爆发|冲刺|快速/.test(text)) return '速度力量';
  if (/跑步|跑|间歇跑/.test(text)) return '跑步';
  return '其他';
}

function isWaterSession(session: StrengthTrainingSession) {
  const environments = new Set(session.sets.map((set) => set.trainingEnvironment || session.structureType));
  return environments.has('水上') || environments.has('泳池') || /水上|泳池|划行/.test(`${session.sessionLabel} ${session.trainingType} ${session.structureType}`);
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

function RoundRatioChart({ items, colors, center, unit }: { items: Array<{ name: string; value: number }>; colors: string[]; center: string; unit: string }) {
  const [active, setActive] = useState<{ name: string; value: number; percent: number; color: string } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <EmptyChart text="暂无可统计数据" />;
  const segments = items.map((item, index) => ({ ...item, percent: round(item.value / total * 100, 1), color: colors[index % colors.length] }));
  const onOrbMove = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const angle = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360;
    let cursor = 0;
    const matched = segments.find((segment) => {
      const next = cursor + segment.value / total * 360;
      const hit = angle >= cursor && angle <= next;
      cursor = next;
      return hit;
    }) || segments[segments.length - 1];
    setActive(matched);
    setTooltip({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  return <div className="strength-round-chart">
    <div className="strength-ratio-orb" style={{ background: conicGradient(items, colors) }} onMouseMove={onOrbMove} onMouseLeave={() => { setActive(null); setTooltip(null); }}><i><strong>{active?.name || center}</strong><small>{active ? `${active.percent}% · ${round(active.value).toLocaleString()} AU` : unit}</small></i>{active && tooltip && <div className="strength-orb-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{active.name}</strong><span>{active.percent}%</span><small>{round(active.value).toLocaleString()} AU</small></div>}</div>
    <div className="strength-round-list">{segments.map((item) => (
      <div className={active?.name === item.name ? 'active' : ''} key={item.name} onMouseEnter={() => setActive(item)} onMouseLeave={() => setActive(null)}>
        <span><i style={{ background: item.color }} />{item.name}</span><strong>{item.percent}%</strong>
      </div>
    ))}</div>
  </div>;
}

function OverviewCards({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const stats = useMemo(() => metricCards(sessions), [sessions]);
  const cards = [
    { label: '平均 RPE', value: stats.rpe || '—', suffix: '', icon: Activity },
    { label: '训练时间', value: stats.duration, suffix: 'min', icon: Clock3 },
    { label: '训练负荷', value: stats.load, suffix: 'AU', icon: Gauge },
    { label: '训练强度', value: stats.intensity, suffix: '%', icon: TrendingUp },
    { label: '完成率', value: stats.completion, suffix: '%', icon: CheckCircle2 }
  ];
  return <section className="strength-kpi-grid">{cards.map(({ icon: Icon, ...card }) => <article key={card.label}><i><Icon size={20} /></i><div><span>{card.label}</span><strong>{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}<small>{card.suffix}</small></strong></div></article>)}</section>;
}

function WaterLandLoadPanel({ items }: { items: LoadBreakdownItem[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const water = items.find((item) => item.name === '水上') || items[0];
  const land = items.find((item) => item.name === '陆上') || items[1];
  if (!total) return <EmptyChart text="暂无水陆负荷数据" />;
  return <div className="strength-load-split">
    <div className="load-split-hero">
      <div>
        <span>水上负荷</span>
        <strong>{water.percent}<small>%</small></strong>
        <em>{water.value.toLocaleString()} AU</em>
      </div>
      <div>
        <span>陆上负荷</span>
        <strong>{land.percent}<small>%</small></strong>
        <em>{land.value.toLocaleString()} AU</em>
      </div>
    </div>
    <div className="load-split-track" aria-label={`水上负荷 ${water.percent}%，陆上负荷 ${land.percent}%`}>
      {items.map((item) => <i key={item.name} style={{ width: `${item.percent}%`, background: item.color }} />)}
    </div>
    <div className="load-split-table">
      {items.map((item) => <article key={item.name}>
        <header><i style={{ background: item.color }} /><strong>{item.name}</strong><span>{item.sessions} 场</span></header>
        <dl>
          <div><dt>训练时间</dt><dd>{item.duration.toLocaleString()} min</dd></div>
          <div><dt>训练距离</dt><dd>{item.distance.toLocaleString()} km</dd></div>
          <div><dt>平均 RPE</dt><dd>{item.rpe || '—'}</dd></div>
        </dl>
      </article>)}
    </div>
  </div>;
}

function LessonCompositionPanel({ items }: { items: LessonBreakdownItem[] }) {
  const visible = items.filter((item) => item.value > 0);
  const dominant = visible[0];
  if (!visible.length) return <EmptyChart text="暂无训练课类型数据" />;
  return <div className="strength-lesson-composition">
    <div className="lesson-summary">
      <span>主课型</span>
      <strong>{dominant.name}</strong>
      <small>{dominant.percent}% · {dominant.value.toLocaleString()} AU · {dominant.sessions} 场</small>
    </div>
    <div className="lesson-rank-list">
      {visible.map((item) => <article key={item.name}>
        <header><span><i style={{ background: item.color }} />{item.name}</span><strong>{item.percent}%</strong></header>
        <div className="lesson-rank-track"><i style={{ width: `${item.percent}%`, background: item.color }} /></div>
        <footer><span>{item.value.toLocaleString()} AU</span><span>{item.duration.toLocaleString()} min</span><span>{item.sets} 项</span><span>完成 {item.completion}%</span></footer>
      </article>)}
    </div>
  </div>;
}

function CategoryExecutionPanel({ items }: { items: CategoryExecutionItem[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const completed = items.reduce((sum, item) => sum + item.done, 0);
  const leading = items.reduce((best, item) => item.count > best.count ? item : best, items[0]);
  if (!total) return <EmptyChart text="暂无训练类型与完成数据" />;
  return <div className="strength-category-execution">
    <div className="category-execution-summary">
      <article>
        <span>训练项</span>
        <strong>{total}</strong>
        <small>覆盖 {items.filter((item) => item.count > 0).length} 类</small>
      </article>
      <article>
        <span>总完成率</span>
        <strong>{round(completed / total * 100)}<small>%</small></strong>
        <small>{completed} / {total} 项完成</small>
      </article>
      <article>
        <span>主训练类</span>
        <strong>{leading.name}</strong>
        <small>{leading.percent}% · {leading.count} 项</small>
      </article>
    </div>
    <div className="category-execution-list">
      {items.map((item) => <article key={item.name}>
        <header><span><i style={{ background: item.color }} />{item.name}</span><strong>{item.count} 项</strong><em>{item.completion}%</em></header>
        <div className="category-execution-track">
          <i style={{ width: `${item.percent}%`, background: item.color }} />
          <b style={{ left: `${item.completion}%` }} />
        </div>
        <footer><span>构成 {item.percent}%</span><span>完成 {item.done}/{item.count}</span></footer>
      </article>)}
    </div>
  </div>;
}

function BodyPositionMapPanel({ items }: { items: Array<{ name: StrengthBodyPosition; value: number }> }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <EmptyChart text="暂无身体位置数据" />;
  const bodyRegions: Record<StrengthBodyPosition, { pointX: number; pointY: number; labelX: number; labelY: number; align: 'left' | 'right'; region: string; note: string; color: string; short: string }> = {
    上肢: { pointX: 43, pointY: 35, labelX: 25, labelY: 34, align: 'left', region: 'upper', note: '推、拉、肩胛与划桨牵拉链', color: '#0d9488', short: '推拉链' },
    核心: { pointX: 51, pointY: 50, labelX: 76, labelY: 47, align: 'right', region: 'core', note: '躯干稳定、抗旋转与力量传导', color: '#f59e0b', short: '传导轴' },
    下肢: { pointX: 49, pointY: 73, labelX: 25, labelY: 76, align: 'left', region: 'lower', note: '蹬伸、支撑、跳跃与跑动能力', color: '#3b82f6', short: '蹬伸端' },
    全身: { pointX: 50, pointY: 24, labelX: 76, labelY: 25, align: 'right', region: 'full', note: '综合协调与全链条动作', color: '#073b4c', short: '全链路' }
  };
  const enriched = items.map((item, index) => ({
    ...item,
    order: index + 1,
    percent: round(item.value / total * 100, 1),
    ...bodyRegions[item.name]
  }));
  const dominant = enriched.reduce((best, item) => item.value > best.value ? item : best, enriched[0]);
  return <div className="strength-body-position-map">
    <div className="body-map-stage">
      <img src="/assets/strength-anatomy-front.png" alt="身体部位训练分布示意图" />
      <div className={`body-region full ${items.find((item) => item.name === '全身')?.value ? 'active' : ''}`} />
      {enriched.map((item) => item.name !== '全身' && <div className={`body-region ${item.region}`} key={`${item.name}-region`} style={{ opacity: Math.max(.18, Math.min(.58, .2 + item.percent / 100 * .7)), background: item.color }} />)}
      <svg className="body-map-connectors" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
        {enriched.map((item) => <g key={`${item.name}-connector`}>
          <line x1={item.pointX} y1={item.pointY} x2={item.labelX} y2={item.labelY} stroke={item.color} />
          <circle cx={item.pointX} cy={item.pointY} r="1.45" fill={item.color} />
        </g>)}
      </svg>
      {enriched.map((item) => <div className={`body-map-label ${item.align} ${item.value ? 'active' : ''}`} key={item.name} style={{ left: `${item.labelX}%`, top: `${item.labelY}%`, '--hotspot-size': `${Math.max(32, Math.min(62, 32 + item.percent * .55))}px` } as CSSProperties}>
        <i style={{ color: item.color }}><b>{item.order}</b></i>
        <span>
          <strong>{item.name}<small>{item.short}</small></strong>
          <em>{item.value} 项 · {item.percent}%</em>
        </span>
      </div>)}
    </div>
    <div className="body-map-detail">
      <article>
        <span>重点部位</span>
        <strong>{dominant.name}</strong>
        <small>{dominant.note}</small>
      </article>
      <div>
        {enriched.map((item) => <section key={item.name}>
          <header><span><i style={{ background: item.color }} />{item.name}<small>{item.short}</small></span><strong>{item.percent}%</strong></header>
          <i><b style={{ width: `${item.percent}%` }} /></i>
          <footer><span>{item.value} 项</span><span>{item.note}</span></footer>
        </section>)}
      </div>
    </div>
  </div>;
}

export function StrengthOverviewPanel({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const { daily21Weeks, loadRatio, lessonRatio, trend, categoryExecution, positions } = useMemo(() => {
    const ordered = [...sessions].sort((a, b) => a.trainingDate.localeCompare(b.trainingDate));
    const recent = ordered.slice(-7);
    const trend = recent.map((session) => ({ date: session.trainingDate.slice(5), load: round(sessionLoad(session)), rpe: session.rpe || 0 }));
    const earliest = ordered[0]?.trainingDate;
    const latest = ordered.at(-1)?.trainingDate || isoDateFromTime(Date.now());
    const endTime = isoDateTime(latest);
    const earliestTime = earliest ? isoDateTime(earliest) : endTime;
    const startTime = Math.max(earliestTime, endTime - 20 * 7 * 24 * 60 * 60 * 1000);
    const dailyMap = new Map<string, { date: string; label: string; distance: number; duration: number }>();
    for (let time = startTime; time <= endTime; time += 24 * 60 * 60 * 1000) {
      const date = isoDateFromTime(time);
      dailyMap.set(date, { date, label: date.slice(5).replace('-', '/'), distance: 0, duration: 0 });
    }
    ordered.forEach((session) => {
      const item = dailyMap.get(session.trainingDate);
      if (!item) return;
      item.distance += session.distanceKm || 0;
      item.duration += session.durationMin || 0;
    });
    const daily21Weeks = [...dailyMap.values()].map((item) => ({
      ...item,
      distance: round(item.distance, 1),
      duration: round(item.duration)
    }));
    const categoryMap = new Map(STRENGTH_TRAINING_CATEGORIES.map((name) => [name, 0]));
    const positionMap = new Map(STRENGTH_BODY_POSITIONS.map((name) => [name, 0]));
    const completionMap = new Map(STRENGTH_TRAINING_CATEGORIES.map((name) => [name, { total: 0, done: 0 }]));
    const loadRatioMap = new Map(['水上', '陆上'].map((name) => [name, { value: 0, sessions: 0, duration: 0, distance: 0, rpeSum: 0, rpeCount: 0 }]));
    const lessonRatioMap = new Map(lessonTypes.map((name) => [name, { value: 0, sessions: 0, duration: 0, distance: 0, rpeSum: 0, rpeCount: 0, sets: 0, done: 0 }]));
    ordered.forEach((session) => {
      const load = sessionLoad(session) || session.durationMin || 0;
      const environmentItem = loadRatioMap.get(isWaterSession(session) ? '水上' : '陆上')!;
      environmentItem.value += load;
      environmentItem.sessions += 1;
      environmentItem.duration += session.durationMin || 0;
      environmentItem.distance += session.distanceKm || 0;
      if (session.rpe !== null) {
        environmentItem.rpeSum += session.rpe;
        environmentItem.rpeCount += 1;
      }
      const lessonType = lessonTypeOf(session);
      const lessonItem = lessonRatioMap.get(lessonType)!;
      lessonItem.value += load;
      lessonItem.sessions += 1;
      lessonItem.duration += session.durationMin || 0;
      lessonItem.distance += session.distanceKm || 0;
      lessonItem.sets += session.sets.length;
      lessonItem.done += session.sets.filter((set) => set.completed).length;
      if (session.rpe !== null) {
        lessonItem.rpeSum += session.rpe;
        lessonItem.rpeCount += 1;
      }
    });
    sessions.flatMap((session) => session.sets).forEach((set) => {
      const category = categoryOf(set.exerciseName, set.trainingCategory);
      const bodyPosition = bodyPositionOf(set.exerciseName, set.bodyPosition);
      categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
      positionMap.set(bodyPosition, (positionMap.get(bodyPosition) || 0) + 1);
      const item = completionMap.get(category)!;
      item.total += 1;
      if (set.completed) item.done += 1;
    });
    const loadTotal = [...loadRatioMap.values()].reduce((sum, item) => sum + item.value, 0);
    const lessonTotal = [...lessonRatioMap.values()].reduce((sum, item) => sum + item.value, 0);
    const categoryTotal = [...categoryMap.values()].reduce((sum, value) => sum + value, 0);
    return {
      daily21Weeks,
      loadRatio: [...loadRatioMap].map(([name, item], index) => ({
        name,
        value: round(item.value),
        percent: loadTotal ? round(item.value / loadTotal * 100) : 0,
        sessions: item.sessions,
        duration: round(item.duration),
        distance: round(item.distance, 1),
        rpe: item.rpeCount ? round(item.rpeSum / item.rpeCount, 1) : 0,
        color: loadRatioPalette[index]
      })),
      lessonRatio: [...lessonRatioMap].map(([name, item], index) => ({
        name,
        value: round(item.value),
        percent: lessonTotal ? round(item.value / lessonTotal * 100, 1) : 0,
        sessions: item.sessions,
        duration: round(item.duration),
        distance: round(item.distance, 1),
        rpe: item.rpeCount ? round(item.rpeSum / item.rpeCount, 1) : 0,
        sets: item.sets,
        completion: item.sets ? round(item.done / item.sets * 100) : 0,
        color: lessonPalette[index]
      })).sort((a, b) => b.value - a.value),
      trend,
      categoryExecution: [...categoryMap].map(([name, value], index) => {
        const item = completionMap.get(name)!;
        return {
          name,
          count: value,
          percent: categoryTotal ? round(value / categoryTotal * 100, 1) : 0,
          completion: item.total ? round(item.done / item.total * 100) : 0,
          done: item.done,
          color: categoryPalette[index]
        };
      }),
      positions: [...positionMap].map(([name, value]) => ({ name, value })),
    };
  }, [sessions]);
  const hasDailyTraining = daily21Weeks.some((item) => item.distance > 0 || item.duration > 0);
  const waterLoad = loadRatio.find((item) => item.name === '水上')?.value || 0;
  const landLoad = loadRatio.find((item) => item.name === '陆上')?.value || 0;
  const loadTotal = waterLoad + landLoad;
  const waterPercent = loadTotal ? round(waterLoad / loadTotal * 100) : 0;
  const landPercent = loadTotal ? 100 - waterPercent : 0;
  const dailyTickInterval = daily21Weeks.length > 60 ? 13 : daily21Weeks.length > 31 ? 6 : daily21Weeks.length > 14 ? 3 : 0;

  return <>
    <OverviewCards sessions={sessions} />
    <section className="strength-dashboard-grid">
      <article className="strength-chart-card strength-daily-volume-card"><header><div><span>每日训练量</span><h2>训练距离与训练时间</h2></div><small>柱状：训练距离 · 折线：训练时间</small></header><div className="strength-chart-area daily-volume">{hasDailyTraining ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily21Weeks} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}><CartesianGrid stroke="#e8efef" vertical={false} /><XAxis dataKey="label" interval={dailyTickInterval} tick={{ fontSize: 9 }} tickLine={false} /><YAxis yAxisId="distance" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={42} label={{ value: 'km', angle: -90, position: 'insideLeft', offset: 8, fill: '#6f858b', fontSize: 9 }} /><YAxis yAxisId="time" orientation="right" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={38} label={{ value: 'min', angle: 90, position: 'insideRight', offset: 5, fill: '#6f858b', fontSize: 9 }} /><Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''} formatter={(value, name) => name === '训练时间' ? [`${value} min`, name] : [`${value} km`, name]} contentStyle={{ border: '1px solid #d5e2e4', borderRadius: 8, boxShadow: '0 10px 24px rgba(7,59,76,.1)', fontSize: 10 }} /><Bar yAxisId="distance" dataKey="distance" name="训练距离" fill="#0d9488" radius={[3, 3, 0, 0]} maxBarSize={12} /><Line yAxisId="time" type="monotone" dataKey="duration" name="训练时间" stroke="#f59e0b" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} connectNulls /></ComposedChart></ResponsiveContainer> : <EmptyChart text="导入训练距离或训练时间后显示日趋势" />}</div></article>
      <article className="strength-chart-card strength-load-split-card"><header><div><span>水陆训练负荷</span><h2>水上与陆上负荷</h2></div><small>{loadTotal ? `水上 ${waterPercent}% · 陆上 ${landPercent}%` : '按 sRPE 与训练时间汇总'}</small></header><WaterLandLoadPanel items={loadRatio} /></article>
      <article className="strength-chart-card strength-lesson-card"><header><div><span>训练环境与课型</span><h2>训练课类型构成</h2></div><small>按负荷、时间、动作项和完成率汇总</small></header><LessonCompositionPanel items={lessonRatio} /></article>
      <article className="strength-chart-card"><header><div><span>最近 7 日</span><h2>训练负荷趋势</h2></div><small>柱状：训练负荷 · 折线：RPE</small></header><div className="strength-chart-area">{trend.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={trend}><CartesianGrid stroke="#e8efef" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis yAxisId="load" tick={{ fontSize: 10 }} /><YAxis yAxisId="rpe" orientation="right" domain={[0, 10]} tick={{ fontSize: 10 }} /><Tooltip /><Bar yAxisId="load" dataKey="load" name="训练负荷 AU" fill="#0d9488" radius={[5, 5, 0, 0]} maxBarSize={30} /><Line yAxisId="rpe" dataKey="rpe" name="RPE" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} /></ComposedChart></ResponsiveContainer> : <EmptyChart text="导入训练记录后显示近 7 日趋势" />}</div></article>
      <article className="strength-chart-card strength-category-execution-card"><header><div><span>训练内容与执行</span><h2>五类体能训练构成与完成</h2></div><small>训练项占比 · 分类完成率</small></header><CategoryExecutionPanel items={categoryExecution} /></article>
      <article className="strength-chart-card strength-body-map-card"><header><div><span>动作覆盖</span><h2>身体位置训练分布</h2></div><small>人体部位热点 · 训练项占比</small></header><BodyPositionMapPanel items={positions} /></article>
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
