import {
  AlarmClock,
  ArrowRight,
  BarChart3,
  Database,
  Dumbbell,
  Gauge,
  HeartPulse,
  Layers3,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import type {
  Athlete,
  OverviewMeasurement,
  OverviewPayload,
  Project,
  ProjectTeam,
  StrengthTest,
  TrainingRecord,
  User,
} from '../types';
import { aggregateRecords, average, formatNumber, percentage } from '../utils';
import { ROLE_META } from '../../shared/access';
import { projectLabel } from '../../shared/projects';
import { PerformanceRadarChart } from '../components/LoadCharts';
import {
  FmsTeamChart,
  InjuryAssessmentChart,
  TrainingContentChart,
  TrainingIntensityChart,
  TrainingVolumeDashboard,
  TrainingLoadEnergyChart,
  trainingLoadCategory,
} from '../components/TrainingAnalysisCharts';
import { AthleteProfileOverview, BirthplaceMapOverview } from '../components/AthleteProfileCharts';
import {
  AppCard,
  ContentState,
  PageContainer,
  PageHeader,
  SectionHeader,
} from '../components/PageLayout';
import {
  buildDailyPerformance,
  buildPerformanceRadar,
  calculateLoadDiagnostics,
} from '../overview-analytics';

type Props = {
  records: TrainingRecord[];
  athletes: Athlete[];
  from: string;
  to: string;
  athleteId: number | null;
  loading: boolean;
  onRangeChange: (from: string, to: string) => void;
  onAthleteChange: (athleteId: number | null) => void;
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
  user: User;
};

type CardSize = 'metric' | 'third' | 'half' | 'wide' | 'full';

const defaultOrder = [
  'duration',
  'distance',
  'srpe',
  'rpe',
  'acute-load',
  'recovery-time',
  'athlete-profile',
  'birthplace-map',
  'fms-analysis',
  'performance-radar',
  'injury-analysis',
  'training-load-analysis',
  'training-intensity',
  'training-content',
  'water-land-load',
  'recovery',
];

const cardMeta: Record<string, { title: string; size: CardSize }> = {
  duration: { title: '训练时长', size: 'metric' },
  distance: { title: '疲劳指数', size: 'metric' },
  srpe: { title: '平均负荷', size: 'metric' },
  rpe: { title: '运动员总数', size: 'metric' },
  'acute-load': { title: '训练负荷', size: 'metric' },
  'recovery-time': { title: '损伤情况', size: 'metric' },
  'athlete-profile': { title: '身体与年龄画像', size: 'full' },
  'birthplace-map': { title: '输送单位', size: 'full' },
  'fms-analysis': { title: '功能动作筛查(FMS)', size: 'half' },
  'performance-radar': { title: '六维运动表现画像', size: 'half' },
  'injury-analysis': { title: '运动损伤评估', size: 'half' },
  'training-load-analysis': { title: '训练量统计', size: 'full' },
  'training-intensity': { title: '训练强度占比', size: 'half' },
  'training-content': { title: '训练课占比', size: 'half' },
  'water-land-load': { title: '训练负荷占比', size: 'half' },
};

export function OverviewPage(props: Props) {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [trainingTeams, setTrainingTeams] = useState<ProjectTeam[]>([]);
  const [trainingTeamId, setTrainingTeamId] = useState<number | null>(null);
  const [teamTrainingOverview, setTeamTrainingOverview] = useState<OverviewPayload | null>(null);
  const [teamTrainingLoading, setTeamTrainingLoading] = useState(false);
  const isSelfOverview = props.user.role === 'ATL';
  const isIndividualOverview = isSelfOverview;
  // 日期、项目和运动员只由应用级筛选栏维护，所有训练页面读取同一份状态。
  const overviewAthleteId = isSelfOverview ? props.user.athleteId : null;
  useEffect(() => {
    if (props.athleteId !== overviewAthleteId) props.onAthleteChange(overviewAthleteId);
  }, [overviewAthleteId, props.athleteId, props.onAthleteChange]);

  useEffect(() => {
    let active = true;
    setOverviewLoading(true);
    setOverviewError('');
    setOverview(null);
    api
      .overview(props.from, props.to, overviewAthleteId, props.project)
      .then((current) => {
        if (!active) return;
        setOverview(current.overview);
      })
      .catch((error) => {
        if (!active) return;
        setOverview(null);
        setOverviewError(error instanceof Error ? error.message : '统一总览数据读取失败');
      })
      .finally(() => {
        if (active) setOverviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.from, props.to, overviewAthleteId, props.project]);

  useEffect(() => {
    let active = true;
    if (isIndividualOverview) {
      setTrainingTeams([]);
      setTrainingTeamId(null);
      return () => {
        active = false;
      };
    }
    api
      .overviewTeams(props.project)
      .then((current) => {
        if (!active) return;
        setTrainingTeams(current.teams);
        setTrainingTeamId((selected) =>
          current.teams.some((team) => team.id === selected)
            ? selected
            : (current.teams[0]?.id ?? null)
        );
      })
      .catch(() => {
        if (!active) return;
        setTrainingTeams([]);
        setTrainingTeamId(null);
      });
    return () => {
      active = false;
    };
  }, [isIndividualOverview, props.project]);

  useEffect(() => {
    let active = true;
    if (isIndividualOverview || !trainingTeamId) {
      setTeamTrainingOverview(null);
      setTeamTrainingLoading(false);
      return () => {
        active = false;
      };
    }
    setTeamTrainingLoading(true);
    setTeamTrainingOverview(null);
    api
      .overview(props.from, props.to, null, props.project, trainingTeamId)
      .then((current) => {
        if (active) setTeamTrainingOverview(current.overview);
      })
      .catch(() => {
        if (active) setTeamTrainingOverview(null);
      })
      .finally(() => {
        if (active) setTeamTrainingLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isIndividualOverview, props.from, props.project, props.to, trainingTeamId]);

  const analysisRecords = overview?.records ?? props.records;
  const trainingOverview = teamTrainingOverview ?? overview;
  const selectedTrainingTeam = trainingTeams.find((team) => team.id === trainingTeamId) ?? null;
  const athleteProfiles = overview?.profiles ?? [];
  const strengthTests = overview?.strengthTests ?? [];
  const strengthLoading = overviewLoading;
  const measurementMap = useMemo(
    () => new Map((overview?.measurements || []).map((item) => [item.code, item])),
    [overview]
  );
  const summary = useMemo(() => aggregateRecords(analysisRecords), [analysisRecords]);
  const durationBreakdown = useMemo(
    () =>
      analysisRecords
        .filter((record) => record.status !== 'rest')
        .reduce(
          (totals, record) => {
            const category = trainingLoadCategory(record);
            if (category) totals[category] += record.durationMin;
            return totals;
          },
          { physical: 0, special: 0, recovery: 0 }
        ),
    [analysisRecords]
  );
  const durationSummary = overview?.trainingAnalytics?.summary;
  const displayTrainingDuration = durationSummary
    ? durationSummary.totalDurationMin
    : summary.totalDuration;
  const displayPhysicalDuration = durationSummary
    ? durationSummary.physicalDurationMin
    : durationBreakdown.physical;
  const displaySpecialDuration = durationSummary
    ? durationSummary.specialDurationMin
    : durationBreakdown.special;
  const trainingLoadBreakdown = useMemo(() => {
    return analysisRecords
      .filter(
        (record) => record.status !== 'rest' && record.date >= props.from && record.date <= props.to
      )
      .reduce(
        (totals, record) => {
          const category = trainingLoadCategory(record);
          if (category) totals[category] += record.srpe;
          return totals;
        },
        { physical: 0, special: 0, recovery: 0 }
      );
  }, [analysisRecords, props.from, props.to]);
  const trainingLoad =
    trainingLoadBreakdown.physical + trainingLoadBreakdown.special + trainingLoadBreakdown.recovery;
  const fatigueSummary = useMemo(() => {
    const athleteDays = new Map<string, number>();
    for (const record of analysisRecords) {
      if (typeof record.fatigueIndex !== 'number' || !Number.isFinite(record.fatigueIndex))
        continue;
      const key = `${record.athleteId}:${record.date}`;
      if (!athleteDays.has(key)) athleteDays.set(key, record.fatigueIndex);
    }
    const values = [...athleteDays.values()];
    const averageValue = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
    return {
      average: averageValue,
      validDays: values.length,
      highDays: values.filter((value) => value >= 6).length,
    };
  }, [analysisRecords]);
  const scopeAthleteCount =
    overview?.meta.athleteCount ||
    new Set(analysisRecords.map((record) => record.athleteId)).size ||
    props.athletes.length ||
    1;
  const injurySummary = useMemo(() => {
    const injuries = overview?.injuries || [];
    const counts = { healthy: 0, observation: 0, restricted: 0, rehab: 0, suspended: 0 };
    for (const injury of injuries) counts[injury.status] += 1;
    counts.healthy += Math.max(0, scopeAthleteCount - injuries.length);
    const active = counts.observation + counts.restricted + counts.rehab + counts.suspended;
    const limited = counts.restricted + counts.rehab + counts.suspended;
    return { ...counts, active, limited };
  }, [overview?.injuries, scopeAthleteCount]);
  const daily = useMemo(
    () =>
      buildDailyPerformance(
        analysisRecords,
        props.from,
        props.to,
        isIndividualOverview ? 'individual' : 'team',
        scopeAthleteCount
      ),
    [analysisRecords, props.from, props.to, isIndividualOverview, scopeAthleteCount]
  );
  const diagnostics = useMemo(
    () => calculateLoadDiagnostics(analysisRecords, daily),
    [analysisRecords, daily]
  );

  const latestStrength = strengthTests[0];
  const measurementSampleCount = Math.max(
    0,
    ...(overview?.measurements || []).map((item) => item.sampleCount)
  );
  const radar = useMemo(
    () => buildPerformanceRadar(latestStrength, diagnostics),
    [latestStrength, diagnostics]
  );
  const selectedAthlete = props.athletes.find((athlete) => athlete.id === overviewAthleteId);

  const scopeLabel = isIndividualOverview
    ? `${selectedAthlete?.name || '本人'} · 个人纵向`
    : `${ROLE_META[props.user.role].label}权限范围 · ${scopeAthleteCount}人`;
  const perAthlete = (value: number) => value / Math.max(1, scopeAthleteCount);

  const renderShell = (id: string, content: ReactNode) => {
    const meta = cardMeta[id];
    if (!meta) return null;
    const size = id === 'athlete-profile' && isIndividualOverview ? 'half' : meta.size;
    return (
      <div key={id} className={`overview-card-shell card-size-${size}`}>
        {content}
      </div>
    );
  };

  const cards: Record<string, ReactNode> = {
    duration: (
      <Metric
        icon={<AlarmClock />}
        label="训练时长"
        value={
          displayTrainingDuration === null ? '—' : formatNumber(displayTrainingDuration / 60, 1)
        }
        unit={displayTrainingDuration === null ? '' : '小时'}
        note={`体能 ${displayPhysicalDuration === null ? '—' : formatNumber(displayPhysicalDuration / 60, 1)}h · 专项 ${displaySpecialDuration === null ? '—' : formatNumber(displaySpecialDuration / 60, 1)}h`}
        tone="navy"
      />
    ),
    distance: (
      <Metric
        icon={<Gauge />}
        label="疲劳指数"
        value={fatigueSummary.average === null ? '—' : formatNumber(fatigueSummary.average, 1)}
        unit={fatigueSummary.average === null ? '' : '分'}
        note={
          fatigueSummary.average === null
            ? '暂无疲劳记录'
            : `有效 ${fatigueSummary.validDays}人日 · 偏高 ${fatigueSummary.highDays}人日`
        }
        tone="teal"
      />
    ),
    srpe: (
      <Metric
        icon={<Gauge />}
        label="平均负荷"
        value={formatNumber(perAthlete(summary.totalSrpe))}
        unit="AU"
        note={`体能 ${formatNumber(perAthlete(trainingLoadBreakdown.physical))}AU · 专项 ${formatNumber(perAthlete(trainingLoadBreakdown.special))}AU`}
        tone="orange"
      />
    ),
    rpe: (
      <Metric
        icon={<UsersRound />}
        label={isIndividualOverview ? '当前运动员' : '运动员总数'}
        value={formatNumber(scopeAthleteCount)}
        unit="人"
        note={
          isIndividualOverview ? '个人视图 · 本人数据' : `${projectLabel(props.project)} · 权限范围内全部运动员`
        }
        tone="blue"
      />
    ),
    'acute-load': (
      <Metric
        icon={<BarChart3 />}
        label="训练负荷"
        value={formatNumber(trainingLoad)}
        unit="AU"
        note={`体能 ${formatNumber(trainingLoadBreakdown.physical)}AU · 专项 ${formatNumber(trainingLoadBreakdown.special)}AU`}
        tone="purple"
      />
    ),
    'recovery-time': (
      <Metric
        icon={<HeartPulse />}
        label="损伤情况"
        value={formatNumber(injurySummary.active)}
        unit="人"
        note={
          injurySummary.active
            ? `观察 ${injurySummary.observation}人 · 受限/康复/停训 ${injurySummary.limited}人`
            : '当前无活动性损伤'
        }
        tone="green"
      />
    ),
    'athlete-profile': (
      <AppCard
        variant="chart"
        className={`professional-panel athlete-profile-panel${isIndividualOverview ? '' : ' team-profile-dashboard'}`}
      >
        <PanelHeading
          title={isIndividualOverview ? '个人身体与年龄画像' : '基本信息'}
          subtitle={
            isIndividualOverview
              ? `${scopeLabel} · 年龄 · 身高 · 体重`
              : `当前队伍 · ${athleteProfiles.length}名运动员 · 身体基础数据`
          }
        />
        <AthleteProfileOverview
          profiles={athleteProfiles}
          individual={isIndividualOverview}
          asOf={props.to}
        />
      </AppCard>
    ),
    'birthplace-map': (
      <AppCard variant="chart" className="professional-panel birthplace-map-panel">
        <PanelHeading
          title="输送单位"
          subtitle={`${scopeLabel} · 省份分布 · 运动员成绩与竞技状态`}
        />
        <BirthplaceMapOverview profiles={athleteProfiles} individual={isIndividualOverview} />
        <p className="analysis-method-note">
          生源地读取运动员籍贯档案，与账号所属区域及数据权限分开管理；地图仅展示当前账号有权访问的运动员。
        </p>
      </AppCard>
    ),
    'fms-analysis': (
      <AppCard
        variant="chart"
        className="professional-panel analysis-feature-panel fms-analysis-panel"
      >
        <PanelHeading
          title="功能动作筛查(FMS)"
          subtitle={`${isIndividualOverview ? '个人FMS' : `最近一次团队测试 · n=${measurementSampleCount || '—'}`} · 标准七项21分制`}
        />
        <FmsTeamChart measurements={overview?.measurements || []} />
        <p className="analysis-method-note">
          每个动作按0–3分计，团队柱为最近一次测试的单项平均分；2分表示动作模式基本达标，低于2分列入纠正训练。七项齐全时汇总为21分制队均，14分仅作复查参考，不单独用于判断损伤风险。
        </p>
      </AppCard>
    ),
    'performance-radar': (
      <AppCard variant="chart" className="professional-panel">
        <PanelHeading title="制胜要素分析" subtitle={`${scopeLabel} · 目标达成制`} />
        {strengthLoading ? (
          <ContentState
            kind="loading"
            className="professional-chart-empty"
            title="正在读取力量测试…"
          />
        ) : (
          <PerformanceRadarChart data={radar} />
        )}
        <p className="analysis-method-note">
          评分只反映教练目标达成、双侧差异和本周期恢复记录，不用于选材或伤病诊断；未测试项不计0分。
        </p>
      </AppCard>
    ),
    'injury-analysis': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="运动损伤评估" subtitle={`${scopeLabel} · 最新伤病记录 · 训练可用性`} />
        <InjuryAssessmentChart
          injuries={overview?.injuries || []}
          athleteCount={scopeAthleteCount}
        />
        <p className="analysis-method-note">
          按每名运动员最新记录统计健康、观察、受限、康复和停训状态，不能替代医学诊断。
        </p>
      </AppCard>
    ),
    'training-load-analysis': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <div className="training-analytics-heading-row">
          <PanelHeading
            title="训练量统计"
            subtitle={
              selectedTrainingTeam
                ? `${selectedTrainingTeam.name} · 整体投入 · 专项 · 体能 · 生理生化 · RPE`
                : '整体投入 · 专项 · 体能 · 生理生化 · RPE'
            }
          />
          {!isIndividualOverview && (
            <label className="training-analytics-team-filter">
              <span>队伍</span>
              <select
                value={trainingTeamId ?? ''}
                onChange={(event) =>
                  setTrainingTeamId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">全部可访问队伍</option>
                {trainingTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}（{team.athleteCount}人）
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {teamTrainingLoading ? (
          <ContentState
            kind="loading"
            className="professional-chart-empty"
            title="正在按队伍汇总训练量…"
          />
        ) : (
          <TrainingVolumeDashboard
            from={props.from}
            to={props.to}
            data={
              trainingOverview?.trainingAnalytics || {
                summary: {
                  totalDurationMin: null,
                  testDurationMin: null,
                  recoveryDurationMin: null,
                  specialDurationMin: null,
                  specialDistanceKm: null,
                  specialLoad: null,
                  specialSessionCount: 0,
                  physicalDurationMin: null,
                  physicalLoad: null,
                  physicalSessionCount: 0,
                  rpeAverage: null,
                  rpeHighest: null,
                  rpeLowest: null,
                },
                days: [],
              }
            }
            physiology={trainingOverview?.physiologyHeatmap || { metrics: [] }}
          />
        )}
      </AppCard>
    ),
    'training-intensity': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="训练强度占比" subtitle="按原始强度区间统计训练时长" />
        <TrainingIntensityChart data={overview?.intensityDistribution || []} />
      </AppCard>
    ),
    'training-content': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="训练课占比" subtitle="九类训练课次占比（当前页面时间范围）" />
        <TrainingContentChart records={analysisRecords} />
      </AppCard>
    ),
    'water-land-load': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="训练负荷占比" subtitle="专项 · 体能 · 恢复（SRPE 训练负荷）" />
        <TrainingLoadEnergyChart
          data={
            overview?.trainingLoadRatio || {
              specialLoad: 0,
              physicalLoad: 0,
              recoveryLoad: 0,
              totalLoad: 0,
              specialPercentage: 0,
              physicalPercentage: 0,
              recoveryPercentage: 0,
            }
          }
        />
      </AppCard>
    ),
  };

  return (
    <PageContainer className="professional-overview">
      <PageHeader
        variant="dashboard"
        className="overview-page-heading"
        eyebrow="TRAINING OVERVIEW"
        title={
          isSelfOverview ? '我的训练总览' : isIndividualOverview ? '运动员训练总览' : '训练总览'
        }
        supportingContent={
          <div
            className="overview-principle"
            role="note"
            aria-label="有训练就要有数据，有数据就要有统计，有统计就要有分析，有分析就要对标对表"
          >
            <div className="overview-principle-flow" aria-hidden="true">
              <span>
                有训练就要有<strong>数据</strong>
              </span>
              <ArrowRight />
              <span>
                有数据就要有<strong>统计</strong>
              </span>
              <ArrowRight />
              <span>
                有统计就要有<strong>分析</strong>
              </span>
              <ArrowRight />
              <span>
                有分析就要<strong>对标对表</strong>
              </span>
            </div>
          </div>
        }
      />
      {overviewError && (
        <div className="overview-data-provenance error">
          <Database size={15} />
          <strong>统一指标接口暂不可用</strong>
          <span>{overviewError}，当前显示兼容数据。</span>
        </div>
      )}
      {props.loading || (overviewLoading && !overview) ? (
        <PageSkeleton />
      ) : (
        <section className="professional-dashboard-grid">
          {defaultOrder.filter((id) => cardMeta[id]).map((id) => renderShell(id, cards[id]))}
        </section>
      )}
    </PageContainer>
  );
}

function PanelHeading({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon?: ReactNode;
}) {
  return (
    <SectionHeader
      className="professional-heading"
      title={title}
      description={subtitle}
      icon={icon && <span className="analysis-title-icon">{icon}</span>}
    />
  );
}

function Metric({
  icon,
  label,
  value,
  unit,
  note,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
  note: string;
  tone: string;
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>
          {value}
          <small>{unit}</small>
        </strong>
        <p>{note}</p>
      </div>
      <div className="metric-waterline" aria-hidden="true" />
    </article>
  );
}

function measurementValue(measurements: Map<string, OverviewMeasurement>, code: string) {
  const value = measurements.get(code)?.value;
  return typeof value === 'number' ? value : null;
}

function MovementMatrix({
  latest,
  measurements,
}: {
  latest?: StrengthTest;
  measurements: Map<string, OverviewMeasurement>;
}) {
  const score = (code: string) => {
    const value = measurementValue(measurements, code);
    return value === null ? null : `${formatNumber(value, 0)}分`;
  };
  const rows = [
    { label: '深蹲', detail: '踝、膝、髋与躯干整体控制', value: score('fms_deep_squat') },
    { label: '跨栏步', detail: '单腿支撑、髋膝踝控制', value: score('fms_hurdle_step') },
    { label: '直线弓步蹲', detail: '分腿姿态下稳定和控制', value: score('fms_inline_lunge') },
    {
      label: '肩部灵活性',
      detail: '肩胛胸廓和肩关节活动度',
      value: score('fms_shoulder_mobility'),
    },
    {
      label: '主动直腿上抬',
      detail: '髋关节灵活性和骨盆控制',
      value: score('fms_active_straight_leg_raise'),
    },
    {
      label: '躯干稳定俯卧撑',
      detail: '反伸抗力和躯干稳定',
      value: score('fms_trunk_stability_pushup'),
    },
    { label: '旋转稳定性', detail: '多平面核心控制和对称性', value: score('fms_rotary_stability') },
    {
      label: '单腿蹲对称',
      detail: '膝内扣与左右功能控制',
      value: symmetryLabel(
        latest?.metrics.leftSingleLegSquatReps,
        latest?.metrics.rightSingleLegSquatReps
      ),
    },
    {
      label: '柔韧能力',
      detail: '坐位体前屈',
      value:
        typeof latest?.metrics.sitReachCm === 'number'
          ? `${latest.metrics.sitReachCm.toFixed(1)} cm`
          : null,
    },
  ];
  return (
    <div className="movement-matrix">
      {rows.map((row) => (
        <div key={row.label} className={row.value ? 'available' : 'missing'}>
          <i />
          <span>
            <strong>{row.label}</strong>
            <small>{row.detail}</small>
          </span>
          <b>{row.value || '待补测'}</b>
        </div>
      ))}
    </div>
  );
}

function symmetryLabel(left?: number, right?: number) {
  if (typeof left !== 'number' || typeof right !== 'number' || Math.max(left, right) <= 0)
    return null;
  return `差异 ${((Math.abs(left - right) / Math.max(left, right)) * 100).toFixed(1)}%`;
}

function PageSkeleton() {
  return (
    <div className="page-skeleton">
      <div />
      <div />
      <div />
      <div />
      <section />
    </div>
  );
}
