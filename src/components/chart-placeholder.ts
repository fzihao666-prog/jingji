/** 空态不注入示例数值；各图表仅在渲染层保留自身结构。 */
export function chartDisplay<T>(real: T[]): { data: T[]; isPlaceholder: boolean } {
  return { data: real, isPlaceholder: real.length === 0 };
}
