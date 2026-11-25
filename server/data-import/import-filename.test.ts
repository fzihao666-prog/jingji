import { describe, expect, it } from 'vitest';
import { normalizeImportFilename } from './import-filename.ts';

describe('导入文件名编码恢复', () => {
  it('恢复上传时被按 Latin-1 解码的 UTF-8 文件名', () => {
    const filename = '赛艇训练数据_2026年10月.xlsx';
    const garbled = Buffer.from(filename, 'utf8').toString('latin1');
    expect(normalizeImportFilename(garbled)).toBe(filename);
    expect(normalizeImportFilename(normalizeImportFilename(garbled))).toBe(filename);
  });

  it.each([
    '训练数据.xlsx',
    'training_2026.xls',
    'résultats.xlsx',
    'Müller.xlsx',
    '测试😀.xlsx',
    '损坏�.xlsx',
    '',
  ])('保留正常或不可恢复的文件名 %s', (filename) => {
    expect(normalizeImportFilename(filename)).toBe(filename);
  });
});
