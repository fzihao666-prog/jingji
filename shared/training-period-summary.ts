type PeriodRecord = {
  durationMin: number;
  durationReported?: boolean;
  distanceKm: number;
  distanceReported?: boolean;
  srpe: number;
  rpe: number | null;
  status: string;
};

/** 公共档案只汇总已填报事实，不选择任何项目的专业评价模型。 */
export function trainingPeriodSummary(records: PeriodRecord[]) {
  const sessions = records.filter(row => row.status !== 'rest' && row.status !== 'missing');
  return {
    sessions: sessions.length,
    totalDistanceKm: sessions.reduce((sum, row) => sum + (row.distanceReported !== false && Number.isFinite(row.distanceKm) ? row.distanceKm : 0), 0),
    totalSrpe: sessions.reduce((sum, row) => sum + (row.durationReported !== false && row.rpe !== null && Number.isFinite(row.srpe) ? row.srpe : 0), 0),
  };
}
