import { TRAINING_INTENSITY_COLORS } from '../../shared/training-chart-colors.js';

/** Word正文、表格与原生图表共用的体育科学报告主题（不含#的OOXML色值）。 */
export const weeklyReportTheme = {
  navy: '183655',
  blue: '2477A9',
  teal: '16A085',
  amber: 'E3A54C',
  risk: 'C45150',
  text: '334155',
  muted: '64748B',
  pale: 'EAF0F5',
  white: 'FFFFFF',
  axis: 'CCD8E3',
  neutral: '94A3B8',
  recovery: '5B9A91',
  previousBlue: '5C93B5',
  previousTeal: '66B9A8',
  previousNavy: '66829D',
} as const;

export function weeklyMetricColor(id: string): string {
  if (['srpe', 'sleep'].includes(id)) return weeklyReportTheme.teal;
  if (id === 'pulse') return weeklyReportTheme.navy;
  return weeklyReportTheme.blue;
}
export function weeklyPreviousColor(id: string): string {
  const color = weeklyMetricColor(id);
  return color === weeklyReportTheme.teal
    ? weeklyReportTheme.previousTeal
    : color === weeklyReportTheme.navy
      ? weeklyReportTheme.previousNavy
      : weeklyReportTheme.previousBlue;
}
/** 只依据已有分类标签上色，不从颜色推导强度、异常或训练效果。 */
export function weeklyCategoryColor(label: string): string {
  const intensity = TRAINING_INTENSITY_COLORS[label];
  if (intensity) return intensity.slice(1).toUpperCase();
  if (['专项', '专项训练', '水上', '水上专项', '水上训练', '测功仪', '排球技术'].includes(label))
    return weeklyReportTheme.blue;
  if (
    [
      '体能',
      '体能训练',
      '力量训练',
      '基础力量',
      '力量耐力',
      '最大力量',
      '速度力量',
      '功能',
      '跑步',
      '骑行',
    ].includes(label)
  )
    return weeklyReportTheme.teal;
  if (['恢复', '恢复训练', '拉伸再生'].includes(label)) return weeklyReportTheme.recovery;
  return weeklyReportTheme.neutral;
}
