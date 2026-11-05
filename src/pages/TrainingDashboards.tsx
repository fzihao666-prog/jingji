import { metricAppliesToProject } from '../../shared/import-metric-choice';
import { StrengthSessionAnalysis, strengthSessionSummary } from '../components/StrengthSessionAnalysis';
import { Activity } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { PhysicalChampionModel } from '../components/PhysicalChampionModel';
import { PhysicalTestModule } from '../components/PhysicalTestModule';
import { AthleteAnalysisSelector } from '../components/AthleteAnalysisSelector';
import {
  AppCard,
  ChartCard,
  ContentState,
  PageContainer,
  PageHeader,
  SectionHeader,
} from '../components/PageLayout';
import type {
  Athlete,
  Project,
  StrengthTest,
  StrengthTrainingSession,
} from '../types';
import { formatNumber } from '../utils';
import { STRENGTH_METRICS, type StrengthMetricKey } from '../../shared/strength-model';
import '../components/EChart.css';
import {
  STRENGTH_CONTENT_ANALYSIS_CATEGORIES,
  inferStrengthContentAnalysisCategory,
} from '../../shared/strength-training';
import '../pages/SpecialTrainingPage.css';

const strengthTooltipStyle = {
  borderRadius: 12, border: '1px solid var(--line)', padding: '12px 16px',
  background: 'var(--surface, white)', color: 'var(--ink)', fontSize: 12,
  boxShadow: '0 8px 24px rgb(18 61 74 / 12%)', lineHeight: 1.8,
};

type Navigation = (page: 'special-schedule' | 'strength-plan' | 'strength-enode') => void;

type CurrentMetric = {
  key: StrengthMetricKey;
  label: string;
  unit: string;
  value: number;
  testDate: string;
  target?: number;
  sampleCount?: number;
  median?: number;
};
type ScopedStrengthSession = StrengthTrainingSession & { athleteId: number };

type StrengthProps = {
  teamId?: number | null;
  athletes: Athlete[];
  project: Project;
  from: string;
  to: string;
  onNavigate: Navigation;
};

function configuredMetrics(project: Project) {
  return STRENGTH_METRICS.filter((metric) => metricAppliesToProject(metric, project));
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function latestTestsByAthlete(tests: StrengthTest[]) {
  const latest = new Map<number, StrengthTest>();
  [...tests]
    .sort((left, right) => right.testDate.localeCompare(left.testDate))
    .forEach((test) => {
      if (!latest.has(test.athleteId)) latest.set(test.athleteId, test);
    });
  return [...latest.values()];
}

function metricsFromTests(tests: StrengthTest[], project: Project) {
  return configuredMetrics(project).flatMap((definition) => {
    const rows = tests.flatMap((test) =>
      typeof test.metrics[definition.key] === 'number'
        ? [
            {
              test,
              value: test.metrics[definition.key] as number,
              target: test.targets[definition.key],
            },
          ]
        : []
    );
    if (!rows.length) return [];
    const values = rows.map((row) => row.value);
    const targets = rows.flatMap((row) =>
      typeof row.target === 'number' && row.target > 0 ? [row.target] : []
    );
    return [
      {
        key: definition.key,
        label: definition.label,
        unit: definition.unit,
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
        median: median(values),
        testDate: `n=${values.length}`,
        sampleCount: values.length,
        target: targets.length
          ? targets.reduce((sum, value) => sum + value, 0) / targets.length
          : undefined,
      },
    ];
  });
}

function PhysicalCoreMetrics({
  sessions,
  athleteId,
}: {
  sessions: ScopedStrengthSession[];
  athleteId: number | null;
}) {
  const summary = strengthSessionSummary(sessions);
  const participants = new Set(sessions.map((session) => session.athleteId)).size;
  const cards: Array<[string, string | number, string, string]> = [
    ['累计体能训练时长', sessions.length ? formatNumber(summary.duration / 60, 1) : '—', 'h', '按当前周期已记录时长汇总'],
    ['体能训练课次', sessions.length, '课', '按运动员课次统计'],
    ['累计训练负荷', summary.load === null ? '—' : formatNumber(summary.load), 'AU', `SRPE · 有效 ${summary.loadCount}/${sessions.length} 课`],
    ['平均 RPE', summary.rpe === null ? '—' : formatNumber(summary.rpe, 1), '分', `课次均值 · 有效 ${summary.rpeCount}/${sessions.length} 课`],
    ['训练参与人数', participants, '人', athleteId ? '当前运动员' : '当前周期有训练记录的运动员'],
  ];
  // 测试结果在下方测试模块展示，顶部集中呈现训练投入。
  return (
    <section className="training-dashboard-metrics physical-core-metrics">
      {cards.map(([label, value, unit, note]) => (
        <AppCard key={label} variant="compact" className="training-dashboard-metric">
          <span className="strength-metric-heading">{label}</span>
          <strong>
            {value}
            <small>{unit}</small>
          </strong>
          <em>{note}</em>
        </AppCard>
      ))}
    </section>
  );
}

function AbilityProfile({
  metrics,
  athleteId,
}: {
  metrics: CurrentMetric[];
  athleteId: number | null;
}) {
  const scored = metrics
    .filter((metric) => typeof metric.target === 'number' && metric.target > 0)
    .map((metric) => ({
      ...metric,
      score: Math.min(120, (metric.value / Number(metric.target)) * 100),
    }));
  const isPlaceholder = scored.length === 0;
  const displayScored = isPlaceholder
    ? STRENGTH_METRICS.slice(0, 5).map((metric) => ({ ...metric, score: null }))
    : scored;
  const ordered = [...scored].sort((a, b) => b.score - a.score);
  return (
    <div className="physical-ability-profile">
      {isPlaceholder && <span className="app-chart-example">暂无数据</span>}
      <div className="physical-radar">
        {displayScored.map((metric, index) => (
          <div
            key={metric.key}
            style={
              {
                '--profile-score': `${metric.score === null ? 0 : Math.min(metric.score, 100)}%`,
                '--profile-color': [
                  '#0d9488',
                  '#3b82f6',
                  '#f59e0b',
                  '#8b5cf6',
                  '#ef6b5b',
                  '#22a06b',
                ][index],
              } as CSSProperties
            }
          >
            <span>{metric.label}</span>
            <i>
              <b />
            </i>
            <strong>{metric.score === null ? '—' : formatNumber(metric.score, 0)}</strong>
          </div>
        ))}
      </div>
      <aside>
        {isPlaceholder ? <p>暂无有效目标对照，保留指标结构；配置真实标准后显示达成度。</p> : <>
        <span>基于已配置的{athleteId ? '个人目标' : '群体目标均值'}</span>
        <h3>{athleteId ? '个人能力摘要' : '团队能力摘要'}</h3>
        <p>
          <b>相对达成</b>
          {ordered.slice(0, 2).map((metric) => (
            <em key={metric.key}>
              {metric.label} · {formatNumber(metric.score, 0)}%
            </em>
          ))}
        </p>
        <p>
          <b>优先关注</b>
          {ordered
            .slice(-2)
            .reverse()
            .map((metric) => (
              <em key={metric.key}>
                {metric.label} · {formatNumber(metric.score, 0)}%
              </em>
            ))}
        </p>
        </>}
      </aside>
    </div>
  );
}

function MetricTrend({
  tests,
  metrics,
  athleteId,
}: {
  tests: StrengthTest[];
  metrics: CurrentMetric[];
  athleteId: number | null;
}) {
  const [selected, setSelected] = useState<StrengthMetricKey | ''>('');
  const metricKey = selected || metrics[0]?.key || STRENGTH_METRICS[0].key;
  const definition = STRENGTH_METRICS.find((metric) => metric.key === metricKey);
  const raw = [...tests]
    .sort((a, b) => a.testDate.localeCompare(b.testDate))
    .map((test) => {
      const measured = test.metrics[metricKey as StrengthMetricKey];
      return { date: test.testDate, value: typeof measured === 'number' && Number.isFinite(measured) ? measured : null };
    });
  const data = athleteId
    ? raw
    : [...new Set(raw.map((item) => item.date))].map((date) => {
        const values = raw.filter((item) => item.date === date).flatMap((item) => item.value === null ? [] : [item.value]);
        return { date, value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
      });
  const values = data.flatMap((item) => item.value === null ? [] : [item.value]);
  const best = values.length ? Math.max(...values) : null;
  const isPlaceholder = values.length === 0;
  const chartData = data.length ? data : [{ date: '', value: null }];
  return (
    <div className="physical-trend">
      <label>
        指标
        <select
          value={metricKey}
          onChange={(event) => setSelected(event.target.value as StrengthMetricKey)}
        >
          {(metrics.length ? metrics : STRENGTH_METRICS.slice(0, 1)).map((metric) => (
            <option key={metric.key} value={metric.key}>
              {metric.label}
            </option>
          ))}
        </select>
      </label>
      {isPlaceholder && <p className="app-chart-example">暂无真实体能测试趋势</p>}
      <div className="physical-chart-canvas">
        {(
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 18, right: 18, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 6" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDataOverflow={isPlaceholder}
                domain={isPlaceholder ? [0, 1] : undefined}
                ticks={isPlaceholder ? [0, 0.25, 0.5, 0.75, 1] : undefined}
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                axisLine={false}
                tickLine={false}
                unit={definition?.unit}
              />
              <Tooltip contentStyle={strengthTooltipStyle}
                labelFormatter={(label) => `${label}`}
                formatter={(value) => [
                  `${formatNumber(Number(value), 1)} ${definition?.unit || ''}`,
                  definition?.label || '测试值',
                ]}
              />
              {best !== null && <ReferenceLine
                y={best ?? undefined}
                stroke="#f59e0b"
                strokeDasharray="4 3"
                label={{ value: 'PB', position: 'right', fontSize: 10, fill: '#b7791f' }}
              />}
              <Line
                type="monotone"
                dataKey="value"
                name={definition?.label || '测试值'}
                stroke="var(--teal)"
                strokeWidth={3}
                activeDot={{ r: 6, strokeWidth: 3 }}
                dot={{ r: 3, fill: '#fff', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {isPlaceholder && <p className="app-chart-example-note">PB 仅根据真实测试显示。</p>}
    </div>
  );
}

function TrainingStructure({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const recordedSets = sessions.flatMap((session) => session.sets.map((set) => ({ session, set })));
  const items = STRENGTH_CONTENT_ANALYSIS_CATEGORIES.map((name) => ({
    name,
    value: recordedSets.filter(
      ({ session, set }) =>
        inferStrengthContentAnalysisCategory({
          sessionLabel: session.sessionLabel,
          trainingType: session.trainingType,
          structureType: session.structureType,
          exerciseName: set.exerciseName,
          trainingCategory: set.trainingCategory,
        }) === name
    ).length,
  }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const displayItems = items;
  const displayTotal = total || 1;
  return (
    <div className="physical-structure">
      {!total && <p className="app-chart-example">暂无数据</p>}
      <div className="physical-structure-bar">
        {displayItems
          .filter((item) => item.value)
          .map((item, index) => (
            <i
              key={item.name}
              style={{
                width: `${(item.value / displayTotal) * 100}%`,
                background: [
                  '#0d9488',
                  '#3b82f6',
                  '#8b5cf6',
                  '#f59e0b',
                  '#ef6b5b',
                  '#22a06b',
                  '#64748b',
                  '#16a3b6',
                ][index],
              }}
              title={`${item.name}：${item.value} 项`}
            />
          ))}
      </div>
      {displayItems
        .map((item) => (
          <div key={item.name}>
            <span>{item.name}</span>
            <b>{total ? `${item.value} 项` : '—'}</b>
            <strong>{total ? `${formatNumber((item.value / displayTotal) * 100, 1)}%` : '—'}</strong>
          </div>
        ))}
      <small>{total ? '统计口径：当前筛选范围内已记录的训练项次数。' : '暂无真实训练项，暂不计算占比。'}</small>
    </div>
  );
}

function TrainingLoadTrend({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const data = [
    ...new Map(sessions.map((session) => [session.trainingDate, session.trainingDate])).keys(),
  ]
    .sort()
    .map((date) => {
      const items = sessions.filter((session) => session.trainingDate === date);
      const loads = items.filter((item) => item.srpe != null);
      return {
        date,
        duration: items.reduce((sum, item) => sum + item.durationMin, 0),
        load: loads.length ? loads.reduce((sum, item) => sum + (item.srpe ?? 0), 0) : null,
      };
    });
  const isPlaceholder = data.length === 0;
  const chartData: Array<{ date: string; duration: number | null; load: number | null }> = data.length
    ? data
    : [{ date: '', duration: null, load: null }];
  return (
    <div className="physical-chart-canvas">
      {isPlaceholder && <span className="app-chart-example">暂无数据</span>}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 18, right: 18, left: -12, bottom: 0 }}>
          <CartesianGrid yAxisId="duration" stroke="var(--line)" strokeDasharray="3 6" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDataOverflow={isPlaceholder}
            domain={isPlaceholder ? [0, 1] : undefined}
            ticks={isPlaceholder ? [0, 0.25, 0.5, 0.75, 1] : undefined}
            yAxisId="duration"
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            axisLine={false}
            tickLine={false}
            unit=" min"
          />
          <YAxis
            allowDataOverflow={isPlaceholder}
            domain={isPlaceholder ? [0, 1] : undefined}
            ticks={isPlaceholder ? [0, 0.25, 0.5, 0.75, 1] : undefined}
            yAxisId="load"
            orientation="right"
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            axisLine={false}
            tickLine={false}
            unit=" AU"
          />
          <Legend verticalAlign="top" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingBottom: 12 }} />
          <Tooltip contentStyle={strengthTooltipStyle} cursor={{ fill: 'var(--line)', fillOpacity: 0.25 }} labelFormatter={(label) => `${label}`} />
          <Bar
            yAxisId="duration"
            dataKey="duration"
            name="训练时长 min"
            fill="var(--teal)"
            fillOpacity={0.75}
            radius={[6, 6, 0, 0]}
            maxBarSize={28}
          />
          <Line
            yAxisId="load"
            type="monotone"
            dataKey="load"
            name="SRPE 训练负荷 AU"
            stroke="var(--amber)"
            strokeWidth={3}
            dot={{ r: 3, fill: 'var(--surface, white)', strokeWidth: 2 }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {isPlaceholder && <p className="app-chart-example-note">暂无当前周期真实数据</p>}
    </div>
  );
}

export function StrengthTrainingDashboard({
  teamId,
  athletes,
  project,
  from,
  to,
  onNavigate,
}: StrengthProps) {
  const [athleteId, setAthleteId] = useState<number | null>(null);
  useEffect(() => { setAthleteId(null); }, [project, teamId]);
  const [sessions, setSessions] = useState<ScopedStrengthSession[]>([]);
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const athleteKey = athletes.map((item) => item.id).join(',');
  useEffect(() => {
    let ignored = false;
    setLoading(true);
    setError(false);
    const athleteIds = athleteKey ? athleteKey.split(',').map(Number) : [];
    api.strengthDashboardData(athleteIds, from, to)
      .then((result) => {
        if (!ignored) {
          setSessions(result.sessions);
          setTests(result.tests);
        }
      })
      .catch(() => {
        if (!ignored) {
          setError(true);
          setSessions([]);
          setTests([]);
        }
      })
      .finally(() => {
        if (!ignored) setLoading(false);
      });
    return () => {
      ignored = true;
    };
  }, [athleteKey, from, to]);
  const periodSessions = useMemo(
    () => sessions.filter((item) => item.trainingDate >= from && item.trainingDate <= to),
    [sessions, from, to]
  );
  const periodTests = useMemo(
    () => tests.filter((test) => test.testDate >= from && test.testDate <= to),
    [tests, from, to]
  );
  const selectedTests = useMemo(
    () => (athleteId ? periodTests.filter((test) => test.athleteId === athleteId) : periodTests),
    [athleteId, periodTests]
  );
  const analysisSessions = useMemo(
    () => (athleteId ? periodSessions.filter((session) => session.athleteId === athleteId) : periodSessions),
    [athleteId, periodSessions]
  );
  const selectorAthletes = useMemo(
    () =>
      athletes.map((athlete) => {
        const athleteSessions = periodSessions.filter((session) => session.athleteId === athlete.id);
        return {
          ...athlete,
          summary: {
            sessionCount: athleteSessions.length,
            durationMin: athleteSessions.length
              ? athleteSessions.reduce((sum, session) => sum + session.durationMin, 0)
              : null,
            distanceKm: null,
            load: athleteSessions.some((session) => session.srpe != null)
              ? athleteSessions.reduce((sum, session) => sum + (session.srpe ?? 0), 0)
              : null,
          },
        };
      }),
    [athletes, periodSessions]
  );
  const latestTest = useMemo(() => latestTestsByAthlete(selectedTests)[0], [selectedTests]);
  const currentMetrics = useMemo(
    () =>
      configuredMetrics(project).flatMap((definition) => {
        const value = latestTest?.metrics[definition.key];
        return typeof value === 'number'
          ? [
              {
                key: definition.key,
                label: definition.label,
                unit: definition.unit,
                value,
                testDate: latestTest.testDate,
                target: latestTest.targets[definition.key],
              },
            ]
          : [];
      }),
    [latestTest, project]
  );
  const teamMetrics = useMemo(
    () => metricsFromTests(latestTestsByAthlete(periodTests), project),
    [periodTests, project]
  );
  const displayMetrics = athleteId ? currentMetrics : teamMetrics;
  return (
    <PageContainer className="professional-overview training-dashboard-page strength-dashboard-page">
      <PageHeader
        variant="dashboard"
        className="overview-page-heading training-plan-entry-heading"
        eyebrow="PHYSICAL TRAINING"
        title="体能训练"
        actions={<><button type="button" className="primary-button" onClick={() => onNavigate('strength-plan')}>训练计划</button><button type="button" className="secondary-button" onClick={() => onNavigate('strength-enode')}>Enode VBT</button>{athleteId ? <button type="button" className="secondary-button" onClick={() => setAthleteId(null)}>当前运动员：{athletes.find((athlete) => athlete.id === athleteId)?.name || '已选运动员'} · 清除</button> : null}</>}
      />

      {loading ? (
        <ContentState
          kind="loading"
          title="正在同步体能训练数据"
          icon={<Activity className="spin" />}
        />
      ) : error ? (
        <ContentState kind="error" title="体能训练数据加载失败" description="请刷新页面重试。" />
      ) : (
        <>
          <section aria-label="整体体能指标">
            <SectionHeader
              title={athleteId ? '体能核心指标概览' : '整体体能指标概览'}
              description={
                athleteId
                  ? '当前运动员本时间范围内最近一次真实测试'
                  : '当前项目、权限与组织范围内的整体体能训练数据'
              }
            />
            <PhysicalCoreMetrics
              sessions={analysisSessions}
              athleteId={athleteId}
            />
          </section>
          <section className="training-dashboard-grid physical-dashboard-grid">
            <ChartCard
              title={athleteId ? '体能能力画像' : '团队体能能力画像'}
              description={
                athleteId ? '仅使用已配置的个人目标进行标准化' : '仅使用真实目标标准化后的团队均值'
              }
              className="dashboard-span-5"
            >
              <AbilityProfile metrics={displayMetrics} athleteId={athleteId} />
            </ChartCard>
            <ChartCard
              title={athleteId ? '关键体能指标趋势' : '关键体能指标整体趋势'}
              description={
                athleteId ? '单指标展示，标记个人历史最佳值' : '单指标展示，按测试日期汇总团队均值'
              }
              className="dashboard-span-7"
            >
              <MetricTrend tests={selectedTests} metrics={displayMetrics} athleteId={athleteId} />
            </ChartCard>
            <ChartCard
              title="体能训练结构"
              description="100% 堆叠比例 · 按当前范围内已记录训练项次数"
              className="dashboard-span-5"
            >
              <TrainingStructure sessions={analysisSessions} />
            </ChartCard>
            <ChartCard
              title="体能训练量趋势"
              description="柱状为总训练时长；折线为已有 SRPE 训练负荷"
              className="dashboard-span-7"
            >
              <TrainingLoadTrend sessions={analysisSessions} />
            </ChartCard>
          </section>
          <StrengthSessionAnalysis sessions={analysisSessions} />
          <PhysicalChampionModel project={project} from={from} to={to} teamId={teamId} />
          <PhysicalTestModule
            tests={periodTests}
            project={project}
            from={from}
            to={to}
            athleteId={athleteId}
            athletes={athletes}
          />
          <ChartCard title="运动员" description={`当前范围共 ${athletes.length} 名运动员 · 默认显示约5条`}>
            <AthleteAnalysisSelector
              athletes={selectorAthletes}
              selectedAthleteId={athleteId}
              onSelect={setAthleteId}
              onClear={() => setAthleteId(null)}
              renderSummary={(athlete) => <span className="athlete-analysis-selector-meta">课次 {athlete.summary?.sessionCount ?? '—'} · 时长 {athlete.summary?.durationMin === null ? '—' : `${formatNumber((athlete.summary?.durationMin || 0) / 60, 1)} h`} · 负荷 {athlete.summary?.load === null ? '—' : `${formatNumber(athlete.summary?.load || 0)} AU`}</span>}
            />
          </ChartCard>
        </>
      )}
    </PageContainer>
  );
}
