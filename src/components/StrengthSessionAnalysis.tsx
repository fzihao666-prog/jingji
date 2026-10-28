import type { StrengthTrainingSession } from '../types';
import { EChart } from './EChart';
import { ChartCard } from './PageLayout';
import { formatNumber } from '../utils';

export function strengthSessionSummary(sessions: StrengthTrainingSession[]) {
  const loads = sessions.flatMap((row) => row.srpe == null ? [] : [row.srpe]);
  const rpes = sessions.flatMap((row) => row.rpe == null ? [] : [row.rpe]);
  const sets = sessions.flatMap((row) => row.sets);
  const comparable = sets.filter((row) => row.targetReps != null);
  const actions = new Map<string, number>();
  sets.forEach((row) => actions.set(row.exerciseName, (actions.get(row.exerciseName) ?? 0) + 1));
  return {
    duration: sessions.reduce((sum, row) => sum + row.durationMin, 0),
    load: loads.length ? loads.reduce((sum, value) => sum + value, 0) : null,
    loadCount: loads.length,
    rpe: rpes.length ? rpes.reduce((sum, value) => sum + value, 0) / rpes.length : null,
    rpeCount: rpes.length,
    actions: [...actions].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    comparableCount: comparable.length,
    target: comparable.reduce((sum, row) => sum + (row.targetReps ?? 0), 0),
    actual: comparable.reduce((sum, row) => sum + row.actualReps, 0),
  };
}

export function StrengthSessionAnalysis({ sessions }: { sessions: StrengthTrainingSession[] }) {
  const summary = strengthSessionSummary(sessions);
  const actions = summary.actions.slice(0, 8);
  return <section className="strength-analysis-grid" aria-label="训练内容与执行分析">
    <ChartCard title="力量动作分布" description="按已记录组次统计 · 展示前8项，不混合不同动作的重量">
      <EChart label="力量动作已记录组次分布" isPlaceholder={!actions.length} option={{
        grid: { left: 100, right: 24, top: 20, bottom: 35 },
        tooltip: { trigger: 'axis', renderMode: 'richText' },
        xAxis: { type: 'value', name: '组', minInterval: 1 },
        yAxis: { type: 'category', inverse: true, data: actions.length ? actions.map(row => row.name) : ['动作待记录'] },
        series: [{ type: 'bar', name: '记录组数', data: actions.map(row => row.count), barMaxWidth: 24 }],
      }} />
      <details><summary>查看动作组数</summary><div className="strength-data-table-wrap"><table className="strength-data-table"><thead><tr><th>动作</th><th>记录组数</th></tr></thead><tbody>{summary.actions.map(row => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td></tr>)}</tbody></table></div></details>
    </ChartCard>
    <ChartCard title="组次目标与实际次数" description="仅比较同时记录目标次数与实际次数的组；不代表完整训练计划执行率">
      <EChart label={`可比${summary.comparableCount}组，目标${summary.target}次，实际${summary.actual}次`} isPlaceholder={!summary.comparableCount} option={{
        grid: { left: 50, right: 24, top: 35, bottom: 35 }, legend: { data: ['目标次数', '实际次数'] },
        tooltip: { trigger: 'axis', renderMode: 'richText' },
        xAxis: { type: 'category', data: ['可比组次'] }, yAxis: { type: 'value', name: '次', minInterval: 1 },
        series: [{ type: 'bar', name: '目标次数', data: [summary.target], barMaxWidth: 40 }, { type: 'bar', name: '实际次数', data: [summary.actual], barMaxWidth: 40 }],
      }} />
      <p className="strength-insight-summary">可比 {summary.comparableCount} 组 · 目标 {summary.comparableCount ? formatNumber(summary.target) : '—'} 次 · 实际 {summary.comparableCount ? formatNumber(summary.actual) : '—'} 次</p>
    </ChartCard>
  </section>;
}
