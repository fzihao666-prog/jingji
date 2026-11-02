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
  IMPORT_TEMPLATE_VERSION_NAME,
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
      const fields = importTemplateFields(name).filter(field=>field.key!=='系统运动员编号');
      expect(fields.map((field) => field.key).sort()).toEqual(original.filter(key => key !== '系统运动员编号' && (name !== '其他测试' || !['指标代码', '单位'].includes(key))).sort());
      fields.forEach((field, index) => {
        const cell = sheet.getCell(3, index + 1);
        expect(templateHeaderKey(String(cell.value))).toBe(field.key);
        expect(String(cell.value)).toContain(field.requirement);
        if (field.unit !== '无单位') expect(String(cell.value)).toContain(field.unit);
        expect(String(cell.value)).toContain('例：');
        expect(cell.note).toBeUndefined();
        const validation = sheet.getCell(4, index + 1).dataValidation;
        expect(Boolean(validation.showInputMessage)).toBe(false);
        expect(validation.prompt).toBeUndefined();
        expect(validation.promptTitle).toBeUndefined();
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

it('评估协议保留表头通俗解释，不弹出提示或批注', () => {
  const workbook = buildImportWorkbook(['竞技评估']);
  const sheet = workbook.getWorksheet('竞技评估')!;
  const column =
    importTemplateFields('竞技评估').filter(field=>field.key!=='系统运动员编号').findIndex((field) => field.key === '评估协议') + 1;
  const header = String(sheet.getCell(3, column).value);
  expect(header).toContain('一般耐力/核心力量评分');
  expect(header).toContain('评分标准');
  expect(header).toContain('队内核心力量评分表（2026版）');
  expect(header).not.toContain('无单位');
  expect(sheet.getCell(4, column).dataValidation.prompt).toBeUndefined();
  expect(sheet.getCell(4, column).dataValidation.showInputMessage).toBe(false);
  expect(sheet.getCell(3, column).note).toBeUndefined();
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
  const fields = importTemplateFields('其他测试').filter(field=>field.key!=='系统运动员编号');
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
    运动员基本资料: ['性别', '血型', '技术等级'],
    力量训练组次: ['类别', '身体部位', '训练环境', '完成状态'],
    伤病记录: ['状态', '侧别'],
    竞技评估: ['等级'],
    其他测试: ['测试类型', '侧别'],
    每日恢复: ['状态'],
  };
  for (const [name, keys] of Object.entries(expected)) {
    const fields = importTemplateFields(name).filter(field=>field.key!=='系统运动员编号');
    for (const key of keys) {
      const column = fields.findIndex(field => field.key === key) + 1;
      const validation = loaded.getWorksheet(name)!.getCell(4, column).dataValidation;
      expect(validation.type, `${name}/${key}`).toBe('list');
      expect(validation.showErrorMessage).toBe(true);
      expect(validation.errorStyle).toBe('stop');
      expect(String(validation.formulae?.[0]).length).toBeLessThanOrEqual(255);
    }
  }
  const intensityColumn = importTemplateFields('力量训练组次').filter(field=>field.key!=='系统运动员编号').findIndex(field=>field.key==='强度区间')+1;
  expect(loaded.getWorksheet('力量训练组次')!.getCell(4,intensityColumn).dataValidation.type).not.toBe('list');
  for (const name of ['项目', '性别组别', '上午/下午']) {
    const fields = importTemplateFields('专项训练成绩');
    const sheet = buildSpecialImportWorkbook().getWorksheet('专项训练成绩')!;
    expect(sheet.getCell(4, fields.findIndex(field => field.key === name) + 1).dataValidation.type).toBe('list');
  }
});

it.each(['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM', 'CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])('%s在线统一模板的活动选项遵守项目配置且不要求距离或艇型', async project => {
  const { projectRules, ACTIVITY_LABELS } = await import('../../shared/sport-rules.ts');
  const rules = projectRules(project)!;
  expect(rules).toBeTruthy();
  const workbook = buildImportWorkbook(undefined, { project });
  const fields = importTemplateFields('训练课次').filter(field=>field.key!=='系统运动员编号');
  const index = fields.findIndex(field => field.key === '训练活动') + 1;
  const sheet = workbook.getWorksheet('训练课次')!;
  const formula = String(sheet.getCell(4, index).dataValidation.formulae?.[0]);
  expect(formula).toBeTruthy();
  expect(formula).toBe('\"' + rules.activities.map(activity => ACTIVITY_LABELS[activity]).join(',') + '\"');
  expect(fields.some(field => field.key === '艇型')).toBe(false);
  expect(fields.find(field => field.key === '距离千米')?.requirement).toBe('条件必填');
  expect(sheet.getRow(4).actualCellCount).toBe(0);
});

it('运动员模板不重复填写项目，保留姓名与所属队伍及自动带入说明', () => {
  const fields=importTemplateFields('运动员基本资料');
  expect(fields.map(field=>field.key)).not.toContain('运动项目');
  expect(fields.map(field=>field.key)).toContain('所属队伍');
  const workbook=buildImportWorkbook(['运动员基本资料']);
  const sheet=workbook.getWorksheet('运动员基本资料')!;
  const headers=Array.from({length:sheet.columnCount},(_,i)=>String(sheet.getCell(3,i+1).value || '').split('\n')[0]);
  expect(headers).not.toContain('运动项目');
  expect(headers).toContain('所属队伍');
});

it('所有模板按业务表、填写说明、数据字典排列，保存重开仍保持顺序及版本命名区域', async () => {
  const books=[buildImportWorkbook(),buildImportWorkbook(undefined,{mode:'export'}),...Object.values(IMPORT_PURPOSE_SHEETS).map(names=>buildImportWorkbook(names)),buildStrengthImportWorkbook(),buildSpecialImportWorkbook()];
  for(const book of books) {
    const reloaded=new ExcelJS.Workbook();
    await reloaded.xlsx.load(await book.xlsx.writeBuffer());
    const names=reloaded.worksheets.filter(sheet=>sheet.state==='visible').map(sheet=>sheet.name);
    expect(names[0]).not.toBe('填写说明');
    const dictionary=names.indexOf('数据字典');
    expect(names.indexOf('填写说明')).toBe(dictionary>=0 ? dictionary-1 : names.length-1);
    expect(reloaded.getWorksheet('填写说明')!.getCell('A1').value).toBeTruthy();
    if(book.definedNames.model.some(name=>name.name===IMPORT_TEMPLATE_VERSION_NAME)) expect(reloaded.definedNames.model.some(name=>name.name===IMPORT_TEMPLATE_VERSION_NAME)).toBe(true);
  }
});

it('空白模板没有编号列，预填模板编号保留并隐藏且保存重开后不丢失',async () => {
  for(const includeAthleteId of [false,true]) {
    const book=buildImportWorkbook(['运动员基本资料'],{includeAthleteId});
    const sheet=book.getWorksheet('运动员基本资料')!;
    const headers=(sheet.getRow(3).values as ExcelJS.CellValue[]).slice(1).map(v=>templateHeaderKey(String(v)));
    expect(headers.includes('系统运动员编号')).toBe(includeAthleteId);
    if(includeAthleteId) {sheet.getCell(4,1).value=123;sheet.getCell(4,2).value='合成队员';}
    const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
    const result=loaded.getWorksheet('运动员基本资料')!;
    if(includeAthleteId) {expect(result.getColumn(1).hidden).toBe(true);expect(result.getCell(4,1).value).toBe(123);expect(result.getCell(4,2).value).toBe('合成队员');}
    else expect(templateHeaderKey(String(result.getCell(3,1).value))).toBe('姓名');
  }
});
