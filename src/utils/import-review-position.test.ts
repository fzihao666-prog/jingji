import { afterEach, expect, it, vi } from 'vitest';
import { readImportReviewPosition, writeImportReviewPosition } from './import-review-position';

afterEach(() => vi.unstubAllGlobals());

it('恢复指定账号项目的草稿位置，不保存业务数据', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const position = {
    batchId: 'draft-1',
    filter: 'exception' as const,
    query: '',
    page: 2,
    reviewGroupPage: 1,
    selectedPersonId: 3,
  };
  writeImportReviewPosition('user-1:ROWING', position);
  expect(readImportReviewPosition('user-1:ROWING')).toEqual(position);
  expect(readImportReviewPosition('user-2:ROWING')).toBeNull();
  expect(readImportReviewPosition('user-1:CANOE')).toBeNull();
});

it('存储不可用、损坏或非法页码不会阻断页面', () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  expect(readImportReviewPosition('key')).toBeNull();
  expect(() =>
    writeImportReviewPosition('key', {
      batchId: 'a',
      filter: 'all',
      query: '',
      page: 0,
      reviewGroupPage: 0,
      selectedPersonId: null,
    })
  ).not.toThrow();
  for (const value of [
    '{',
    JSON.stringify({
      batchId: 'a',
      filter: 'all',
      query: '',
      page: -1,
      reviewGroupPage: 0,
      selectedPersonId: null,
    }),
  ]) {
    vi.stubGlobal('sessionStorage', { getItem: () => value });
    expect(readImportReviewPosition('key')).toBeNull();
  }
});
