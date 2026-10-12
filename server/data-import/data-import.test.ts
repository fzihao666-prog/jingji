import { describe, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';
vi.mock('../core/db.ts', () => ({ db: {} }));
import { parseImportBirthDate } from './data-import.ts';

describe('独立导入出生日期', () => {
  it.each(['1900-01-01', '1990-10-01', '1996-02-29', '1996/2/29', '1996年2月29日'])(
    '保留合法历史生日 %s',
    (input) => {
      const expected = input.startsWith('1996') ? '1996-02-29' : input;
      expect(parseImportBirthDate(input, '2026-10-12')).toBe(expected);
    }
  );
  it('兼容 Excel 日期单元格和日期序列', () => {
    expect(parseImportBirthDate(new Date(1996, 1, 29), '2026-10-12')).toBe('1996-02-29');
    const serial = XLSX.SSF.parse_date_code(35124);
    expect(serial).toMatchObject({ y: 1996, m: 2, d: 29 });
    expect(parseImportBirthDate(35124, '2026-10-12')).toBe('1996-02-29');
  });
  it.each([
    '1900-02-29',
    '1996-02-30',
    '1990-13-01',
    '2026-10-13',
    '2-29',
    '1996-02-29额外文本',
    '',
  ])('拒绝非法或未来生日 %s', (input) => {
    expect(parseImportBirthDate(input, '2026-10-12')).toBe('');
  });
});
