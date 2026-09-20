import type { EChartsOption } from 'echarts';
import type {
  ProfileTrainingStatusPayload,
  TrainingStatusCard,
  TrainingStatusMetric,
} from '../types';
import { formatNumber } from '../utils';
import { EChart } from './EChart';
import { ContentState } from './PageLayout';

type Props = {
  trainingStatus: ProfileTrainingStatusPayload | null;
  loading: boolean;
};

function formatValue(value: number | null, unit: string) {
  return value === null ? '--' : `${formatNumber(value, 1)}${unit ? ` ${unit}` : ''}`;
}

function formatDifference(metric: TrainingStatusMetric) {
  if (metric.difference === null) return '--';
  const prefix = metric.difference > 0 ? '+' : '';
  return `${prefix}${formatNumber(metric.difference, 1)}${metric.unit ? ` ${metric.unit}` : ''}`;
}

function differenceLabel(metric: TrainingStatusMetric) {
  if (metric.difference === null) return '暂无可比团队数据';
  if (metric.difference > 0) return '高于团队';
  if (metric.difference < 0) return '低于团队';
  return '与团队一致';
}

function trendOption(card: TrainingStatusCard): EChartsOption {
  const points = card.trend.points;
  const timestamps = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  return {
    animation: false,
    useUTC: true,
    legend: { top: 0, data: ['当前运动员', '团队平均'] },
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
        lineStyle: { width: 2, type: 'dashed', color: '#c59745' },
        itemStyle: { color: '#c59745' },
        data: points.map((point) => [Date.parse(`${point.date}T00:00:00Z`), point.teamMean]),
      },
    ],
  };
}

function trendSummary(card: TrainingStatusCard) {
  const personalCount = card.trend.points.filter((point) => point.personalValue !== null).length;
  const teamCount = card.trend.points.filter((point) => point.teamMean !== null).length;
  const firstDate = card.trend.points.at(0)?.date;
  const lastDate = card.trend.points.at(-1)?.date;
  const period = firstDate && lastDate ? `${firstDate}至${lastDate}` : '当前周期';
  return `${period}内，当前运动员有 ${personalCount} 个有效${card.trend.label}记录，团队有 ${teamCount} 个可比日期；完整数值见下方数据表。`;
}

function TrainingStatusCard({ card }: { card: TrainingStatusCard }) {
  const hasPersonalTrend = card.trend.points.some((point) => point.personalValue !== null);
  const summary = trendSummary(card);
  return (
    <section
      className="profile-training-status-card"
      aria-labelledby={`${card.kind}-training-title`}
    >
      <header>
        <div>
          <small>{card.kind === 'physical' ? 'PHYSICAL TRAINING' : 'SPECIAL TRAINING'}</small>
          <h3 id={`${card.kind}-training-title`}>{card.title}</h3>
          <p>当前运动员与同项目、同队且在授权范围内的有效训练数据对照。</p>
        </div>
      </header>
      <dl className="profile-training-status-metrics">
        {card.metrics.map((metric) => (
          <div key={metric.key}>
            <dt>{metric.label}</dt>
            <dd>
              <span>
                <small>当前运动员</small>
                <strong>{formatValue(metric.personalValue, metric.unit)}</strong>
              </span>
              <span>
                <small>团队平均</small>
                <strong>{formatValue(metric.teamMean, metric.unit)}</strong>
              </span>
              <span>
                <small>差异</small>
                <strong>{formatDifference(metric)}</strong>
                <em>{differenceLabel(metric)}</em>
              </span>
              {metric.differencePercent !== null && (
                <span>
                  <small>差异率</small>
                  <strong>
                    {metric.differencePercent > 0 ? '+' : ''}
                    {formatNumber(metric.differencePercent, 1)}%
                  </strong>
                  <em>团队样本 {metric.teamSampleCount} 人</em>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <section
        className="profile-training-status-trend"
        aria-labelledby={`${card.kind}-training-trend`}
      >
        <header>
          <div>
            <h4 id={`${card.kind}-training-trend`}>{card.trend.label}趋势</h4>
            <p>实线为当前运动员，虚线为团队平均；缺失日期不补零、不连线。</p>
          </div>
        </header>
        {hasPersonalTrend ? (
          <figure className="profile-training-status-figure">
            <figcaption>{summary}</figcaption>
            <EChart
              option={trendOption(card)}
              label={`${card.title}${card.trend.label}趋势：${summary}`}
            />
            <details className="profile-training-status-data">
              <summary>查看趋势数据表</summary>
              <div
                className="table-scroll profile-training-status-table-scroll"
                tabIndex={0}
                aria-label={`${card.title}${card.trend.label}趋势数据表，可横向滚动`}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">日期</th>
                      <th scope="col">当前运动员</th>
                      <th scope="col">团队平均</th>
                      <th scope="col">团队样本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.trend.points.map((point) => (
                      <tr key={point.date}>
                        <td>{point.date}</td>
                        <td>{formatValue(point.personalValue, card.trend.unit)}</td>
                        <td>{formatValue(point.teamMean, card.trend.unit)}</td>
                        <td>
                          {point.teamSampleCount === null ? '--' : `${point.teamSampleCount} 人`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </figure>
        ) : (
          <ContentState
            kind="empty"
            title="暂无训练趋势数据"
            description="当前周期未找到有效训练时长。"
          />
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
