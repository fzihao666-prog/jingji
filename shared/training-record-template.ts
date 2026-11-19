export const TRAINING_RECORD_SHEET = '训练记录';
export const TRAINING_RECORD_FORMAT = 'jingji:training-record:v1';
export const TRAINING_RECORD_IDENTITY = ['运动员编号', '姓名', '日期', '课次', '明细序号'] as const;
export const TRAINING_SESSION_COLUMNS = ['开始时间', '训练类型', '时长分钟', '距离千米', 'RPE'] as const;
export const TRAINING_SET_COLUMNS = ['动作', '组序', '实际重量kg', '实际次数'] as const;
export const TRAINING_RECORD_OPTIONS = [...TRAINING_SESSION_COLUMNS, ...TRAINING_SET_COLUMNS] as const;

export type TrainingRecordTemplate = {
  name: string;
  standard: string[];
  fields: Array<{ name: string; unit: string; kind: 'number' | 'text' | 'time' }>;
};
export const trainingDetailHeader = (field: TrainingRecordTemplate['fields'][number]) =>
  field.unit ? `${field.name}（${field.unit}）` : field.name;
export const trainingRecordHeaders = (template: TrainingRecordTemplate) =>
  [...TRAINING_RECORD_IDENTITY, ...template.standard, ...template.fields.map(trainingDetailHeader)];
