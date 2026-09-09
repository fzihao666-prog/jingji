import { Activity, ArrowRight, Target, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { TrainingContentChart, TrainingIntensityChart, TrainingVolumeChart, trainingLoadCategory } from '../components/TrainingAnalysisCharts';
import { AppCard, ChartCard, ContentState, PageContainer, PageHeader, SectionHeader } from '../components/PageLayout';
import type { Athlete, OverviewPayload, Project, StrengthTest, StrengthTrainingSession, TrainingRecord } from '../types';
import { formatNumber } from '../utils';
import { STRENGTH_METRICS, type StrengthMetricKey } from '../../shared/strength-model';
import { STRENGTH_CONTENT_ANALYSIS_CATEGORIES, inferStrengthContentAnalysisCategory } from '../../shared/strength-training';
import '../pages/SpecialTrainingPage.css';

type Navigation = (page: 'special-schedule' | 'strength-plan') => void;

type SpecialProps = {
  records: TrainingRecord[]; project: Project; from: string; to: string; loading: boolean; onNavigate: Navigation;
};

type CurrentMetric = { key: StrengthMetricKey; label: string; unit: string; value: number; testDate: string; target?: number; sampleCount?: number; median?: number };
type ScopedStrengthSession = StrengthTrainingSession & { athleteId: number };

function ChampionModelPlaceholder({ project, kind, onPlanOpen, currentMetrics = [], scopeLabel = '当前运动员' }: { project: Project; kind: '专项' | '体能'; onPlanOpen: () => void; currentMetrics?: CurrentMetric[]; scopeLabel?: string }) {
  return <ChartCard title="冠军模型" description={`${project} · ${kind}能力参考模型`} actions={<button className="dashboard-action-button" onClick={onPlanOpen}>查看训练计划 <ArrowRight size={15} /></button>} className="training-dashboard-champion">
    {currentMetrics.length ? <div className="champion-current-comparison"><div className="champion-comparison-head"><span>指标</span><span>冠军模型</span><span>{scopeLabel}</span><span>达成率</span></div>{currentMetrics.slice(0, 4).map((metric) => <div key={metric.key}><strong>{metric.label}</strong><span>--</span><b>{formatNumber(metric.value, 1)} {metric.unit}</b><span>--</span></div>)}<small>模型数据待配置；当前仅展示已录入的真实{scopeLabel === '当前队伍均值' ? '群体均值' : '测试值'}。</small></div> : <ContentState kind="empty" title="模型数据待配置" icon={<Trophy size={26} />} description="将按当前项目配置真实冠军表现与能力指标；模型启用后可在此对比当前范围、模型值、差距和达成率。" />}
  </ChartCard>;
}

function volumePayload(records: TrainingRecord[]): OverviewPayload['trainingVolume'] {
  const days = [...new Map(records.map((record) => [record.date, record.date])).keys()].sort().map((date) => {
    const items = records.filter((item) => item.date === date);
    const reportedDuration = items.filter((item) => item.durationReported);
    const reportedDistance = items.filter((item) => item.distanceReported);
    return {
      date,
      durationMin: reportedDuration.length ? reportedDuration.reduce((sum, item) => sum + item.durationMin, 0) : null,
      distanceKm: reportedDistance.length ? reportedDistance.reduce((sum, item) => sum + item.distanceKm, 0) : null,
      sessionCount: items.length
    };
  });
  const durationDays = days.filter((item) => item.durationMin !== null);
  const distanceDays = days.filter((item) => item.distanceKm !== null);
  const totalDurationMin = durationDays.length ? durationDays.reduce((sum, item) => sum + (item.durationMin || 0), 0) : null;
  const totalDistanceKm = distanceDays.length ? distanceDays.reduce((sum, item) => sum + (item.distanceKm || 0), 0) : null;
  return { days, totalDurationMin, totalDistanceKm, averageDurationMin: totalDurationMin === null ? null : totalDurationMin / durationDays.length, averageDistanceKm: totalDistanceKm === null ? null : totalDistanceKm / distanceDays.length, durationDayCount: durationDays.length, distanceDayCount: distanceDays.length };
}

function intensityPayload(records: TrainingRecord[]): OverviewPayload['intensityDistribution'] {
  const zones = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;
  const valid = records.filter((item) => zones.includes(item.intensityZone as typeof zones[number]) && item.durationReported);
  const total = valid.reduce((sum, item) => sum + item.durationMin, 0);
  return zones.map((zone) => {
    const items = valid.filter((item) => item.intensityZone === zone);
    const durationMin = items.reduce((sum, item) => sum + item.durationMin, 0);
    return { zone, durationMin, sessionCount: items.length, percentage: total ? durationMin / total * 100 : 0 };
  });
}

export function SpecialTrainingDashboard({ records, project, from, to, loading, onNavigate }: SpecialProps) {
  const specialRecords = useMemo(() => records.filter((item) => trainingLoadCategory(item) === 'special'), [records]);
  const volume = useMemo(() => volumePayload(specialRecords), [specialRecords]);
  const intensity = useMemo(() => intensityPayload(specialRecords), [specialRecords]);
  const metrics = [
    ['专项训练场次', specialRecords.length, '场'],
    ['累计训练时长', volume.totalDurationMin === null ? '—' : formatNumber(volume.totalDurationMin / 60, 1), volume.totalDurationMin === null ? '' : 'h'],
    ['累计训练距离', volume.totalDistanceKm === null ? '—' : formatNumber(volume.totalDistanceKm, 1), volume.totalDistanceKm === null ? '' : 'km'],
    ['有效强度记录', intensity.reduce((sum, item) => sum + item.sessionCount, 0), '条']
  ];
  return <PageContainer className="professional-overview training-dashboard-page">
    <PageHeader variant="dashboard" className="overview-page-heading" eyebrow="SPECIAL TRAINING" title="专项训练" />
    <ChampionModelPlaceholder project={project} kind="专项" onPlanOpen={() => onNavigate('special-schedule')} />
    {loading ? <ContentState kind="loading" title="正在同步专项训练数据" icon={<Activity className="spin" />} /> : <>
      <section className="training-dashboard-metrics">{metrics.map(([label, value, unit]) => <AppCard key={String(label)} variant="compact" className="training-dashboard-metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong><em>{project} · {from} 至 {to}</em></AppCard>)}</section>
      <section className="training-dashboard-grid"><ChartCard title="专项训练量趋势" description="按真实训练时长与距离汇总" className="dashboard-span-8"><TrainingVolumeChart data={volume} from={from} to={to} /></ChartCard><ChartCard title="专项训练强度结构" description="仅展示当前项目已记录的强度分区" className="dashboard-span-4"><TrainingIntensityChart data={intensity} /></ChartCard><ChartCard title="专项训练内容结构" description="按统一训练内容分类统计" className="dashboard-span-5"><TrainingContentChart records={specialRecords} /></ChartCard><ChartCard title="专项成绩趋势" description="该项目暂未配置可用于趋势分析的专项成绩指标" className="dashboard-span-7"><ContentState kind="empty" title="暂无专项指标配置" icon={<Target size={25} />} description="配置当前项目的真实测试或比赛成绩字段后，将按日期展示趋势和最佳表现。" /></ChartCard></section>
    </>}
  </PageContainer>;
}

type StrengthProps = { athletes: Athlete[]; athleteId: number | null; project: Project; from: string; to: string; onNavigate: Navigation; onAthleteChange: (athleteId: number | null) => void };

function configuredMetrics(project: Project) {
  return STRENGTH_METRICS.filter((metric) => !metric.projects || metric.projects.includes(project));
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function latestTestsByAthlete(tests: StrengthTest[]) {
  const latest = new Map<number, StrengthTest>();
  [...tests].sort((left, right) => right.testDate.localeCompare(left.testDate)).forEach((test) => {
    if (!latest.has(test.athleteId)) latest.set(test.athleteId, test);
  });
  return [...latest.values()];
}

function metricsFromTests(tests: StrengthTest[], project: Project) {
  return configuredMetrics(project).flatMap((definition) => {
    const rows = tests.flatMap((test) => typeof test.metrics[definition.key] === 'number' ? [{ test, value: test.metrics[definition.key] as number, target: test.targets[definition.key] }] : []);
    if (!rows.length) return [];
    const values = rows.map((row) => row.value);
    const targets = rows.flatMap((row) => typeof row.target === 'number' && row.target > 0 ? [row.target] : []);
    return [{ key: definition.key, label: definition.label, unit: definition.unit, value: values.reduce((sum, value) => sum + value, 0) / values.length, median: median(values), testDate: `n=${values.length}`, sampleCount: values.length, target: targets.length ? targets.reduce((sum, value) => sum + value, 0) / targets.length : undefined }];
  });
}

function PhysicalCoreMetrics({ metrics, sessions, athleteId }: { metrics: CurrentMetric[]; sessions: ScopedStrengthSession[]; athleteId: number | null }) {
  if (athleteId) {
    if (!metrics.length && !sessions.length) return <ContentState kind="empty" title="暂无体能训练数据" description="当前时间范围内没有可用于分析的真实训练或测试数据。" />;
    return <section className="training-dashboard-metrics physical-core-metrics">{metrics.slice(0, 6).map((metric) => <AppCard key={metric.key} variant="compact" className="training-dashboard-metric"><span>{metric.label}</span><strong>{formatNumber(metric.value, 1)}<small>{metric.unit}</small></strong><em>{metric.testDate}</em></AppCard>)}</section>;
  }
  const participants = new Set(sessions.map((session) => session.athleteId)).size;
  const totalDuration = sessions.reduce((sum, session) => sum + session.durationMin, 0);
  const cards: Array<[string, string | number, string, string]> = [
    ['参与体能训练人数', participants, '人', '当前时间范围内有训练结果'],
    ['体能训练总次数', sessions.length, '场', '当前组织范围内有效训练'],
    ['总训练时长', formatNumber(totalDuration / 60, 1), 'h', '按已记录训练时长汇总'],
    ['人均训练时长', participants ? formatNumber(totalDuration / participants / 60, 1) : '—', participants ? 'h' : '', '按参与训练运动员计算'],
    ...metrics.filter((metric) => metric.sampleCount).slice(0, 2).map((metric) => [`${metric.label}均值`, formatNumber(metric.value, 1), metric.unit, `中位数 ${formatNumber(metric.median || 0, 1)}${metric.unit} · n=${metric.sampleCount}`] as [string, string | number, string, string])
  ];
  if (!sessions.length && !metrics.length) return <ContentState kind="empty" title="暂无体能训练数据" description="当前项目、组织范围和时间范围内没有有效体能训练或测试数据。" />;
  return <section className="training-dashboard-metrics physical-core-metrics">{cards.map(([label, value, unit, note]) => <AppCard key={label} variant="compact" className="training-dashboard-metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong><em>{note}</em></AppCard>)}</section>;
}

function AbilityProfile({ metrics, athleteId }: { metrics: CurrentMetric[]; athleteId: number | null }) {
  const scored = metrics.filter((metric) => typeof metric.target === 'number' && metric.target > 0).map((metric) => ({ ...metric, score: Math.min(120, metric.value / Number(metric.target) * 100) }));
  if (scored.length < 3) return <ContentState kind="empty" title="能力评价标准待配置" icon={<Target size={25} />} description="只有配置至少三项真实个人目标或项目标准后，才会生成标准化能力画像和优先级判断。" />;
  const ordered = [...scored].sort((a, b) => b.score - a.score);
  return <div className="physical-ability-profile"><div className="physical-radar">{scored.map((metric, index) => <div key={metric.key} style={{ '--profile-score': `${Math.min(metric.score, 100)}%`, '--profile-color': ['#0d9488', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef6b5b', '#22a06b'][index] } as CSSProperties}><span>{metric.label}</span><i><b /></i><strong>{formatNumber(metric.score, 0)}</strong></div>)}</div><aside><span>基于已配置的{athleteId ? '个人目标' : '群体目标均值'}</span><h3>{athleteId ? '个人能力摘要' : '团队能力摘要'}</h3><p><b>相对达成</b>{ordered.slice(0, 2).map((metric) => <em key={metric.key}>{metric.label} · {formatNumber(metric.score, 0)}%</em>)}</p><p><b>优先关注</b>{ordered.slice(-2).reverse().map((metric) => <em key={metric.key}>{metric.label} · {formatNumber(metric.score, 0)}%</em>)}</p></aside></div>;
}

function MetricTrend({ tests, metrics, athleteId }: { tests: StrengthTest[]; metrics: CurrentMetric[]; athleteId: number | null }) {
  const [selected, setSelected] = useState<StrengthMetricKey | ''>('');
  const metricKey = selected || metrics[0]?.key || '';
  const definition = STRENGTH_METRICS.find((metric) => metric.key === metricKey);
  const raw = [...tests].sort((a, b) => a.testDate.localeCompare(b.testDate)).flatMap((test) => typeof test.metrics[metricKey as StrengthMetricKey] === 'number' ? [{ date: test.testDate, value: test.metrics[metricKey as StrengthMetricKey] as number }] : []);
  const data = athleteId ? raw : [...new Map(raw.map((item) => [item.date, item.date])).keys()].map((date) => { const values = raw.filter((item) => item.date === date).map((item) => item.value); return { date, value: values.reduce((sum, value) => sum + value, 0) / values.length }; });
  const best = data.length ? Math.max(...data.map((item) => item.value)) : null;
  if (!metrics.length) return <ContentState kind="empty" title="暂无可展示的体能趋势" description="至少录入两次同一项目的真实体能测试后展示变化趋势。" />;
  return <div className="physical-trend"><label>指标<select value={metricKey} onChange={(event) => setSelected(event.target.value as StrengthMetricKey)}>{metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label><div className="physical-chart-canvas">{data.length > 1 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 18, right: 18, left: -12, bottom: 0 }}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis tick={{ fontSize: 10, fill: '#62767d' }} axisLine={false} tickLine={false} unit={definition?.unit}/><Tooltip formatter={(value) => [`${formatNumber(Number(value), 1)} ${definition?.unit || ''}`, definition?.label || '测试值']} /><ReferenceLine y={best ?? undefined} stroke="#f59e0b" strokeDasharray="4 3" label={{ value: 'PB', position: 'right', fontSize: 10, fill: '#b7791f' }} /><Line type="monotone" dataKey="value" name={definition?.label || '测试值'} stroke="#0d9488" strokeWidth={2.6} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} /></ComposedChart></ResponsiveContainer> : <ContentState kind="empty" title="至少两次测试后显示趋势" />}</div></div>;
}

function TrainingStructure({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const recordedSets = sessions.flatMap((session) => session.sets.map((set) => ({ session, set })));
  const items = STRENGTH_CONTENT_ANALYSIS_CATEGORIES.map((name) => ({ name, value: recordedSets.filter(({ session, set }) => inferStrengthContentAnalysisCategory({ sessionLabel: session.sessionLabel, trainingType: session.trainingType, structureType: session.structureType, exerciseName: set.exerciseName, trainingCategory: set.trainingCategory }) === name).length }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <ContentState kind="empty" title="暂无可统计的体能训练结构" />;
  return <div className="physical-structure"><div className="physical-structure-bar">{items.filter((item) => item.value).map((item, index) => <i key={item.name} style={{ width: `${item.value / total * 100}%`, background: ['#0d9488','#3b82f6','#8b5cf6','#f59e0b','#ef6b5b','#22a06b','#64748b','#16a3b6'][index] }} title={`${item.name}：${item.value} 项`} />)}</div>{items.filter((item) => item.value).map((item) => <div key={item.name}><span>{item.name}</span><b>{item.value} 项</b><strong>{formatNumber(item.value / total * 100, 1)}%</strong></div>)}<small>统计口径：当前筛选范围内已记录的训练项次数。</small></div>;
}

function TrainingLoadTrend({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const data = [...new Map(sessions.map((session) => [session.trainingDate, session.trainingDate])).keys()].sort().map((date) => { const items = sessions.filter((session) => session.trainingDate === date); const loads = items.filter((item) => item.srpe > 0); return { date, duration: items.reduce((sum, item) => sum + item.durationMin, 0), load: loads.length ? loads.reduce((sum, item) => sum + item.srpe, 0) : null }; });
  if (!data.some((item) => item.duration > 0 || item.load !== null)) return <ContentState kind="empty" title="暂无体能训练量数据" />;
  return <div className="physical-chart-canvas"> <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 18, right: 18, left: -12, bottom: 0 }}><CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#62767d' }} axisLine={false} tickLine={false}/><YAxis yAxisId="duration" tick={{ fontSize: 10, fill: '#62767d' }} axisLine={false} tickLine={false} unit=" min"/><YAxis yAxisId="load" orientation="right" tick={{ fontSize: 10, fill: '#62767d' }} axisLine={false} tickLine={false} unit=" AU"/><Tooltip /><Bar yAxisId="duration" dataKey="duration" name="训练时长 min" fill="#70b9b2" radius={[4,4,0,0]} maxBarSize={32}/><Line yAxisId="load" type="monotone" dataKey="load" name="SRPE 训练负荷 AU" stroke="#f59e0b" strokeWidth={2.5} connectNulls /></ComposedChart></ResponsiveContainer></div>;
}

export function StrengthTrainingDashboard({ athletes, athleteId, project, from, to, onNavigate, onAthleteChange }: StrengthProps) {
  const [sessions, setSessions] = useState<ScopedStrengthSession[]>([]);
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [loading, setLoading] = useState(true);
  const scopedAthletes = useMemo(() => athleteId ? athletes.filter((item) => item.id === athleteId) : athletes, [athleteId, athletes]);
  const athleteKey = scopedAthletes.map((item) => item.id).join(',');
  useEffect(() => {
    let ignored = false;
    setLoading(true);
    Promise.all(scopedAthletes.map(async (athlete) => {
      const [resultSessions, resultTests] = await Promise.all([api.strengthTrainingResults(athlete.id), api.strengthTests(athlete.id)]);
      return { sessions: resultSessions.sessions.map((session) => ({ ...session, athleteId: athlete.id })), tests: resultTests.tests };
    })).then((results) => { if (!ignored) { setSessions(results.flatMap((item) => item.sessions)); setTests(results.flatMap((item) => item.tests)); } }).catch(() => { if (!ignored) { setSessions([]); setTests([]); } }).finally(() => { if (!ignored) setLoading(false); });
    return () => { ignored = true; };
  }, [athleteKey]);
  const periodSessions = useMemo(() => sessions.filter((item) => item.trainingDate >= from && item.trainingDate <= to), [sessions, from, to]);
  const periodTests = useMemo(() => tests.filter((test) => test.testDate >= from && test.testDate <= to), [tests, from, to]);
  const selectedTests = useMemo(() => athleteId ? periodTests.filter((test) => test.athleteId === athleteId) : periodTests, [athleteId, periodTests]);
  const latestTest = useMemo(() => latestTestsByAthlete(selectedTests)[0], [selectedTests]);
  const currentMetrics = useMemo(() => configuredMetrics(project).flatMap((definition) => {
    const value = latestTest?.metrics[definition.key];
    return typeof value === 'number' ? [{ key: definition.key, label: definition.label, unit: definition.unit, value, testDate: latestTest.testDate, target: latestTest.targets[definition.key] }] : [];
  }), [latestTest, project]);
  const teamMetrics = useMemo(() => metricsFromTests(latestTestsByAthlete(periodTests), project), [periodTests, project]);
  const displayMetrics = athleteId ? currentMetrics : teamMetrics;
  return <PageContainer className="professional-overview training-dashboard-page strength-dashboard-page">
    <PageHeader variant="dashboard" className="overview-page-heading" eyebrow="PHYSICAL TRAINING" title="体能训练" actions={<label className="physical-athlete-filter">运动员<select aria-label="体能训练运动员筛选" value={athleteId ?? ''} onChange={(event) => onAthleteChange(event.target.value ? Number(event.target.value) : null)}><option value="">全部运动员（整体分析）</option>{athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}</select></label>} />
    <ChampionModelPlaceholder project={project} kind="体能" onPlanOpen={() => onNavigate('strength-plan')} currentMetrics={displayMetrics} scopeLabel={athleteId ? '当前运动员' : '当前队伍均值'} />
    {loading ? <ContentState kind="loading" title="正在同步体能训练数据" icon={<Activity className="spin" />} /> : <>
      <section aria-label="整体体能指标"><SectionHeader title={athleteId ? '体能核心指标概览' : '整体体能指标概览'} description={athleteId ? '当前运动员本时间范围内最近一次真实测试' : '当前项目、权限与组织范围内的整体体能训练数据'} /><PhysicalCoreMetrics metrics={displayMetrics} sessions={periodSessions} athleteId={athleteId} /></section>
      <section className="training-dashboard-grid physical-dashboard-grid"><ChartCard title={athleteId ? '体能能力画像' : '团队体能能力画像'} description={athleteId ? '仅使用已配置的个人目标进行标准化' : '仅使用真实目标标准化后的团队均值'} className="dashboard-span-5"><AbilityProfile metrics={displayMetrics} athleteId={athleteId} /></ChartCard><ChartCard title={athleteId ? '关键体能指标趋势' : '关键体能指标整体趋势'} description={athleteId ? '单指标展示，标记个人历史最佳值' : '单指标展示，按测试日期汇总团队均值'} className="dashboard-span-7"><MetricTrend tests={selectedTests} metrics={displayMetrics} athleteId={athleteId} /></ChartCard><ChartCard title="体能训练结构" description="100% 堆叠比例 · 按当前范围内已记录训练项次数" className="dashboard-span-5"><TrainingStructure sessions={periodSessions} /></ChartCard><ChartCard title="体能训练量趋势" description="柱状为总训练时长；折线为已有 SRPE 训练负荷" className="dashboard-span-7"><TrainingLoadTrend sessions={periodSessions} /></ChartCard></section>
    </>}
  </PageContainer>;
}
