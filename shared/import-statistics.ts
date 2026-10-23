import { dataImportPersonKey } from './data-import-person.js';

export type ImportStatistics = {
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  excludedCount: number;
  unfilledRows: number;
  errorCount: number;
  mergedCount: number;
};

type StatisticsItem = {
  rawAthleteName: string;
  itemType: string;
  quality: string;
  resolution: string;
  payload: Record<string, unknown>;
  conflict: { exists: boolean; identical: boolean } | null;
};

/** 每条派生业务记录只归入一种结果；自动合并来源和未填报源行单列。 */
export function importStatistics(items: readonly StatisticsItem[], excludedPeople: ReadonlySet<string> = new Set(), unfilledRows = 0): ImportStatistics {
  const counts: ImportStatistics = { newCount: 0, updateCount: 0, unchangedCount: 0, excludedCount: 0, unfilledRows, errorCount: 0, mergedCount: 0 };
  for (const item of items) {
    if (item.payload.valueAutoMerged) counts.mergedCount += 1;
    else if (item.resolution === 'skip' || item.quality === 'skipped' || excludedPeople.has(dataImportPersonKey(item))) counts.excludedCount += 1;
    else if (item.quality === 'error' || item.itemType === 'invalid_row') counts.errorCount += 1;
    else if (item.conflict?.identical) counts.unchangedCount += 1;
    else if (item.conflict?.exists) counts.updateCount += 1;
    else counts.newCount += 1;
  }
  return counts;
}
