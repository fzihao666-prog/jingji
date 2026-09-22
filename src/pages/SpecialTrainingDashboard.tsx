import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { AthleteAnalysisSelector } from '../components/AthleteAnalysisSelector';
import { SpecialChampionModel } from '../components/SpecialChampionModel';
import {
  AppCard,
  ChartCard,
  ContentState,
  FilterBar,
  PageContainer,
  PageHeader,
  SectionHeader,
} from '../components/PageLayout';
import { EChart } from '../components/EChart';
import {
  contentOption,
  intensityOption,
  loadOption,
  volumeOption,
} from '../components/special-chart-options';
import type { Project, ProjectTeam } from '../types';
import { formatNumber } from '../utils';

type Props = {
  project: Project;
  from: string;
  to: string;
};
type Payload = Awaited<ReturnType<typeof api.specialTrainingOverview>>;
const value = (number: number | null, digits = 1) =>
  number === null ? '—' : formatNumber(number, digits);
const empty = (title: string) => (
  <ContentState kind="empty" title={title} description="当前筛选范围内暂无有效数据。" />
);

export function SpecialTrainingDashboard({ project, from, to }: Props) {
  const [teams, setTeams] = useState<{ project: Project; items: ProjectTeam[] } | null>(null);
  const [selection, setSelection] = useState<{ project: Project; teamId: number | null }>({
    project,
    teamId: null,
  });
  const [result, setResult] = useState<{ key: string; payload?: Payload; error?: string } | null>(
    null
  );
  const [retry, setRetry] = useState(0);
  const [selectedAthleteId, setSelectedAthleteId] = useState<number | null>(null);
  const teamId = selection.project === project ? selection.teamId : null;
  const currentTeams = teams?.project === project ? teams.items : [];
  const selectedTeam = currentTeams.find((team) => team.id === teamId);
  const requestKey = JSON.stringify([project, from, to, teamId, selectedAthleteId, retry]);
  useEffect(() => {
    let active = true;
    api
      .overviewTeams(project)
      .then(({ teams: items }) => {
        if (active) setTeams({ project, items });
      })
      .catch(() => {
        if (active) setTeams({ project, items: [] });
      });
    return () => {
      active = false;
    };
  }, [project]);
  useEffect(() => {
    let active = true;
    api
      .specialTrainingOverview(from, to, project, teamId, selectedAthleteId)
      .then((payload) => {
        if (active) setResult({ key: requestKey, payload });
      })
      .catch((error) => {
        if (active)
          setResult({
            key: requestKey,
            error: error instanceof Error ? error.message : '专项数据加载失败',
          });
      });
    return () => {
      active = false;
    };
  }, [project, from, to, teamId, selectedAthleteId, requestKey]);
  const current = result?.key === requestKey ? result : null;
  const payload = current?.payload;
  const training = payload?.training;
  const teamTraining = payload?.teamTraining;
  const athletes = payload?.athletes || [];
  const selectedAthlete = payload?.selectedAthlete || null;
  const scope = selectedTeam?.name || '当前权限范围 · 全部运动员';
  const metricItems = training
    ? [
        {
          label: '专项训练时长',
          amount:
            training.summary.durationMin === null ? '—' : value(training.summary.durationMin / 60),
          unit: 'h',
        },
        { label: '专项训练距离', amount: value(training.summary.distanceKm), unit: 'km' },
        { label: '专项训练课次', amount: String(training.summary.sessionCount), unit: '课次' },
        { label: '专项训练负荷', amount: value(training.summary.load), unit: 'AU' },
      ]
    : [];
  return (
    <PageContainer className="professional-overview training-dashboard-page">
      <PageHeader
        variant="dashboard"
        className="overview-page-heading"
        eyebrow="SPECIAL TRAINING"
        title="专项训练"
        actions={
          selectedAthlete ? (
            <button className="dashboard-action-button" onClick={() => setSelectedAthleteId(null)}>
              当前运动员：{selectedAthlete.name} · 清除
            </button>
          ) : undefined
        }
      />
      <FilterBar label="专项训练页面筛选">
        <label className="physical-athlete-filter special-team-filter">
          队伍
          <select
            aria-label="专项训练队伍筛选"
            value={teamId ?? ''}
            onChange={(event) => {
              setSelection({
                project,
                teamId: event.target.value ? Number(event.target.value) : null,
              });
              setSelectedAthleteId(null);
            }}
          >
            <option value="">当前权限范围全部队伍</option>
            {currentTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>
      <SpecialChampionModel project={project} />
      {!current ? (
        <ContentState
          kind="loading"
          title="正在同步专项训练数据"
          icon={<Activity className="spin" />}
        />
      ) : current.error ? (
        <ContentState
          kind="error"
          title="专项训练数据加载失败"
          description={current.error}
          action={
            <button className="secondary-button" onClick={() => setRetry((count) => count + 1)}>
              重试
            </button>
          }
        />
      ) : (
        training && (
          <>
            <SectionHeader title="专项数据概览" description={`${scope} · ${from} 至 ${to}`} />
            <section className="training-dashboard-metrics" aria-label="专项重要数据">
              {metricItems.map((item) => (
                <AppCard key={item.label} variant="compact" className="training-dashboard-metric">
                  <span>{item.label}</span>
                  <strong>
                    {item.amount}
                    <small>{item.unit}</small>
                  </strong>
                  <em>
                    {selectedAthlete && teamTraining
                      ? `团队均值 ${item.label === '专项训练时长' ? value((teamTraining.summary.durationMin || 0) / 60) : item.label === '专项训练距离' ? value(teamTraining.summary.distanceKm) : item.label === '专项训练课次' ? teamTraining.summary.sessionCount : value(teamTraining.summary.load)}${item.unit ? ` ${item.unit}` : ''}`
                      : '同队共同课次去重'}
                  </em>
                </AppCard>
              ))}
            </section>
            <ChartCard title="专项训练量统计" description="柱状：训练时长 · 折线：训练距离">
              {training.days.some((day) => day.durationMin !== null || day.distanceKm !== null) ? (
                <EChart option={volumeOption(training, from, to)} label="专项训练时长与距离趋势" />
              ) : (
                empty('暂无专项训练量数据')
              )}
            </ChartCard>
            <ChartCard title="专项训练强度占比" description="按原始强度分区的有效训练时长统计">
              {training.intensity.some((row) => row.durationMin !== null && row.durationMin > 0) ? (
                <>
                  <EChart option={intensityOption(training)} label="专项训练强度时长占比" />
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>强度分区</th>
                          <th>时长（min）</th>
                          <th>占比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {training.intensity.map((row) => (
                          <tr key={row.name}>
                            <td>{row.name}</td>
                            <td>{value(row.durationMin)}</td>
                            <td>{value(row.percentage)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                empty('暂无有效专项强度数据')
              )}
            </ChartCard>
            <ChartCard title="专项训练课占比" description="按统一训练内容字典统计专项课次">
              {training.content.length ? (
                <>
                  <EChart option={contentOption(training)} label="专项训练内容课次分布" />
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>训练内容</th>
                          <th>课次数</th>
                          <th>占比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {training.content.map((row) => (
                          <tr key={row.name}>
                            <td>{row.name}</td>
                            <td>{row.count}</td>
                            <td>{value(row.percentage)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                empty('暂无专项训练内容数据')
              )}
            </ChartCard>
            <ChartCard
              title="专项训练负荷分析"
              description={`累计专项负荷 ${value(training.summary.load)} AU · 每日既有 SRPE`}
            >
              {training.days.some((day) => day.load !== null) ? (
                <EChart option={loadOption(training, from, to)} label="每日专项SRPE负荷趋势" />
              ) : (
                empty('暂无有效专项训练负荷')
              )}
            </ChartCard>
            {selectedAthlete && (
              <ChartCard title="专项测试表现" description="当前周期最新专项测试与团队均值对照">
                {payload?.specialTestComparison?.athlete ? (
                  <p>
                    {payload.specialTestComparison.athlete.testDate} · {payload.specialTestComparison.athlete.distanceM}m · {payload.specialTestComparison.athlete.boatClass} · 成绩 {value(payload.specialTestComparison.athlete.bestMs / 1000, 2)}s · 团队均值 {value(payload.specialTestComparison.teamAverage === null ? null : payload.specialTestComparison.teamAverage / 1000, 2)}s · 差异 {value(payload.specialTestComparison.deltaMs === null ? null : payload.specialTestComparison.deltaMs / 1000, 2)}s
                  </p>
                ) : (
                  empty('当前周期暂无可对照的专项测试成绩')
                )}
              </ChartCard>
            )}
            <ChartCard title="运动员" description={`当前范围共 ${athletes.length} 名运动员 · 默认显示约5条`}>
              <AthleteAnalysisSelector
                athletes={athletes.map((athlete) => ({ ...athlete, identityNumber: '', specialties: '' }))}
                selectedAthleteId={selectedAthleteId}
                onSelect={setSelectedAthleteId}
                onClear={() => setSelectedAthleteId(null)}
                renderSummary={(athlete) => <span className="athlete-analysis-selector-meta">课次 {athlete.summary?.sessionCount ?? '—'} · 时长 {athlete.summary?.durationMin == null ? '—' : `${value(athlete.summary.durationMin / 60)} h`} · 距离 {athlete.summary?.distanceKm == null ? '—' : `${value(athlete.summary.distanceKm)} km`} · 负荷 {value(athlete.summary?.load ?? null)} AU</span>}
              />
            </ChartCard>
          </>
        )
      )}
    </PageContainer>
  );
}
