import { Activity, ArrowRight, Dumbbell, Target, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { StrengthAssessmentPanel, StrengthOverviewPanel } from '../components/StrengthTrainingInsights';
import { TrainingContentChart, TrainingIntensityChart, TrainingVolumeChart, trainingLoadCategory } from '../components/TrainingAnalysisCharts';
import { AppCard, ChartCard, ContentState, PageContainer, PageHeader, SectionHeader } from '../components/PageLayout';
import type { Athlete, OverviewPayload, Project, StrengthTest, StrengthTrainingSession, TrainingRecord } from '../types';
import { formatNumber } from '../utils';
import '../pages/SpecialTrainingPage.css';

type Navigation = (page: 'special-schedule' | 'strength-records' | 'strength-plan') => void;

type SpecialProps = {
  records: TrainingRecord[]; project: Project; from: string; to: string; loading: boolean; onNavigate: Navigation;
};

function ChampionModelPlaceholder({ project, kind }: { project: Project; kind: '专项' | '体能' }) {
  return <ChartCard title="冠军模型" description={`${project} · ${kind}能力参考模型`} className="training-dashboard-champion">
    <ContentState kind="empty" title="模型数据待配置" icon={<Trophy size={26} />} description="将按当前项目配置真实冠军表现与能力指标；模型启用后可在此对比当前运动员、模型值、差距和达成率。" />
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
    <PageHeader variant="dashboard" className="overview-page-heading" eyebrow="SPECIAL TRAINING" title="专项训练" actions={<button className="dashboard-action-button" onClick={() => onNavigate('special-schedule')}>查看训练计划 <ArrowRight size={15} /></button>} />
    <ChampionModelPlaceholder project={project} kind="专项" />
    {loading ? <ContentState kind="loading" title="正在同步专项训练数据" icon={<Activity className="spin" />} /> : <>
      <section className="training-dashboard-metrics">{metrics.map(([label, value, unit]) => <AppCard key={String(label)} variant="compact" className="training-dashboard-metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong><em>{project} · {from} 至 {to}</em></AppCard>)}</section>
      <section className="training-dashboard-grid"><ChartCard title="专项训练量趋势" description="按真实训练时长与距离汇总" className="dashboard-span-8"><TrainingVolumeChart data={volume} from={from} to={to} /></ChartCard><ChartCard title="专项训练强度结构" description="仅展示当前项目已记录的强度分区" className="dashboard-span-4"><TrainingIntensityChart data={intensity} /></ChartCard><ChartCard title="专项训练内容结构" description="按统一训练内容分类统计" className="dashboard-span-5"><TrainingContentChart records={specialRecords} /></ChartCard><ChartCard title="专项成绩趋势" description="该项目暂未配置可用于趋势分析的专项成绩指标" className="dashboard-span-7"><ContentState kind="empty" title="暂无专项指标配置" icon={<Target size={25} />} description="配置当前项目的真实测试或比赛成绩字段后，将按日期展示趋势和最佳表现。" /></ChartCard></section>
    </>}
  </PageContainer>;
}

type StrengthProps = { athletes: Athlete[]; athleteId: number | null; project: Project; from: string; to: string; onNavigate: Navigation };

function RecentStrengthRecords({ sessions, onNavigate }: { sessions: StrengthTrainingSession[]; onNavigate: Navigation }) {
  const recent = [...sessions].sort((a, b) => b.trainingDate.localeCompare(a.trainingDate) || b.id - a.id).slice(0, 6);
  return <ChartCard title="最近体能训练记录" description={`当前筛选范围内 ${sessions.length} 场`} actions={<button className="dashboard-link-button" onClick={() => onNavigate('strength-records')}>查看全部 <ArrowRight size={14} /></button>}>
    {recent.length ? <div className="dashboard-record-list">{recent.map((item) => <article key={item.id}><time>{item.trainingDate}</time><div><strong>{item.sessionLabel || item.trainingType}</strong><span>{item.sets.length} 个训练项 · {item.rpe === null ? 'RPE 未记录' : `RPE ${item.rpe}`}</span></div><b>{item.durationMin ? `${formatNumber(item.durationMin)} min` : item.volume ? `${formatNumber(item.volume)} kg·reps` : '—'}</b></article>)}</div> : <ContentState kind="empty" title="暂无数据" icon={<Dumbbell size={24} />} />}
  </ChartCard>;
}

export function StrengthTrainingDashboard({ athletes, athleteId, project, from, to, onNavigate }: StrengthProps) {
  const [sessions, setSessions] = useState<StrengthTrainingSession[]>([]);
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [loading, setLoading] = useState(true);
  const scopedAthletes = useMemo(() => athleteId ? athletes.filter((item) => item.id === athleteId) : athletes, [athleteId, athletes]);
  const athleteKey = scopedAthletes.map((item) => item.id).join(',');
  useEffect(() => {
    let ignored = false;
    setLoading(true);
    Promise.all(scopedAthletes.map(async (athlete) => {
      const [resultSessions, resultTests] = await Promise.all([api.strengthTrainingResults(athlete.id), api.strengthTests(athlete.id)]);
      return { sessions: resultSessions.sessions, tests: resultTests.tests };
    })).then((results) => { if (!ignored) { setSessions(results.flatMap((item) => item.sessions)); setTests(results.flatMap((item) => item.tests)); } }).catch(() => { if (!ignored) { setSessions([]); setTests([]); } }).finally(() => { if (!ignored) setLoading(false); });
    return () => { ignored = true; };
  }, [athleteKey]);
  const periodSessions = useMemo(() => sessions.filter((item) => item.trainingDate >= from && item.trainingDate <= to), [sessions, from, to]);
  const totalDuration = periodSessions.reduce((sum, item) => sum + (item.durationMin || 0), 0);
  const totalVolume = periodSessions.reduce((sum, item) => sum + (item.volume || 0), 0);
  const metrics = [['体能训练场次', periodSessions.length, '场'], ['累计训练时长', totalDuration || '—', totalDuration ? 'min' : ''], ['训练总量', totalVolume || '—', totalVolume ? 'kg·reps' : ''], ['有效体能测试', tests.length, '次']];
  return <PageContainer className="professional-overview training-dashboard-page strength-dashboard-page">
    <PageHeader variant="dashboard" className="overview-page-heading" eyebrow="PHYSICAL TRAINING" title="体能训练" actions={<button className="dashboard-action-button" onClick={() => onNavigate('strength-plan')}>查看训练计划 <ArrowRight size={15} /></button>} />
    <ChampionModelPlaceholder project={project} kind="体能" />
    {loading ? <ContentState kind="loading" title="正在同步体能训练数据" icon={<Activity className="spin" />} /> : <>
      <section className="training-dashboard-metrics">{metrics.map(([label, value, unit]) => <AppCard key={String(label)} variant="compact" className="training-dashboard-metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong><em>{athleteId ? '当前运动员' : `全队 ${scopedAthletes.length} 人`} · {from} 至 {to}</em></AppCard>)}</section>
      <section className="training-dashboard-grid"><ChartCard title="体能能力画像" description="仅在存在统一标准化配置时展示跨单位雷达对比" className="dashboard-span-5"><ContentState kind="empty" title="暂无可用于统一标准化的体能指标" icon={<Target size={25} />} description="不会把 kg、秒、W 等不同单位的原始数值直接放入同一雷达图。" /></ChartCard><ChartCard title="体能指标趋势" description="已有体能测试结果按日期变化" className="dashboard-span-7"><StrengthAssessmentPanel tests={tests} /></ChartCard><div className="dashboard-span-12"><SectionHeader title="体能训练量与内容结构" description="基于当前筛选范围内的真实训练结果" /><StrengthOverviewPanel sessions={periodSessions} /></div><RecentStrengthRecords sessions={periodSessions} onNavigate={onNavigate} /></section>
    </>}
  </PageContainer>;
}
