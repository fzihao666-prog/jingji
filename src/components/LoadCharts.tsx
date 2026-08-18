import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { TrainingRecord } from '../types';
import { formatNumber, percentage } from '../utils';

const chartColors = ['#176f7f', '#22a99a', '#71c5aa', '#e5a72e', '#e36146', '#6a7285', '#8b6fb0'];

export function LoadTrendChart({ records }: { records: TrainingRecord[] }) {
  const byDate = new Map<string, { date: string; srpe: number; duration: number }>();
  for (const record of records) {
    const entry = byDate.get(record.date) || { date: record.date.slice(5).replace('-', '/'), srpe: 0, duration: 0 };
    entry.srpe += record.srpe;
    entry.duration += record.durationMin;
    byDate.set(record.date, entry);
  }
  const data = [...byDate.values()];

  return (
    <div className="chart-wrap" aria-label="每日训练负荷趋势图">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="loadFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1f9f9a" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#1f9f9a" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#dce6e9" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#6d8088', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={{ fill: '#6d8088', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #d7e4e7', boxShadow: '0 12px 24px rgba(12,48,61,.1)' }} />
          <Area type="monotone" dataKey="srpe" name="SRPE" stroke="#137e80" strokeWidth={2.4} fill="url(#loadFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StructureChart({ records }: { records: TrainingRecord[] }) {
  const grouped = new Map<string, number>();
  for (const record of records) grouped.set(record.structureType, (grouped.get(record.structureType) || 0) + record.durationMin);
  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  const data = [...grouped.entries()].map(([name, value]) => ({ name, value, ratio: percentage(value, total) })).filter((item) => item.value > 0);

  return (
    <div className="donut-layout">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={53} outerRadius={78} paddingAngle={2}>
              {data.map((_, index) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => `${formatNumber(Number(value))} 分钟`} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center"><strong>{formatNumber(total)}</strong><span>分钟</span></div>
      </div>
      <div className="chart-legend">
        {data.slice(0, 6).map((item, index) => (
          <div key={item.name}><i style={{ background: chartColors[index % chartColors.length] }} /><span>{item.name}</span><strong>{item.ratio}%</strong></div>
        ))}
      </div>
    </div>
  );
}

export function IntensityChart({ records }: { records: TrainingRecord[] }) {
  const order = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'];
  const grouped = new Map<string, number>(order.map((zone) => [zone, 0]));
  for (const record of records) {
    if (grouped.has(record.intensityZone)) grouped.set(record.intensityZone, (grouped.get(record.intensityZone) || 0) + record.durationMin);
  }
  const data = order.map((zone, index) => ({ zone, minutes: grouped.get(zone) || 0, fill: chartColors[index] }));
  return (
    <div className="chart-wrap compact" aria-label="训练强度分布图">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 2, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#dce6e9" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="zone" tick={{ fill: '#536b75', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6d8088', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => `${formatNumber(Number(value))} 分钟`} />
          <Bar dataKey="minutes" name="训练时间" radius={[5, 5, 0, 0]}>
            {data.map((entry) => <Cell key={entry.zone} fill={entry.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function pacePer500m(minutes: number, distanceKm: number) {
  if (!minutes || !distanceKm) return '—';
  const seconds = Math.round(minutes * 60 / (distanceKm * 2));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function WaterIntensityLoadChart({ records }: { records: TrainingRecord[] }) {
  const zones = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;
  const data = zones.map((zone, index) => {
    const distance = records.reduce((sum, record) => sum + (Number(record.trainingBreakdown?.waterDistanceByZone?.[zone]) || 0), 0);
    const minutes = records.reduce((sum, record) => sum + (Number(record.trainingBreakdown?.waterTimeByZone?.[zone]) || 0), 0);
    return { zone, distance, minutes, color: chartColors[index], pace: pacePer500m(minutes, distance) };
  });
  const maxDistance = Math.max(...data.map((item) => item.distance), 1);
  const maxMinutes = Math.max(...data.map((item) => item.minutes), 1);
  return (
    <div className="water-zone-analysis" aria-label="水上各强度距离与时间分析">
      <div className="water-zone-head"><span>强度</span><span>专项距离</span><span>训练时间</span><span>平均配速</span></div>
      {data.map((item) => (
        <div className="water-zone-row" key={item.zone}>
          <strong style={{ color: item.color }}>{item.zone}</strong>
          <div className="water-zone-bar"><i style={{ width: `${item.distance / maxDistance * 100}%`, background: item.color }} /><span>{formatNumber(item.distance, 1)} km</span></div>
          <div className="water-zone-bar time"><i style={{ width: `${item.minutes / maxMinutes * 100}%`, background: item.color }} /><span>{formatNumber(item.minutes)} min</span></div>
          <b>{item.pace}<small>/500m</small></b>
        </div>
      ))}
    </div>
  );
}
