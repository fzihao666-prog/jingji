import { Activity, Target } from 'lucide-react';
import { type CSSProperties } from 'react';
import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ChampionBenchmarkDimension, ChampionBenchmarkPayload } from '../types';
import { formatNumber } from '../utils';

const dimensionMetricCodes: Record<string, string[]> = {
  body_shape: ['heightCm', 'armSpanCm', 'body_fat_pct', 'skeletal_muscle_kg'],
  endurance: ['general_endurance_score', 'erg_6k_sec'],
  vo2max: ['vo2max_ml_kg_min'],
  asymmetry: ['asymmetry_index_pct', 'dsd_ratio', 'left_paddle_power_w', 'right_paddle_power_w'],
  power: ['cmj_peak_power_w', 'seven_stroke_power_w', 'benchPressPeakPowerW', 'benchPullPeakPowerW'],
  anaerobic_power: ['anaerobic_power_wkg', 'wingatePeakPowerWkg', 'wingateWorkJkg', 'sprint_200_sec', 'sprint_500_sec', 'sprint300Sec'],
  fmax: ['imtp_peak_force_n', 'benchPressKg', 'benchPullKg', 'squatKg', 'deadliftKg'],
  core: ['core_strength_score', 'frontPlankSec', 'leftPlankSec', 'rightPlankSec']
};

function splitDimensionLabel(label: string) {
  const match = label.match(/^(.+?)([A-Za-z][A-Za-z ]*)$/);
  return match ? { cn: match[1], en: match[2].trim() } : { cn: label, en: '' };
}

function dimensionState(dimension: ChampionBenchmarkDimension) {
  if (dimension.current === null) return { label: '待补测', color: '#87979d' };
  if (dimension.current >= 100) return { label: '冠军区间', color: '#178f86' };
  if (dimension.current >= 90) return { label: '接近冠军', color: '#d5a02b' };
  return { label: '优先补强', color: '#df7040' };
}

export function ChampionModelBenchmark({ benchmark, loading }: { benchmark: ChampionBenchmarkPayload | null; loading: boolean }) {
  const rows = benchmark?.rows ?? [];
  const dimensions = benchmark?.dimensions ?? [];
  const radarData = dimensions.map((dimension) => ({
    name: splitDimensionLabel(dimension.label).cn,
    current: dimension.current ?? 0,
    champion: dimension.champion,
    gap: dimension.gap,
    comparable: dimension.comparable
  }));
  if (loading) return <div className="champion-benchmark-empty">正在读取冠军模型标准与个人测试数据…</div>;
  if (!benchmark || !rows.length || !radarData.length) return <div className="champion-benchmark-empty">暂无冠军模型标准。请先初始化或录入该项目模型。</div>;
  const validDimensions = dimensions.filter((dimension) => dimension.current !== null);
  const weakDimensions = [...validDimensions]
    .sort((left, right) => (right.priorityIndex || 0) - (left.priorityIndex || 0))
    .slice(0, 3);
  const dimensionRows = (dimension: ChampionBenchmarkDimension) => rows
    .filter((row) => (dimensionMetricCodes[dimension.key] || []).includes(row.code) && row.score !== null)
    .sort((left, right) => (right.priorityIndex || 0) - (left.priorityIndex || 0))
    .slice(0, 3);

  return <div className="champion-benchmark">
    <div className="champion-benchmark-body">
      <section className="champion-chart-panel">
        <div className="champion-radar-canvas"><ResponsiveContainer width="100%" height="100%"><RadarChart data={radarData} outerRadius="74%"><PolarGrid radialLines stroke="#d7e4e6" /><PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: '#495f66', fontWeight: 800 }} /><PolarRadiusAxis angle={90} domain={[0, 120]} tick={{ fontSize: 8, fill: '#7c9096' }} tickCount={7} /><Tooltip formatter={(value, name) => [`${formatNumber(Number(value), 1)}`, name === 'current' ? '当前水平' : '冠军标准']} contentStyle={{ border: '1px solid #d5e3e5', borderRadius: 10, boxShadow: '0 10px 24px rgba(9,54,65,.12)' }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Radar dataKey="current" name="当前水平" stroke="#8abfe0" fill="#8abfe0" fillOpacity={0.48} strokeWidth={2} /><Radar dataKey="champion" name="冠军标准" stroke="#e60012" fill="transparent" strokeWidth={3} dot /></RadarChart></ResponsiveContainer></div>
      </section>
      <aside className="champion-insight-panel">
        <div><Activity size={16} /><p>{benchmark.summary.primaryGap}</p></div>
        {weakDimensions.map((dimension) => {
          const state = dimensionState(dimension);
          const label = splitDimensionLabel(dimension.label);
          const keyMetrics = dimensionRows(dimension);
          return <article key={dimension.key} style={{ '--champion-row': state.color } as CSSProperties}>
            <span><b>{label.cn}</b><em>{state.label}</em></span>
            <strong>{dimension.current === null ? '—' : `${formatNumber(dimension.current, 1)} / 100`}</strong>
            <small>维度差距 {dimension.gap === null ? '—' : formatNumber(Math.max(0, dimension.gap), 1)} · 补强优先级 {dimension.priorityIndex === null ? '—' : formatNumber(dimension.priorityIndex, 1)}</small>
            {keyMetrics.map((row) => {
              const range = row.targetMin !== null && row.targetMax !== null ? `${formatNumber(row.targetMin, 1)}-${formatNumber(row.targetMax, 1)} ${row.unit}` : '未设区间';
              return <p key={row.code}><b>{row.label}</b> 当前 {row.value === null ? '未测试' : `${formatNumber(row.value, row.unit === 's' || row.unit === '秒' ? 1 : 1)} ${row.unit}`}，冠军参考 {range}。</p>;
            })}
          </article>;
        })}
      </aside>
    </div>
    <footer><Target size={15} /><span>{benchmark.summary.source}</span></footer>
  </div>;
}
