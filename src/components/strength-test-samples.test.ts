import { describe, expect, it } from 'vitest';
import { STRENGTH_METRICS } from '../../shared/strength-model';
import type { StrengthTest } from '../types';
import { latestStrengthMetricTests } from './strength-test-samples';

const [first, second] = STRENGTH_METRICS;
function testRow(id: number, athleteId: number, day: number, metrics: StrengthTest['metrics']): StrengthTest {
  return { id, athleteId, testDate: `2026-11-0${day}`, metrics, targets: {}, notes: '', updatedAt: '', updatedBy: '' };
}

describe('体能指标最近有效实测', () => {
  it('保留分次测试的指标、真实零值及每人的最近有效记录', () => {
    const earlier = testRow(1, 1, 1, { [first.key]: 0 });
    const otherMetric = testRow(2, 1, 2, { [second.key]: 70 });
    const teammate = testRow(3, 2, 1, { [first.key]: 100 });
    const invalid = testRow(4, 1, 3, { [first.key]: Infinity });
    expect(latestStrengthMetricTests([earlier, otherMetric, teammate, invalid], first.key)).toEqual([earlier, teammate]);
    expect(latestStrengthMetricTests([earlier, otherMetric, teammate, invalid], second.key)).toEqual([otherMetric]);
  });
});
