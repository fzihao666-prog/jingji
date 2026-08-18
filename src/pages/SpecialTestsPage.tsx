import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDownToLine, FileSpreadsheet, Flag, Gauge, LoaderCircle, Medal, RefreshCw, TimerReset, Trophy } from 'lucide-react';
import { api } from '../api';
import type { Project, SpecialTestEvent, SpecialTestImportPreview, User } from '../types';

type Props = {
  user: User;
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  project: Project;
};

function formatRaceTime(ms: number | null | undefined) {
  if (!ms) return '—';
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function formatDelta(ms: number | null) {
  if (ms === null) return '无历史值';
  if (ms === 0) return '持平';
  return `${ms < 0 ? '快' : '慢'} ${(Math.abs(ms) / 1000).toFixed(2)}s`;
}

export function SpecialTestsPage({ user, from, to, onRangeChange, project }: Props) {
  const [events, setEvents] = useState<SpecialTestEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<SpecialTestImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [templateDownloading, setTemplateDownloading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canImport = user.role !== 'ATL';

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const result = await api.specialTests(from, to, project);
      setEvents(result.events);
      setSelectedId((current) => result.events.some((event) => event.id === current) ? current : result.events[0]?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专项测试数据加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [from, to, project]);

  const selected = events.find((event) => event.id === selectedId) || null;
  const summary = useMemo(() => {
    if (!selected?.results.length) return null;
    const best = selected.results[0];
    const average = Math.round(selected.results.reduce((sum, result) => sum + result.bestMs, 0) / selected.results.length);
    const pbCount = selected.results.filter((result) => result.deltaPreviousMs !== null && result.deltaPreviousMs < 0).length;
    const spread = selected.results[selected.results.length - 1].bestMs - best.bestMs;
    return { best, average, pbCount, spread };
  }, [selected]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    setMessage('');
    try {
      setPreview(await api.previewSpecialTests(file, project));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专项测试Excel读取失败。');
    } finally {
      setImporting(false);
    }
  };

  const commit = async () => {
    if (!preview || preview.invalid > 0) return;
    setImporting(true);
    try {
      const result = await api.commitSpecialTests(preview.importId);
      setMessage(`已导入 ${result.events} 个测试批次、${result.imported} 条成绩。`);
      setPreview(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专项测试导入失败。');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = async () => {
    setTemplateDownloading(true);
    setMessage('');
    try {
      await api.downloadSpecialTestTemplate();
      setMessage('专项测试Excel模板已下载。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专项测试模板下载失败。');
    } finally {
      setTemplateDownloading(false);
    }
  };

  return (
    <div className="page special-tests-page">
      <header className="special-tests-hero">
        <div>
          <span className="eyebrow">ON-WATER PERFORMANCE</span>
          <h1>{project}专项距离测试</h1>
          <p>同距离、艇型与组别内自动排名，比较轮次稳定性和历史最好成绩。</p>
        </div>
        <div className="special-tests-actions">
          <label><span>开始</span><input type="date" value={from} onChange={(event) => onRangeChange(event.target.value, to)} /></label>
          <label><span>结束</span><input type="date" value={to} onChange={(event) => onRangeChange(from, event.target.value)} /></label>
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={17} />刷新</button>
          {canImport && <>
            <button className="secondary-button" onClick={() => void downloadTemplate()} disabled={templateDownloading}>
              {templateDownloading ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}
              {templateDownloading ? '下载中' : '下载模板'}
            </button>
            <button className="primary-button" onClick={() => fileRef.current?.click()} disabled={importing}><FileSpreadsheet size={17} />导入成绩</button>
            <input ref={fileRef} className="visually-hidden" type="file" accept=".xlsx" onChange={upload} />
          </>}
        </div>
      </header>

      {message && <div className="special-tests-message">{message}</div>}

      {preview && <section className="special-import-preview">
        <div className="panel-heading">
          <div><span className="eyebrow">IMPORT CHECK</span><h2>导入校对</h2></div>
          <div className="preview-counts"><b>{preview.valid}</b> 可导入 · <b className={preview.invalid ? 'danger-text' : ''}>{preview.invalid}</b> 错误 · {preview.warningCount} 提醒</div>
        </div>
        <div className="special-preview-table table-scroll"><table><thead><tr><th>行</th><th>测试</th><th>组合</th><th>轮次</th><th>平均</th><th>校验</th></tr></thead><tbody>
          {preview.rows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? 'row-error' : ''}>
            <td>{row.rowNumber}</td><td>{row.testDate}<br />{row.distanceM}m · {row.boatClass}</td><td>{row.crewName}<small>{row.memberNames.join('、')}</small></td>
            <td>{row.attemptsMs.map(formatRaceTime).join(' / ') || '—'}</td><td>{formatRaceTime(row.averageMs)}</td>
            <td>{row.errors.length ? row.errors.join('；') : row.warnings.join('；') || '通过'}</td>
          </tr>)}
        </tbody></table></div>
        <div className="preview-footer"><p>相同日期、距离、艇型、组别和时段视为同一测试批次，再次导入会覆盖该批次。</p><div><button className="secondary-button" onClick={() => setPreview(null)}>取消</button><button className="primary-button" disabled={importing || preview.invalid > 0} onClick={() => void commit()}>确认入库</button></div></div>
      </section>}

      <section className="test-event-strip" aria-label="测试批次">
        {events.map((event) => <button key={event.id} className={event.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(event.id)}>
          <span>{event.testDate.slice(5).replace('-', '.')}</span><strong>{event.distanceM}m</strong><small>{event.boatClass} · {event.genderGroup}</small>
        </button>)}
        {!events.length && !loading && <div className="special-empty"><TimerReset /><strong>当前日期范围暂无专项测试</strong><span>{canImport ? '下载模板并导入测试成绩后，这里会自动生成排名。' : '教练导入成绩后即可在这里查看。'}</span></div>}
      </section>

      {selected && summary && <>
        <section className="test-summary-band">
          <div className="event-identity"><span>{selected.testDate}</span><h2>{selected.distanceM}m · {selected.boatClass}</h2><p>{[selected.genderGroup, selected.session, selected.windConditions, selected.location].filter(Boolean).join(' · ')}</p></div>
          <div><Trophy /><span>本次最快</span><strong>{formatRaceTime(summary.best.bestMs)}</strong><small>{summary.best.crewName}</small></div>
          <div><Gauge /><span>全组平均</span><strong>{formatRaceTime(summary.average)}</strong><small>{selected.results.length} 个组合</small></div>
          <div><Medal /><span>刷新历史最好</span><strong>{summary.pbCount}</strong><small>人 / 组合</small></div>
          <div><Flag /><span>首尾差距</span><strong>{(summary.spread / 1000).toFixed(2)}s</strong><small>用于识别分层</small></div>
        </section>

        <section className="special-ranking-panel">
          <div className="panel-heading"><div><span className="eyebrow">FINISH ORDER</span><h2>{selected.distanceM}米成绩排名</h2></div><small>按当次最好成绩升序</small></div>
          <div className="ranking-table-wrap"><table className="special-ranking-table"><thead><tr><th>排名</th><th>运动员 / 组合</th><th>历史最好</th><th>第1轮</th><th>第2轮</th><th>第3轮</th><th>平均</th><th>本次最好</th><th>历史比较</th></tr></thead><tbody>
            {selected.results.map((result) => <tr key={result.id}>
              <td><span className={`rank-badge rank-${Math.min(result.rank, 4)}`}>{result.rank}</span></td>
              <td><strong>{result.crewName}</strong><small>{result.memberNames.join('、')}</small></td>
              <td>{formatRaceTime(result.previousBestMs)}</td>
              {[0, 1, 2].map((index) => <td key={index} className={result.attemptsMs[index] === result.bestMs ? 'attempt-best' : ''}>{formatRaceTime(result.attemptsMs[index])}</td>)}
              <td>{formatRaceTime(result.averageMs)}</td><td className="result-best">{formatRaceTime(result.bestMs)}</td>
              <td><span className={result.deltaPreviousMs !== null && result.deltaPreviousMs < 0 ? 'delta-positive' : 'delta-neutral'}>{formatDelta(result.deltaPreviousMs)}</span></td>
            </tr>)}
          </tbody></table></div>
        </section>

        <section className="finish-gap-panel">
          <div className="panel-heading"><div><span className="eyebrow">TIME GAP</span><h2>与领先成绩差距</h2></div><small>终点线视图 · 越靠右越接近领先成绩</small></div>
          <div className="finish-track">
            {selected.results.map((result) => {
              const maxGap = Math.max(...selected.results.map((item) => item.gapLeaderMs), 1);
              const progress = 18 + (1 - result.gapLeaderMs / maxGap) * 82;
              return <div className="finish-row" key={result.id}><span className="finish-rank">{result.rank}</span><strong>{result.crewName}</strong><div className="finish-lane"><i style={{ width: `${progress}%` }} /><b style={{ left: `${progress}%` }} /></div><span>{result.gapLeaderMs ? `+${(result.gapLeaderMs / 1000).toFixed(2)}s` : '领先'}</span></div>;
            })}
          </div>
        </section>
      </>}
    </div>
  );
}
