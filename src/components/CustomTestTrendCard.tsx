import { useEffect, useState } from 'react';
import type { EChartsOption } from 'echarts';
import type { CustomTestTrend } from '../../shared/custom-test-trend';
import { api } from '../api';
import type { Project } from '../types';
import { EChart } from './EChart';
import { ChartCard, ContentState } from './PageLayout';
import './CustomTestTrendCard.css';

const dayMs = 86_400_000;
const dateTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const axisDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
const detailDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 12 });

function trendOption(points: CustomTestTrend['points'], from: string, to: string, unit: string): EChartsOption {
  const series: Array<[number, number | null]> = [];
  for (const point of points) {
    const date = dateTime(point.date);
    const previous = series.at(-1)?.[0];
    if (previous !== undefined && date - previous > dayMs) series.push([previous + dayMs, null]);
    series.push([date, point.value]);
  }
  return {
    animation: false,
    useUTC: true,
    grid: { top: 34, right: 18, bottom: 32, left: 54 },
    tooltip: { trigger: 'item', renderMode: 'richText', valueFormatter: value => typeof value === 'number' ? numberFormat.format(value) : String(value ?? '') },
    xAxis: {
      type: 'time',
      ...(from === to ? {} : { min: dateTime(from), max: dateTime(to) }),
      axisLabel: { formatter: value => axisDate.format(value), hideOverlap: true },
    },
    yAxis: { type: 'value', name: unit, scale: true },
    series: [{ type: 'line', data: series, connectNulls: false, showSymbol: true, symbolSize: 7 }],
  };
}

export function CustomTestTrendCard({ project, teamId, athleteId, from, to }: {
  project: Project; teamId: number; athleteId: number; from: string; to: string;
}) {
  const [selected, setSelected] = useState<CustomTestTrend['metrics'][number]>();
  const seriesKey = (metric: CustomTestTrend['metrics'][number]) => JSON.stringify([metric.code, metric.protocol, metric.version]);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: CustomTestTrend; error?: string } | null>(null);
  const key = JSON.stringify([project, teamId, athleteId, from, to, selected, retry]);
  useEffect(() => {
    const controller = new AbortController();
    void api.customTestTrend(athleteId, { project, teamId, from, to, metricCode: selected?.code, protocol: selected?.protocol, version: selected?.version }, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setResult({ key, data });
      }).catch(error => {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : '成绩加载失败。' });
      });
    return () => controller.abort();
  }, [project, teamId, athleteId, from, to, selected, key]);

  const current = result?.key === key ? result : null;
  const catalog = result?.data?.metrics ?? [];
  const metric = selected
    ? catalog.find(entry => seriesKey(entry) === seriesKey(selected))
    : catalog.find(entry => entry.code === result?.data?.metricCode);
  const points = current?.data?.points ?? [];
  const latest = points.at(-1);
  const show = (value: number) => `${numberFormat.format(value)}${metric?.unit ? ` ${metric.unit}` : ''}`;

  return (
    <ChartCard title="导入测试成绩趋势" actions={catalog.length > 0 && (
      <label className="custom-test-trend-select">
        <span>测试指标</span>
        <select value={metric ? seriesKey(metric) : ''} onChange={event => setSelected(catalog.find(entry => seriesKey(entry) === event.target.value))}>
          {!metric && <option value="" disabled>请选择指标</option>}
          {catalog.map(entry => (
            <option key={seriesKey(entry)} value={seriesKey(entry)}>
              {entry.label}{entry.unit ? `（${entry.unit}）` : ''}{entry.version ? ` · 版本 ${entry.version}` : ''}{entry.protocol ? ` · ${entry.protocol}` : ''}
            </option>
          ))}
        </select>
      </label>
    )}>
      {!current ? <div role="status"><ContentState kind="loading" title="正在加载指标成绩" /></div>
        : current.error ? <ContentState kind="error" title="指标成绩加载失败" description={current.error}
          action={<button type="button" className="secondary-button" onClick={() => setRetry(count => count + 1)}>重试</button>} />
        : !catalog.length ? <ContentState kind="empty" title="该运动员暂无导入的测试成绩" description="提交基础数据模板后，测得的指标会显示在这里。" />
        : !latest || !metric ? <ContentState kind="empty" title="所选日期内暂无该指标成绩" description="可切换指标或调整上方日期范围。" />
        : <>
          <p className="custom-test-trend-summary" role="status">
            {metric.label} · 实测 {points.length} 天 · 最近一次 {detailDate.format(dateTime(latest.date))}，{show(latest.value)}
          </p>
          <EChart option={trendOption(points, from, to, metric.unit)} label={`${metric.label}的实测成绩按日期排列，缺测处断开`} />
          <details>
            <summary>查看成绩明细</summary>
            <div className="table-scroll">
              <table className="data-table">
                <caption>{metric.label} · 版本 {metric.version}</caption>
                <thead><tr><th scope="col">测试日期</th><th scope="col">实测成绩</th></tr></thead>
                <tbody>{points.map(point => (
                  <tr key={point.date}><td>{detailDate.format(dateTime(point.date))}</td><td>{show(point.value)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </>}
    </ChartCard>
  );
}
