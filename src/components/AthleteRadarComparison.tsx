import type { EChartsOption } from 'echarts';
import type { ReactNode } from 'react';
import type { AthleteRadarDimension, AthleteRadarModel } from '../types';
import { ContentState } from './PageLayout';
import { EChart } from './EChart';

type Props = {
  model: AthleteRadarModel | null;
  loading: boolean;
  title: string;
  unavailableReason?: string;
};

const metricNumber = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
});

function formatMetric(value: number | null, unit: string) {
  return value === null ? '—' : `${metricNumber.format(value)} ${unit}`;
}

function formatDifference(value: number | null, unit: string) {
  if (value === null) return '—';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${metricNumber.format(value)} ${unit}`;
}

function formatAchieved(value: number | null) {
  if (value === null) return '—';
  return `${metricNumber.format(Math.min(120, value))}%`;
}

function pendingReason(dimension: AthleteRadarDimension) {
  return dimension.status === 'measurement_pending'
    ? '待采集'
    : dimension.status === 'reference_pending'
      ? '待参考'
      : null;
}

function sourceUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function radarOption(title: string, dimensions: AthleteRadarDimension[]): EChartsOption {
  return {
    animation: false,
    radar: {
      center: ['50%', '52%'],
      radius: '66%',
      splitNumber: 4,
      indicator: dimensions.map((dimension) => ({ name: dimension.label, max: 120 })),
      axisName: {
        color: '#365660',
        fontSize: 12,
        lineHeight: 16,
      },
      axisLine: { lineStyle: { color: '#c8d9dc' } },
      splitLine: { lineStyle: { color: '#c8d9dc' } },
      splitArea: { areaStyle: { color: ['#f8fbfb', '#eef6f5'] } },
    },
    series: [
      {
        name: title,
        type: 'radar',
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2, color: '#176f7f' },
        itemStyle: { color: '#1b9d95' },
        areaStyle: { color: 'rgba(27, 157, 149, 0.2)' },
        data: [
          {
            name: title,
            value: dimensions.map((dimension) => Math.min(120, dimension.achievedPercent ?? 0)),
          },
        ],
      },
    ],
  };
}

function RadarDetails({ dimensions }: { dimensions: AthleteRadarDimension[] }) {
  return (
    <dl className="athlete-radar-details">
      {dimensions.map((dimension) => {
        const reason = pendingReason(dimension);
        const href = dimension.source ? sourceUrl(dimension.source.url) : null;
        return (
          <div key={dimension.key}>
            <dt>
              <strong>{dimension.label}</strong>
              {reason && <span>{reason}</span>}
            </dt>
            <dd>
              <span>
                <small>当前</small>
                <strong>{formatMetric(dimension.currentValue, dimension.unit)}</strong>
              </span>
              <span>
                <small>参考</small>
                <strong>{formatMetric(dimension.referenceValue, dimension.unit)}</strong>
              </span>
              <span>
                <small>差值</small>
                <strong>{formatDifference(dimension.signedDifference, dimension.unit)}</strong>
              </span>
              <span>
                <small>达成度</small>
                <strong>{formatAchieved(dimension.achievedPercent)}</strong>
              </span>
              {dimension.source && href && (
                <a href={href} target="_blank" rel="noreferrer">
                  来源：{dimension.source.name}（{dimension.source.year}）
                </a>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function AthleteRadarComparison({ model, loading, title, unavailableReason }: Props) {
  let statusMessage: string;
  let content: ReactNode;

  if (loading) {
    statusMessage = `正在读取${title}。`;
    content = (
      <ContentState
        kind="loading"
        title={`正在读取${title}`}
        description="正在汇总当前周期测试与正式参考标准。"
      />
    );
  } else if (unavailableReason) {
    statusMessage = `${unavailableReason}。当前仅配置赛艇项目的雷达维度。`;
    content = (
      <ContentState
        kind="empty"
        title={unavailableReason}
        description="当前仅配置赛艇项目的雷达维度。"
      />
    );
  } else if (!model) {
    statusMessage = `${title}暂不可用。未能读取雷达模型，请稍后重试。`;
    content = (
      <ContentState
        kind="error"
        title={`${title}暂不可用`}
        description="未能读取雷达模型，请稍后重试。"
      />
    );
  } else {
    const readyDimensions = model.dimensions.filter(
      (dimension) => dimension.status === 'ready' && dimension.achievedPercent !== null
    );
    const pendingCount = model.dimensions.length - readyDimensions.length;
    const summary = `${title}共 ${model.dimensions.length} 项指标，${readyDimensions.length} 项可比，${pendingCount} 项待补充；可达成度最高显示 120%。`;

    if (readyDimensions.length < 3) {
      statusMessage = `${summary}可比指标不足，暂不生成雷达图。`;
      content = (
        <section className="athlete-radar-comparison is-incomplete" aria-label={`${title}数据状态`}>
          <ContentState
            kind="empty"
            title="可比指标不足，暂不生成雷达图"
            description="至少需要 3 项同时具备当前值与正式参考值的指标。"
          />
          <p className="athlete-radar-summary">{summary}</p>
          <RadarDetails dimensions={model.dimensions} />
        </section>
      );
    } else {
      const chartLabel = `${summary}雷达图仅包含可比指标。`;
      statusMessage = `${summary}雷达图与明细已更新。`;
      content = (
        <section className="athlete-radar-comparison" aria-label={`${title}比较结果`}>
          <div className="athlete-radar-chart">
            <EChart option={radarOption(title, readyDimensions)} label={chartLabel} />
          </div>
          <div className="athlete-radar-copy">
            <p className="athlete-radar-summary">{summary}</p>
            <RadarDetails dimensions={model.dimensions} />
          </div>
        </section>
      );
    }
  }

  return (
    <section className="athlete-radar-root" aria-label={`${title}状态与结果`} aria-busy={loading}>
      <p className="visually-hidden athlete-radar-live-status" aria-live="polite">
        {statusMessage}
      </p>
      {content}
    </section>
  );
}
