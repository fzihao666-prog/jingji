// 档案页三个数据模块的视图模型：身体成分趋势、训练对比条、雷达系列。
// 数值缺失保留 null/占位文本，不用 0 代替；百分比与柱高只做展示归一，不参与业务统计。
const { number } = require('./format');

const BODY_METRIC_ORDER = [
  'weightKg', 'bodyFatPct', 'skeletalMuscleKg', 'muscleMassKg',
  'totalBodyWaterKg', 'visceralFatLevel', 'basalMetabolismKcal'
];

const RADAR_STATUS_LABELS = {
  ready: '已测',
  measurement_pending: '待测量',
  reference_pending: '缺参考'
};

// 身体成分历史：每个指标一行趋势柱（柱高按该指标自身波动范围归一），保留环比与最近值。
function bodyCompositionTrendView(history) {
  const records = Array.isArray(history) ? history : [];
  const dates = records.map((record) => record.measurementDate);
  const seriesByKey = new Map();
  records.forEach((record, index) => {
    (Array.isArray(record.items) ? record.items : []).forEach((item) => {
      const series = seriesByKey.get(item.key) || {
        key: item.key,
        label: item.label,
        unit: item.unit || '',
        points: records.map(() => null)
      };
      series.points[index] = {
        date: record.measurementDate,
        value: Number(item.value),
        delta: item.delta == null ? null : Number(item.delta)
      };
      seriesByKey.set(item.key, series);
    });
  });
  const metrics = [...seriesByKey.values()]
    .map((series) => {
      const values = series.points
        .filter((point) => point && Number.isFinite(point.value))
        .map((point) => point.value);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const span = max - min;
      const points = series.points.map((point, index) =>
        point
          ? {
              date: point.date,
              value: point.value,
              delta: point.delta,
              height: span > 0 ? Math.round(14 + ((point.value - min) / span) * 86) : 55
            }
          : { date: dates[index], missing: true }
      );
      const latest = series.points.find((point) => point) || null;
      return {
        key: series.key,
        label: series.label,
        unit: series.unit,
        latest: latest ? latest.value : null,
        latestDate: latest ? latest.date : '',
        delta: latest ? latest.delta : null,
        recorded: values.length,
        points
      };
    })
    .filter((metric) => metric.recorded > 0);
  metrics.sort((a, b) => {
    const left = BODY_METRIC_ORDER.indexOf(a.key);
    const right = BODY_METRIC_ORDER.indexOf(b.key);
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.key.localeCompare(b.key);
  });
  return { dates, metrics };
}

// 训练情况对比：个人与队均双条（同一指标内按较大值归一），差值按“个人 − 队均”。
function trainingComparisonView(comparison) {
  const items = comparison && Array.isArray(comparison.items) ? comparison.items : [];
  return {
    items: items.map((item) => {
      const personal = item.personalValue == null ? null : Number(item.personalValue);
      const team = item.teamMean == null ? null : Number(item.teamMean);
      const scale = Math.max(personal || 0, team || 0);
      const diff =
        personal != null && team != null ? Math.round((personal - team) * 10) / 10 : null;
      return {
        key: item.key,
        label: item.label,
        unit: item.unit || '',
        personalText: personal == null ? '—' : number(personal, 1),
        teamText: team == null ? '—' : number(team, 1),
        personalPct: personal != null && scale > 0 ? Math.max(4, Math.round((personal / scale) * 100)) : 0,
        teamPct: team != null && scale > 0 ? Math.max(4, Math.round((team / scale) * 100)) : 0,
        diffText: diff == null ? '—' : `${diff > 0 ? '+' : ''}${number(diff, 1)}`,
        diffClass: diff == null ? '' : diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
        note: personal == null ? '个人未记录' : team == null ? '队均样本不足' : '个人 − 队均'
      };
    })
  };
}

// 雷达模型：参考标准固定 100，个人序列用达成度；不足 3 个有效维度不画多边形。
function radarGroupView(group, options) {
  const settings = options || {};
  const dimensions = group && Array.isArray(group.dimensions) ? group.dimensions : [];
  const achieved = dimensions.map((item) =>
    item.achievedPercent == null || !Number.isFinite(Number(item.achievedPercent))
      ? null
      : Number(item.achievedPercent)
  );
  const valid = achieved.filter((value) => value != null);
  const peak = valid.length ? Math.max(...valid) : 100;
  const maxValue = Math.max(120, Math.ceil(peak / 20) * 20);
  return {
    title: settings.title || '',
    canvasId: settings.canvasId || '',
    hasChart: valid.length >= 3,
    maxValue,
    personalValues: achieved,
    referenceValues: dimensions.map(() => 100),
    dimensions: dimensions.map((item, index) => ({
      key: item.key,
      label: item.label,
      unit: item.unit || '',
      valueText: item.currentValue == null ? '—' : `${number(item.currentValue, 1)}${item.unit || ''}`,
      referenceText:
        item.referenceValue == null ? '—' : `${number(item.referenceValue, 1)}${item.unit || ''}`,
      achievedText: achieved[index] == null ? '—' : `${number(achieved[index], 1)}%`,
      statusLabel: RADAR_STATUS_LABELS[item.status] || item.status || ''
    }))
  };
}

// 恢复状态：按指标输出个人趋势柱与当日队均横杠；缺失个人值留空位，不用 0 代替。
function wellnessTrendsView(trends) {
  const list = Array.isArray(trends) ? trends : [];
  return {
    metrics: list
      .map((trend) => {
        const points = Array.isArray(trend.points) ? trend.points : [];
        const personalValues = points
          .filter((point) => point.hasPersonalValue && Number.isFinite(Number(point.personalValue)))
          .map((point) => Number(point.personalValue));
        const teamValues = points
          .filter((point) => point.teamMean != null && Number.isFinite(Number(point.teamMean)))
          .map((point) => Number(point.teamMean));
        const scaleValues = [...personalValues, ...teamValues];
        const min = scaleValues.length ? Math.min(...scaleValues) : 0;
        const max = scaleValues.length ? Math.max(...scaleValues) : 0;
        const span = max - min;
        const heightOf = (value) =>
          span > 0 ? Math.round(14 + ((value - min) / span) * 86) : 55;
        const rendered = points.map((point) => {
          const hasPersonal =
            point.hasPersonalValue && Number.isFinite(Number(point.personalValue));
          const hasTeam = point.teamMean != null && Number.isFinite(Number(point.teamMean));
          return {
            date: point.date,
            missing: !hasPersonal,
            valueText: hasPersonal ? number(point.personalValue, 1) : '未测',
            height: hasPersonal ? heightOf(Number(point.personalValue)) : 8,
            teamPct: hasTeam ? heightOf(Number(point.teamMean)) : null,
            teamText: hasTeam ? number(point.teamMean, 1) : '',
            teamSampleCount: point.teamSampleCount == null ? null : Number(point.teamSampleCount)
          };
        });
        // 行首数值取日期最新的一次个人实测，不依赖接口返回顺序。
        const latestIndex = rendered.reduce(
          (best, point, index) =>
            point.missing ? best : best < 0 || rendered[best].date < point.date ? index : best,
          -1
        );
        const latest = latestIndex >= 0 ? rendered[latestIndex] : null;
        const latestPoint = latestIndex >= 0 ? points[latestIndex] : null;
        const diff =
          latestPoint && latestPoint.personalValue != null && latestPoint.teamMean != null
            ? Math.round((Number(latestPoint.personalValue) - Number(latestPoint.teamMean)) * 10) / 10
            : null;
        return {
          key: trend.key,
          label: trend.label,
          unit: trend.unit || '',
          recorded: personalValues.length,
          latestDate: latest ? latest.date : '',
          latestText: latest ? latest.valueText : '—',
          diffText: diff == null ? '—' : `${diff > 0 ? '+' : ''}${number(diff, 1)}`,
          note:
            latest == null
              ? '周期内未测'
              : diff == null
                ? '最近一次 · 当日队均样本不足'
                : '最近一次 · 个人 − 队均',
          points: rendered
        };
      })
      .filter((metric) => metric.points.length)
  };
}

module.exports = { bodyCompositionTrendView, trainingComparisonView, radarGroupView, wellnessTrendsView };
