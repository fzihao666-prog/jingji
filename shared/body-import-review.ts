import { BODY_TEMPLATE_FIELDS } from './data-import-template.js';
import { dataImportPersonKey } from './data-import-person.js';

export const BODY_REVIEW_FIELDS = BODY_TEMPLATE_FIELDS.filter(([, field]) => field !== 'armSpanCm');
export type BodyReviewItem = {
  id: number;
  itemType: string;
  metricCode: string;
  athleteId: number | null;
  rawAthleteName: string;
  eventDate: string;
  payload: Record<string, unknown>;
  resolution: string;
  quality: string;
  sourceSheet: string;
  sourceAddress: string;
};
export function bodyReviewKey(item: BodyReviewItem) {
  return `${item.athleteId ? `id:${item.athleteId}` : dataImportPersonKey(item)}|${item.eventDate}`;
}
export function bodyReviewGroups<T extends BodyReviewItem>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (item.itemType !== 'body_measurement' || item.metricCode !== 'body_composition') continue;
    if (
      item.resolution === 'skip' &&
      !item.payload.bodyMergedInto &&
      !item.payload.bodyMergeDecision
    )
      continue;
    const key = bodyReviewKey(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
export function bodyFieldValues(items: BodyReviewItem[], field: string): number[] {
  return [
    ...new Set(
      items
        .map((item) => item.payload[field])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ),
  ];
}
