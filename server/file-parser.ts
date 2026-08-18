/**
 * 文件内容提取工具
 * 支持 Excel、Word、PDF、文本、图片等格式
 */

import * as XLSX from 'exceljs';

/**
 * 提取文件内容
 */
export async function extractFileContent(
  buffer: Buffer,
  mimetype: string,
  filename: string
): Promise<{ content: string; metadata: FileMetadata }> {
  const metadata: FileMetadata = {
    filename,
    mimetype,
    size: buffer.length,
    extractedAt: new Date().toISOString()
  };

  try {
    switch (mimetype) {
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.ms-excel':
        return { content: await extractExcelContent(buffer), metadata };

      case 'application/pdf':
        return { content: await extractPdfContent(buffer), metadata };

      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return { content: await extractWordContent(buffer), metadata };

      case 'text/plain':
      case 'text/markdown':
      case 'text/csv':
        return { content: extractTextContent(buffer), metadata };

      case 'image/jpeg':
      case 'image/png':
      case 'image/webp':
        return { content: extractImagePlaceholder(filename), metadata };

      default:
        // 尝试作为文本读取
        return { content: extractTextContent(buffer), metadata };
    }
  } catch (error) {
    console.error(`[FileParser] 提取文件内容失败 (${filename}):`, error);
    throw new Error(`无法解析文件 ${filename}: ${(error as Error).message}`);
  }
}

/**
 * 提取 Excel 内容
 */
async function extractExcelContent(buffer: Buffer): Promise<string> {
  const workbook = new XLSX.Workbook();
  await workbook.xlsx.load(buffer);

  let content = '';

  workbook.eachSheet((sheet, index) => {
    content += `\n--- 工作表: ${sheet.name} ---\n`;

    sheet.eachRow((row, rowNumber) => {
      const rowValues: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        let value: string;

        if (cell.value === null || cell.value === undefined) {
          value = '';
        } else if (typeof cell.value === 'object') {
          // 处理富文本或公式结果
          if ('richText' in cell.value) {
            value = (cell.value as { richText: Array<{ text: string }> }).richText.map(t => t.text).join('');
          } else if ('result' in cell.value) {
            value = String((cell.value as { result: unknown }).result);
          } else {
            value = JSON.stringify(cell.value);
          }
        } else {
          value = String(cell.value);
        }

        rowValues.push(value);
      });

      // 过滤掉全空行
      if (rowValues.some(v => v.trim())) {
        content += rowValues.join('\t') + '\n';
      }
    });
  });

  return content.trim();
}

/**
 * 提取 PDF 内容
 * 注意：Node.js 环境下需要特殊处理，这里使用简单实现
 */
async function extractPdfContent(buffer: Buffer): Promise<string> {
  // 由于 pdf-parse 在 TypeScript ESM 环境下可能有问题
  // 这里先返回一个占位符，实际使用时可以集成 pdf-parse 或其他库
  // 或者将 PDF 上传给 AI，让 AI 直接处理

  // 尝试简单提取文本（仅适用于文本型 PDF）
  const text = buffer.toString('utf-8');

  // 如果能找到可读文本，返回它
  if (text.includes('%PDF')) {
    // 尝试提取文本流
    const textMatches = text.match(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
    if (textMatches) {
      return textMatches
        .map(m => m.replace(/stream\r?\n/, '').replace(/\r?\nendstream/, ''))
        .join('\n')
        .slice(0, 10000); // 限制长度
    }
  }

  // 如果无法提取，返回说明
  return `[PDF 文件内容提取]\n文件名包含训练相关内容，AI 将直接分析文件。\n文件大小: ${buffer.length} bytes\n建议：如需精确提取，请上传文本或 Word 格式。`;
}

/**
 * 提取 Word 文档内容
 * 注意：mammoth 在 TypeScript ESM 环境下可能有问题
 */
async function extractWordContent(buffer: Buffer): Promise<string> {
  // 尝试简单提取文本
  const text = buffer.toString('utf-8');

  // Word 文档通常包含大量 XML，尝试提取可读文本
  const textMatches = text.match(/<[^[]>>([\s\S]*?)<\/[^[]>>/g);
  if (textMatches) {
    const extracted = textMatches
      .map(m => m.replace(/<[^[]>>/g, '').replace(/<\/[^[]>>/g, ''))
      .filter(t => t.trim().length > 0)
      .join('\n');

    if (extracted.length > 100) {
      return extracted.slice(0, 10000);
    }
  }

  return `[Word 文档内容提取]\n文件名包含训练相关内容，AI 将直接分析文件。\n文件大小: ${buffer.length} bytes\n建议：如需精确提取，请复制文本内容粘贴。`;
}

/**
 * 提取纯文本内容
 */
function extractTextContent(buffer: Buffer): string {
  // 尝试多种编码
  const encodings = ['utf-8', 'gbk', 'gb2312', 'big5'];

  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
      // 如果解码成功且包含合理内容，返回
      if (text.length > 0 && !text.includes('\u0000')) {
        return text.slice(0, 20000); // 限制长度
      }
    } catch {
      continue;
    }
  }

  // 默认使用 utf-8（非严格模式）
  return buffer.toString('utf-8').slice(0, 20000);
}

/**
 * 图片占位符
 * 图片将由 AI 视觉能力直接分析
 */
function extractImagePlaceholder(filename: string): string {
  return `[图片文件: ${filename}]\n\n这是一张训练相关的图片文件。AI 将分析图片中的内容，包括：\n- 训练计划表格\n- 训练数据图表\n- 训练动作示范\n- 手写训练记录\n- 其他训练相关资料\n\n请确保图片清晰可读，以获得最佳分析效果。`;
}

/**
 * 文件元数据
 */
interface FileMetadata {
  filename: string;
  mimetype: string;
  size: number;
  extractedAt: string;
}

/**
 * 支持的文件类型
 */
export const SUPPORTED_FILE_TYPES = [
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx', name: 'Excel 2007+' },
  { mime: 'application/vnd.ms-excel', ext: '.xls', name: 'Excel 97-2003' },
  { mime: 'application/pdf', ext: '.pdf', name: 'PDF' },
  { mime: 'application/msword', ext: '.doc', name: 'Word 97-2003' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx', name: 'Word 2007+' },
  { mime: 'text/plain', ext: '.txt', name: '纯文本' },
  { mime: 'text/markdown', ext: '.md', name: 'Markdown' },
  { mime: 'text/csv', ext: '.csv', name: 'CSV' },
  { mime: 'image/jpeg', ext: '.jpg', name: 'JPEG 图片' },
  { mime: 'image/png', ext: '.png', name: 'PNG 图片' },
  { mime: 'image/webp', ext: '.webp', name: 'WebP 图片' },
];

/**
 * 检查文件类型是否支持
 */
export function isFileTypeSupported(mimetype: string): boolean {
  return SUPPORTED_FILE_TYPES.some(t => t.mime === mimetype);
}

/**
 * 获取支持的文件类型描述
 */
export function getSupportedFileTypesDescription(): string {
  return SUPPORTED_FILE_TYPES.map(t => `${t.name} (${t.ext})`).join('、');
}

export type { FileMetadata };
