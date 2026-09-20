import { describe, expect, it } from 'vitest';
import { trainingStatusMetric } from './training-status-metrics.js';

describe('trainingStatusMetric', () => {
  it('在个人指标缺失时不计算差异', () => {
    expect(
      trainingStatusMetric({
        key: 'duration',
        label: '训练时长',
        unit: '分钟',
        personalValue: null,
        teamValues: [10, 14],
      })
    ).toMatchObject({
      teamMean: 12,
      difference: null,
      differencePercent: null,
      teamSampleCount: 2,
    });
  });

  it('在团队均值为零时不计算差异率', () => {
    expect(
      trainingStatusMetric({
        key: 'load',
        label: '训练负荷',
        unit: 'AU',
        personalValue: 12,
        teamValues: [0, 0],
      })
    ).toMatchObject({ teamMean: 0, difference: 12, differencePercent: null, teamSampleCount: 2 });
  });
});
