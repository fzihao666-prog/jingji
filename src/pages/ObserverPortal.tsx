import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { AppShell, observerNavigation, type PageKey } from '../components/AppShell';
import {
  AppCard,
  ContentState,
  FilterBar,
  PageContainer,
  PageHeader,
} from '../components/PageLayout';
import { TrainingReportFigures } from '../components/TrainingReport';
import { UnifiedPlanDetail } from '../components/UnifiedPlanDetail';
import { OverviewPage } from './OverviewPage';
import { addDays, toIsoDate } from '../utils';
import { projectLabel } from '../../shared/projects';
import { STRENGTH_METRICS } from '../../shared/strength-model';
import { resolveTeamPlanSessions, type TeamPlan } from '../../shared/team-plan';
import type { CatalogPlan } from '../../shared/training-plan-catalog';
import type { ReportHistory, SavedReport } from '../../shared/training-report';
import type {
  Athlete,
  SpecialTestEvent,
  StrengthTest,
  StrengthTrainingSession,
  TrainingRecord,
  User,
} from '../types';

type ObserverTeam = Awaited<ReturnType<typeof api.observerTeams>>['teams'][number];
type Props = { user: User; onLogout: () => void };
const today = toIsoDate(new Date());
const readRoute = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview';
const value = (number: number | null | undefined, unit = '') =>
  number == null ? '—' : `${number}${unit}`;

export function ObserverPortal({ user, onLogout }: Props) {
  const [route, setRoute] = useState(readRoute);
  const [directory, setDirectory] = useState<{ teams: ObserverTeam[]; athletes: Athlete[] } | null>(
    null
  );
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [athleteId, setAthleteId] = useState<number | null>(null);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const navigation = observerNavigation.find((item) => item.key === route);
  const page = navigation?.key || 'overview';
  const team = directory?.teams.find((item) => item.id === teamId);
  const athletes =
    directory?.athletes.filter(
      (athlete) => team && athlete.teamId === team.id && athlete.project === team.project
    ) || [];
  const athlete =
    athletes.find((item) => item.id === athleteId) ||
    (page === 'reports' ? athletes[0] : undefined);

  useEffect(() => {
    const changed = () => setRoute(readRoute());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    let active = true;
    setDirectory(null);
    setError('');
    Promise.all([api.observerTeams(), api.athletes()])
      .then(([result, roster]) => {
        if (!active) return;
        setDirectory({ teams: result.teams, athletes: roster.athletes });
        setTeamId((current) =>
          result.teams.some((item) => item.id === current) ? current : (result.teams[0]?.id ?? null)
        );
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '队伍信息读取失败');
      });
    return () => {
      active = false;
    };
  }, [retry]);

  const invalidRange = page !== 'personal' && (!from || !to || from > to);
  const filters = (
    <FilterBar label="队伍阅览筛选">
      <label>
        队伍{' '}
        <select
          value={teamId ?? ''}
          onChange={(event) => {
            setTeamId(Number(event.target.value));
            setAthleteId(null);
          }}
        >
          {directory?.teams.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {projectLabel(item.project)}
            </option>
          ))}
        </select>
      </label>
      {page !== 'overview' && (
        <label>
          运动员{' '}
          <select
            value={athlete?.id ?? ''}
            onChange={(event) => setAthleteId(Number(event.target.value) || null)}
          >
            {page !== 'reports' && <option value="">全部运动员</option>}
            {athletes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {page !== 'personal' && (
        <>
          <label>
            开始日期{' '}
            <input
              type="date"
              aria-invalid={Boolean(invalidRange)}
              aria-describedby={invalidRange ? 'observer-date-error' : undefined}
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            结束日期{' '}
            <input
              type="date"
              aria-invalid={Boolean(invalidRange)}
              aria-describedby={invalidRange ? 'observer-date-error' : undefined}
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </>
      )}
    </FilterBar>
  );
  const changePage = (next: PageKey) => {
    window.location.hash = `/${next}`;
    setRoute(next);
  };
  let content: ReactNode;
  if (!navigation)
    content = (
      <ContentState
        kind="error"
        title="当前账号无法访问此页面"
        action={
          <button type="button" className="secondary-button" onClick={() => changePage('overview')}>
            返回训练总览
          </button>
        }
      />
    );
  else if (error)
    content = (
      <ContentState
        kind="error"
        title={error}
        action={
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRetry((count) => count + 1)}
          >
            重试
          </button>
        }
      />
    );
  else if (!directory) content = <ContentState kind="loading" title="正在读取授权队伍…" />;
  else if (!team)
    content = (
      <ContentState kind="empty" title="暂无获授权队伍" description="管理员配置队伍后即可阅览。" />
    );
  else if (invalidRange)
    content = (
      <PageContainer key={page}>
        <PageHeader title={navigation.label} filters={filters} />
        <div id="observer-date-error">
          <ContentState kind="error" title="请选择有效的日期范围" />
        </div>
      </PageContainer>
    );
  else if (page === 'overview')
    content = (
      <OverviewPage
        key={`${team.id}:${from}:${to}`}
        user={user}
        filters={filters}
        teamId={team.id}
        records={[]}
        athletes={athletes}
        from={from}
        to={to}
        athleteId={null}
        loading={false}
        project={team.project}
        projects={[team.project]}
        onRangeChange={() => undefined}
        onAthleteChange={() => undefined}
        onProjectChange={() => undefined}
      />
    );
  else
    content = (
      <PageContainer key={page}>
        <PageHeader title={navigation.label} filters={filters} />
        {page === 'personal' ? (
          <>
            <AppCard>
              <h2>教练</h2>
              {team.coaches.length ? (
                <ul>
                  {team.coaches.map((coach) => (
                    <li key={coach.id}>{coach.displayName}</li>
                  ))}
                </ul>
              ) : (
                <p>暂无关联教练</p>
              )}
            </AppCard>
            <AppCard>
              <h2>运动员</h2>
              <ReadTable
                caption="队伍运动员与教练关系"
                headings={['姓名', '队伍', '负责教练']}
                rows={(athlete ? [athlete] : athletes).map((item) => [
                  item.name,
                  team.name,
                  item.coaches || item.headCoaches || '未关联教练',
                ])}
              />
            </AppCard>
          </>
        ) : (
          <ObserverData
            key={`${page}:${team.id}:${athlete?.id ?? ''}:${from}:${to}`}
            page={page}
            team={team}
            athletes={athletes}
            athlete={athlete}
            from={from}
            to={to}
          />
        )}
      </PageContainer>
    );
  return (
    <AppShell
      user={user}
      page={page}
      onPageChange={changePage}
      onLogout={onLogout}
      onProfileNameChange={async () => undefined}
    >
      {content}
    </AppShell>
  );
}

function ReadTable({
  caption,
  headings,
  rows,
}: {
  caption: string;
  headings: string[];
  rows: ReactNode[][];
}) {
  if (!rows.length) return <ContentState kind="empty" title="当前范围暂无数据" />;
  return (
    <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DataProps = {
  page: PageKey;
  team: ObserverTeam;
  athletes: Athlete[];
  athlete: Athlete | undefined;
  from: string;
  to: string;
};
function ObserverData({ page, team, athletes, athlete, from, to }: DataProps) {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [strength, setStrength] = useState<Array<StrengthTrainingSession & { athleteId: number }>>(
    []
  );
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [events, setEvents] = useState<SpecialTestEvent[]>([]);
  const [plans, setPlans] = useState<TeamPlan[]>([]);
  const [legacyPlans, setLegacyPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selected = athlete ? [athlete] : athletes;
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (page === 'special-records') {
        const [result, physical] = await Promise.all([
          api.records(from, to, athlete?.id ?? null, team.project, team.id),
          api.strengthDashboardData(
            selected.map((item) => item.id),
            from,
            to
          ),
        ]);
        if (active) {
          setRecords(result.records);
          setStrength(physical.sessions);
        }
      } else if (page === 'strength-assessment') {
        const [special, physical] = await Promise.all([
          api.specialTests(from, to, team.project, athlete?.id, team.id),
          api.strengthDashboardData(
            selected.map((item) => item.id),
            from,
            to
          ),
        ]);
        if (active) {
          setEvents(special.events);
          setTests(physical.tests);
        }
      } else if (page === 'training-plans') {
        const [result, legacy] = await Promise.all([
          api.teamPlans({ project: team.project, athleteId: athlete?.id }),
          api.trainingPlanCatalog(),
        ]);
        if (active) {
          setPlans(
            result.plans.filter(
              (plan) =>
                plan.teamId === team.id &&
                plan.project === team.project &&
                plan.endDate >= from &&
                plan.startDate <= to
            )
          );
          setLegacyPlans(
            legacy.plans.filter(
              (plan) =>
                plan.project === team.project &&
                (plan.teamId === team.id || selected.some((item) => item.id === plan.athleteId)) &&
                (!athlete || !plan.athleteId || plan.athleteId === athlete.id) &&
                plan.endDate >= from &&
                plan.startDate <= to
            )
          );
        }
      }
    };
    load()
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '数据读取失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, team, athletes, athlete, from, to]);
  if (loading) return <ContentState kind="loading" title="正在读取数据…" />;
  if (error) return <ContentState kind="error" title={error} />;
  if (page === 'reports')
    return (
      <ObserverReports
        key={athlete?.id ?? selected[0]?.id ?? ''}
        athlete={athlete ?? selected[0]}
        from={from}
        to={to}
      />
    );
  if (page === 'special-records')
    return (
      <>
        <AppCard>
          <h2>训练课次</h2>
          <ReadTable
            caption="运动员训练明细"
            headings={[
              '日期',
              '运动员',
              '训练内容',
              '时长（分钟）',
              '距离（km）',
              'RPE',
              '负荷（AU）',
            ]}
            rows={records.map((record) => [
              record.date,
              record.athleteName,
              record.content,
              record.durationReported ? value(record.durationMin) : '—',
              record.distanceReported ? value(record.distanceKm) : '—',
              value(record.rpe),
              value(record.srpe),
            ])}
          />
        </AppCard>
        <AppCard>
          <h2>体能训练组次</h2>
          <ReadTable
            caption="体能训练组次"
            headings={['日期', '运动员', '动作', '组次', '完成次数', '重量（kg）']}
            rows={strength.flatMap((session) =>
              session.sets.map((set) => [
                session.trainingDate,
                athletes.find((item) => item.id === session.athleteId)?.name ?? '—',
                set.exerciseName,
                set.setIndex,
                value(set.actualReps),
                value(set.actualWeightKg),
              ])
            )}
          />
        </AppCard>
      </>
    );
  if (page === 'strength-assessment')
    return (
      <>
        <AppCard>
          <h2>专项测试</h2>
          <ReadTable
            caption="专项测试结果"
            headings={[
              '日期',
              '运动员 / 组合',
              '测试距离（m）',
              '最佳成绩（秒）',
              '平均成绩（秒）',
            ]}
            rows={events.flatMap((event) =>
              event.results.map((result) => [
                event.testDate,
                result.memberNames.join('、') || result.crewName,
                event.distanceM,
                value(result.bestMs == null ? null : result.bestMs / 1000),
                value(result.averageMs == null ? null : result.averageMs / 1000),
              ])
            )}
          />
        </AppCard>
        <AppCard>
          <h2>体能测试</h2>
          <ReadTable
            caption="体能测试结果"
            headings={['日期', '运动员', '指标', '结果']}
            rows={tests.flatMap((test) =>
              STRENGTH_METRICS.filter((metric) => test.metrics[metric.key] != null).map(
                (metric) => [
                  test.testDate,
                  athletes.find((item) => item.id === test.athleteId)?.name ?? '—',
                  metric.label,
                  value(test.metrics[metric.key], metric.unit),
                ]
              )
            )}
          />
        </AppCard>
      </>
    );
  if (page === 'training-plans')
    return (
      <>
        {!plans.length && !legacyPlans.length && (
          <ContentState kind="empty" title="当前范围暂无训练计划" />
        )}
        {plans.map((plan) => (
          <AppCard key={plan.id}>
            <h2>{plan.title}</h2>
            <p>
              {plan.startDate} — {plan.endDate} · {plan.team}
            </p>
            {plan.data.goal && <p>目标 · {plan.data.goal}</p>}
            <ReadTable
              caption={`${plan.title}训练安排`}
              headings={[
                '日期',
                '时段',
                '内容',
                '时长（分钟）',
                '距离（km）',
                '强度',
                '组数 / 次数 / 负重',
              ]}
              rows={(athlete ? resolveTeamPlanSessions(plan, athlete.id) : plan.data.sessions).map(
                (session) => [
                  session.date,
                  session.period,
                  session.content,
                  value(session.durationMin),
                  value(session.distanceKm),
                  session.intensity || '—',
                  `${value(session.sets)} / ${value(session.reps)} / ${value(session.load)}`,
                ]
              )}
            />
          </AppCard>
        ))}
        {legacyPlans.map((plan) => (
          <AppCard key={plan.key}>
            <h2>{plan.title}</h2>
            <p>
              {plan.startDate} — {plan.endDate}
            </p>
            <UnifiedPlanDetail plan={plan} />
          </AppCard>
        ))}
      </>
    );
  return null;
}

function ObserverReports({
  athlete,
  from,
  to,
}: {
  athlete: Athlete | undefined;
  from: string;
  to: string;
}) {
  const [history, setHistory] = useState<ReportHistory | null>(null);
  const [report, setReport] = useState<SavedReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!athlete) return;
    let active = true;
    api
      .reportHistory(athlete.id)
      .then((result) => {
        if (active) setHistory(result.filter((item) => item.to >= from && item.from <= to));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '报告列表读取失败');
      });
    return () => {
      active = false;
    };
  }, [athlete, from, to]);
  if (!athlete) return <ContentState kind="empty" title="当前队伍暂无运动员" />;
  return (
    <AppCard>
      <h2>{athlete.name} · 已保存报告</h2>
      <p>此账号展示报告中的训练统计与测试图表。</p>
      {error && <ContentState kind="error" title={error} />}
      {!history && !error && <ContentState kind="loading" title="正在读取报告…" />}
      {history?.length === 0 && <ContentState kind="empty" title="当前范围暂无已保存报告" />}
      {history && history.length > 0 && (
        <label>
          报告{' '}
          <select
            value={report?.id ?? ''}
            disabled={busy}
            onChange={async (event) => {
              const id = event.target.value;
              setReport(null);
              setError('');
              if (!id) return;
              setBusy(true);
              try {
                setReport(await api.reportDetail(athlete.id, id));
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : '报告读取失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            <option value="">请选择报告</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {item.from} — {item.to}
              </option>
            ))}
          </select>
        </label>
      )}
      {busy && <p role="status">正在读取报告…</p>}
      {report && (
        <div className="training-report">
          <TrainingReportFigures data={report.data} />
        </div>
      )}
    </AppCard>
  );
}
