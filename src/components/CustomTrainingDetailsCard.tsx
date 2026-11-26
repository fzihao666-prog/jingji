import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Project } from '../types';
import { EChart } from './EChart';
import { ChartCard, ContentState } from './PageLayout';

type Details = Awaited<ReturnType<typeof api.customTrainingDetails>>;
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 12 });
const fieldKey = (row: Details['rows'][number]) => JSON.stringify([row.template, row.field, row.unit, row.value === null]);

export function CustomTrainingDetailsCard({ project, teamId, athleteId, from, to }: {
  project: Project; teamId: number; athleteId: number; from: string; to: string;
}) {
  const [selection, setSelection] = useState('');
  const key = JSON.stringify([project, teamId, athleteId, from, to]);
  const [result, setResult] = useState<{ key: string; details?: Details; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void api.customTrainingDetails(athleteId, project, teamId, from, to, controller.signal).then(details => {
      if (!controller.signal.aborted) setResult({ key, details });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : '训练明细加载失败。' });
    });
    return () => controller.abort();
  }, [project, teamId, athleteId, from, to, key]);

  const current = result?.key === key ? result : undefined;
  const options = new Map(current?.details?.rows.map(row => [fieldKey(row), row]));
  const selected = options.get(selection) ?? options.values().next().value;
  const rows = selected ? current?.details?.rows.filter(row => fieldKey(row) === fieldKey(selected)).reverse() ?? [] : [];
  const label = (row: Details['rows'][number]) => `${row.date} · ${row.session} · 第 ${row.detailOrder} 条`;
  return <ChartCard title="自定义训练明细">
    {!current ? <div role="status"><ContentState kind="loading" title="正在加载训练明细" /></div>
      : current.error ? <ContentState kind="error" title="训练明细加载失败" description={current.error} />
      : !selected ? <ContentState kind="empty" title="所选日期内暂无自定义训练明细" />
      : <>
        <label>训练字段 <select value={fieldKey(selected)} onChange={event => setSelection(event.target.value)}>
          {[...options].map(([id, row]) => <option key={id} value={id}>
            {row.template} · {row.field}{row.unit ? `（${row.unit}）` : ''}{row.value === null ? ' · 文字' : ''}
          </option>)}
        </select></label>
        {current.details?.truncated && <p>仅显示最近 1000 条明细。可缩短日期范围查看其他记录。</p>}
        {selected.value !== null && <EChart label={`${selected.field}按训练明细排列的实测趋势`} option={{
          animation: false,
          tooltip: { trigger: 'axis', renderMode: 'richText' },
          grid: { left: 52, right: 16, top: 32, bottom: 36 },
          xAxis: { type: 'category', data: rows.map(label), axisLabel: { hideOverlap: true } },
          yAxis: { type: 'value', name: selected.unit, scale: true },
          series: [{ type: 'line', data: rows.map(row => row.value), connectNulls: true, showSymbol: true }],
        }} />}
        <div className="table-scroll"><table className="data-table">
          <caption>{selected.field}{selected.unit && `（${selected.unit}）`}</caption>
          <thead><tr><th scope="col">训练明细</th><th scope="col">填写值</th></tr></thead>
          <tbody>{rows.map(row => <tr key={JSON.stringify([row.date, row.sessionOrder, row.detailOrder])}>
            <td>{label(row)}</td><td>{row.value === null ? row.text : number.format(row.value)}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
  </ChartCard>;
}
