import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrainingRecord } from '../types';
import type { DailyPerformancePoint, RadarDimension } from '../overview-analytics';
import { formatNumber, percentage } from '../utils';
import { chartDisplay, placeholderTrend } from './chart-placeholder';
import './EChart.css';

const chartColors = ['#176f7f', '#22a99a', '#71c5aa', '#e5a72e', '#e36146', '#6a7285', '#8b6fb0'];

export function LoadTrendChart({ records }: { records: TrainingRecord[] }) {
  const byDate = new Map<string, { date: string; srpe: number; duration: number }>();
  for (const record of records) {
    const entry = byDate.get(record.date) || {
      date: record.date.slice(5).replace('-', '/'),
      srpe: 0,
      duration: 0,
    };
    entry.srpe += record.srpe;
    entry.duration += record.durationMin;
    byDate.set(record.date, entry);
  }
  const data = [...byDate.values()];
  const display = chartDisplay(data, placeholderTrend.map((value, index) => ({
    date: `示例${index + 1}`, srpe: value * 5, duration: value * 2,
  })));

  return (
    <div className="chart-wrap" aria-label="每日训练负荷趋势图">
      {display.isPlaceholder && <span className="app-chart-example">示例数据</span>}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={display.data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="loadFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1f9f9a" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#1f9f9a" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#dce6e9" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6d8088', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis tick={{ fill: '#6d8088', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            labelFormatter={(label) => `${display.isPlaceholder ? '示例数据，仅用于展示图表效果 · ' : ''}${label}`}
            contentStyle={{
              borderRadius: 10,
              border: '1px solid #d7e4e7',
              boxShadow: '0 12px 24px rgba(12,48,61,.1)',
            }}
          />
          <Area
            type="monotone"
            dataKey="srpe"
            name="SRPE"
            stroke="#137e80"
            strokeWidth={2.4}
            fill="url(#loadFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
      {display.isPlaceholder && <p className="app-chart-example-note">暂无当前周期真实数据 · 当前图表为示例效果</p>}
    </div>
  );
}

const landStructureLabels = {
  functional: '功能力量',
  endurance: '力量耐力',
  maxStrength: '最大力量',
  speedStrength: '速度力量',
  recovery: '恢复再生',
  running: '跑步体能',
  other: '其他陆上',
} as const;

type LandStructureKey = keyof typeof landStructureLabels;

function legacyStructureBucket(record: TrainingRecord): 'water' | 'erg' | 'land' {
  const text = `${record.trainingType} ${record.structureType} ${record.content}`.toLowerCase();
  if (/测功仪|划船机|陆上划船器/.test(text)) return 'erg';
  if (/水上|艇上|静水|划行|专项训练/.test(text)) return 'water';
  return 'land';
}

function legacyLandBucket(record: TrainingRecord): LandStructureKey {
  const text = `${record.trainingType} ${record.structureType} ${record.content}`.toLowerCase();
  if (/最大力量|1rm|深蹲|硬拉|卧推|高翻/.test(text)) return 'maxStrength';
  if (/速度力量|爆发|跳跃|药球/.test(text)) return 'speedStrength';
  if (/力量耐力|循环力量/.test(text)) return 'endurance';
  if (/功能|核心|稳定|灵活/.test(text)) return 'functional';
  if (/恢复|再生|拉伸|放松/.test(text)) return 'recovery';
  if (/跑步|跑台|有氧跑/.test(text)) return 'running';
  return 'other';
}

export function StructureChart({ records }: { records: TrainingRecord[] }) {
  const activeRecords = records.filter(
    (record) => record.status !== 'rest' && record.durationMin > 0
  );
  const primary = { water: 0, erg: 0, land: 0 };
  const land = Object.fromEntries(
    Object.keys(landStructureLabels).map((key) => [key, 0])
  ) as Record<LandStructureKey, number>;
  const purposes = new Map<string, number>();
  let detailedRecords = 0;

  for (const record of activeRecords) {
    const breakdown = record.trainingBreakdown;
    const water = Math.max(0, Number(breakdown?.waterMinutes) || 0);
    const erg = Math.max(0, Number(breakdown?.ergMinutes) || 0);
    const rawLand = Object.fromEntries(
      (Object.keys(landStructureLabels) as LandStructureKey[]).map((key) => [
        key,
        Math.max(0, Number(breakdown?.landMinutes?.[key]) || 0),
      ])
    ) as Record<LandStructureKey, number>;
    const landTotal = Object.values(rawLand).reduce((sum, value) => sum + value, 0);
    const covered = water + erg + landTotal;
    const duration = Math.max(0, Number(record.durationMin) || 0);

    if (covered > 0) {
      detailedRecords += 1;
      const scale = duration > 0 && covered > duration ? duration / covered : 1;
      primary.water += water * scale;
      primary.erg += erg * scale;
      primary.land += landTotal * scale;
      for (const key of Object.keys(landStructureLabels) as LandStructureKey[])
        land[key] += rawLand[key] * scale;

      const remainder = Math.max(0, duration - covered * scale);
      if (remainder > 0) {
        const bucket = legacyStructureBucket(record);
        primary[bucket] += remainder;
        if (bucket === 'land') land[legacyLandBucket(record)] += remainder;
      }
    } else {
      const bucket = legacyStructureBucket(record);
      primary[bucket] += duration;
      if (bucket === 'land') land[legacyLandBucket(record)] += duration;
    }

    const purpose = record.structureType?.trim() || record.trainingType?.trim() || '未分类';
    purposes.set(purpose, (purposes.get(purpose) || 0) + duration);
  }

  const primaryMeta = [
    { key: 'water' as const, name: '水上专项', value: primary.water, color: '#176f7f' },
    { key: 'erg' as const, name: '测功仪', value: primary.erg, color: '#22a99a' },
    { key: 'land' as const, name: '陆上训练', value: primary.land, color: '#e5a72e' },
  ];
  const total = primaryMeta.reduce((sum, item) => sum + item.value, 0);
  const chartData = total
    ? primaryMeta.filter((item) => item.value > 0).map((item) => ({ ...item, ratio: percentage(item.value, total) }))
    : primaryMeta.map((item, index) => ({ ...item, value: [52, 28, 20][index], ratio: [52, 28, 20][index] }));
  const purposeEntries: Array<[string, number]> = total
    ? [...purposes.entries()]
    : [['技术训练', 45], ['耐力训练', 35], ['恢复训练', 20]];
  const purposeData = purposeEntries
    .map(([name, value]) => ({ name, value, ratio: percentage(value, total || 100) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const landTotal = primary.land;
  const landFocus = (Object.entries(land) as Array<[LandStructureKey, number]>)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])[0];
  const mainShare = percentage(primary.water + primary.erg, total);
  const coverage = percentage(detailedRecords, activeRecords.length);
  const leading = chartData.slice().sort((a, b) => b.value - a.value)[0];

  return (
    <div className="structure-professional" aria-label="训练环境与训练目的两级结构分析">
      {!total && <span className="app-chart-example">示例数据</span>}
      <div className="structure-primary">
        <div className="structure-donut">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={42}
                outerRadius={59}
                paddingAngle={2}
                strokeWidth={0}
              >
                {chartData.map((item) => (
                  <Cell key={item.key} fill={item.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value, name) => [total ? `${formatNumber(Number(value))} 分钟` : '示例数据，仅用于展示图表效果', name]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="structure-donut-center">
            <strong>{total ? formatNumber(total / 60, 1) : '—'}</strong>
            <span>总小时</span>
          </div>
        </div>
        <div className="structure-primary-list">
          {primaryMeta.map((item) => (
            <div key={item.key}>
              <i style={{ background: item.color }} />
              <span>
                {item.name}
                <small>{formatNumber(item.value)} min</small>
              </span>
              <strong>{percentage(item.value, total)}%</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="structure-stack" aria-label="一级训练结构占比">
        {chartData.map((item) => (
          <i
            key={item.key}
            style={{ width: `${item.ratio}%`, background: item.color }}
            title={`${item.name} ${item.ratio}%`}
          />
        ))}
      </div>

      {total > 0 && <div className="structure-kpis">
        <div>
          <span>专项占比</span>
          <strong>{mainShare}%</strong>
        </div>
        <div>
          <span>结构主导</span>
          <strong>{leading?.name || '—'}</strong>
        </div>
        <div>
          <span>明细覆盖</span>
          <strong>{coverage}%</strong>
        </div>
      </div>}

      <div className="structure-purpose">
        <div className="structure-section-title">
          <strong>训练目的构成</strong>
          <span>{total ? `TOP ${purposeData.length}` : '示例数据'}</span>
        </div>
        {purposeData.map((item, index) => (
          <div className="structure-purpose-row" key={item.name}>
            <span>{item.name}</span>
            <div>
              <i
                style={{
                  width: `${item.ratio}%`,
                  background: chartColors[index % chartColors.length],
                }}
              />
            </div>
            <strong>{item.ratio}%</strong>
          </div>
        ))}
      </div>

      {total > 0 ? <p className="structure-insight">
        本周期由<strong>{leading?.name}</strong>主导（{leading?.ratio}%）；
        {landTotal > 0 && landFocus
          ? `陆上训练重点为${landStructureLabels[landFocus[0]]}，占陆上时长${percentage(landFocus[1], landTotal)}%。`
          : '当前未记录陆上训练细分。'}
      </p> : <p className="structure-insight">暂无真实训练结构数据 · 当前图形仅用于展示效果。</p>}
    </div>
  );
}

export function IntensityChart({ records }: { records: TrainingRecord[] }) {
  const order = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'];
  const grouped = new Map<string, number>(order.map((zone) => [zone, 0]));
  for (const record of records) {
    if (grouped.has(record.intensityZone))
      grouped.set(
        record.intensityZone,
        (grouped.get(record.intensityZone) || 0) + record.durationMin
      );
  }
  const data = order.map((zone, index) => ({
    zone,
    minutes: grouped.get(zone) || 0,
    fill: chartColors[index],
  }));
  const isPlaceholder = !data.some((item) => item.minutes > 0);
  const displayData = isPlaceholder
    ? data.map((item, index) => ({ ...item, minutes: [42, 27, 19, 12, 9, 6, 4][index] }))
    : data;
  return (
    <div className="chart-wrap compact" aria-label="训练强度分布图">
      {isPlaceholder && <span className="app-chart-example">示例数据</span>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={displayData} margin={{ top: 8, right: 2, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#dce6e9" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="zone"
            tick={{ fill: '#536b75', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: '#6d8088', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => isPlaceholder ? '示例数据，仅用于展示图表效果' : `${formatNumber(Number(value))} 分钟`} />
          <Bar dataKey="minutes" name="训练时间" radius={[5, 5, 0, 0]}>
            {displayData.map((entry) => (
              <Cell key={entry.zone} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {isPlaceholder && <p className="app-chart-example-note">暂无真实强度数据 · 当前图表为示例效果</p>}
    </div>
  );
}

function pacePer500m(minutes: number, distanceKm: number) {
  if (!minutes || !distanceKm) return '—';
  const seconds = Math.round((minutes * 60) / (distanceKm * 2));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function WaterIntensityLoadChart({ records }: { records: TrainingRecord[] }) {
  const zones = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;
  const data = zones.map((zone, index) => {
    const distance = records.reduce(
      (sum, record) => sum + (Number(record.trainingBreakdown?.waterDistanceByZone?.[zone]) || 0),
      0
    );
    const minutes = records.reduce(
      (sum, record) => sum + (Number(record.trainingBreakdown?.waterTimeByZone?.[zone]) || 0),
      0
    );
    return {
      zone,
      distance,
      minutes,
      color: chartColors[index],
      pace: pacePer500m(minutes, distance),
    };
  });
  const isPlaceholder = !data.some((item) => item.distance > 0 || item.minutes > 0);
  const displayData = isPlaceholder ? data.map((item, index) => ({ ...item,
    distance: [4.2, 3.1, 2.4, 1.5, 1.1, 0.8, 0.5][index],
    minutes: [42, 36, 29, 22, 18, 12, 8][index],
  })) : data;
  const maxDistance = Math.max(...displayData.map((item) => item.distance), 1);
  const maxMinutes = Math.max(...displayData.map((item) => item.minutes), 1);
  return (
    <div className="water-zone-analysis" aria-label="水上各强度距离与时间分析">
      {isPlaceholder && <span className="app-chart-example">示例数据</span>}
      <div className="water-zone-head">
        <span>强度</span>
        <span>专项距离</span>
        <span>训练时间</span>
        <span>平均配速</span>
      </div>
      {displayData.map((item) => (
        <div className="water-zone-row" key={item.zone}>
          <strong style={{ color: item.color }}>{item.zone}</strong>
          <div className="water-zone-bar">
            <i
              style={{ width: `${(item.distance / maxDistance) * 100}%`, background: item.color }}
            />
            <span>{isPlaceholder ? '示例' : `${formatNumber(item.distance, 1)} km`}</span>
          </div>
          <div className="water-zone-bar time">
            <i style={{ width: `${(item.minutes / maxMinutes) * 100}%`, background: item.color }} />
            <span>{isPlaceholder ? '示例' : `${formatNumber(item.minutes)} min`}</span>
          </div>
          <b>
            {isPlaceholder ? '—' : item.pace}
            <small>/500m</small>
          </b>
        </div>
      ))}
      {isPlaceholder && <p className="app-chart-example-note">暂无真实水上强度数据 · 当前图形仅展示效果</p>}
    </div>
  );
}

export function ProfessionalLoadChart({
  data,
  team = false,
}: {
  data: DailyPerformancePoint[];
  team?: boolean;
}) {
  const display = chartDisplay(data.some((row) => row.srpe > 0 || row.smvl > 0) ? data : [], placeholderTrend.map((value, index) => ({
    date: `sample-${index + 1}`, label: `示例${index + 1}`,
    srpe: value * 5, smvl: value * 3, duration: 0, distance: 0,
    rpe: null, sleep: null, fatigue: null, pulse: null, weight: null, participantCount: 0,
  })));
  return (
    <div className="chart-wrap professional-load-chart" aria-label="每日SRPE与SMVL训练负荷响应图">
      {display.isPlaceholder && <span className="app-chart-example">示例数据</span>}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={display.data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#dce6e9" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#6d8088', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="load"
            tick={{ fill: '#6d8088', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="smvl"
            orientation="right"
            tick={{ fill: '#d45d46', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(value, name) => [display.isPlaceholder ? '示例数据，仅用于展示图表效果' : formatNumber(Number(value), 1), name]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar
            yAxisId="load"
            dataKey="srpe"
            name={team ? '人均SRPE' : 'SRPE负荷'}
            fill="#168f8a"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
          <Line
            yAxisId="smvl"
            type="monotone"
            dataKey="smvl"
            name={team ? '人均SMVL' : 'SMVL'}
            stroke="#dc6049"
            strokeWidth={2.2}
            dot={{ r: 2.6 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
      {display.isPlaceholder && <p className="app-chart-example-note">暂无真实训练负荷数据 · 当前图表为示例效果</p>}
    </div>
  );
}

export function PerformanceRadarChart({ data }: { data: RadarDimension[] }) {
  const rated = data.filter((item) => item.score !== null).length;
  const isPlaceholder = rated === 0;
  const chartData = isPlaceholder
    ? (data.length ? data : ['力量', '爆发', '耐力', '技术', '恢复', '稳定'].map((label, index) => ({ key: String(index), label, score: null, basis: '' })))
      .map((item, index) => ({ ...item, score: [64, 72, 61, 76, 68, 70][index % 6] }))
    : data;
  return (
    <div className="performance-radar-layout">
      {isPlaceholder && <span className="app-chart-example">示例数据</span>}
      <div className="performance-radar-chart" aria-label="六维运动表现评分雷达图">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} outerRadius="70%">
            <PolarGrid stroke="#cadadd" />
            <PolarAngleAxis
              dataKey="label"
              tick={{ fill: '#385863', fontSize: 10, fontWeight: 700 }}
            />
            <PolarRadiusAxis
              domain={[0, 100]}
              tickCount={5}
              tick={{ fill: '#829399', fontSize: 8 }}
              axisLine={false}
            />
            <Tooltip formatter={(value) => isPlaceholder ? '示例数据，仅用于展示图表效果' : value === null ? '未测试' : `${value}分`} />
            <Radar
              dataKey="score"
              name="指标评分"
              stroke="#138d87"
              strokeWidth={2.2}
              fill="#20a89a"
              fillOpacity={0.28}
              connectNulls={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="radar-dimension-list">
        {data.map((item) => (
          <div key={item.key}>
            <span>{item.label}</span>
            <strong>{item.score === null ? '未测试' : `${item.score}分`}</strong>
            <small>{item.basis}</small>
          </div>
        ))}
      </div>
      {isPlaceholder && <p className="app-chart-example-note">当前无真实评分 · 雷达轮廓仅供展示</p>}
    </div>
  );
}

export function StrengthChangeChart({
  data,
}: {
  data: Array<{
    key: string;
    label: string;
    unit: string;
    current: number;
    previous: number | null;
    change: number | null;
  }>;
}) {
  const comparable = data.filter((item) => item.change !== null);
  const isPlaceholder = data.length === 0;
  const displayComparable = isPlaceholder
    ? ['纵跳', '卧推', '卧拉', '深蹲'].map((label, index) => ({
        key: `sample-${index}`, label, unit: '', current: 0, previous: null,
        change: [4, 8, 6, 10][index],
      }))
    : comparable;
  if (!comparable.length && !isPlaceholder)
    return (
      <div className="single-test-metrics">
        {data.map((item) => (
          <div key={item.key}>
            <span>{item.label}</span>
            <strong>
              {formatNumber(item.current, 1)}
              <small>{item.unit}</small>
            </strong>
            <p>仅有一次测试</p>
          </div>
        ))}
      </div>
    );
  return (
    <div className="chart-wrap" aria-label="力量与爆发指标前后测变化柱状图">
      {isPlaceholder && <span className="app-chart-example">示例数据</span>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={displayComparable} margin={{ top: 18, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#dce6e9" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#536b75', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            unit="%"
            tick={{ fill: '#6d8088', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value, _name, item) => [
              isPlaceholder ? '示例数据，仅用于展示图表效果' : `${formatNumber(Number(value), 1)}%`,
              isPlaceholder ? '' : `${item.payload.previous} → ${item.payload.current} ${item.payload.unit}`,
            ]}
          />
          <Bar dataKey="change" name="变化率" radius={[5, 5, 0, 0]} maxBarSize={34}>
            {displayComparable.map((item) => (
              <Cell key={item.key} fill={isPlaceholder ? '#b7d3d0' : (item.change || 0) >= 0 ? '#15958c' : '#db5b46'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {isPlaceholder && <p className="app-chart-example-note">暂无真实力量测试 · 当前图表为示例效果</p>}
    </div>
  );
}

export function RelativeStrengthChart({
  data,
}: {
  data: Array<{ label: string; current: number; previous: number | null }>;
}) {
  const isPlaceholder = data.length === 0;
  const chartData = isPlaceholder
    ? ['卧推', '卧拉', '深蹲'].map((label, index) => ({ label, previous: [0.8, 0.7, 1.2][index], current: [0.9, 0.85, 1.35][index] }))
    : data;
  return (
    <div className="chart-wrap" aria-label="相对力量倍体重对比图">
      {isPlaceholder && <span className="app-chart-example">示例数据</span>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 5, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#dce6e9" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#536b75', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: '#6d8088', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => isPlaceholder ? '示例数据，仅用于展示图表效果' : `${formatNumber(Number(value), 2)} 倍体重`} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar
            dataKey="previous"
            name="前测"
            fill="#b8c9cc"
            radius={[4, 4, 0, 0]}
            maxBarSize={30}
          />
          <Bar dataKey="current" name="本次" fill="#168f8a" radius={[4, 4, 0, 0]} maxBarSize={30} />
        </BarChart>
      </ResponsiveContainer>
      {isPlaceholder && <p className="app-chart-example-note">暂无真实相对力量数据 · 当前图表为示例效果</p>}
    </div>
  );
}
