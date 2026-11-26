export type CustomTestTrend = {
  metrics: Array<{ code: string; label: string; unit: string; protocol: string; version: number; projectName?: string; seriesKey?: string }>;
  metricCode: string | null;
  points: Array<{ date: string; value: number }>;
};
