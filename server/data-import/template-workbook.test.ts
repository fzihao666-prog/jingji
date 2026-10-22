import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildImportWorkbook } from './template-workbook.ts';
import {
  UNIFIED_IMPORT_HEADERS,
  IMPORT_PURPOSE_SHEETS,
} from '../../shared/data-import-template.ts';
import {
  importTemplateFields,
  templateHeaderKey,
  IMPORT_TEMPLATE_VERSION,
} from '../../shared/import-template-fields.ts';
import {
  buildStrengthImportWorkbook,
  buildSpecialImportWorkbook,
} from './specialized-template-workbooks.ts';

describe('简化导入模板', () => {
  it('每列具备必填性、单位、示例；专业项连续折叠且条件必填可见', async () => {
    const workbook = buildImportWorkbook();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(loaded.getWorksheet('填写说明')!.getCell('B1').value).toBe(IMPORT_TEMPLATE_VERSION);
    for (const [name, original] of UNIFIED_IMPORT_HEADERS) {
      const sheet = loaded.getWorksheet(name)!;
      const fields = importTemplateFields(name);
      expect(fields.map((field) => field.key).sort()).toEqual([...original].sort());
      fields.forEach((field, index) => {
        const cell = sheet.getCell(3, index + 1);
        expect(templateHeaderKey(String(cell.value))).toBe(field.key);
        expect(String(cell.value)).toContain(field.requirement);
        if (field.unit !== '无单位') expect(String(cell.value)).toContain(field.unit);
        expect(String(cell.value)).toContain('例：');
        expect(cell.note).toBeTruthy();
        expect(Boolean(sheet.getColumn(index + 1).hidden)).toBe(field.advanced);
        if (field.requirement === '条件必填' || field.requirement === '必填')
          expect(field.advanced).toBe(false);
      });
      const start = fields.findIndex((field) => field.advanced);
      if (start >= 0) expect(fields.slice(start).every((field) => field.advanced)).toBe(true);
      sheet.eachRow((row, number) => {
        if (number > 3) expect(row.actualCellCount).toBe(0);
      });
    }
  });
  it('分用途仅包含对应表，完整导出保留旧字段顺序和纯表头', () => {
    for (const names of Object.values(IMPORT_PURPOSE_SHEETS)) {
      const workbook = buildImportWorkbook(names);
      expect(
        workbook.worksheets
          .filter((sheet) => !['填写说明', '数据字典'].includes(sheet.name))
          .map((sheet) => sheet.name)
      ).toEqual(names);
    }
    const full = buildImportWorkbook(undefined, { mode: 'export' });
    for (const [name, headers] of UNIFIED_IMPORT_HEADERS)
      expect(full.getWorksheet(name)!.getRow(3).values).toEqual([undefined, ...headers]);
  });
  it('体能与专项模板没有示例业务行，并且可展开专业列', () => {
    for (const workbook of [buildStrengthImportWorkbook(), buildSpecialImportWorkbook()]) {
      const data = workbook.worksheets.find(
        (sheet) => !['填写说明', '数据字典'].includes(sheet.name)
      )!;
      data.eachRow((row, number) => {
        if (number > 3) expect(row.actualCellCount).toBe(0);
      });
      expect(data.columns.some((column) => column.hidden && column.outlineLevel === 1)).toBe(true);
      data.getRow(3).eachCell((cell) => expect(String(cell.value)).toContain('例：'));
    }
  });
  it('已装饰与旧表头均能稳定提取字段名', () => {
    expect(templateHeaderKey('实际重量kg\n必填｜kg｜例：60')).toBe('实际重量kg');
    expect(templateHeaderKey('实际重量kg')).toBe('实际重量kg');
  });
});

it('评估协议在表头直接说明何时填，输入提示解释用途、例子及不知道时怎么办', () => {
  const workbook = buildImportWorkbook(['竞技评估']);
  const sheet = workbook.getWorksheet('竞技评估')!;
  const column =
    importTemplateFields('竞技评估').findIndex((field) => field.key === '评估协议') + 1;
  const header = String(sheet.getCell(3, column).value);
  expect(header).toContain('一般耐力/核心力量评分');
  expect(header).toContain('评分标准');
  expect(header).toContain('队内核心力量评分表（2026版）');
  expect(header).not.toContain('无单位');
  const help = sheet.getCell(4, column).dataValidation.prompt!;
  expect(help).toContain('为什么');
  expect(help).toContain('没有评分标准');
  expect(help).toContain('对应评分都留空');
  expect(help).not.toContain('本队已采用的评分协议名称及版本');
});

it('条件必填显示具体条件，编号和课次不只标注术语', () => {
  const sheet = buildImportWorkbook(['训练课次']).getWorksheet('训练课次')!;
  const headers = (sheet.getRow(3).values as ExcelJS.CellValue[]).slice(1).map(String);
  expect(headers.find((value) => value.startsWith('课次序号\n'))).toContain(
    '同一人同一天有多次训练'
  );
  expect(headers.find((value) => value.startsWith('姓名\n'))).toContain('没有系统编号');
});
