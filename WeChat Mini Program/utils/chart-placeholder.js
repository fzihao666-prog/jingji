// 仅用于客户端图表展示；不参与页面摘要、接口请求或持久化。
// 空态只提供结构，不生成成绩、趋势或可交互的数据点。
function displaySeries(real) {
  return { data: real, isPlaceholder: real.length === 0 };
}

function trendPlaceholder() { return []; }
function ratioPlaceholder(names) {
  return names.map((name) => ({ name, value: '--', percentage: '--', width: 0, isPlaceholder: true }));
}

// 强度占比只展示填报端与总览共用的七类标准区间（与 training-entry 的 intensityOptions 一致）；
// 项目分类名单由 shared/sport-rules.ts 生成，不能在图表层维护全项目类别。
const INTENSITY_ZONE_NAMES = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'];

// 占比图固定展示选定的分类名单：没有数据的分类保留 0 值行，不隐藏、不用模拟值顶替，
// 名单之外的分区/分类不展示；百分比按合计重算，合计为 0 时全部为 0。
function completeRatioRows(realRows, names, valueOf, formatValue) {
  const realByName = new Map((realRows || []).map((row) => [row.name, Number(valueOf(row)) || 0]));
  const total = names.reduce((sum, name) => sum + (realByName.get(name) || 0), 0);
  return names.map((name) => {
    const value = realByName.get(name) || 0;
    const percentage = total ? (value / total) * 100 : 0;
    return {
      name,
      value: formatValue(value),
      percentage: Math.round(percentage * 10) / 10,
      width: Math.max(0, Math.min(100, percentage))
    };
  });
}

function physiologyPlaceholder() {
  const heatDates = ['1日', '2日', '3日', '4日', '5日', '6日', '7日'];
  return { metrics: ['指标一', '指标二', '指标三', '指标四'].map((label, index) => ({
    code: `empty-${index}`, label, unit: '',
    days: heatDates.map((dateLabel, dayIndex) => ({ date: `empty-${dayIndex}`, dateLabel,
      status: 'MISSING', statusClass: 'missing', median: null, sampleCount: 0, abnormalRateChange: null })),
    heatDates, sparkPoints: '', hasSpark: false,
    summary: { latestValue: null, latestStatusClass: 'missing', latestStatusLabel: '未测量',
      trendDirection: null, trendArrow: '', minValue: null, maxValue: null, avgValue: null, dataDays: 0 }
  })) };
}

module.exports = {
  displaySeries,
  trendPlaceholder,
  ratioPlaceholder,
  physiologyPlaceholder,
  INTENSITY_ZONE_NAMES,
  completeRatioRows
};
