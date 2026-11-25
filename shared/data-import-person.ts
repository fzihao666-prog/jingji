/** 暂存人员标识由服务端生成；旧批次仅以规范姓名读取，提交时须重新解析。 */
export function dataImportPersonKey(item: {
  rawAthleteName: string;
  payload: Record<string, unknown>;
}): string {
  return typeof item.payload.personKey === 'string'
    ? item.payload.personKey
    : normalizeImportPersonName(item.rawAthleteName);
}

export function normalizeImportPersonName(value: string): string {
  return value.trim().normalize('NFKC').replaceAll('⾬', '雨').replace(/[\s·•]/g, '');
}

/** 已排除全部业务行的人员不再要求确认建档。 */
export function importPersonNeedsConfirmation(
  candidate: { status: string; excluded: boolean; confirmed: boolean; normalizedName: string },
  items: readonly { rawAthleteName: string; payload: Record<string, unknown>; quality: string; resolution: string; itemType: string }[]
): boolean {
  return candidate.status === 'pending' && !candidate.excluded && !candidate.confirmed && items.some(item =>
    item.itemType !== 'invalid_row' && item.itemType !== 'scoring_rule' && item.quality !== 'skipped' &&
    item.resolution !== 'skip' && !item.payload.valueAutoMerged && dataImportPersonKey(item) === candidate.normalizedName
  );
}
