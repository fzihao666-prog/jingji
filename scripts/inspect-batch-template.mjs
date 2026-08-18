import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const artifactModule = 'C:/Users/fanzihao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(artifactModule).href);
const outputDir = resolve('outputs/batch-plan-import-20260731');
const input = await FileBlob.load(resolve(outputDir, '多人四周训练计划导入模板.xlsx'));
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({ kind: 'sheet', include: 'id,name', maxChars: 2000 });
const values = await workbook.inspect({ kind: 'table', sheetId: '多人四周训练计划', range: 'A1:N14', include: 'values', maxChars: 6000 });
const preview = await workbook.render({ sheetName: '多人四周训练计划', range: 'A1:N18', scale: 1.25, format: 'png' });
await fs.writeFile(resolve(outputDir, '模板预览.png'), new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile(resolve(outputDir, 'artifact-inspection.json'), JSON.stringify({ summary, values }, null, 2));
console.log(JSON.stringify({ rendered: resolve(outputDir, '模板预览.png'), summary }, null, 2));
