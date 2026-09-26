import { STRENGTH_METRICS } from '../../shared/strength-model.ts';

export function strengthMetricCode(key: string) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export const strengthMetricKeyByCode = new Map(
  STRENGTH_METRICS.map((metric) => [strengthMetricCode(metric.key), metric.key])
);
