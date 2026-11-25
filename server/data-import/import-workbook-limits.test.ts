import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { assertImportWorkbookSize } from './import-workbook-limits.ts';

it('按解压大小限制高压缩率的工作簿', async () => {
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', Buffer.alloc(80 * 1024 * 1024 + 1));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  expect(buffer.length).toBeLessThan(1024 * 1024);
  expect(() => assertImportWorkbookSize(buffer)).toThrow('解压后超过 80 MB');
});

it('实际解压长度超过 ZIP 声明时拒绝文件', async () => {
  const zip = new JSZip();
  zip.file('sheet.xml', 'x'.repeat(4096));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  expect(() => assertImportWorkbookSize(buffer)).not.toThrow();
  const directory = buffer.readUInt32LE(buffer.length - 6);
  buffer.writeUInt32LE(1, 22);
  buffer.writeUInt32LE(1, directory + 24);
  expect(() => assertImportWorkbookSize(buffer)).toThrow('实际解压大小超过声明值');
});
