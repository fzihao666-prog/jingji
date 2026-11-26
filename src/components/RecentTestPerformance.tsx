import type { EChartsOption } from 'echarts';
import { EChart } from './EChart';
import { useId, useState } from 'react';
import { AppCard, ContentState } from './PageLayout';
import { recentDailyTrainingSeries, testSeriesSummary } from './recent-test-performance';
import type { Project } from '../types';
import { useDailyTraining } from './DailyTrainingCards';
import './RecentTestPerformance.css';

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
function displayResult(value: number, unit: string) {
  if (unit !== 's' && unit !== '秒') return `${number.format(value)} ${unit}`;
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

export function RecentTestPerformance(props: {
  athleteId: number;
  project: Project;
  teamId: number | null;
  from: string;
  to: string;
}) {
  const id = useId();
  const [selectedKey, setSelectedKey] = useState('');
  const { result, retry } = useDailyTraining(props, props.athleteId);
  const series = recentDailyTrainingSeries(result?.data?.rows ?? []);
  const selected = series.find((item) => item.key === selectedKey) ?? series[0];
  const summary = selected ? testSeriesSummary(selected) : null;
  const loading = props.teamId !== null && !result;
  const points = selected?.points ?? [];
  const chartPoints = points.slice(-8);
  const labels = chartPoints.map(
    (point, index) => `${point.date} · ${points.length - chartPoints.length + index + 1}`
  );
  const option: EChartsOption = {
    animation: false,
    grid: { top: 40, right: 28, bottom: 28, left: 120 },
    legend: { data: ['测试成绩'], top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8 },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      valueFormatter: (value) => displayResult(Number(value), selected?.unit ?? ''),
    },
    xAxis: {
      type: 'value',
      min: 0,
      name: selected?.unit || '成绩',
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: selected ? labels : ['测试记录'],
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        name: '测试成绩',
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
        展示所选周期内已导入的每日训练数据，按训练项目、指标、单位和记录条件分别展示。
      </p>
      {loading && <p role="status">正在读取每日训练数据…</p>}
      {result?.error && <ContentState kind="error" title="训练数据读取失败" description={result.error}
        action={<button type="button" className="secondary-button" onClick={retry}>重试</button>} />}
      {props.teamId === null && <ContentState kind="empty" title="该运动员尚未关联队伍" />}
      {result?.data && !series.length && <ContentState kind="empty" title="所选周期内暂无导入的每日训练数据" description="导入每日训练模板或调整日期范围后查看。" />}
      {result?.data?.truncated && <p className="recent-test-description">仅展示最近 1,000 条明细，可缩短日期范围。</p>}
      <>
          <label htmlFor={id}>训练项目 / 指标</label>
          <select
            id={id}
            value={selected?.key ?? ''}
            disabled={!selected}
            onChange={(event) => setSelectedKey(event.target.value)}
          >
            {!selected && <option value="">暂无可选训练指标</option>}
            {series.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <dl className="recent-test-summary">
            <div>
              <dt>最近成绩</dt>
              <dd>{summary && selected ? displayResult(summary.latest.value, selected.unit) : '—'}</dd>
            </div>
            <div>
              <dt>记录日期</dt>
              <dd>{summary?.latest.date ?? '—'}</dd>
            </div>
            <div>
              <dt>记录次数</dt>
              <dd>{selected ? number.format(points.length) : '—'}</dd>
            </div>
            <div>
              <dt>较上次差值</dt>
              <dd>
                {!summary || !selected || summary.difference === null
                  ? '—'
                  : `${summary.difference > 0 ? '+' : ''}${number.format(summary.difference)} ${selected.unit}`}
              </dd>
            </div>
          </dl>
      </>
      {selected && summary ? (
        <>
          <p className="recent-test-description">
            {!selected.comparable
              ? '测试条件未完整记录，保留原始成绩，暂不比较。'
              : selected.direction === 'neutral'
                ? '训练指标不统一判定优劣；差值为同一口径下本次减上次。'
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
                  <th>记录日期 / 次序</th>
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
      ) : (
        <EChart option={option} label="测试成绩参考坐标，暂无可展示的成绩" isPlaceholder={!loading && !result?.error} />
      )}
    </AppCard>
  );
}
