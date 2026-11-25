import type { StrengthMetricKey } from '../../shared/strength-model';
import type { StrengthTest } from '../types';

export function latestStrengthMetricTests(tests: StrengthTest[], key: StrengthMetricKey) {
  const latest = new Map<number, StrengthTest>();
  for (const test of tests) {
    const value = test.metrics[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const previous = latest.get(test.athleteId);
    if (!previous || test.testDate > previous.testDate ||
        (test.testDate === previous.testDate && test.id > previous.id)) {
      latest.set(test.athleteId, test);
    }
  }
  return [...latest.values()];
}
