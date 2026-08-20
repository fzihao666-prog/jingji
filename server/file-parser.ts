/**
 * 将训练计划文件转换为可交给 AI 的真实输入。
 * 这里只做无业务规则的内容提取，不猜测周数、表头或训练字段。
 */

import ExcelJS from 'exceljs';
import * as mammoth from 'mammoth';

export interface FileMetadata {
  filename: string;
  mimetype: string;
  size: number;
  extractedAt: string;
  extractionMethod: 'excel-cells' | 'pdf-text' | 'docx-text' | 'plain-text' | 'vision';
  sheetCount?: number;
  pageCount?: number;
  chunkCount?: number;
  sections?: Array<{
    name: string;
    chunkCount: number;
    characterCount: number;
  }>;
  warnings: string[];
}

export interface PreparedAITextChunk {
  id: string;
  label: string;
  content: string;
  sectionName: string;
  order: number;
}

export type PreparedAIFile =
  | { kind: 'text'; content: string; chunks: PreparedAITextChunk[]; metadata: FileMetadata }
  | { kind: 'image'; dataUrl: string; metadata: FileMetadata };

const MAX_EXTRACTED_CHARACTERS = 120_000;
const MAX_CHUNK_CHARACTERS = 30_000;

export async function prepareAITrainingPlanFile(
  buffer: Buffer,
  mimetype: string,
  filename: string
): Promise<PreparedAIFile> {
  const effectiveMimetype = resolveFileMimetype(mimetype, filename);
  const baseMetadata = {
    filename,
    mimetype: effectiveMimetype,
    size: buffer.length,
    extractedAt: new Date().toISOString(),
    warnings: [] as string[]
  };

  try {
    if (effectiveMimetype.startsWith('image/')) {
      return {
        kind: 'image',
        dataUrl: `data:${effectiveMimetype};base64,${buffer.toString('base64')}`,
        metadata: { ...baseMetadata, extractionMethod: 'vision' }
      };
    }

    if (effectiveMimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const extracted = await extractExcelContent(buffer);
      return {
        kind: 'text',
        content: extracted.content,
        chunks: extracted.chunks,
        metadata: {
          ...baseMetadata,
          extractionMethod: 'excel-cells',
          sheetCount: extracted.sheetCount,
          chunkCount: extracted.chunks.length,
          sections: extracted.sections,
          warnings: extracted.warnings
        }
      };
    }

    if (effectiveMimetype === 'application/vnd.ms-excel') {
      throw new Error('暂不支持旧版 .xls，请先在 Excel 中另存为 .xlsx 后再导入');
    }

    if (effectiveMimetype === 'application/pdf') {
      const extracted = await extractPdfContent(buffer);
      return {
        kind: 'text',
        content: extracted.content,
        chunks: extracted.chunks,
        metadata: {
          ...baseMetadata,
          extractionMethod: 'pdf-text',
          pageCount: extracted.pageCount,
          chunkCount: extracted.chunks.length,
          sections: sectionSummary(extracted.chunks),
          warnings: extracted.warnings
        }
      };
    }

    if (effectiveMimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const extracted = await mammoth.extractRawText({ buffer });
      const content = normalizeText(extracted.value);
      if (!content) throw new Error('Word 文档中没有识别到可读文字');
      const warnings = extracted.messages.map((message) => message.message);
      const chunks = chunkText(content, 'Word 文档');
      return {
        kind: 'text',
        content: previewText(content),
        chunks,
        metadata: {
          ...baseMetadata,
          extractionMethod: 'docx-text',
          chunkCount: chunks.length,
          sections: sectionSummary(chunks),
          warnings: batchWarnings(content, warnings)
        }
      };
    }

    if (effectiveMimetype === 'application/msword') {
      throw new Error('暂不支持旧版 .doc，请先另存为 .docx 后再导入');
    }

    if (['text/plain', 'text/markdown', 'text/csv'].includes(effectiveMimetype)) {
      const warnings: string[] = [];
      const content = extractTextContent(buffer);
      if (!content) throw new Error('文件中没有识别到可读文字');
      const chunks = chunkText(content, '文本内容');
      return {
        kind: 'text',
        content: previewText(content),
        chunks,
        metadata: {
          ...baseMetadata,
          extractionMethod: 'plain-text',
          chunkCount: chunks.length,
          sections: sectionSummary(chunks),
          warnings: batchWarnings(content, warnings)
        }
      };
    }

    throw new Error(`不支持的文件类型：${effectiveMimetype || '未知类型'}`);
  } catch (error) {
    console.error(`[FileParser] 解析失败 (${filename}):`, error);
    throw new Error(`无法解析文件 ${filename}：${error instanceof Error ? error.message : '未知错误'}`);
  }
}

async function extractExcelContent(buffer: Buffer): Promise<{
  content: string;
  chunks: PreparedAITextChunk[];
  sections: FileMetadata['sections'];
  sheetCount: number;
  warnings: string[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  const sections: string[] = [];
  const chunks: PreparedAITextChunk[] = [];
  const formulaWarnings: Array<{ sheetName: string; count: number }> = [];

  workbook.eachSheet((sheet) => {
    const rows: string[] = [`## 工作表：${sheet.name}`];
    let formulaWithoutResult = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value && (!('result' in cell.value) || cell.value.result === null || cell.value.result === undefined)) {
          formulaWithoutResult += 1;
        }
        const value = formatExcelValue(cell.value);
        if (value) cells.push(`${sheet.getColumn(columnNumber).letter}${rowNumber}=${value}`);
      });
      if (cells.length) rows.push(cells.join(' | '));
    });
    if (rows.length > 1) {
      const section = rows.join('\n');
      sections.push(section);
      chunks.push(...chunkText(section, sheet.name, sheet.name, chunks.length));
    }
    if (formulaWithoutResult > 0) {
      formulaWarnings.push({ sheetName: sheet.name, count: formulaWithoutResult });
    }
  });

  if (!sections.length) throw new Error('Excel 中没有识别到非空单元格');
  const joined = sections.join('\n\n');
  const formulaWarningText = formulaWarnings.length
    ? [`${formulaWarnings.length}个工作表共有${formulaWarnings.reduce((sum, item) => sum + item.count, 0)}个公式单元格没有缓存结果；系统已保留其他可读文字和数值，相关公式结果请人工核对`]
    : [];
  const warnings = batchWarnings(joined, formulaWarningText);
  return {
    content: previewText(joined),
    chunks,
    sections: sectionSummary(chunks),
    sheetCount: workbook.worksheets.length,
    warnings
  };
}

function formatExcelValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value).trim();
  if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
  if ('formula' in value && (!('result' in value) || value.result === null || value.result === undefined)) return '';
  if ('result' in value) return String(value.result ?? '').trim();
  if ('text' in value) return String(value.text ?? '').trim();
  return JSON.stringify(value);
}

async function extractPdfContent(buffer: Buffer): Promise<{
  content: string;
  chunks: PreparedAITextChunk[];
  pageCount: number;
  warnings: string[];
}> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false
  }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push(`## 第 ${pageNumber} 页\n${text}`);
  }

  const normalized = normalizeText(pages.join('\n\n'));
  if (normalized.length < 20) {
    throw new Error('PDF 中没有足够的可读文字，可能是扫描件；请将相关页面导出为清晰的 PNG/JPG 图片后导入');
  }
  const warnings: string[] = [];
  const chunks = chunkText(normalized, 'PDF 文档');
  return {
    content: previewText(normalized),
    chunks,
    pageCount: document.numPages,
    warnings: batchWarnings(normalized, warnings)
  };
}

function extractTextContent(buffer: Buffer): string {
  for (const encoding of ['utf-8', 'gbk', 'gb18030', 'big5']) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(buffer);
      if (decoded && !decoded.includes('\u0000')) return normalizeText(decoded);
    } catch {
      // 继续尝试下一种编码。
    }
  }
  return normalizeText(buffer.toString('utf8'));
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function previewText(value: string): string {
  return value.slice(0, MAX_EXTRACTED_CHARACTERS);
}

function batchWarnings(value: string, warnings: string[]): string[] {
  const result = [...warnings];
  if (value.length > MAX_EXTRACTED_CHARACTERS) {
    result.push(`文件文字超过 ${MAX_EXTRACTED_CHARACTERS.toLocaleString()} 字，已自动拆分为多个批次完整识别，不再截断后半部分`);
  }
  return [...new Set(result)];
}

function chunkText(
  value: string,
  label: string,
  sectionName = label,
  startOrder = 0
): PreparedAITextChunk[] {
  const normalized = normalizeText(value);
  const sheetHeader = `## 工作表：${sectionName}`;
  const body = normalized.startsWith(sheetHeader)
    ? normalized.slice(sheetHeader.length).replace(/^\n+/, '')
    : normalized;
  const lines = body.split('\n');
  const parts: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    current = '';
  };

  for (const line of lines) {
    if (line.length > MAX_CHUNK_CHARACTERS) {
      pushCurrent();
      for (let offset = 0; offset < line.length; offset += MAX_CHUNK_CHARACTERS) {
        parts.push(line.slice(offset, offset + MAX_CHUNK_CHARACTERS));
      }
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MAX_CHUNK_CHARACTERS) pushCurrent();
    current = current ? `${current}\n${line}` : line;
  }
  pushCurrent();

  return parts.map((part, index) => ({
    id: `chunk-${startOrder + index + 1}`,
    label: parts.length > 1 ? `${label} · 第${index + 1}/${parts.length}批` : label,
    sectionName,
    order: startOrder + index,
    content: `${sheetHeader}\n${part}`
  }));
}

function sectionSummary(chunks: PreparedAITextChunk[]): NonNullable<FileMetadata['sections']> {
  const sections = new Map<string, { name: string; chunkCount: number; characterCount: number }>();
  for (const chunk of chunks) {
    const current = sections.get(chunk.sectionName) || { name: chunk.sectionName, chunkCount: 0, characterCount: 0 };
    current.chunkCount += 1;
    current.characterCount += chunk.content.length;
    sections.set(chunk.sectionName, current);
  }
  return [...sections.values()];
}

export const SUPPORTED_FILE_TYPES = [
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx', name: 'Excel' },
  { mime: 'application/pdf', ext: '.pdf', name: 'PDF' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx', name: 'Word' },
  { mime: 'text/plain', ext: '.txt', name: '纯文本' },
  { mime: 'text/markdown', ext: '.md', name: 'Markdown' },
  { mime: 'text/csv', ext: '.csv', name: 'CSV' },
  { mime: 'image/jpeg', ext: '.jpg', name: 'JPEG 图片' },
  { mime: 'image/jpeg', ext: '.jpeg', name: 'JPEG 图片' },
  { mime: 'image/png', ext: '.png', name: 'PNG 图片' },
  { mime: 'image/webp', ext: '.webp', name: 'WebP 图片' }
];

function resolveFileMimetype(mimetype: string, filename: string): string {
  if (SUPPORTED_FILE_TYPES.some((type) => type.mime === mimetype)) return mimetype;
  const lowerName = filename.toLowerCase();
  return SUPPORTED_FILE_TYPES.find((type) => lowerName.endsWith(type.ext))?.mime || mimetype;
}

export function isFileTypeSupported(mimetype: string, filename = ''): boolean {
  return SUPPORTED_FILE_TYPES.some((type) => type.mime === resolveFileMimetype(mimetype, filename));
}

export function getSupportedFileTypesDescription(): string {
  return SUPPORTED_FILE_TYPES.map((type) => `${type.name} (${type.ext})`).join('、');
}
