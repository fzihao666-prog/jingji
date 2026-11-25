export type BodyCompositionTrendRecord = {
  measurementDate: string;
  skeletalMuscleKg: number | null;
  bodyFatPct: number | null;
  totalBodyWaterKg: number | null;
};

export type BodyCompositionTrendKey =
  | 'skeletalMuscleKg'
  | 'bodyFatPct'
  | 'totalBodyWaterKg';

export type BodyCompositionTrendPoint = {
  measurementDate: string;
  value: number;
};

export type BodyCompositionTrend = {
  key: BodyCompositionTrendKey;
  label: string;
  unit: string;
  points: BodyCompositionTrendPoint[];
  latestValue: number | null;
  deltaFromPrevious: number | null;
};

const TREND_DEFINITIONS: ReadonlyArray<Pick<BodyCompositionTrend, 'key' | 'label' | 'unit'>> = [
  { key: 'skeletalMuscleKg', label: '骨骼肌量', unit: 'kg' },
  { key: 'bodyFatPct', label: '体脂率', unit: '%' },
  { key: 'totalBodyWaterKg', label: '体水分', unit: 'kg' },
];

const roundToOne = (value: number) => Math.round(value * 10) / 10;

export function buildBodyCompositionTrends(
  records: readonly BodyCompositionTrendRecord[],
): BodyCompositionTrend[] {
  const sortedRecords = [...records].sort((left, right) =>
    left.measurementDate.localeCompare(right.measurementDate),
  );

  return TREND_DEFINITIONS.map(({ key, label, unit }) => {
    const points = sortedRecords
      .map((record) => ({ measurementDate: record.measurementDate, value: record[key] }))
      .filter((point): point is BodyCompositionTrendPoint =>
        point.value !== null && Number.isFinite(point.value),
      )
      .slice(-6);
    const latestValue = points.at(-1)?.value ?? null;
    const previousValue = points.at(-2)?.value ?? null;

    return {
      key,
      label,
      unit,
      points,
      latestValue,
      deltaFromPrevious:
        latestValue === null || previousValue === null ? null : roundToOne(latestValue - previousValue),
    };
  });
}
