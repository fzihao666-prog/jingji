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

// —— 演示补全（临时）——
// 专项训练的强度占比与课次占比中缺失的分类用下列固定模拟值补全，并按真实数据展示（不带“示例数据”标记）。
// 用户已知悉该临时行为，接入真实数据后整体删除两张补全表与 completeRatioRows 即可。
const INTENSITY_FILL = [
  { name: 'U3', value: 30 },
  { name: 'U2', value: 210 },
  { name: 'U1', value: 160 },
  { name: 'AT', value: 110 },
  { name: 'TPT', value: 70 },
  { name: 'AN', value: 40 },
  { name: 'ATP', value: 25 }
];
const CONTENT_FILL = [
  { name: '水上', value: 9 },
  { name: '测功仪', value: 4 },
  { name: '功能', value: 2 },
  { name: '拉伸再生', value: 3 },
  { name: '力量耐力', value: 3 },
  { name: '最大力量', value: 2 },
  { name: '速度力量', value: 2 },
  { name: '跑步', value: 2 },
  { name: '其它', value: 1 }
];

// 真实分类保留真实值，缺失分类取补全表；再按合计重算百分比，让分布完整成100%。
function completeRatioRows(realRows, fillRows, valueOf, formatValue) {
  const realByName = new Map((realRows || []).map((row) => [row.name, Number(valueOf(row)) || 0]));
  const merged = fillRows.map((fill) => ({
    name: fill.name,
    value: realByName.get(fill.name) > 0 ? realByName.get(fill.name) : fill.value
  }));
  for (const [name, value] of realByName) {
    if (value > 0 && !merged.some((row) => row.name === name)) merged.push({ name, value });
  }
  if (!merged.length) return [];
  const total = merged.reduce((sum, row) => sum + row.value, 0) || 1;
  const raw = merged.map((row) => (row.value / total) * 100);
  const rounded = raw.map((value) => Math.round(value * 10) / 10);
  // 四舍五入的余数并入占比最大的一行，保证展示百分比合计恰好 100。
  const maxIndex = rounded.indexOf(Math.max(...rounded));
  const drift = Math.round((100 - rounded.reduce((sum, value) => sum + value, 0)) * 10) / 10;
  rounded[maxIndex] = Math.round((rounded[maxIndex] + drift) * 10) / 10;
  return merged.map((row, index) => ({
    name: row.name,
    value: formatValue(row.value),
    percentage: rounded[index],
    width: Math.max(0, Math.min(100, raw[index]))
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

module.exports = {
  displaySeries,
  trendPlaceholder,
  ratioPlaceholder,
  physiologyPlaceholder,
  INTENSITY_FILL,
  CONTENT_FILL,
  completeRatioRows
};
