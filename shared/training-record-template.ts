export const TRAINING_RECORD_SHEET = '训练记录';
export const TRAINING_RECORD_FORMAT = 'jingji:training-record:v1';
export const TRAINING_RECORD_IDENTITY = ['运动员编号', '姓名', '日期', '课次'] as const;
export const TRAINING_RECORD_SEGMENT = '段序';
export const TRAINING_SESSION_COLUMNS = ['开始时间', '训练类型', '时长分钟', '距离千米', 'RPE'] as const;
export const TRAINING_SET_COLUMNS = ['动作', '组序', '实际重量kg', '实际次数'] as const;
export const TRAINING_RECORD_OPTIONS = [...TRAINING_SESSION_COLUMNS, ...TRAINING_SET_COLUMNS, TRAINING_RECORD_SEGMENT] as const;

export type TrainingRecordTemplate = {
  name: string;
  compactIdentity?: boolean;
  columnOrder?: string[];
  standard: string[];
  fields: Array<{ name: string; unit: string; kind: 'number' | 'text' | 'time' }>;
};
export const trainingDetailHeader = (field: TrainingRecordTemplate['fields'][number]) =>
  field.unit ? `${field.name}（${field.unit}）` : field.name;
export const trainingRecordHeaders = (template: TrainingRecordTemplate) =>
  [...TRAINING_RECORD_IDENTITY, ...(template.compactIdentity ? [] : ['明细序号']), ...(template.columnOrder ?? [...template.standard, ...template.fields.map(trainingDetailHeader)])];

export function combineTrainingProjects(projects: readonly TrainingRecordTemplate[], columnOrder?: string[]) {
  return {
    name: '本队训练记录',
    compactIdentity: true,
    columnOrder,
    standard: [...new Set([...projects.flatMap(project => project.standard), ...(columnOrder?.includes(TRAINING_RECORD_SEGMENT) ? [TRAINING_RECORD_SEGMENT] : [])])],
    fields: projects.flatMap(project => project.fields.map(field => ({ ...field, name: `${project.name} · ${field.name}` }))),
    fieldSources: projects.flatMap(project => project.fields.map(field => ({ project: project.name, name: field.name, sequence: project.standard.includes(TRAINING_RECORD_SEGMENT) ? TRAINING_RECORD_SEGMENT : project.standard.includes('组序') ? '组序' : undefined }))),
  };
}

export const commonTrainingProjects: TrainingRecordTemplate[] = [
  { name: '整课训练', standard: ['时长分钟', 'RPE'], fields: [{ name: '备注', unit: '', kind: 'text' }] },
  { name: '力量训练', standard: [...TRAINING_SET_COLUMNS], fields: [] },
  { name: '间歇与分段训练', standard: [TRAINING_RECORD_SEGMENT], fields: [
    { name: '分段距离', unit: 'm', kind: 'number' },
    { name: '分段用时', unit: 's', kind: 'time' },
  ] },
];
