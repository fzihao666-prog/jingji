import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Gauge,
  HeartPulse,
  MapPinned,
  RefreshCw,
  Route,
  Sparkles,
  Target,
  TimerReset,
  TrendingUp,
  Waves,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SpecialPageKey } from '../components/AppShell';
import { SpecialPerformancePanel } from '../components/SpecialPerformancePanel';
import {
  AppCard,
  ContentState,
  PageContainer,
  PageHeader,
  SectionHeader,
} from '../components/PageLayout';
import type { Project, TrainingRecord } from '../types';
import { projectCapability, projectLabel } from '../../shared/projects';
import { ProjectSpecialTraining } from '../components/ProjectSpecialTraining';
import './SpecialTrainingPage.css';
import '../components/EChart.css';

type Props = {
  records: TrainingRecord[];
  project: Project;
  from: string;
  to: string;
  loading: boolean;
  section: Exclude<SpecialPageKey, 'special-overview'>;
  onSectionChange: (section: SpecialPageKey) => void;
  onPlanOpen: () => void;
};

type Session = {
  id: string;
  date: string;
  athleteId: number;
  athleteName: string;
  type: string;
  content: string;
  duration: number;
  distance: number;
  rpe: number | null;
  load: number;
  strokeRate: number | null;
  heartRate: number | null;
  maxHeartRate: number | null;
  power: number | null;
  sleepHours: number | null;
  fatigueIndex: number | null;
  source: 'system' | 'manual' | 'import';
};

const SECTION_META: Record<
  Exclude<SpecialPageKey, 'special-overview'>,
  { group: string; title: string; english: string; description: string }
> = {
  'special-volume': {
    group: '综合分析',
    title: '训练量分析',
    english: 'TRAINING VOLUME',
    description: '汇总专项训练次数、训练距离与训练时间，观察周期训练量变化。',
  },
  'special-time': {
    group: '综合分析',
    title: '时间分析',
    english: 'TRAINING TIME',
    description: '按周期、训练类型和运动员拆解专项训练时长与完成质量。',
  },
  'special-distance': {
    group: '综合分析',
    title: '距离分析',
    english: 'TRAINING DISTANCE',
    description: '监测专项里程、强度分布与运动员距离完成情况。',
  },
  'special-load': {
    group: '综合分析',
    title: '负荷分析',
    english: 'TRAINING LOAD',
    description: '结合 sRPE、急慢性负荷比与恢复状态识别训练风险。',
  },
  'special-rate': {
    group: '专项指标',
    title: '桨频分析',
    english: 'STROKE RATE',
    description: '观察不同训练区间的桨频效率、稳定性与专项节奏。',
  },
  'special-heart': {
    group: '专项指标',
    title: '心率分析',
    english: 'HEART RATE',
    description: '分析心率响应、训练区间与负荷后的恢复能力。',
  },
  'special-power': {
    group: '专项指标',
    title: '功率分析',
    english: 'POWER OUTPUT',
    description: '评估平均功率、峰值能力、功率体重比与持续输出。',
  },
  'special-records': {
    group: '训练记录',
    title: '训练记录',
    english: 'TRAINING RECORDS',
    description: '按当前项目和日期范围查看专项训练历史记录。',
  },
  'special-schedule': {
    group: '训练执行',
    title: '训练安排',
    english: 'TRAINING SCHEDULE',
    description: '协调技术、战术、体能与恢复训练，形成清晰可执行的周计划。',
  },
};

const COLORS = ['#12978f', '#347fe5', '#78b83f', '#f69a33', '#8b65d4'];
const tooltipStyle = {
  border: '1px solid #d8e5e6',
  borderRadius: 10,
  boxShadow: '0 10px 28px rgba(8,45,56,.12)',
  fontSize: 11,
};

function dateOffset(iso: string, offset: number) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}
function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}
function sum(sessions: Session[], key: 'duration' | 'distance' | 'load') {
  return sessions.reduce((total, item) => total + item[key], 0);
}
function averageMetric(
  sessions: Session[],
  key: 'rpe' | 'strokeRate' | 'heartRate' | 'power' | 'sleepHours' | 'fatigueIndex'
) {
  const values = sessions
    .map((item) => item[key])
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}
function stabilityScore(sessions: Session[], key: 'strokeRate' | 'heartRate' | 'power') {
  const average = averageMetric(sessions, key);
  const values = sessions
    .map((item) => item[key])
    .filter((value): value is number => value !== null);
  if (!average || !values.length) return 0;
  const deviation = Math.sqrt(
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length
  );
  return Math.max(0, Math.min(100, Math.round(100 - (deviation / average) * 100)));
}
function projectMetric(project: Project) {
  if (project === 'CANOE_SPRINT')
    return {
      label: '划频',
      unit: '次/分',
      technique: '双桨衔接效率',
    };
  if (project === 'CANOE_SLALOM')
    return {
      label: '划频',
      unit: '次/分',
      technique: '门区转换效率',
    };
  return {
    label: '桨频',
    unit: '桨/分',
    technique: '推进阶段一致性',
  };
}

function recordSessions(records: TrainingRecord[], project: Project): Session[] {
  return records.filter(record => record.projectCode === project && record.projectStatus === 'confirmed').map((record) => {
    const rpe = record.rpe;
    return {
      id: `record-${record.id}`,
      date: record.date,
      athleteId: record.athleteId,
      athleteName: record.athleteName,
      type: record.trainingType || '专项训练',
      content: record.content || '专项训练记录',
      duration: record.durationMin,
      distance: record.distanceKm,
      rpe,
      load: record.rpe !== null && record.durationReported ? (record.srpe ?? 0) : 0,
      strokeRate: record.strokeRateSpm ?? null,
      heartRate: record.averageHeartRate ?? null,
      maxHeartRate: record.maxHeartRate ?? null,
      power: record.averagePowerW ?? null,
      sleepHours: record.sleepHours ?? null,
      fatigueIndex: record.fatigueIndex ?? null,
      source: 'system',
    };
  });
}

function aggregateDays(sessions: Session[]) {
  const map = new Map<
    string,
    {
      date: string;
      duration: number;
      distance: number;
      load: number;
      rate: number;
      power: number;
      heart: number;
      rateCount: number;
      heartCount: number;
      powerCount: number;
    }
  >();
  sessions.forEach((item) => {
    const current = map.get(item.date) || {
      date: item.date.slice(5),
      duration: 0,
      distance: 0,
      load: 0,
      rate: 0,
      power: 0,
      heart: 0,
      rateCount: 0,
      heartCount: 0,
      powerCount: 0,
    };
    current.duration += item.duration;
    current.distance += item.distance;
    current.load += item.load;
    if (item.strokeRate !== null) {
      current.rate += item.strokeRate;
      current.rateCount += 1;
    }
    if (item.heartRate !== null) {
      current.heart += item.heartRate;
      current.heartCount += 1;
    }
    if (item.power !== null) {
      current.power += item.power;
      current.powerCount += 1;
    }
    map.set(item.date, current);
  });
  const daily = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([isoDate, item]) => ({
      ...item,
      isoDate,
      duration: round(item.duration / 60, 2),
      distance: round(item.distance, 1),
      load: Math.round(item.load),
      rate: item.rateCount ? round(item.rate / item.rateCount) : null,
      power: item.powerCount ? Math.round(item.power / item.powerCount) : null,
      heart: item.heartCount ? Math.round(item.heart / item.heartCount) : null,
    }));
  return daily.map((item) => ({
    ...item,
    chronic: Math.round(
      daily
        .filter(
          (candidate) =>
            candidate.isoDate >= dateOffset(item.isoDate, -27) && candidate.isoDate <= item.isoDate
        )
        .reduce((total, candidate) => total + candidate.load, 0) / 4
    ),
  }));
}

function loadSnapshot(sessions: Session[]) {
  const end = sessions.reduce((latest, item) => (item.date > latest ? item.date : latest), '');
  if (!end) return { acute: 0, chronic: 0, acwr: 0 };
  const acute = sessions
    .filter((item) => item.date >= dateOffset(end, -6) && item.date <= end)
    .reduce((total, item) => total + item.load, 0);
  const chronic =
    sessions
      .filter((item) => item.date >= dateOffset(end, -27) && item.date <= end)
      .reduce((total, item) => total + item.load, 0) / 4;
  return { acute, chronic, acwr: chronic > 0 ? acute / chronic : 0 };
}

function loadRiskInsights(sessions: Session[]) {
  const grouped = new Map<string, Session[]>();
  sessions.forEach((item) =>
    grouped.set(item.athleteName, [...(grouped.get(item.athleteName) || []), item])
  );
  const risks = [...grouped.entries()]
    .map(([name, own]) => ({
      name,
      ...loadSnapshot(own),
      highRpeDays: new Set(own.filter((item) => item.rpe !== null && item.rpe >= 8).map((item) => item.date)).size,
    }))
    .sort((a, b) => b.acwr - a.acwr);
  const highest = risks[0];
  const repeatedHighRpe = [...risks].sort((a, b) => b.highRpeDays - a.highRpeDays)[0];
  const totalLoad = sum(sessions, 'load');
  const highIntensityShare =
    totalLoad > 0
      ? (sum(
          sessions.filter((item) => item.rpe !== null && item.rpe >= 8),
          'load'
        ) /
          totalLoad) *
        100
      : 0;
  return [
    highest
      ? `${highest.name} 当前 ACWR ${round(highest.acwr, 2)}：${highest.acwr > 1.5 ? '建议降低下一次高强度课总量。' : highest.acwr < 0.8 ? '近期刺激偏低，建议结合周期目标复核。' : '处于常用监测区间。'}`
      : '当前周期暂无可计算的负荷比。',
    repeatedHighRpe
      ? `${repeatedHighRpe.name} 本周期有 ${repeatedHighRpe.highRpeDays} 天 RPE ≥ 8：${repeatedHighRpe.highRpeDays >= 3 ? '建议增加恢复监测。' : '尚未形成连续高主观强度。'}`
      : '当前周期暂无主观强度记录。',
    `全队高强度负荷占比 ${round(highIntensityShare)}%，请结合训练阶段与恢复状态判断。`,
  ];
}

function SectionCard({
  title,
  note,
  children,
  className = '',
}: {
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AppCard variant="chart" className={`professional-panel special-card ${className}`}>
      <SectionHeader title={title} description={note} />
      {children}
    </AppCard>
  );
}
function MetricCard({
  icon,
  label,
  value,
  unit,
  change,
  tone = 'teal',
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  change: string;
  tone?: string;
}) {
  return (
    <div className="overview-card-shell card-size-metric special-metric-shell">
      <article className={`metric-card special-metric tone-${tone}`}>
        <div className="metric-icon">{icon}</div>
        <div className="metric-copy">
          <span>{label}</span>
          <strong>
            {value}
            <small>{unit}</small>
          </strong>
          <p>{change}</p>
        </div>
        <div className="metric-waterline" aria-hidden="true" />
      </article>
    </div>
  );
}

export function TrendChart({
  data,
  metric,
  color = '#12978f',
  secondary,
}: {
  data: ReturnType<typeof aggregateDays>;
  metric: 'duration' | 'distance' | 'load' | 'rate' | 'heart' | 'power';
  color?: string;
  secondary?: 'chronic';
}) {
  const isPlaceholder = !data.some((row) => row[metric] !== null && Number.isFinite(row[metric]));
  const chartData = data;
  return (
    <div className="special-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.28} />
              <stop offset="1" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e8eff0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#778b91' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#778b91' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => `${label}`} />
          <Area
            type="monotone"
            dataKey={metric}
            stroke={color}
            strokeWidth={2.2}
            fill={`url(#fill-${metric})`}
          />
          {secondary && (
            <Line
              type="monotone"
              dataKey={secondary}
              stroke="#347fe5"
              strokeWidth={2}
              dot={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {isPlaceholder && <p className="app-chart-example-note">暂无当前周期真实数据</p>}
    </div>
  );
}

export function TypeDonut({
  sessions,
  valueKey = 'duration',
}: {
  sessions: Session[];
  valueKey?: 'duration' | 'distance' | 'load';
}) {
  const values = useMemo(() => {
    const grouped = new Map<string, number>();
    sessions.forEach((item) =>
      grouped.set(item.type, (grouped.get(item.type) || 0) + item[valueKey])
    );
    return [...grouped]
      .map(([name, value]) => ({ name, value: round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [sessions, valueKey]);
  const total = Math.max(
    values.reduce((result, item) => result + item.value, 0),
    1
  );
  const isPlaceholder = !values.some((item) => item.value > 0);
  const chartValues = values;
  return (
    <div className="special-donut-wrap">
      <ResponsiveContainer width="48%" height={210}>
        <PieChart>
          <Pie
            data={chartValues}
            dataKey="value"
            nameKey="name"
            innerRadius={58}
            outerRadius={82}
            paddingAngle={2}
          >
            {chartValues.map((_, index) => (
              <Cell key={index} fill={COLORS[index]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value, '']} />
        </PieChart>
      </ResponsiveContainer>
      <div className="special-legend">
        {chartValues.map((item, index) => (
          <div key={item.name}>
            <i style={{ background: COLORS[index] }} />
            <span>{item.name}</span>
            <strong>{round((item.value / total) * 100)}%</strong>
          </div>
        ))}
      </div>
      {isPlaceholder && <p className="app-chart-example-note">暂无真实占比数据</p>}
    </div>
  );
}

function AthleteTable({
  sessions,
  metric,
}: {
  sessions: Session[];
  metric: 'duration' | 'distance' | 'load' | 'strokeRate' | 'heartRate' | 'power';
}) {
  const rows = useMemo(() => {
    const grouped = new Map<string, { name: string; total: number; count: number; rpe: number; rpeCount: number }>();
    sessions.forEach((item) => {
      const value = item[metric];
      if (value === null) return;
      const row = grouped.get(item.athleteName) || {
        name: item.athleteName,
        total: 0,
        count: 0,
        rpe: 0, rpeCount: 0,
      };
      row.total += value;
      row.count += 1;
      if (item.rpe !== null) { row.rpe += item.rpe; row.rpeCount += 1; }
      grouped.set(item.athleteName, row);
    });
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        value: ['strokeRate', 'heartRate', 'power'].includes(metric)
          ? row.total / row.count
          : row.total,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [sessions, metric]);
  const unit =
    metric === 'duration'
      ? 'min'
      : metric === 'distance'
        ? 'km'
        : metric === 'load'
          ? 'AU'
          : metric === 'heartRate'
            ? 'bpm'
            : metric === 'power'
              ? 'W'
              : 'spm';
  const teamAverageValue = rows.length
    ? rows.reduce((total, row) => total + row.value, 0) / rows.length
    : 0;
  return (
    <div className="special-table-wrap">
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>运动员</th>
            <th>训练次数</th>
            <th>指标值</th>
            <th>平均 RPE</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const attention = teamAverageValue > 0 && row.value < teamAverageValue * 0.9;
            return (
              <tr key={row.name}>
                <td>
                  <b className={`rank rank-${index + 1}`}>{index + 1}</b>
                </td>
                <td>
                  <strong>{row.name}</strong>
                </td>
                <td>{row.count}</td>
                <td className="table-value">
                  {round(row.value)} {unit}
                </td>
                <td>{row.rpeCount ? round(row.rpe / row.rpeCount) : '—'}</td>
                <td>
                  <span className={attention ? 'status attention' : 'status good'}>
                    {attention ? '低于队均' : '区间正常'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InsightList({ items, warning = false }: { items: string[]; warning?: boolean }) {
  return (
    <div className="insight-list">
      {items.map((item, index) => (
        <div key={item}>
          <i className={warning && index < 2 ? 'warn' : ''}>
            {warning && index < 2 ? <AlertTriangle /> : <CheckCircle2 />}
          </i>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}
function ProjectNotes({ project }: { project: Project }) {
  const items =
    project === 'ROWING'
      ? ['以 500m / 2000m 分段为核心', '关注艇速、桨频与功率同步', '单桨 / 双桨分组比较']
      : project === 'CANOE_SPRINT'
        ? [
            '以 200m / 500m / 1000m 分段为核心',
            '关注左右侧输出与高划频保持',
            '单艇 / 双艇 / 四艇分组比较',
          ]
        : ['距离之外增加门区通过质量', '关注逆水门、顺水门耗时', '结合罚分与线路偏差评价'];
  return (
    <div className="project-notes">
      <span>{projectLabel(project)}专项口径</span>
      {items.map((item, index) => (
        <div key={item}>
          <b>0{index + 1}</b>
          <p>{item}</p>
        </div>
      ))}
    </div>
  );
}

function AnalysisPage({
  section,
  sessions,
  days,
  project,
}: {
  section: SpecialPageKey;
  sessions: Session[];
  days: ReturnType<typeof aggregateDays>;
  project: Project;
}) {
  if (section === 'special-time') {
    const total = sum(sessions, 'duration');
    const specialtyMinutes = sum(
      sessions.filter((item) => item.type.includes('专项') || item.type.includes('技术')),
      'duration'
    );
    const specialtyShare = total ? round((specialtyMinutes / total) * 100) : 0;
    return (
      <>
        <div className="special-metrics">
          <MetricCard
            icon={<Clock3 />}
            label="总训练时长"
            value={round(total / 60, 1)}
            unit="h"
            change={`来自 ${sessions.length} 条训练记录`}
          />
          <MetricCard
            icon={<CalendarDays />}
            label="日均训练"
            value={round(total / Math.max(days.length, 1))}
            unit="min"
            change={`${days.length} 个有效训练日`}
            tone="blue"
          />
          <MetricCard
            icon={<TimerReset />}
            label="单次平均"
            value={round(total / Math.max(sessions.length, 1))}
            unit="min"
            change="按实际训练记录计算"
            tone="green"
          />
          <MetricCard
            icon={<CheckCircle2 />}
            label="专项课时占比"
            value={specialtyShare}
            unit="%"
            change={`${round(specialtyMinutes / 60)} 小时专项与技术训练`}
            tone="purple"
          />
        </div>
        <div className="special-grid">
          <SectionCard title="训练时间趋势" note="小时 · 按日" className="span-8">
            <TrendChart data={days} metric="duration" />
          </SectionCard>
          <SectionCard title="训练类别构成" note="按时长统计" className="span-4">
            <TypeDonut sessions={sessions} />
          </SectionCard>
          <SectionCard title="运动员时长对比" note="与队内均值联动" className="span-8">
            <AthleteTable sessions={sessions} metric="duration" />
          </SectionCard>
          <SectionCard title="时间执行诊断" note="周期建议" className="span-4">
            <InsightList
              items={[
                `当前周期共有 ${days.length} 个有效训练日、${sessions.length} 条训练记录。`,
                `专项与技术训练占总时长 ${specialtyShare}%，请结合周期目标复核。`,
                `单次平均训练 ${round(total / Math.max(sessions.length, 1))} 分钟，建议同步观察恢复评分。`,
              ]}
            />
          </SectionCard>
        </div>
      </>
    );
  }
  if (section === 'special-distance') {
    const total = sum(sessions, 'distance');
    const highIntensityDistance = sum(
      sessions.filter((item) => item.rpe !== null && item.rpe >= 8),
      'distance'
    );
    const highShare = total ? round((highIntensityDistance / total) * 100) : 0;
    return (
      <>
        <div className="special-metrics">
          <MetricCard
            icon={<Route />}
            label="总训练距离"
            value={round(total, 1)}
            unit="km"
            change={`来自 ${sessions.length} 条训练记录`}
          />
          <MetricCard
            icon={<Target />}
            label="日均距离"
            value={round(total / Math.max(days.length, 1))}
            unit="km"
            change={`${days.length} 个有效训练日`}
            tone="blue"
          />
          <MetricCard
            icon={<MapPinned />}
            label="最长单次"
            value={round(Math.max(...sessions.map((item) => item.distance), 0))}
            unit="km"
            change="按单次训练记录统计"
            tone="green"
          />
          <MetricCard
            icon={<Zap />}
            label="高强度距离"
            value={round(highIntensityDistance)}
            unit="km"
            change={`RPE ≥ 8，占总距离 ${highShare}%`}
            tone="orange"
          />
        </div>
        <div className="special-grid">
          <SectionCard title="专项距离趋势" note="公里 · 按日" className="span-8">
            <TrendChart data={days} metric="distance" color="#167d9b" />
          </SectionCard>
          <SectionCard title="距离训练构成" note="技术 / 耐力 / 力量 / 恢复" className="span-4">
            <TypeDonut sessions={sessions} valueKey="distance" />
          </SectionCard>
          <SectionCard title="距离完成排名" note="连接运动员档案与训练记录" className="span-8">
            <AthleteTable sessions={sessions} metric="distance" />
          </SectionCard>
          <SectionCard title={`${projectLabel(project)}距离模型`} note="项目差异" className="span-4">
            <ProjectNotes project={project} />
          </SectionCard>
        </div>
      </>
    );
  }
  const total = sum(sessions, 'load');
  const { acute, chronic, acwr } = loadSnapshot(sessions);
  return (
    <>
      <div className="special-metrics">
        <MetricCard
          icon={<Activity />}
          label="总训练负荷"
          value={Math.round(total)}
          unit="AU"
          change={`来自 ${sessions.length} 条训练记录`}
        />
        <MetricCard
          icon={<TrendingUp />}
          label="急性负荷（7天）"
          value={Math.round(acute)}
          unit="AU"
          change="近 7 天滚动值"
          tone="blue"
        />
        <MetricCard
          icon={<BarChart3 />}
          label="慢性负荷（28天）"
          value={Math.round(chronic)}
          unit="AU"
          change="近 28 天周均值"
          tone="green"
        />
        <MetricCard
          icon={<AlertTriangle />}
          label="负荷风险 ACWR"
          value={round(acwr, 2)}
          change={
            acwr > 1.5 ? '负荷增长偏快，建议复核' : acwr < 0.8 ? '近期刺激偏低' : '处于常用监测区间'
          }
          tone="purple"
        />
      </div>
      <div className="special-grid">
        <SectionCard title="急慢性负荷趋势" note="ACWR 建议区间 0.8–1.5" className="span-8">
          <TrendChart data={days} metric="load" secondary="chronic" />
        </SectionCard>
        <SectionCard title="训练负荷构成" note="按 sRPE 统计" className="span-4">
          <TypeDonut sessions={sessions} valueKey="load" />
        </SectionCard>
        <SectionCard title="运动员负荷与风险" note="按累计 sRPE 排序" className="span-8">
          <AthleteTable sessions={sessions} metric="load" />
        </SectionCard>
        <SectionCard title="风险预警" note="根据当前记录自动识别" className="span-4">
          <InsightList warning items={loadRiskInsights(sessions)} />
        </SectionCard>
      </div>
    </>
  );
}

function TrainingVolumePage({
  sessions,
  days,
}: {
  sessions: Session[];
  days: ReturnType<typeof aggregateDays>;
}) {
  const totalDuration = sum(sessions, 'duration');
  const totalDistance = sum(sessions, 'distance');
  const averageDuration = totalDuration / Math.max(sessions.length, 1);
  const averageDailyDuration = totalDuration / Math.max(days.length, 1);

  return (
    <>
      <div className="special-metrics">
        <MetricCard
          icon={<CalendarDays />}
          label="专项训练次数"
          value={sessions.length}
          unit="场"
          change={`${days.length} 个有效训练日`}
        />
        <MetricCard
          icon={<Clock3 />}
          label="专项训练时间"
          value={round(totalDuration / 60, 1)}
          unit="h"
          change={`日均 ${round(averageDailyDuration)} min`}
          tone="blue"
        />
        <MetricCard
          icon={<Route />}
          label="专项训练量"
          value={round(totalDistance, 1)}
          unit="km"
          change="按训练距离累计"
          tone="green"
        />
        <MetricCard
          icon={<TimerReset />}
          label="单次训练时间"
          value={round(averageDuration)}
          unit="min"
          change="按实际训练记录计算"
          tone="purple"
        />
      </div>
      <div className="special-grid">
        <SectionCard title="专项训练量趋势" note="公里 · 按日" className="span-7">
          <TrendChart data={days} metric="distance" color="#347fe5" />
        </SectionCard>
        <SectionCard title="专项训练时间趋势" note="小时 · 按日" className="span-5">
          <TrendChart data={days} metric="duration" />
        </SectionCard>
        <SectionCard title="训练量类别构成" note="按训练距离统计" className="span-4">
          <TypeDonut sessions={sessions} valueKey="distance" />
        </SectionCard>
        <SectionCard title="运动员训练时间对比" note="按累计训练时长排序" className="span-8">
          <AthleteTable sessions={sessions} metric="duration" />
        </SectionCard>
        <SectionCard title="训练量与时间诊断" note="当前筛选周期" className="span-12">
          <InsightList
            items={[
              `当前周期完成 ${sessions.length} 场专项训练，覆盖 ${days.length} 个有效训练日。`,
              `累计训练量 ${round(totalDistance, 1)} km，累计训练时间 ${round(totalDuration / 60, 1)} 小时。`,
              `单次训练平均 ${round(averageDuration)} 分钟；建议结合“负荷分析”同步复核强度与恢复情况。`,
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function MetricPage({ section, sessions, days, project }: {
  section: SpecialPageKey; sessions: Session[]; days: ReturnType<typeof aggregateDays>; project: Project;
}) {
  const kind = section === 'special-rate' ? 'rate' : section === 'special-heart' ? 'heart' : 'power';
  const metric = projectMetric(project);
  const key = kind === 'rate' ? 'strokeRate' : kind === 'heart' ? 'heartRate' : 'power';
  const values = sessions.map(row => row[key]).filter((value): value is number => value !== null && Number.isFinite(value));
  const label = kind === 'rate' ? metric.label : kind === 'heart' ? '课次平均心率' : '课次平均功率';
  const unit = kind === 'rate' ? metric.unit : kind === 'heart' ? 'bpm' : 'W';
  return <>
    <div className="special-metrics">
      <MetricCard icon={<Activity />} label={`${label}均值`} value={values.length ? round(values.reduce((sum,value) => sum+value,0)/values.length) : '—'} unit={unit} change={`有效课次 ${values.length}/${sessions.length}；仅为课次值均值`} />
      <MetricCard icon={<Gauge />} label="最高课次记录值" value={values.length ? Math.max(...values) : '—'} unit={unit} change="不代表瞬时峰值，不用于达标分区" />
    </div>
    <SectionCard title={`${label}趋势`} note="仅展示实测，不推算强度阈值或效率评分" className="span-12">
      <TrendChart data={days} metric={kind} color="#12978f" />
    </SectionCard>
    <SectionCard title={`${label}课次汇总`} note="描述性统计，不作为冠军评分" className="span-12">
      <AthleteTable sessions={sessions} metric={key} />
    </SectionCard>
  </>;
}

export function SpecialTestsPage({
  records,
  project,
  from,
  to,
  loading,
  section,
  onSectionChange,
  onPlanOpen,
}: Props) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [section]);
  const systemSessions = useMemo(() => recordSessions(records, project), [records, project]);
  const sessions = useMemo(
    () => systemSessions.filter((item) => item.date >= from && item.date <= to),
    [systemSessions, from, to]
  );
  const days = useMemo(() => aggregateDays(sessions), [sessions]);
  const meta = SECTION_META[section];
  if (!projectCapability(project)) return <PageContainer>
    <PageHeader eyebrow="SPECIAL TRAINING" title="专项训练" actions={<button onClick={onPlanOpen}>训练计划</button>} />
    <ProjectSpecialTraining project={project} records={records.filter(record => record.date >= from && record.date <= to)} />
  </PageContainer>;
  const analysisTabs: Array<{ key: SpecialPageKey; label: string }> = [
    { key: 'special-volume', label: '训练量' },
    { key: 'special-time', label: '时间' },
    { key: 'special-distance', label: '距离' },
    { key: 'special-load', label: '负荷' },
  ];
  const metricTabs: Array<{ key: SpecialPageKey; label: string }> = [
    { key: 'special-rate', label: project === 'ROWING' ? '桨频' : '划频' },
    { key: 'special-heart', label: '心率' },
    { key: 'special-power', label: '功率' },
  ];
  const pageTabs = analysisTabs.some((item) => item.key === section)
    ? analysisTabs
    : metricTabs.some((item) => item.key === section)
      ? metricTabs
      : [];
  return (
    <PageContainer className="professional-overview special-training-page">
      <PageHeader
        variant="dashboard"
        className="overview-page-heading special-page-heading training-plan-entry-heading"
        eyebrow={meta.english}
        title="专项训练"
        actions={<button className="dashboard-action-button" onClick={onPlanOpen}>训练计划</button>}
      />
      {pageTabs.length > 0 && (
        <nav className="special-page-tabs" aria-label={`${meta.group}指标切换`}>
          {pageTabs.map((item) => (
            <button
              key={item.key}
              className={section === item.key ? 'active' : ''}
              aria-current={section === item.key ? 'page' : undefined}
              onClick={() => onSectionChange(item.key)}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
      {loading ? (
        <ContentState
          kind="loading"
          className="special-loading"
          icon={<RefreshCw className="spin" />}
          title="正在同步训练数据…"
        />
      ) : !sessions.length ? (
        <ContentState
          kind="empty"
          className="special-empty"
          icon={<FileSpreadsheet />}
          title="当前日期范围内暂无训练记录"
          description="可通过全局筛选栏调整日期或项目查看数据。"
        />
      ) : section === 'special-volume' ? (
        <TrainingVolumePage sessions={sessions} days={days} />
      ) : ['special-time', 'special-distance', 'special-load'].includes(section) ? (
        <>
          <AnalysisPage section={section} sessions={sessions} days={days} project={project} />
          {section === 'special-distance' && (
            <SpecialPerformancePanel project={project} from={from} to={to} />
          )}
        </>
      ) : ['special-rate', 'special-heart', 'special-power'].includes(section) ? (
        <MetricPage section={section} sessions={sessions} days={days} project={project} />
      ) : section === 'special-records' ? (
        <RecordPage sessions={sessions} />

      ) : null}
    </PageContainer>
  );
}

function RecordPage({ sessions }: { sessions: Session[] }) {
  const records = [...sessions].sort(
    (left, right) =>
      right.date.localeCompare(left.date) || left.athleteName.localeCompare(right.athleteName)
  );
  return (
    <div className="special-grid">
      <SectionCard
        title="专项训练记录"
        note={`当前筛选共 ${records.length} 条`}
        className="span-12"
      >
        <div className="special-table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>运动员</th>
                <th>训练类型</th>
                <th>训练内容</th>
                <th>时长</th>
                <th>距离</th>
                <th>RPE</th>
                <th>负荷</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.date}</td>
                  <td>
                    <strong>{record.athleteName}</strong>
                  </td>
                  <td>{record.type}</td>
                  <td>{record.content}</td>
                  <td>{round(record.duration)} min</td>
                  <td>{round(record.distance)} km</td>
                  <td>{record.rpe ?? '—'}</td>
                  <td className="table-value">{record.rpe === null ? '—' : round(record.load)} AU</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
