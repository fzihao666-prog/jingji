import { inflateRawSync } from 'node:zlib';

const MAX_EXPANDED_BYTES = 80 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4096;

/** SheetJS 会一次性解压整个 XLSX，先核对实际解压大小与 ZIP 目录。 */
export function assertImportWorkbookSize(buffer: Buffer) {
  if (buffer.length > MAX_EXPANDED_BYTES) throw new Error('Excel 文件超过 80 MB。');
  if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50 || buffer[2] >= 9 || buffer[3] >= 9) return;

  const invalid = () => new Error('Excel 压缩包结构无效或使用了不支持的 ZIP 格式。');
  if (buffer.readUInt32LE(0) !== 0x04034b50) throw invalid();
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length ||
      end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length ||
      buffer.readUInt32LE(end + 4) !== 0) throw invalid();

  const entries = buffer.readUInt16LE(end + 10);
  let directory = buffer.readUInt32LE(end + 16);
  if (entries !== buffer.readUInt16LE(end + 8) || entries > MAX_ZIP_ENTRIES ||
      directory + buffer.readUInt32LE(end + 12) !== end) throw invalid();

  const directoryStart = directory;
  let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (directory + 46 > end || buffer.readUInt32LE(directory) !== 0x02014b50) throw invalid();
    const compressed = buffer.readUInt32LE(directory + 20);
    const size = buffer.readUInt32LE(directory + 24);
    const local = buffer.readUInt32LE(directory + 42);
    const centralExtra = directory + 46 + buffer.readUInt16LE(directory + 28);
    const centralExtraEnd = centralExtra + buffer.readUInt16LE(directory + 30);
    const next = centralExtraEnd + buffer.readUInt16LE(directory + 32);
    if (next > end || local + 30 > directoryStart || buffer.readUInt32LE(local) !== 0x04034b50)
      throw invalid();

    const flags = buffer.readUInt16LE(local + 6);
    const method = buffer.readUInt16LE(local + 8);
    const localExtra = local + 30 + buffer.readUInt16LE(local + 26);
    const start = localExtra + buffer.readUInt16LE(local + 28);
    const finish = start + compressed;
    if (finish > directoryStart || flags !== buffer.readUInt16LE(directory + 8) ||
        flags & 0x2041 || method !== buffer.readUInt16LE(directory + 10)) throw invalid();

    // ZIP64 扩展可覆盖解析器读取的长度，普通 Excel 导入只接受 ZIP32。
    for (const [from, to] of [[centralExtra, centralExtraEnd], [localExtra, start]]) {
      for (let extra = from; extra < to;) {
        if (extra + 4 > to || buffer.readUInt16LE(extra) === 1) throw invalid();
        extra += 4 + buffer.readUInt16LE(extra + 2);
        if (extra > to) throw invalid();
      }
    }

    const localCompressed = buffer.readUInt32LE(local + 18);
    const localSize = buffer.readUInt32LE(local + 22);
    const descriptor = Boolean(flags & 8);
    if ((localCompressed !== compressed && !(descriptor && localCompressed === 0)) ||
        (localSize !== size && !(descriptor && localSize === 0))) throw invalid();
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('Excel 解压后超过 80 MB。');

    if (method === 8) {
      try {
        const output = inflateRawSync(buffer.subarray(start, finish), { maxOutputLength: Math.max(1, size) });
        if (output.length !== size) throw invalid();
      } catch {
        throw new Error('Excel 压缩条目无效或实际解压大小超过声明值。');
      }
    } else if (method !== 0 || compressed !== size || localCompressed !== compressed) {
      throw invalid();
    }

    if (descriptor) {
      if (finish + 12 > directoryStart) throw invalid();
      const lengths = finish + (buffer.readUInt32LE(finish) === 0x08074b50 ? 8 : 4);
      if (lengths + 8 > directoryStart || buffer.readUInt32LE(lengths) !== compressed ||
          buffer.readUInt32LE(lengths + 4) !== size) throw invalid();
    }
    directory = next;
  }
  if (directory !== end) throw invalid();
}
