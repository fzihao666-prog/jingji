import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Project } from '../types';

const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });

export function CollectionProgress({ project, team, lastCommit }: { project: Project; team: string; lastCommit?: string }) {
  const today = localDate.format(new Date());
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [result, setResult] = useState<{
    key: string; data?: Awaited<ReturnType<typeof api.collectionProgress>>; error?: string;
  }>();
  const [selection, setSelection] = useState<{ key: string; athleteIds: number[]; metricCodes: string[] }>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const key = JSON.stringify([from, to, lastCommit]);
  useEffect(() => {
    if (!open || !from || !to || from > to) return;
    const controller = new AbortController();
    void api.collectionProgress(project, team, from, to, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : '采集进度加载失败。' });
    });
    return () => controller.abort();
  }, [open, project, team, from, to, key]);
  const current = result?.key === key ? result : undefined;
  const draft = selection?.key === key ? selection : undefined;
  async function confirm() {
    if (!draft) return;
    setSaving(true);
    setSaveError('');
    try {
      const { athleteIds, metricCodes } = draft;
      const data = await api.collectionProgress(project, team, from, to, undefined, { athleteIds, metricCodes });
      setResult({ key, data });
      setSelection(undefined);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '应测范围保存失败。');
    } finally {
      setSaving(false);
    }
  }
  return <details className="data-import-template-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>队伍采集进度</summary>
    {open && <>
      <label>开始日期 <input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>{' '}
      <label>结束日期 <input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
      {!from || !to || from > to ? <p role="status">请选择有效日期范围。</p>
        : current?.error ? <p role="alert">{current.error}</p>
        : !current?.data ? <p role="status">正在加载采集进度…</p>
        : <>
          <p>授权在册 {current.data.athleteCount} 人。性别、出生日期、具体小项、训练年限均齐全 {current.data.profileCompleteCount} 人
            {current.data.athleteCount > 0 && `（${new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(current.data.profileCompleteCount / current.data.athleteCount)}）`}。</p>
          {!!current.data.missingProfiles.length && <ul>{current.data.missingProfiles.map(athlete =>
            <li key={athlete.id}>{athlete.name} · {athlete.missing.join('、')}</li>,
          )}</ul>}
          {saveError && <p role="alert">{saveError}</p>}
          {draft ? <fieldset disabled={saving}>
            <legend>确认本期应测范围</legend>
            <p>应测人员</p>
            {current.data.athletes.map(athlete => <label key={athlete.id}>
              <input type="checkbox" checked={draft.athleteIds.includes(athlete.id)} onChange={event => setSelection({
                ...draft, athleteIds: event.target.checked ? [...draft.athleteIds, athlete.id] : draft.athleteIds.filter(id => id !== athlete.id),
              })} />{athlete.name}{' '}
            </label>)}
            <p>应测指标</p>
            {current.data.metrics.filter(metric => metric.inTemplate).map(metric => <label key={metric.code}>
              <input type="checkbox" checked={draft.metricCodes.includes(metric.code)} onChange={event => setSelection({
                ...draft, metricCodes: event.target.checked ? [...draft.metricCodes, metric.code] : draft.metricCodes.filter(code => code !== metric.code),
              })} />{metric.label}{' '}
            </label>)}
            <div><button type="button" className="primary-button" disabled={!draft.athleteIds.length || !draft.metricCodes.length}
              onClick={() => void confirm()}>确认应测范围</button>{' '}
              <button type="button" className="secondary-button" onClick={() => setSelection(undefined)}>取消</button></div>
          </fieldset> : <button type="button" className="secondary-button"
            disabled={!current.data.athletes.length || !current.data.metrics.some(metric => metric.inTemplate)}
            onClick={() => setSelection({
              key,
              athleteIds: current.data?.expectation?.athleteIds ?? current.data!.athletes.map(athlete => athlete.id),
              metricCodes: current.data!.metrics.filter(metric => metric.inTemplate &&
                (!current.data?.expectation || current.data.expectation.metricCodes.includes(metric.code))).map(metric => metric.code),
            })}>{current.data.expectation ? '调整本期应测范围' : '设置本期应测范围'}</button>}
          <p>当前模板指标的实测人数按所选日期统计。</p>
          {!current.data.metrics.length && <p>当前队伍模板暂无测试指标。</p>}
          {current.data.metrics.map(metric => <details key={metric.code}>
            <summary>{metric.label} · {metric.coverage ? `应测已完成 ${metric.coverage.completed} 人，待测 ${metric.missing.length} 人` : `已测 ${metric.measured} 人，未查到成绩 ${metric.missing.length} 人`}</summary>
            {metric.coverage && <p>应测覆盖 {metric.coverage.completed}/{metric.coverage.total} · {new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(metric.coverage.completed / metric.coverage.total)}</p>}
            <p>{metric.missing.map(athlete => athlete.name).join('、') || (metric.coverage ? '本期应测人员均有成绩。' : '授权名单均有成绩。')}</p>
          </details>)}
        </>}
    </>}
  </details>;
}
