/** 仅恢复能无损往返的 UTF-8/Latin-1 错码，保留正常中文及不可恢复的文件名。 */
export function normalizeImportFilename(filename: string): string {
  if (!/[\u0080-\u00ff]/u.test(filename) || /[^\u0000-\u00ff]/u.test(filename)) return filename;
  const bytes = Buffer.from(filename, 'latin1');
  const decoded = bytes.toString('utf8');
  if (decoded.includes('\ufffd') || !Buffer.from(decoded, 'utf8').equals(bytes)) return filename;
  return decoded;
}
