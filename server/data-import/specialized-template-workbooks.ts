import { createTemplateWorkbook, addTemplateSheet } from './template-layout.ts';
import { importTemplateFields } from '../../shared/import-template-fields.ts';

export function buildStrengthImportWorkbook() {
  const workbook = createTemplateWorkbook('竞迹｜体能训练结果导入模板');
  addTemplateSheet(
    workbook,
    '训练结果数据',
    importTemplateFields('训练结果数据'),
    '每位运动员每个动作每组一行；动作、实际次数和实际重量必填，同动作多组需组次，同日多课需训练场次。徒手实际外加重量填0；时长按原记录填写，不在每组重复填整课时长。'
  );
  return workbook;
}

export function buildSpecialImportWorkbook() {
  const workbook = createTemplateWorkbook('竞迹｜专项训练成绩导入模板');
  addTemplateSheet(
    workbook,
    '专项训练成绩',
    importTemplateFields('专项训练成绩'),
    '每个运动员或组合的一次专项成绩一行；日期、项目、距离(m)、运动员/组合、至少一轮成绩必需。单人只填一次姓名；组合需完整成员；艇型/组别缺省为未分组，不与明确分组混排。'
  );
  return workbook;
}
