import { beijingDate } from './coach-daily-todos.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PainTrendRow = {
  bodyPart: string;
  painScore: number;
  recordType: string;
  status: string;
  createdAt: string;
};

export type PainTrendPoint = { date: string; painScore: number; recordType: string };

export type PainTrendPart = {
  bodyPart: string;
  latestPainScore: number;
  latestStatus: string;
  latestRecordAt: string;
  series: PainTrendPoint[];
};

export type PainTrend = {
  athleteId: number;
  days: number;
  startDate: string;
  endDate: string;
  parts: PainTrendPart[];
};

// 窗口按北京日定义；起点换算为 UTC 文本，便于与 created_at（UTC 存储）比较。
export function painTrendWindow(now: Date, days: number) {
  const endDate = beijingDate(now);
  const startDate = beijingDate(new Date(now.getTime() - (days - 1) * DAY_MS));
  const startUtc = new Date(Date.parse(`${startDate}T00:00:00+08:00`));
  return {
    startDate,
    endDate,
    startUtcText: startUtc.toISOString().slice(0, 19).replace('T', ' '),
  };
}

// 纯聚合：同部位同日只保留最新一条（created_at 最新，并列取后出现的），供路由与单测共用。
export function buildPainTrend(input: {
  athleteId: number;
  days: number;
  now: Date;
  rows: PainTrendRow[];
}): PainTrend {
  const { startDate, endDate } = painTrendWindow(input.now, input.days);
  const byPart = new Map<string, Map<string, PainTrendRow & { timestamp: number }>>();
  for (const row of input.rows) {
    // created_at 有两种历史格式：SQLite UTC 文本（无时区）与 ISO 带时区；统一解析为 UTC 时间戳。
    const timestamp = /[zZ]|[+-]\d\d:\d\d$/.test(row.createdAt)
      ? Date.parse(row.createdAt)
      : Date.parse(`${row.createdAt.replace(' ', 'T')}Z`);
    if (!Number.isFinite(timestamp)) continue;
    const date = beijingDate(new Date(timestamp));
    if (date < startDate || date > endDate) continue;
    const part = byPart.get(row.bodyPart) ?? new Map<string, PainTrendRow & { timestamp: number }>();
    const existing = part.get(date);
    if (!existing || timestamp >= existing.timestamp) {
      part.set(date, { ...row, timestamp });
    }
    byPart.set(row.bodyPart, part);
  }
  const parts = [...byPart.entries()]
    .map(([bodyPart, daysMap]) => {
      const series = [...daysMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, row]) => ({
          date,
          painScore: row.painScore,
          recordType: row.recordType,
        }));
      const latest = [...daysMap.values()].sort((a, b) => b.timestamp - a.timestamp)[0];
      return {
        bodyPart,
        latestPainScore: latest.painScore,
        latestStatus: latest.status,
        latestRecordAt: new Date(latest.timestamp).toISOString(),
        series,
      };
    })
    .sort(
      (a, b) =>
        b.latestRecordAt.localeCompare(a.latestRecordAt) || a.bodyPart.localeCompare(b.bodyPart)
    );
  return { athleteId: input.athleteId, days: input.days, startDate, endDate, parts };
}
