import { Activity, Target, Trophy } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChampionBenchmarkPayload, ChampionBenchmarkRow } from '../types';
import { formatNumber } from '../utils';

const statusMeta = {
  elite: { label: '冠军区间', color: '#178f86' },
  near: { label: '接近区间', color: '#d5a02b' },
  develop: { label: '重点补强', color: '#df7040' },
  missing: { label: '未测试', color: '#87979d' }
} as const;

const domainLabels: Record<string, string> = {
  morphology: '身体形态',
  foundation: '基础力量',
  explosive: '爆发能力',
  project: '专项能力',
  technique: '技术效率',
  symmetry: '对称输出',
  slalom: '激流专项'
};

export function ChampionModelBenchmark({ benchmark, loading }: { benchmark: ChampionBenchmarkPayload | null; loading: boolean }) {
  const rows = benchmark?.rows ?? [];
  const visibleRows = rows.filter((row) => row.standardDistance !== null).map((row) => ({
    ...row,
    displayDistance: Math.max(0, row.standardDistance || 0)
  })).slice(0, 8);
  const domainScores = useMemo(() => {
    const groups = new Map<string, ChampionBenchmarkRow[]>();
    for (const row of rows.filter((item) => item.score !== null)) groups.set(row.domain, [...(groups.get(row.domain) || []), row]);
    return [...groups].map(([domain, items]) => ({
      domain: domainLabels[domain] || domain,
      distance: items.reduce((sum, item) => sum + Math.max(0, item.standardDistance || 0) * item.weight, 0) / items.reduce((sum, item) => sum + item.weight, 0),
      priority: items.reduce((sum, item) => sum + (item.priorityIndex || 0), 0)
    })).sort((left, right) => right.priority - left.priority);
  }, [rows]);
  if (loading) return <div className="champion-benchmark-empty">正在读取冠军模型标准与个人测试数据…</div>;
  if (!benchmark || !rows.length) return <div className="champion-benchmark-empty">暂无冠军模型标准。请先初始化或录入该项目模型。</div>;
  const missingCount = rows.filter((row) => row.status === 'missing').length;
  const keyRows = [...rows]
    .filter((row) => row.score !== null)
    .sort((left, right) => (right.weight * (100 - Math.min(100, right.score || 0))) - (left.weight * (100 - Math.min(100, left.score || 0))))
    .slice(0, 3);

  return <div className="champion-benchmark">
    <header className="champion-benchmark-hero">
      <div><Trophy size={22} /><span><small>{benchmark.project} · {benchmark.gender}子 · {benchmark.modelVersion}</small><strong>冠军模型标准化差距</strong></span></div>
      <strong>{benchmark.summary.averageStandardDistance === null ? '—' : formatNumber(benchmark.summary.averageStandardDistance, 2)}<small>区间宽度</small></strong>
      <p>达标 {benchmark.summary.achieved}/{benchmark.summary.comparable} 项，最高补强优先级 {benchmark.summary.topPriorityIndex === null ? '—' : formatNumber(benchmark.summary.topPriorityIndex, 1)}，{missingCount ? `${missingCount} 项待补测。` : '有效指标已完成对标。'}</p>
    </header>
    <div className="champion-benchmark-body">
      <section className="champion-chart-panel">
        <div className="champion-chart-canvas"><ResponsiveContainer width="100%" height="100%"><BarChart data={visibleRows} margin={{ top: 10, right: 10, left: -16, bottom: 0 }}><CartesianGrid stroke="#e1eaeb" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{ fontSize: 9, fill: '#526b73', fontWeight: 700 }} interval={0} angle={-16} textAnchor="end" height={52}/><YAxis tick={{ fontSize: 8, fill: '#82949a' }} axisLine={false} tickLine={false}/><Tooltip formatter={(value) => `${formatNumber(Number(value), 2)} 个区间宽度`} contentStyle={{ border: '1px solid #d5e3e5', borderRadius: 10, boxShadow: '0 10px 24px rgba(9,54,65,.12)' }}/><Bar dataKey="displayDistance" name="标准化差距" radius={[6,6,1,1]} maxBarSize={34}>{visibleRows.map((row) => <Cell key={row.code} fill={statusMeta[row.status].color}/>)}</Bar></BarChart></ResponsiveContainer></div>
        <div className="champion-domain-strip">{domainScores.map((item) => <span key={item.domain}><b>{item.domain}</b><i><em style={{ width: `${Math.min(100, item.priority)}%` }} /></i><strong>{formatNumber(item.distance, 2)}</strong></span>)}</div>
      </section>
      <aside className="champion-insight-panel">
        <div><Activity size={16} /><p>{benchmark.summary.primaryGap}</p></div>
        {keyRows.map((row) => {
          const meta = statusMeta[row.status];
          const range = row.targetMin !== null && row.targetMax !== null ? `${formatNumber(row.targetMin, 1)}-${formatNumber(row.targetMax, 1)} ${row.unit}` : '未设区间';
          return <article key={row.code} style={{ '--champion-row': meta.color } as CSSProperties}>
            <span><b>{row.label}</b><em>{meta.label}</em></span>
            <strong>{row.value === null ? '未测试' : `${formatNumber(row.value, row.unit === 's' || row.unit === '秒' ? 1 : 1)} ${row.unit}`}</strong>
            <small>冠军参考 {range} · 标准化差距 {row.standardDistance === null ? '—' : formatNumber(Math.max(0, row.standardDistance), 2)} · 优先级 {row.priorityIndex === null ? '—' : formatNumber(row.priorityIndex, 1)}</small>
            <p>{row.rationale}</p>
          </article>;
        })}
      </aside>
    </div>
    <footer><Target size={15} /><span>{benchmark.summary.source}</span></footer>
  </div>;
}
