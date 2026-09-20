import type { EChartsOption } from 'echarts';
import type { ReactNode } from 'react';
import type { AthleteRadarDimension, AthleteRadarModel } from '../types';
import { formatNumber } from '../utils';
import { EChart } from './EChart';
import { ContentState } from './PageLayout';

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

function formatAchieved(value: number | null) {
  if (value === null) return '—';
  return `${metricNumber.format(value)}%`;
}

function pendingReason(dimension: AthleteRadarDimension) {
  return dimension.status === 'measurement_pending'
    ? '待采集'
    : dimension.status === 'reference_pending'
      ? '待参考'
      : null;
}
function formatRadarDifference(dimension: AthleteRadarDimension) {
  const diff = dimension.signedDifference;

  if (diff === null) return '--';

  const abs = Math.abs(diff);

  const formattedValue =
    dimension.unit === 's' || dimension.unit === 's/500m'
      ? formatRadarValue(abs, dimension.unit)
      : `${formatNumber(abs, 1)} ${dimension.unit}`.trim();

  if (dimension.direction === 'lower_better') {
    if (diff > 0) return `慢 ${formattedValue}`;
    if (diff < 0) return `快 ${formattedValue}`;
    return '与参考一致';
  }

  if (diff > 0) return `高 ${formattedValue}`;
  if (diff < 0) return `低 ${formattedValue}`;

  return '与参考一致';
}
function formatRadarValue(value: number | null, unit: string) {
  if (value === null) return '—';

  if (unit === 's' || unit === 's/500m') {
    const totalSeconds = Math.round(value);

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const formatted = `${minutes}:${String(seconds).padStart(2, '0')}`;

    return unit === 's/500m' ? `${formatted} /500m` : formatted;
  }

  return `${formatNumber(value, 1)} ${unit}`.trim();
}
function radarOption(title: string, dimensions: AthleteRadarDimension[]): EChartsOption {
  const athleteValues = dimensions.map((dimension) =>
    Math.min(120, dimension.achievedPercent ?? 0)
  );

  const referenceValues = dimensions.map(() => 100);

  return {
    tooltip: {
      trigger: 'item',

      formatter: () => {
        return dimensions
          .map((dimension) => {
            const current = formatRadarValue(dimension.currentValue, dimension.unit);

            const reference = formatRadarValue(dimension.referenceValue, dimension.unit);

            const difference = formatRadarDifference(dimension);

            const achieved =
              dimension.achievedPercent === null
                ? '--'
                : `${formatNumber(dimension.achievedPercent, 1)}%`;

            return `
          <div style="margin-bottom:10px;">
            <strong>${dimension.label}</strong><br/>
            当前值：${current}<br/>
            参考值：${reference}<br/>
            差值：${difference}<br/>
            达成度：${achieved}
          </div>
        `;
          })
          .join('');
      },
    },
    animation: false,

    legend: {
      top: 0,
      right: 4,
      itemWidth: 10,
      itemHeight: 6,
      textStyle: {
        color: '#52666d',
        fontSize: 10,
      },
    },

    radar: {
      center: ['50%', '54%'],
      radius: '54%',
      splitNumber: 4,

      indicator: dimensions.map((dimension) => ({
        name: dimension.label,
        max: 120,
      })),

      axisName: {
        color: '#365660',
        fontSize: 10,
        lineHeight: 14,
      },

      axisLine: {
        lineStyle: {
          color: '#c8d9dc',
        },
      },

      splitLine: {
        lineStyle: {
          color: '#c8d9dc',
        },
      },

      splitArea: {
        areaStyle: {
          color: ['#f8fbfb', '#eef6f5'],
        },
      },
    },

    series: [
      {
        name: title,
        type: 'radar',

        data: [
          {
            name: '冠军参考模型',
            value: referenceValues,

            symbol: 'none',

            lineStyle: {
              width: 2,
              type: 'dashed',
              color: '#c59745',
            },

            areaStyle: {
              color: 'rgba(197, 151, 69, 0.05)',
            },
          },

          {
            name: '当前运动员',
            value: athleteValues,

            symbol: 'circle',
            symbolSize: 6,

            lineStyle: {
              width: 2,
              color: '#176f7f',
            },

            itemStyle: {
              color: '#1b9d95',
            },

            areaStyle: {
              color: 'rgba(27, 157, 149, 0.20)',
            },
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
        return (
          <div key={dimension.key} className={`athlete-radar-detail is-${dimension.status}`}>
            <dt>
              <strong>{dimension.label}</strong>

              {reason && <span className="athlete-radar-detail-status">{reason}</span>}
            </dt>

            <dd>
              <span>
                <small>当前值</small>

                <strong>{formatRadarValue(dimension.currentValue, dimension.unit)}</strong>
              </span>

              <span>
                <small>参考值</small>

                <strong>{formatRadarValue(dimension.referenceValue, dimension.unit)}</strong>
              </span>

              <span>
                <small>差值</small>

                <strong>{formatRadarDifference(dimension)}</strong>
              </span>

              <span>
                <small>达成度</small>

                <strong>{formatAchieved(dimension.achievedPercent)}</strong>
              </span>
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
