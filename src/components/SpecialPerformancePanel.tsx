import { CheckCircle2, Clock3, FileSpreadsheet, Medal, RefreshCw, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Project, SpecialTestEvent } from '../types';
import './SpecialPerformancePanel.css';

type Props = { project: Project; from: string; to: string; refreshKey: number };

function formatTime(milliseconds: number | null) {
  if (milliseconds === null || milliseconds <= 0) return '—';
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${(totalSeconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

export function SpecialPerformancePanel({ project, from, to, refreshKey }: Props) {
  const [events, setEvents] = useState<SpecialTestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.specialTests(from, to, project)
      .then((result) => { if (active) setEvents(result.events); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : '专项成绩加载失败。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project, from, to, refreshKey]);

  const results = useMemo(() => events.flatMap((event) => event.results), [events]);
  const best = results.length ? Math.min(...results.map((result) => result.bestMs)) : null;
  const improved = results.filter((result) => result.deltaPreviousMs !== null && result.deltaPreviousMs < 0).length;

  return <section className="special-performance-panel">
    <header><div><span>SPECIAL RESULTS</span><h2>专项距离成绩与排名</h2><p>{project} · {from} 至 {to} · 来自导入专项数据</p></div>{loading && <RefreshCw className="spin" />}</header>
    {error ? <div className="special-performance-empty error">{error}</div> : <>
      <div className="special-performance-metrics">
        <article><Clock3/><div><span>训练批次</span><strong>{events.length}</strong></div></article>
        <article><Medal/><div><span>有效成绩</span><strong>{results.length}</strong></div></article>
        <article><Trophy/><div><span>周期最好</span><strong>{formatTime(best)}</strong></div></article>
        <article><CheckCircle2/><div><span>刷新个人最好</span><strong>{improved}</strong></div></article>
      </div>
      {!loading && !events.length ? <div className="special-performance-empty"><FileSpreadsheet/><strong>当前范围内暂无导入的专项距离成绩</strong><span>点击页面顶部“导入数据”，下载模板并完成导入。</span></div> : <div className="special-performance-events">{events.map((event) => <article key={event.id}>
        <header><div><span>{event.testDate} · {event.session || '未填写时段'}</span><strong>{event.distanceM}m · {event.boatClass} · {event.genderGroup}</strong></div><small>{event.location || '未填写地点'} · {event.windConditions || '未填写风况'}</small></header>
        <div className="special-performance-table-wrap"><table><thead><tr><th>排名</th><th>运动员 / 组合</th><th>各轮成绩</th><th>平均</th><th>最好</th><th>较历史最好</th></tr></thead><tbody>{event.results.map((result) => <tr key={result.id}><td><b className={`performance-rank rank-${result.rank}`}>{result.rank}</b></td><td><strong>{result.crewName}</strong><small>{result.memberNames.join('、')}</small></td><td>{result.attemptsMs.map(formatTime).join(' / ')}</td><td>{formatTime(result.averageMs)}</td><td><strong>{formatTime(result.bestMs)}</strong></td><td>{result.deltaPreviousMs === null ? '—' : <span className={result.deltaPreviousMs < 0 ? 'improved' : 'declined'}>{result.deltaPreviousMs < 0 ? '提升 ' : '慢 '}{Math.abs(result.deltaPreviousMs / 1000).toFixed(2)}s</span>}</td></tr>)}</tbody></table></div>
      </article>)}</div>}
    </>}
  </section>;
}
