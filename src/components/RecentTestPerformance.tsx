import type { EChartsOption } from 'echarts';
import { EChart } from './EChart';
import { useId, useState } from 'react';
import { AppCard, ContentState } from './PageLayout';
import { recentTestSeries, testSeriesSummary } from './recent-test-performance';
import type { SpecialTestEvent, StrengthTest } from '../types';
import './RecentTestPerformance.css';

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
function displayResult(value: number, unit: string) {
  if (unit !== 's' && unit !== '秒') return `${number.format(value)} ${unit}`;
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

export function RecentTestPerformance(props: {
  tests: StrengthTest[];
  events: SpecialTestEvent[];
  athleteId: number;
  project: string;
  from: string;
  to: string;
  strengthLoading: boolean;
  specialLoading: boolean;
  strengthError: boolean;
  specialError: boolean;
}) {
  const id = useId();
  const [selectedKey, setSelectedKey] = useState('');
  const series = recentTestSeries(
    props.tests,
    props.events,
    props.athleteId,
    props.project,
    props.from,
    props.to
  );
  const selected = series.find((item) => item.key === selectedKey) ?? series[0];
  const summary = selected ? testSeriesSummary(selected) : null;
  const loading = props.strengthLoading || props.specialLoading;
  const points = selected?.points ?? [];
  const chartPoints = points.slice(-8);
  const labels = chartPoints.map(
    (point, index) => `${point.date} · ${points.length - chartPoints.length + index + 1}`
  );
  const option: EChartsOption = {
    animation: false,
    grid: { top: 28, right: 28, bottom: 28, left: 120 },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      valueFormatter: (value) => displayResult(Number(value), selected?.unit ?? ''),
    },
    xAxis: {
      type: 'value',
      min: 0,
      name: selected?.unit ?? '',
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        name: selected?.label ?? '测试成绩',
        data: chartPoints.map((point) => point.value),
        barMaxWidth: 18,
        itemStyle: { color: '#176f7f', borderRadius: [0, 3, 3, 0] },
      },
    ],
  };
  return (
    <AppCard
      variant="chart"
      className="professional-panel analysis-feature-panel recent-test-performance"
    >
      <header className="personal-analysis-card-heading">
        <div>
          <span>
            <small>RECENT TEST PERFORMANCE</small>
            <h3>近期测试表现</h3>
          </span>
        </div>
      </header>
      <p className="recent-test-description">
        所选周期内的体能与专项测试原始成绩，按同一指标和测试条件分别展示。
      </p>
      {loading && <p role="status">正在读取测试成绩…</p>}
      {props.strengthError && (
        <ContentState kind="error" title="体能测试读取失败" description="请刷新页面重试。" />
      )}
      {props.specialError && (
        <ContentState kind="error" title="专项测试读取失败" description="请刷新页面重试。" />
      )}
      {selected && summary ? (
        <>
          <label htmlFor={id}>测试指标</label>
          <select
            id={id}
            value={selected.key}
            onChange={(event) => setSelectedKey(event.target.value)}
          >
            {series.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <dl className="recent-test-summary">
            <div>
              <dt>最近成绩</dt>
              <dd>{displayResult(summary.latest.value, selected.unit)}</dd>
            </div>
            <div>
              <dt>测试日期</dt>
              <dd>{summary.latest.date}</dd>
            </div>
            <div>
              <dt>周期最好</dt>
              <dd>{summary.best === null ? '—' : displayResult(summary.best, selected.unit)}</dd>
            </div>
            <div>
              <dt>较上次差值</dt>
              <dd>
                {summary.difference === null
                  ? '—'
                  : `${summary.difference > 0 ? '+' : ''}${number.format(summary.difference)} ${selected.unit}`}
              </dd>
            </div>
          </dl>
          <p className="recent-test-description">
            {!selected.comparable
              ? '测试条件未完整记录，保留原始成绩，暂不比较。'
              : selected.direction === 'neutral'
                ? '该指标不判定高低优劣；差值为本次减上次。'
                : `${selected.direction === 'lower_better' ? '数值越低表现越好' : '数值越高表现越好'}；差值为本次减上次。`}
          </p>
          {points.length > 8 && (
            <p className="recent-test-description">图中展示最近8次，完整成绩见下方明细。</p>
          )}
          <EChart
            option={option}
            label={`${selected.label}最近${chartPoints.length}次测试成绩，单位${selected.unit}`}
          />
          <details>
            <summary>查看逐次成绩（{points.length}次）</summary>
            <table>
              <thead>
                <tr>
                  <th>测试日期 / 次序</th>
                  <th>成绩</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point, index) => (
                  <tr key={point.id}>
                    <td>
                      {point.date} · {index + 1}
                    </td>
                    <td>{displayResult(point.value, selected.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : !loading && !props.strengthError && !props.specialError ? (
        <ContentState
          kind="empty"
          title="当前周期暂无测试成绩"
          description="完成体能或专项测试后，将在这里展示原始成绩与变化。"
        />
      ) : null}
      {!selected && <EChart option={option} label="测试成绩趋势，暂无可展示的成绩" isPlaceholder />}
    </AppCard>
  );
}
