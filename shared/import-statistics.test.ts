import { expect, it } from 'vitest';
import { importStatistics } from './import-statistics.js';

it('五类记录互斥；错误、自动合并与未填报单列，排除人员不计入可写入', () => {
  const base = { rawAthleteName: '虚构队员', itemType: 'body_measurement', quality: 'valid', resolution: '', payload: {}, conflict: null };
  const counts = importStatistics([
    base,
    { ...base, conflict: { exists: true, identical: false } },
    { ...base, conflict: { exists: true, identical: true } },
    { ...base, resolution: 'skip' },
    { ...base, quality: 'error' },
    { ...base, quality: 'skipped', payload: { valueAutoMerged: true } },
    { ...base, payload: { personKey: 'excluded' } },
  ], new Set(['excluded']), 3);
  expect(counts).toEqual({ newCount: 1, updateCount: 1, unchangedCount: 1, excludedCount: 2, errorCount: 1, mergedCount: 1, unfilledRows: 3 });
});
