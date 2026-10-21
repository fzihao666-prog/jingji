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
