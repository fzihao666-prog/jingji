import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildImportWorkbook } from '../server/data-import/template-workbook.ts';
import { buildStrengthImportWorkbook, buildSpecialImportWorkbook } from '../server/data-import/specialized-template-workbooks.ts';

// 与在线下载、统一导出共用字段及说明，不读取人员文件或正式数据库。
if (process.argv.includes('--filled'))
  throw new Error('此构建器只生成空白模板，不填充历史人员数据。');
const directory = resolve('public/templates');
await mkdir(directory, { recursive: true });
const path = resolve(directory, '竞迹统一数据导入模板.xlsx');
await buildImportWorkbook().xlsx.writeFile(path);
console.log(`已生成统一数据导入模板：${path}`);

await buildStrengthImportWorkbook().xlsx.writeFile(resolve(directory, '竞迹体能训练数据导入模板.xlsx'));
await buildSpecialImportWorkbook().xlsx.writeFile(resolve(directory, '竞迹专项训练导入模板.xlsx'));
console.log('已生成体能训练结果与专项训练成绩空白模板');
