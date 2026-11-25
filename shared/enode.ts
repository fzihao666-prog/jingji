export type EnodeKind = 'measurement' | 'wellness' | 'sessionRpe';
export const ENODE_KINDS: Record<EnodeKind, string> = {
  measurement: '动作测量',
  wellness: '每日状态',
  sessionRpe: '训练 RPE',
};
export const ENODE_METRICS = {
  meanVelocity: { label: '平均速度', unit: 'm/s', kind: 'measurement' },
  peakVelocity: { label: '峰值速度', unit: 'm/s', kind: 'measurement' },
  meanPower: { label: '平均功率', unit: 'W', kind: 'measurement' },
  peakPower: { label: '峰值功率', unit: 'W', kind: 'measurement' },
  jumpHeight: { label: '跳跃高度', unit: 'm', kind: 'measurement' },
  distance: { label: '动作位移', unit: 'm', kind: 'measurement' },
  propulsiveDistance: { label: '推进位移', unit: 'm', kind: 'measurement' },
  rsi: { label: 'RSI', unit: '', kind: 'measurement' },
  wellnessScore: { label: '状态总分', unit: '分', kind: 'wellness' },
  stress: { label: '压力', unit: '分', kind: 'wellness' },
  mood: { label: '心情', unit: '分', kind: 'wellness' },
  sleep: { label: '睡眠评分', unit: '分', kind: 'wellness' },
  soreness: { label: '酸痛', unit: '分', kind: 'wellness' },
  fatigue: { label: '疲劳', unit: '分', kind: 'wellness' },
  sessionRpe: { label: '课次 RPE', unit: '', kind: 'sessionRpe' },
  trainingLoad: { label: '来源训练负荷', unit: 'AU', kind: 'sessionRpe' },
  durationMin: { label: '训练时长', unit: 'min', kind: 'sessionRpe' },
  sessionCount: { label: '来源课次数', unit: '次', kind: 'sessionRpe' },
  volume: { label: '来源训练量', unit: '（来源单位未声明）', kind: 'sessionRpe' },
} as const;
export type EnodeMetric = keyof typeof ENODE_METRICS;
export type EnodeValues = Partial<Record<EnodeMetric, number | null>>;
export type EnodeImportResult = {
  filename: string;
  kind: EnodeKind | null;
  inserted: number;
  skipped: number;
  failed: number;
  issues: { row: number; message: string }[];
  unresolvedNames: string[];
};
export type EnodeRecord = {
  id: number;
  recordedAt: string;
  exercise: string;
  side: string;
  values: EnodeValues;
  sourceRow: number;
  filename: string;
  context: Record<string, string>;
};
export type EnodeQuery = {
  athleteId: number;
  project: string;
  kind: EnodeKind;
  from: string;
  to: string;
  exercise?: string;
  metric: EnodeMetric;
  side?: string;
  page: number;
};
export type EnodeData = {
  selectedExercise: string;
  selectedSide: string;
  exercises: { name: string; count: number; latest: string }[];
  sides: string[];
  daily: { date: string; mean: number; min: number; max: number; count: number }[];
  points: { date: string; value: number }[];
  pointCount: number;
  records: EnodeRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type EnodePersonDecision =
  { action: 'link'; athleteId: number } | { action: 'create'; team: string } | { action: 'skip' };
export type EnodePreview = {
  people: {
    key: string;
    name: string;
    counts: Partial<Record<EnodeKind, number>>;
    candidates: { id: number; name: string; team: string }[];
  }[];
  teams: string[];
  files: { filename: string; error?: string }[];
};
