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
  it('每列具备必填性、单位、示例；选填项靠后且所有数据列直接可见', async () => {
    const workbook = buildImportWorkbook();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(loaded.getWorksheet('填写说明')!.getCell('B1').value).toBe(IMPORT_TEMPLATE_VERSION);
    for (const [name, original] of UNIFIED_IMPORT_HEADERS) {
      const sheet = loaded.getWorksheet(name)!;
      const fields = importTemplateFields(name);
      expect(fields.map((field) => field.key).sort()).toEqual(original.filter(key => name !== '其他测试' || !['指标代码', '单位'].includes(key)).sort());
      fields.forEach((field, index) => {
        const cell = sheet.getCell(3, index + 1);
        expect(templateHeaderKey(String(cell.value))).toBe(field.key);
        expect(String(cell.value)).toContain(field.requirement);
        if (field.unit !== '无单位') expect(String(cell.value)).toContain(field.unit);
        expect(String(cell.value)).toContain('例：');
        expect(cell.note).toBeTruthy();
        expect(Boolean(sheet.getColumn(index + 1).hidden)).toBe(false);
        expect(sheet.getColumn(index + 1).outlineLevel).toBe(0);
        if (field.requirement === '条件必填' || field.requirement === '必填')
          expect(field.advanced).toBe(false);
      });
      const optionalStart = fields.findIndex((field) => field.requirement === '选填');
      if (optionalStart >= 0)
        expect(fields.slice(optionalStart).every((field) => field.requirement === '选填')).toBe(
          true
        );
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
          .filter((sheet) => !['填写说明', '数据字典', '选项列表'].includes(sheet.name))
          .map((sheet) => sheet.name)
      ).toEqual(names);
    }
    const full = buildImportWorkbook(undefined, { mode: 'export' });
    for (const [name, headers] of UNIFIED_IMPORT_HEADERS)
      expect(full.getWorksheet(name)!.getRow(3).values).toEqual([undefined, ...headers]);
  });
  it('体能与专项模板没有示例业务行，专业列也全部显示', () => {
    for (const workbook of [buildStrengthImportWorkbook(), buildSpecialImportWorkbook()]) {
      const data = workbook.worksheets.find(
        (sheet) => !['填写说明', '数据字典', '选项列表'].includes(sheet.name)
      )!;
      data.eachRow((row, number) => {
        if (number > 3) expect(row.actualCellCount).toBe(0);
      });
      expect(data.columns.every((column) => !column.hidden && column.outlineLevel === 0)).toBe(
        true
      );
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

it('教练其他测试模板选择中文项目，不出现内部代码或单位填写列', () => {
  const workbook = buildImportWorkbook(['其他测试']);
  const sheet = workbook.getWorksheet('其他测试')!;
  const fields = importTemplateFields('其他测试');
  const keys = fields.map(field => field.key);
  expect(keys).not.toContain('指标代码');
  expect(keys).not.toContain('单位');
  const column = keys.indexOf('指标名称') + 1;
  expect(String(sheet.getCell(3, column).value)).toMatch(/^测试项目\n/);
  expect(String(sheet.getCell(3, column).value)).toContain('纵跳（cm）');
  expect(sheet.getCell(4, column).dataValidation.formulae).toEqual(['_JINGJI_TEST_NAMES']);
  const dictionary = workbook.getWorksheet('数据字典')!;
  expect(dictionary.getCell('A1').value).toBe('测试项目（下拉选项）');
  expect(dictionary.getColumn(1).values).toContain('纵跳（cm）');
  expect(workbook.definedNames.model.some(name => name.name === '_JINGJI_TEST_NAMES')).toBe(true);
});

it('所有固定枚举使用可见下拉，长选项使用命名区域，保存后仍有效', async () => {
  const workbook = buildImportWorkbook();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const expected: Record<string, string[]> = {
    运动员基本资料: ['性别', '血型', '技术等级', '运动项目'],
    力量训练组次: ['类别', '身体部位', '训练环境', '强度区间', '完成状态'],
    伤病记录: ['状态', '侧别'],
    竞技评估: ['等级'],
    其他测试: ['测试类型', '侧别'],
    每日恢复: ['状态'],
  };
  for (const [name, keys] of Object.entries(expected)) {
    const fields = importTemplateFields(name);
    for (const key of keys) {
      const column = fields.findIndex(field => field.key === key) + 1;
      const validation = loaded.getWorksheet(name)!.getCell(4, column).dataValidation;
      expect(validation.type, `${name}/${key}`).toBe('list');
      expect(validation.showErrorMessage).toBe(true);
      expect(validation.errorStyle).toBe('stop');
      expect(String(validation.formulae?.[0]).length).toBeLessThanOrEqual(255);
    }
  }
  for (const name of ['项目', '性别组别', '上午/下午']) {
    const fields = importTemplateFields('专项训练成绩');
    const sheet = buildSpecialImportWorkbook().getWorksheet('专项训练成绩')!;
    expect(sheet.getCell(4, fields.findIndex(field => field.key === name) + 1).dataValidation.type).toBe('list');
  }
});
