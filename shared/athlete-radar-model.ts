export type RadarDirection = 'higher_better' | 'lower_better';

export type RadarDimensionDefinition = {
  key:
    | 'rowing_on_water_time'
    | 'rowing_erg_2000_time'
    | 'rowing_erg_5000_time'
    | 'rowing_erg_30min_20spm_split'
    | 'rowing_erg_peak_power'
    | 'relative_squat'
    | 'relative_bench_pull'
    | 'relative_high_pull'
    | 'vertical_jump'
    | 'bench_pull_2min'
    | 'front_plank';
  label: string;
  unit: string;
  direction: RadarDirection;
};

export type RowingRadarDimension = RadarDimensionDefinition;

export const ROWING_RADAR_DIMENSIONS = {
  special: [
  { key: 'rowing_on_water_time', label: '主项水上计时', unit: 's', direction: 'lower_better' },
  { key: 'rowing_erg_2000_time', label: '2000m测功仪', unit: 's', direction: 'lower_better' },
  { key: 'rowing_erg_5000_time', label: '5000m测功仪', unit: 's', direction: 'lower_better' },
  {
    key: 'rowing_erg_30min_20spm_split',
    label: '30分钟20桨频分段',
    unit: 's/500m',
    direction: 'lower_better',
  },
  { key: 'rowing_erg_peak_power', label: '峰值功率', unit: 'W', direction: 'higher_better' },
  ],
  physical: [
  { key: 'relative_squat', label: '相对深蹲', unit: '倍体重', direction: 'higher_better' },
  { key: 'relative_bench_pull', label: '相对卧拉', unit: '倍体重', direction: 'higher_better' },
  { key: 'relative_high_pull', label: '相对高翻/高拉', unit: '倍体重', direction: 'higher_better' },
  { key: 'vertical_jump', label: '纵跳', unit: 'cm', direction: 'higher_better' },
  { key: 'bench_pull_2min', label: '2分钟卧拉', unit: '次', direction: 'higher_better' },
  { key: 'front_plank', label: '前支撑', unit: 's', direction: 'higher_better' },
  ],
} as const satisfies {
  special: readonly RadarDimensionDefinition[];
  physical: readonly RadarDimensionDefinition[];
};

export type RadarComparison = {
  achievedPercent: number | null;
  signedDifference: number | null;
  comparable: boolean;
};

function roundToOne(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function buildRadarComparison(
  direction: RadarDirection,
  currentValue: number | null | undefined,
  referenceValue: number | null | undefined,
): RadarComparison {
  if (
    currentValue == null ||
    referenceValue == null ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(referenceValue) ||
    referenceValue === 0
  ) {
    return { achievedPercent: null, signedDifference: null, comparable: false };
  }

  const achievedPercent =
    direction === 'lower_better'
      ? (referenceValue / currentValue) * 100
      : (currentValue / referenceValue) * 100;
  if (!Number.isFinite(achievedPercent)) {
    return { achievedPercent: null, signedDifference: null, comparable: false };
  }

  return {
    achievedPercent: roundToOne(achievedPercent),
    signedDifference: roundToOne(currentValue - referenceValue),
    comparable: true,
  };
}
