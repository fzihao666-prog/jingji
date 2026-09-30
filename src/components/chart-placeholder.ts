// 固定样本只供图表渲染，禁止传入统计、排名或 API 请求。
export const placeholderTrend = [36, 52, 44, 68, 57, 79, 63];
export const placeholderRatio = [42, 27, 19, 12];

export function chartDisplay<T>(real: T[], sample: T[]): { data: T[]; isPlaceholder: boolean } {
  return real.length > 0
    ? { data: real, isPlaceholder: false }
    : { data: sample, isPlaceholder: true };
}
