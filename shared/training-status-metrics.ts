export type TrainingStatusMetricInput = {
  key: 'duration' | 'load' | 'sessionCount' | 'distance';
  label: string;
  unit: string;
  personalValue: number | null;
  teamValues: number[];
};

function mean(values: number[]) {
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    : null;
}

function difference(personalValue: number | null, teamMean: number | null) {
  return personalValue === null || teamMean === null
    ? null
    : Math.round((personalValue - teamMean) * 10) / 10;
}

export function trainingStatusMetric(input: TrainingStatusMetricInput) {
  const teamMean = input.teamValues.length >= 2 ? mean(input.teamValues) : null;
  const differenceValue = difference(input.personalValue, teamMean);
  return {
    ...input,
    teamMean,
    difference: differenceValue,
    differencePercent:
      differenceValue === null || teamMean === null || teamMean === 0
        ? null
        : Math.round((differenceValue / teamMean) * 1000) / 10,
    teamSampleCount: teamMean === null ? null : input.teamValues.length,
  };
}
