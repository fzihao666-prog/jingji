/** 年限统一存为年，月份按一年十二个月换算。 */
export function parseTrainingYears(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.normalize('NFKC').replace(/\s/g, '');
  const match = /^(?:(\d+(?:\.\d+)?)(?:年|年整))?(?:(\d+)个?月)?$/.exec(text);
  const numeric = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  if (numeric !== null) return numeric;
  if (!match || (!match[1] && !match[2])) return null;
  if (match[1]?.includes('.') && match[2]) return null;
  return Number(match[1] || 0) + Number(match[2] || 0) / 12;
}

/** 使用自然月，避免闰年和时区导致整年边界偏移。 */
export function trainingYearsFromDate(startDate: string | null, asOf: string): number | null {
  const date = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
  };
  const start = date(startDate || '');
  const end = date(asOf);
  if (!start || !end || start > end) return null;
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
  return Math.max(0, months) / 12;
}
