// 仅用于客户端图表展示；不参与页面摘要、接口请求或持久化。
const TREND_HEIGHTS = [36, 52, 44, 68, 57, 79, 63];
const RATIO_VALUES = [42, 27, 19, 12];

function displaySeries(real, fallback, hasReal = real.length > 0) {
  return hasReal ? { data: real, isPlaceholder: false } : { data: fallback, isPlaceholder: true };
}

function trendPlaceholder(kind) {
  return TREND_HEIGHTS.map((height, index) => {
    const secondary = Math.max(18, Math.round(height * (kind === 'special' ? 0.72 : 0.81)));
    return {
      date: `示例第${index + 1}日`,
      label: `${index + 1}日`,
      duration: height,
      load: secondary * 5,
      distance: secondary / 10,
      durationHeight: height,
      loadHeight: secondary,
      distanceHeight: secondary,
      isPlaceholder: true,
      ariaLabel: `示例数据，仅用于展示图表效果，第${index + 1}日`
    };
  });
}

function ratioPlaceholder(names, unit) {
  return names.map((name, index) => ({
    name,
    value: `示例 ${RATIO_VALUES[index % RATIO_VALUES.length]} ${unit}`,
    percentage: RATIO_VALUES[index % RATIO_VALUES.length],
    width: RATIO_VALUES[index % RATIO_VALUES.length],
    isPlaceholder: true
  }));
}

function physiologyPlaceholder() {
  const labels = ['指标一', '指标二', '指标三', '指标四'];
  const heatDates = ['1日', '2日', '3日', '4日', '5日', '6日', '7日'];
  return { metrics: labels.map((label, metricIndex) => ({
    code: `sample-${metricIndex}`, label, unit: '',
    days: heatDates.map((dateLabel, dayIndex) => ({
      date: `sample-${dayIndex}`, dateLabel, status: 'MISSING',
      statusClass: `sample-${(metricIndex + dayIndex) % 3}`, median: null,
      sampleCount: 0, abnormalRateChange: null, isPlaceholder: true
    })),
    heatDates, sparkPoints: '0,23 16,18 32,21 48,11 64,15 80,8 100,13', hasSpark: true,
    summary: { latestValue: null, latestStatusClass: 'missing', latestStatusLabel: '示例数据',
      trendDirection: 'stable', trendArrow: '', minValue: null, maxValue: null, avgValue: null, dataDays: 0 }
  })) };
}

module.exports = { displaySeries, trendPlaceholder, ratioPlaceholder, physiologyPlaceholder };
