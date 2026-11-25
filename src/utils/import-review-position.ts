export type ImportReviewPosition = {
  batchId: string;
  filter: 'exception' | 'duplicate' | 'overwrite' | 'all';
  query: string;
  page: number;
  reviewGroupPage: number;
  selectedPersonId: number | null;
};

export function readImportReviewPosition(key: string): ImportReviewPosition | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (
      !value ||
      typeof value.batchId !== 'string' ||
      !['exception', 'duplicate', 'overwrite', 'all'].includes(value.filter) ||
      typeof value.query !== 'string' ||
      !Number.isSafeInteger(value.page) ||
      value.page < 0 ||
      !Number.isSafeInteger(value.reviewGroupPage) ||
      value.reviewGroupPage < 0 ||
      !(value.selectedPersonId === null || Number.isSafeInteger(value.selectedPersonId))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function writeImportReviewPosition(key: string, value: ImportReviewPosition) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 浏览器禁用存储时仍可正常校对。 */
  }
}
