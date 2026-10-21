/** 档案编辑、导入及导出共用的技术等级口径；空白仍表示未提供。 */
export const TECHNICAL_LEVELS = ['未定级', '国际级运动健将', '运动健将', '一级运动员', '二级运动员', '三级运动员'] as const;
export function normalizeTechnicalLevel(value: unknown): string {
  const level = String(value ?? '').trim().replace(/\s/g, '');
  if (!level) return '';
  const aliases: Record<string, string> = { '国家运动健将': '运动健将', '国际运动健将': '国际级运动健将', '国际级健将': '国际级运动健将', '一级': '一级运动员', '二级': '二级运动员', '三级': '三级运动员' };
  if (aliases[level]) return aliases[level];
  const match = /^(?:国家)?([一二三])级(?:运动员)?$/.exec(level);
  return match ? `${match[1]}级运动员` : level;
}
export function validTechnicalLevel(value: string) {
  return value === '' || TECHNICAL_LEVELS.some(level => level === normalizeTechnicalLevel(value));
}
