import { Activity, ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { SpecialChampionModel } from '../components/SpecialChampionModel';
import { AppCard, ChartCard, ContentState, FilterBar, PageContainer, PageHeader, SectionHeader } from '../components/PageLayout';
import { EChart } from '../components/EChart';
import { contentOption, intensityOption, loadOption, performanceGroups, performanceOption, volumeOption } from '../components/special-chart-options';
import type { Athlete, Project, ProjectTeam } from '../types';
import { formatNumber } from '../utils';
import './SpecialTrainingPage.css';

type Props = {
  athletes: Athlete[]; athleteId: number | null; project: Project; from: string; to: string;
  onAthleteChange: (id: number | null) => void; onRecordsOpen: () => void;
};
type Payload = Awaited<ReturnType<typeof api.specialTrainingOverview>>;
const value = (number: number | null, digits = 1) => number === null ? '—' : formatNumber(number, digits);
const empty = (title: string) => <ContentState kind="empty" title={title} description="当前筛选范围内暂无有效数据。" />;

export function SpecialTrainingDashboard({ athletes, athleteId, project, from, to, onAthleteChange, onRecordsOpen }: Props) {
  const [teams, setTeams] = useState<{ project: Project; items: ProjectTeam[] } | null>(null);
  const [selection, setSelection] = useState<{ project: Project; teamId: number | null }>({ project, teamId: null });
  const [result, setResult] = useState<{ key: string; payload?: Payload; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const teamId = selection.project === project ? selection.teamId : null;
  const currentTeams = teams?.project === project ? teams.items : [];
  const selectedTeam = currentTeams.find((team) => team.id === teamId);
  const candidates = athletes.filter((athlete) => athlete.project === project && (!selectedTeam || athlete.team === selectedTeam.name));
  const requestKey = JSON.stringify([project, from, to, athleteId, teamId, retry]);
  useEffect(() => {
    let active = true;
    api.overviewTeams(project).then(({ teams: items }) => { if (active) setTeams({ project, items }); }).catch(() => { if (active) setTeams({ project, items: [] }); });
    return () => { active = false; };
  }, [project]);
  useEffect(() => {
    let active = true;
    api.specialTrainingOverview(from, to, project, athleteId, teamId)
      .then((payload) => { if (active) setResult({ key: requestKey, payload }); })
      .catch((error) => { if (active) setResult({ key: requestKey, error: error instanceof Error ? error.message : '专项数据加载失败' }); });
    return () => { active = false; };
  }, [project, from, to, athleteId, teamId, requestKey]);
  const current = result?.key === requestKey ? result : null;
  const payload = current?.payload;
  const training = payload?.training;
  const groups = useMemo(() => performanceGroups(payload?.events || []), [payload]);
  const scope = athleteId ? athletes.find((athlete) => athlete.id === athleteId)?.name || '当前运动员' : selectedTeam?.name || '当前权限范围 · 全部运动员';
  const metricItems = training ? [
    { label: '专项训练时长', amount: training.summary.durationMin === null ? '—' : value(training.summary.durationMin / 60), unit: 'h' },
    { label: '专项训练距离', amount: value(training.summary.distanceKm), unit: 'km' },
    { label: '专项训练课次', amount: String(training.summary.sessionCount), unit: '课次' },
    { label: '专项训练负荷', amount: value(training.summary.load), unit: 'AU' }
  ] : [];
  return <PageContainer className="professional-overview training-dashboard-page">
    <PageHeader variant="dashboard" className="overview-page-heading" eyebrow="SPECIAL TRAINING" title="专项训练" />
    <FilterBar label="专项训练页面筛选">
      <label className="physical-athlete-filter">组织 / 队伍<select aria-label="专项训练队伍筛选" value={teamId ?? ''} onChange={(event) => { setSelection({ project, teamId: event.target.value ? Number(event.target.value) : null }); onAthleteChange(null); }}>
        <option value="">当前权限范围全部队伍</option>{currentTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select></label>
      <label className="physical-athlete-filter">运动员<select aria-label="专项训练运动员筛选" value={athleteId ?? ''} onChange={(event) => onAthleteChange(event.target.value ? Number(event.target.value) : null)}>
        <option value="">全部运动员（整体分析）</option>{candidates.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
      </select></label>
    </FilterBar>
    <SpecialChampionModel project={project} />
    {!current ? <ContentState kind="loading" title="正在同步专项训练数据" icon={<Activity className="spin" />} /> : current.error ? <ContentState kind="error" title="专项训练数据加载失败" description={current.error} action={<button className="secondary-button" onClick={() => setRetry((count) => count + 1)}>重试</button>} /> : training && <>
      <SectionHeader title="专项重要数据概览" description={`${scope} · ${from} 至 ${to}`} />
      <section className="training-dashboard-metrics" aria-label="专项重要数据">{metricItems.map((item) => <AppCard key={item.label} variant="compact" className="training-dashboard-metric"><span>{item.label}</span><strong>{item.amount}<small>{item.unit}</small></strong><em>{athleteId ? '个人实际训练' : '同队共同课次去重'}</em></AppCard>)}</section>
      <ChartCard title="专项训练量统计" description="柱状：训练时长 · 折线：训练距离">
        {training.days.some((day) => day.durationMin !== null || day.distanceKm !== null) ? <EChart option={volumeOption(training, from, to)} label="专项训练时长与距离趋势" /> : empty('暂无专项训练量数据')}
      </ChartCard>
      <ChartCard title="专项训练强度占比" description="按原始强度分区的有效训练时长统计">
        {training.intensity.some((row) => row.durationMin !== null && row.durationMin > 0) ? <>
          <EChart option={intensityOption(training)} label="专项训练强度时长占比" />
          <div className="table-scroll"><table className="data-table"><thead><tr><th>强度分区</th><th>时长（min）</th><th>占比</th></tr></thead><tbody>{training.intensity.map((row) => <tr key={row.name}><td>{row.name}</td><td>{value(row.durationMin)}</td><td>{value(row.percentage)}%</td></tr>)}</tbody></table></div>
        </> : empty('暂无有效专项强度数据')}
      </ChartCard>
      <ChartCard title="专项训练课占比" description="按统一训练内容字典统计专项课次">
        {training.content.length ? <><EChart option={contentOption(training)} label="专项训练内容课次分布" /><div className="table-scroll"><table className="data-table"><thead><tr><th>训练内容</th><th>课次数</th><th>占比</th></tr></thead><tbody>{training.content.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{value(row.percentage)}%</td></tr>)}</tbody></table></div></> : empty('暂无专项训练内容数据')}
      </ChartCard>
      <ChartCard title="专项训练负荷分析" description={`累计专项负荷 ${value(training.summary.load)} AU · 每日既有 SRPE`}>
        {training.days.some((day) => day.load !== null) ? <EChart option={loadOption(training, from, to)} label="每日专项SRPE负荷趋势" /> : empty('暂无有效专项训练负荷')}
      </ChartCard>
      <ChartCard title="专项表现趋势" description={`${groups.reduce((sum, group) => sum + group.results.length, 0)} 条有效成绩 · 同距离、艇型和性别分组比较；成绩越低越好`}>
        {groups.length ? groups.map((group) => <section key={group.label}>
          <SectionHeader title={group.label} description={`周期最好 ${value(Math.min(...group.results.map((row) => row.best)), 2)} 秒`} />
          <EChart option={performanceOption(group, from, to)} label={`${group.label}专项成绩趋势`} />
        </section>) : empty('暂无可靠专项成绩数据')}
      </ChartCard>
      <ChartCard title="最近专项训练" description="当前筛选范围内最近10个专项课次" actions={<button className="dashboard-action-button" onClick={onRecordsOpen}>完整训练记录 <ArrowRight size={15} /></button>}>
        {training.recent.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>日期</th><th>训练内容</th><th>时长（min）</th><th>距离（km）</th><th>强度</th><th>负荷（AU）</th></tr></thead><tbody>{training.recent.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.content}</td><td>{value(row.durationMin)}</td><td>{value(row.distanceKm)}</td><td>{row.intensityZone || '—'}</td><td>{value(row.load)}</td></tr>)}</tbody></table></div> : empty('暂无专项训练记录')}
      </ChartCard>
    </>}
  </PageContainer>;
}
