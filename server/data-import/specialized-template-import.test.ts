import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
vi.mock('../core/db.ts', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return { db: new DatabaseSync(':memory:') };
});
vi.mock('../core/permissions.ts', () => ({
  accessibleAthleteIds: () => [1, 2, 3],
  hasAthleteAccess: () => true,
}));
import { db } from '../core/db.ts';
import { initializeDatabase } from '../core/db-initialize.ts';
import {
  parseStrengthImportFile,
  validateStrengthImportRow,
} from '../strength/strength-training-routes.ts';
import { parseSpecialTestWorkbook } from '../special/special-training-routes.ts';
import {
  buildStrengthImportWorkbook,
  buildSpecialImportWorkbook,
} from './specialized-template-workbooks.ts';
import { templateHeaderKey } from '../../shared/import-template-fields.ts';
import type { AuthUser } from '../core/shared-server.ts';
const people = [
  { id: 1, name: '张某', project: 'ROWING', team: 'A队', gender: '男', birthDate: '' },
  { id: 2, name: '李某', project: 'ROWING', team: 'A队', gender: '男', birthDate: '' },
  { id: 3, name: '李某', project: 'ROWING', team: 'B队', gender: '男', birthDate: '' },
];
const user = { id: 1, role: 'SCC' } as AuthUser;
beforeAll(() => {
  initializeDatabase(db, { databasePath: ':memory:', databaseExistedBeforeStartup: false });
  for (const person of people)
    db.prepare(
      'INSERT INTO athletes (id, name, project, team, gender) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, project=excluded.project, team=excluded.team, gender=excluded.gender'
    ).run(person.id, person.name, person.project, person.team, person.gender);
});
afterAll(() => db.close());
function fill(
  workbook: ExcelJS.Workbook,
  name: string,
  values: Record<string, string | number>,
  row = 4
) {
  const sheet = workbook.getWorksheet(name)!;
  sheet.getRow(3).eachCell((cell, column) => {
    const key = templateHeaderKey(String(cell.value));
    if (key in values) sheet.getCell(row, column).value = values[key];
  });
}
async function strength(workbook: ExcelJS.Workbook) {
  return parseStrengthImportFile(
    {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      originalname: '体能.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Express.Multer.File,
    people
  );
}
async function special(workbook: ExcelJS.Workbook) {
  return parseSpecialTestWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), user, 'ROWING');
}
describe('独立简化模板往返', () => {
  it('体能最小实际组次可解析，编号可替代姓名，空验证行不产生记录', async () => {
    const workbook = buildStrengthImportWorkbook();
    fill(workbook, '训练结果数据', {
      系统运动员编号: 1,
      训练日期: '2026-10-01',
      动作: '深蹲',
      实际次数: 6,
      实际重量kg: 0,
    });
    const result = await strength(workbook);
    expect(result.records).toHaveLength(1);
    const row = validateStrengthImportRow(result.records[0], 4, people);
    expect(row.errors).toEqual([]);
    expect(row.actualWeightKg).toBe(0);
    expect(row.athleteId).toBe(1);
  });
  it('体能同动作多组无组次阻断，已有模板组次依旧支持', async () => {
    const workbook = buildStrengthImportWorkbook();
    const values = {
      运动员: '张某',
      训练日期: '2026-10-01',
      动作: '深蹲',
      实际次数: 6,
      实际重量kg: 60,
    };
    fill(workbook, '训练结果数据', values);
    fill(workbook, '训练结果数据', values, 5);
    const result = await strength(workbook);
    expect(
      result.records
        .map((record, index) => validateStrengthImportRow(record, index + 4, people))
        .flatMap((row) => row.errors)
        .join('；')
    ).toContain('组次');
  });
  it('专项单人一轮秒数正确，无组别明确显示未分组', async () => {
    const workbook = buildSpecialImportWorkbook();
    fill(workbook, '专项训练成绩', {
      训练日期: '2026-10-01',
      项目: '赛艇',
      '训练距离(m)': 250,
      '运动员/组合': '张某',
      第1轮: '0:55.15',
    });
    const rows = await special(workbook);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].attemptsMs).toEqual([55150]);
    expect(rows[0].genderGroup).toBe('未分组');
    expect(rows[0].memberAthleteIds).toEqual([1]);
  });
  it('专项同名成员、跨项目及非法非空轮次拒绝，不能丢掉错误成绩', async () => {
    const workbook = buildSpecialImportWorkbook();
    fill(workbook, '专项训练成绩', {
      训练日期: '2026-10-01',
      项目: '赛艇',
      '训练距离(m)': 250,
      '运动员/组合': '张某、李某',
      第1轮: '55.15',
      第2轮: '写错',
    });
    const rows = await special(workbook);
    expect(rows[0].errors.join('；')).toContain('同名');
    expect(rows[0].errors.join('；')).toContain('第2轮');
    fill(workbook, '专项训练成绩', { 项目: '皮划艇' });
    expect((await special(workbook))[0].errors.join('；')).toContain('不能导入');
  });
});

it('体能编号与姓名冲突不能静默采用编号对应的人', () => {
  const row = validateStrengthImportRow(
    {
      athleteId: 1,
      athleteName: '李某',
      trainingDate: '2026-10-01',
      exerciseName: '深蹲',
      actualReps: 6,
      actualWeightKg: 60,
    },
    4,
    people
  );
  expect(row.errors.join('；')).toContain('编号与姓名');
});

it('体能非法真实日期不能通过格式检查', () => {
  const row = validateStrengthImportRow(
    {
      athleteId: 1,
      trainingDate: '2026-02-30',
      exerciseName: '深蹲',
      actualReps: 6,
      actualWeightKg: 60,
    },
    4,
    people
  );
  expect(row.errors.join('；')).toContain('日期');
});

it('新版体能隐藏选填数值和组次的非法文本不能静默变成空白或1', async () => {
  const workbook = buildStrengthImportWorkbook();
  fill(workbook, '训练结果数据', {
    运动员: '张某',
    训练日期: '2026-10-01',
    动作: '深蹲',
    实际次数: 6,
    实际重量kg: 60,
    计划重量kg: '写错',
    组次: '写错',
    RPE: '写错',
  });
  const parsed = await strength(workbook);
  const row = validateStrengthImportRow(parsed.records[0], 4, people);
  expect(row.errors.join('；')).toContain('计划重量');
  expect(row.errors.join('；')).toContain('组次');
  expect(row.errors.join('；')).toContain('RPE');
});
