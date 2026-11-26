import { useEffect, useMemo, useState } from 'react';
import type { DailyTrainingData, DailyTrainingRecord } from '../../shared/daily-training';
import { api } from '../api';
import type { Project } from '../types';
import { dailyTrainingNumber, dailyTrainingSeries, dailyTrainingTrendOption } from './daily-training-chart';
import { EChart } from './EChart';
import { ChartCard, ContentState } from './PageLayout';
import './CustomTestTrendCard.css';

type Scope = { project: Project; teamId: number | null; from: string; to: string };

function useDailyTraining({ project, teamId, from, to }: Scope, athleteId?: number) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: DailyTrainingData; error?: string }>();
  const key = JSON.stringify([project, teamId, from, to, athleteId, retry]);
  useEffect(() => {
    if (teamId === null) return;
    const controller = new AbortController();
    void api.dailyTraining(project, teamId, from, to, athleteId, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch(error => {
        if (!controller.signal.aborted)
          setResult({ key, error: error instanceof Error ? error.message : '每日训练读取失败。' });
      });
    return () => controller.abort();
  }, [project, teamId, from, to, athleteId, key]);
  return { result: result?.key === key ? result : undefined, retry: () => setRetry(count => count + 1) };
}

function TrainingState({ error, retry }: { error?: string; retry: () => void }) {
  return error
    ? <ContentState kind="error" title="每日训练加载失败" description={error}
        action={<button type="button" className="secondary-button" onClick={retry}>重试</button>} />
    : <div role="status"><ContentState kind="loading" title="正在读取每日训练" /></div>;
}

function TrainingRecords({ rows }: { rows: DailyTrainingRecord[] }) {
  return <div className="table-scroll">
    <table className="data-table">
      <caption>每日训练记录</caption>
      <thead><tr>{['日期', '训练项目', '强度', '每组次数', '组数', '时长（分钟）', 'PRE'].map(label =>
        <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td><time dateTime={row.date}>{row.date}</time></td>
        <td>{row.projectName}</td>
        <td>{dailyTrainingNumber(row.intensity, row.intensityUnit ?? '')}</td>
        <td>{dailyTrainingNumber(row.repetitions)}</td>
        <td>{dailyTrainingNumber(row.sets)}</td>
        <td>{dailyTrainingNumber(row.durationMin)}</td>
        <td>{dailyTrainingNumber(row.pre)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function TeamAthleteRecords({ scope, athleteId }: { scope: Scope; athleteId: number }) {
  const { result, retry } = useDailyTraining(scope, athleteId);
  if (!result?.data) return <TrainingState error={result?.error} retry={retry} />;
  if (!result.data.rows.length) return <ContentState kind="empty" title="该运动员在所选日期内暂无每日训练记录" />;
  return <>
    {result.data.truncated && <p>明细仅显示最近 1,000 条，可缩短日期范围。</p>}
    <TrainingRecords rows={result.data.rows} />
  </>;
}

export function DailyTrainingTeamCard(scope: Scope) {
  const { result, retry } = useDailyTraining(scope);
  const [athleteId, setAthleteId] = useState<number>();
  const athletes = result?.data?.athletes ?? [];
  const selected = athletes.find(athlete => athlete.id === athleteId);
  const max = athletes.reduce((highest, athlete) => Math.max(highest, athlete.recordCount), 1);
  return <ChartCard title="队伍每日训练" description="按队员汇总所选日期内已导入的训练记录。">
    {scope.teamId === null ? <ContentState kind="empty" title="请在页面上方选择队伍" />
      : !result?.data ? <TrainingState error={result?.error} retry={retry} />
      : !athletes.length ? <ContentState kind="empty" title="所选队伍暂无可查看的运动员" />
      : <>
        <div className="table-scroll"><table className="data-table">
          <caption>队员训练汇总</caption>
          <thead><tr>{['运动员', '训练记录', '训练天数', '已记录时长（分钟）', '最近训练日'].map(label =>
            <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{athletes.map(athlete => <tr key={athlete.id}>
            <th scope="row">{athlete.name}</th>
            <td><meter min={0} max={max} value={athlete.recordCount}
                aria-label={`${athlete.name}的训练记录数`} /> {dailyTrainingNumber(athlete.recordCount)} 条</td>
            <td>{dailyTrainingNumber(athlete.trainingDays)}</td>
            <td>{dailyTrainingNumber(athlete.durationMin)}</td>
            <td>{athlete.latestDate ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
        <label className="custom-test-trend-select">
          <span>查看队员训练明细</span>
          <select value={selected?.id ?? ''} onChange={event => setAthleteId(Number(event.target.value) || undefined)}>
            <option value="">请选择运动员</option>
            {athletes.map(athlete => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
          </select>
        </label>
        {selected && <TeamAthleteRecords scope={scope} athleteId={selected.id} />}
      </>}
  </ChartCard>;
}

export function DailyTrainingPersonalCard({ athleteId, ...scope }: Scope & { athleteId: number }) {
  const { result, retry } = useDailyTraining(scope, athleteId);
  const [projectName, setProjectName] = useState('');
  const [metricKey, setMetricKey] = useState('');
  const rows = result?.data?.rows;
  const projects = useMemo(() => Array.from(new Set(rows?.map(row => row.projectName))), [rows]);
  const selectedProject = projects.includes(projectName) ? projectName : projects[0];
  const selectedRows = useMemo(() => rows?.filter(row => row.projectName === selectedProject) ?? [], [rows, selectedProject]);
  const series = useMemo(() => dailyTrainingSeries(selectedRows), [selectedRows]);
  const selected = series.find(metric => metric.key === metricKey) ?? series[0];
  return <ChartCard title="个人每日训练趋势" actions={projects.length > 0 && <>
    <label className="custom-test-trend-select">
      <span>训练项目</span>
      <select value={selectedProject} onChange={event => setProjectName(event.target.value)}>
        {projects.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    {series.length > 0 && <label className="custom-test-trend-select">
      <span>训练指标</span>
      <select value={selected?.key} onChange={event => setMetricKey(event.target.value)}>
        {series.map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
      </select>
    </label>}
  </>}>
    {scope.teamId === null ? <ContentState kind="empty" title="该运动员暂无可用的队伍归属" />
      : !result?.data ? <TrainingState error={result?.error} retry={retry} />
      : !projects.length ? <ContentState kind="empty" title="所选日期内暂无每日训练记录" />
      : <>
        {result.data.truncated && <p>当前显示最近 1,000 条训练记录，可缩短日期范围。</p>}
        {selected ? <>
          <p className="custom-test-trend-summary" role="status">
            {selectedProject} · {selected.label} · {selected.points.length} 条实测记录
          </p>
          <EChart option={dailyTrainingTrendOption(selected, scope.from, scope.to)}
            label={`${selectedProject}的${selected.label}随训练日期变化`} />
        </> : <ContentState kind="empty" title="该训练项目暂无可绘制的数值" />}
        <details><summary>查看训练明细</summary><TrainingRecords rows={selectedRows} /></details>
      </>}
  </ChartCard>;
}
