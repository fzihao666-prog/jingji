import type { EChartsOption } from 'echarts';
import type {
  ProfileTrainingStatusPayload,
  TrainingStatusCard,
  TrainingStatusMetric,
} from '../types';
import { formatNumber } from '../utils';
import { EChart } from './EChart';
import { ContentState } from './PageLayout';
import { placeholderTrend } from './chart-placeholder';

type Props = {
  trainingStatus: ProfileTrainingStatusPayload | null;
  loading: boolean;
};

function formatValue(value: number | null, unit: string, emptyLabel = '暂无数据') {
  return value === null ? emptyLabel : `${formatNumber(value, 1)}${unit ? ` ${unit}` : ''}`;
}

function formatDifference(metric: TrainingStatusMetric) {
  if (metric.difference === null) return '暂无可比数据';
  const prefix = metric.difference > 0 ? '+' : '';
  return `${prefix}${formatNumber(metric.difference, 1)}${metric.unit ? ` ${metric.unit}` : ''}`;
}

function trendOption(card: TrainingStatusCard, isPlaceholder: boolean): EChartsOption {
  const points = isPlaceholder
    ? placeholderTrend.map((value, index) => ({
        date: `2026-01-${String(index + 1).padStart(2, '0')}`,
        personalValue: value, teamMean: null,
      }))
    : card.trend.points;
  const timestamps = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  return {
    animation: false,
    useUTC: true,
    legend: {
      top: 0,
      data: ['当前运动员', '团队平均'],
      textStyle: { color: '#092b39' },
    },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      valueFormatter: (value) => `${formatNumber(Number(value), 1)} ${card.trend.unit}`,
    },
    grid: {
      top: 34,
      right: 18,
      bottom: 34,
      left: 46,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: {
      type: 'time',
      min: timestamps[0],
      max: timestamps.at(-1),
      axisLabel: { formatter: '{MM}/{dd}', hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      name: card.trend.unit,
      scale: true,
      splitLine: { lineStyle: { color: '#e0e9e9' } },
    },
    series: [
      {
        id: `${card.kind}-personal`,
        name: '当前运动员',
        type: 'line',
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2, color: '#176f7f' },
        itemStyle: { color: '#176f7f' },
        data: points.map((point) => [Date.parse(`${point.date}T00:00:00Z`), point.personalValue]),
      },
      {
        id: `${card.kind}-team`,
        name: '团队平均',
        type: 'line',
        connectNulls: false,
        symbol: 'emptyCircle',
        symbolSize: 5,
        lineStyle: { width: 2, type: 'dashed', color: '#8a651e' },
        itemStyle: { color: '#8a651e' },
        data: points.map((point) => [Date.parse(`${point.date}T00:00:00Z`), point.teamMean]),
      },
    ],
  };
}

function TrainingStatusCard({ card }: { card: TrainingStatusCard }) {
  const hasPersonalTrend = card.trend.points.some((point) => point.personalValue !== null);
  return (
    <section
      className="profile-training-status-card"
      aria-labelledby={`${card.kind}-training-title`}
    >
      <header>
        <h3 id={`${card.kind}-training-title`}>{card.title}</h3>
      </header>
      <dl className="profile-training-status-metrics">
        {card.metrics.map((metric) => (
          <div key={metric.key}>
            <dt>{metric.label}</dt>
            <dd>
              <span className="profile-training-status-primary">
                <small>当前运动员</small>
                <strong className={metric.personalValue === null ? 'is-empty' : undefined}>
                  {formatValue(metric.personalValue, metric.unit)}
                </strong>
              </span>
              <span>
                <small>团队平均</small>
                <strong>{formatValue(metric.teamMean, metric.unit, '暂无可比数据')}</strong>
              </span>
              <span>
                <small>差异</small>
                <strong>{formatDifference(metric)}</strong>
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <section
        className="profile-training-status-trend"
        aria-labelledby={`${card.kind}-training-chart-title`}
      >
        <h4 id={`${card.kind}-training-chart-title`}>{card.trend.label}</h4>
        {(
          <figure className="profile-training-status-figure">
            <EChart
              option={trendOption(card, !hasPersonalTrend)}
              label={`${card.trend.label}：当前运动员与团队平均的每日变化`}
              isPlaceholder={!hasPersonalTrend}
            />
            {hasPersonalTrend && (
            <div
              className="profile-training-status-accessible-data visually-hidden"
              role="region"
              tabIndex={0}
              aria-label={`${card.trend.label}按日期查看数值，按 Tab 键显示`}
            >
              <table>
                <caption>{card.trend.label}数据</caption>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">当前运动员</th>
                    <th scope="col">团队平均</th>
                  </tr>
                </thead>
                <tbody>
                  {card.trend.points.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td>
                      <td>{formatValue(point.personalValue, card.trend.unit)}</td>
                      <td>{formatValue(point.teamMean, card.trend.unit, '暂无可比数据')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </figure>
        )}
      </section>
    </section>
  );
}

export function ProfileTrainingStatus({ trainingStatus, loading }: Props) {
  const statusMessage = loading
    ? '正在更新训练情况。'
    : trainingStatus
      ? '训练情况已更新。'
      : '训练情况暂不可用。';
  return (
    <div aria-busy={loading}>
      <p className="visually-hidden" aria-live="polite">
        {statusMessage}
      </p>
      {loading ? (
        <ContentState kind="loading" title="正在读取训练情况" />
      ) : !trainingStatus ? (
        <ContentState kind="error" title="训练情况暂不可用" description="请稍后重试。" />
      ) : (
        <div className="profile-training-status-list">
          {trainingStatus.cards.map((card) => (
            <TrainingStatusCard key={card.kind} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
