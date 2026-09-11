/** 每位运动员先取当日均值，再计算队内总体标准差；只接受真实、有效的0～10分记录。 */
export function summarizeDailyRpe(records: Array<{ athleteId: number; rpe: number | null; sessionDemo?: number }>) {
  const athletes = new Map<number, number[]>();
  for (const record of records) {
    if (record.sessionDemo || record.rpe === null || !Number.isFinite(record.rpe) || record.rpe < 0 || record.rpe > 10) continue;
    const values = athletes.get(record.athleteId) || [];
    values.push(record.rpe);
    athletes.set(record.athleteId, values);
  }
  const values = [...athletes.values()].map((items) => items.reduce((sum, value) => sum + value, 0) / items.length);
  const rpeCount = values.length;
  if (!rpeCount) return { averageRpe: null, stdRpe: null, lowerRpe: null, upperRpe: null, rpeCount };
  const averageRpe = values.reduce((sum, value) => sum + value, 0) / rpeCount;
  const stdRpe = Math.sqrt(values.reduce((sum, value) => sum + (value - averageRpe) ** 2, 0) / rpeCount);
  return { averageRpe, stdRpe, lowerRpe: Math.max(0, averageRpe - stdRpe), upperRpe: Math.min(10, averageRpe + stdRpe), rpeCount };
}
