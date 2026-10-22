import { BODY_TEMPLATE_FIELDS } from './data-import-template.js';
import { dataImportPersonKey } from './data-import-person.js';

export type ReviewValue = number | string;
/** 异常列表与计数共用口径：错误或待复核，已排除的行不再待处理。 */
export function isImportException(item: Pick<ImportReviewItem, 'itemType' | 'quality' | 'resolution'>): boolean {
  return item.resolution !== 'skip' && item.quality !== 'skipped' &&
    (item.itemType === 'invalid_row' || item.quality === 'error' || item.quality === 'warning');
}
/** 只吸收机器浮点尾差，不按业务小数位舍入；空白、真实零及文本不混同。 */
export function importReviewValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'number' || typeof right !== 'number' ||
      !Number.isFinite(left) || !Number.isFinite(right) || left === 0 || right === 0 ||
      (Number.isInteger(left) && Number.isInteger(right))) return false;
  return Math.abs(left - right) <= Number.EPSILON * Math.max(Math.abs(left), Math.abs(right));
}
export type ReviewField = readonly [
  header: string,
  key: string,
  code: string,
  label: string,
  unit: string,
  kind?: 'text',
];
export const BODY_REVIEW_FIELDS: ReviewField[] = BODY_TEMPLATE_FIELDS.filter(
  ([, field]) => field !== 'armSpanCm'
);
export type ImportReviewItem = {
  id: number;
  itemType: string;
  metricCode: string;
  athleteId: number | null;
  rawAthleteName: string;
  eventDate: string;
  payload: Record<string, unknown>;
  resolution: string;
  quality: string;
  sourceSheet: string;
  sourceAddress: string;
  testType?: string;
  side?: string;
  metricLabel?: string;
  unit?: string;
  valueNum?: number | null;
  exerciseName?: string;
  sessionLabel?: string;
  setIndex?: number;
  targetReps?: number | null;
  actualReps?: number | null;
  actualWeightKg?: number | null;
  intensityPercent?: number | null;
  conflict?: {
    exists: boolean;
    fields: Array<{ field: string; oldValue: string; newValue: string; overwrites: boolean }>;
  } | null;
};
const numeric = (fields: Record<string, string>): ReviewField[] =>
  Object.entries(fields).map(([key, label]) => [label, key, key, label, '']);
const textual = (fields: Record<string, string>): ReviewField[] =>
  Object.entries(fields).map(([key, label]) => [label, key, key, label, '', 'text']);
const schemas: Record<string, ReviewField[]> = {
  body_measurement: [...BODY_REVIEW_FIELDS, ...textual({ note: '备注' })],
  wellness: [
    ...numeric({
      sleepHours: '睡眠小时',
      sleepQuality: '睡眠质量',
      morningPulse: '晨脉',
      weightKg: '体重kg',
      fatigueIndex: '疲劳',
      sorenessIndex: '肌肉酸痛',
      moodIndex: '情绪',
    }),
    ...textual({ status: '状态', note: '备注' }),
  ],
  training_session: [
    ...numeric({
      durationMin: '时长分钟',
      distanceKm: '距离km',
      rpe: 'RPE',
      srpe: 'SRPE',
      smvl: 'SMVL',
      averageHeartRate: '平均心率',
      maxHeartRate: '最大心率',
      averagePowerW: '平均功率W',
      strokeRateSpm: '桨频',
    }),
    ...textual({
      startTime: '开始时间',
      trainingType: '训练类型',
      structureType: '训练阶段',
      intensityZone: '强度区间',
      content: '训练内容',
    }),
  ],
  training_set: [
    ...numeric({
      plannedWeightKg: '计划重量kg',
      completed: '完成状态',
      durationMin: '组次时长分钟',
      distanceKm: '组次距离千米',
      targetReps: '计划次数',
      actualReps: '实际次数',
      actualWeightKg: '实际重量kg',
      intensityPercent: '强度百分比',
      rpe: 'RPE',
    }),
    ...textual({ exerciseCode: '动作代码', trainingEnvironment: '训练环境', intensityZone: '强度区间', trainingCategory: '训练类别', bodyPosition: '身体部位', note: '备注' }),
  ],
  injury_record: [
    ...numeric({ painScore: '疼痛评分' }),
    ...textual({
      bodyPart: '部位',
      side: '侧别',
      status: '状态',
      restrictions: '训练限制',
      rehabPlan: '康复计划',
      reviewDate: '复查日期',
      note: '备注',
    }),
  ],
  competitive_state: [
    ...numeric({
      overallScore: '总分',
      enduranceScore: '专项耐力',
      powerScore: '力量爆发',
      techniqueScore: '技术效率',
      loadAdaptationScore: '负荷适应',
      recoveryScore: '恢复能力',
      competitionScore: '比赛能力',
    }),
    ...textual({ stateLevel: '等级', note: '备注' }),
  ],
  athlete_profile: textual({
    gender: '性别',
    birthDate: '出生日期',
    region: '省份',
    city: '城市',
    county: '区县',
    ethnicity: '民族',
    phone: '手机号',
    bloodType: '血型',
    emergencyContact: '紧急联系人',
    emergencyPhone: '紧急电话',
    education: '学历',
    technicalLevel: '技术等级',
    position: '位置号位',
    healthStatus: '身体状态',
    bestResult: '最好成绩',
    nativePlace: '籍贯',
    homeAddress: '家庭住址',
    athleteStatus: '训练状态',
    startSportDate: '开始运动日期',
    trainingVenue: '训练场地',
    currentEvent: '备战赛事',
    trainingPhase: '备战阶段',
    campPeriod: '集训时间',
    originPlace: '输送地',
    originUnit: '输送单位',
    originCoach: '输送教练',
    specialties: '优势项',
    notes: '备注',
  }),
  scoring_rule: [...numeric({ valueNum: '评分阈值' }), ...textual({ comparison: '比较方式' })],
};
const topFields = new Set([
  'targetReps',
  'actualReps',
  'actualWeightKg',
  'intensityPercent',
  'valueNum',
]);
export function reviewMetricKey(item: ImportReviewItem) {
  return `${item.metricCode}:${item.side || 'center'}`;
}
export function reviewFields(items: ImportReviewItem[]): ReviewField[] {
  if (items[0]?.itemType !== 'test_measurement') return schemas[items[0]?.itemType] || [];
  const unique = [...new Map(items.map((item) => [reviewMetricKey(item), item])).values()];
  return [
    ...unique.flatMap<ReviewField>((item) => {
      const key = reviewMetricKey(item);
      const label = `${item.metricLabel || item.metricCode}${item.side && item.side !== 'center' ? `（${item.side}）` : ''}`;
      return [
        [label, `metric:${key}`, item.metricCode, label, item.unit || ''],
        [`${label}单位`, `unit:${key}`, '', `${label}单位`, '', 'text'],
        [`${label}目标值`, `target:${key}`, '', `${label}目标值`, item.unit || ''],
        [`${label}备注`, `note:${key}`, '', `${label}备注`, '', 'text'],
      ];
    }),
    ...textual({ protocol: '测试协议' }),
    ...numeric({ durationMin: '测试时长分钟' }),
  ];
}
function reviewValue(item: ImportReviewItem, field: string): unknown {
  if (item.payload.reviewDatabase) return item.payload[field];
  if (field.startsWith('metric:'))
    return field.slice(7) === reviewMetricKey(item) ? item.valueNum : null;
  if (field.startsWith('unit:'))
    return field.slice(5) === reviewMetricKey(item) ? item.unit : null;
  if (field.startsWith('target:'))
    return field.slice(7) === reviewMetricKey(item) ? item.payload.targetValue : null;
  if (field.startsWith('note:'))
    return field.slice(5) === reviewMetricKey(item) ? item.payload.note : null;
  return topFields.has(field) ? item[field as keyof ImportReviewItem] : item.payload[field];
}
export function reviewValues(
  item: ImportReviewItem,
  group: ImportReviewItem[] = [item]
): Record<string, ReviewValue> {
  const values: Record<string, ReviewValue> = {};
  for (const [, field] of reviewFields(group)) {
    const value = reviewValue(item, field);
    if (typeof value === 'number' && Number.isFinite(value)) values[field] = value;
    else if (typeof value === 'string' && value.trim()) values[field] = value;
  }
  return values;
}
export function writeReviewValues(
  item: ImportReviewItem,
  values: Record<string, ReviewValue>,
  group: ImportReviewItem[]
) {
  if (item.itemType === 'test_measurement') {
    const key = reviewMetricKey(item);
    item.valueNum =
      typeof values[`metric:${key}`] === 'number' ? (values[`metric:${key}`] as number) : null;
    item.unit =
      typeof values[`unit:${key}`] === 'string' ? (values[`unit:${key}`] as string) : item.unit;
    item.payload.note = values[`note:${key}`] ?? '';
    if (values[`target:${key}`] !== undefined) item.payload.targetValue = values[`target:${key}`];
    else delete item.payload.targetValue;
    item.payload.protocol = values.protocol ?? '';
    if ('durationMin' in values) item.payload.durationMin = values.durationMin;
    else delete item.payload.durationMin;
    return;
  }
  for (const [, field] of reviewFields(group)) {
    if (topFields.has(field)) Object.assign(item, { [field]: values[field] ?? null });
    else if (field in values) item.payload[field] = values[field];
    else delete item.payload[field];
  }
  const number = (value: unknown) => (typeof value === 'number' ? value : null);
  if (item.itemType === 'body_measurement')
    item.valueNum = number(item.payload.weightKg ?? item.payload.heightCm);
  if (item.itemType === 'wellness') item.valueNum = number(item.payload.sleepHours);
  if (item.itemType === 'competitive_state') item.valueNum = number(item.payload.overallScore);
  if (item.itemType === 'injury_record') item.valueNum = number(item.payload.painScore);
  if (item.itemType === 'training_session') {
    item.valueNum = number(item.payload.durationMin);
    item.payload.durationReported = item.payload.durationMin != null;
    item.payload.distanceReported = item.payload.distanceKm != null;
  }
}
export function importReviewKey(item: ImportReviewItem) {
  const person = item.athleteId ? `id:${item.athleteId}` : dataImportPersonKey(item);
  let suffix = '';
  if (item.itemType === 'test_measurement') suffix = item.testType || '力量素质测试';
  if (item.itemType === 'training_session')
    suffix = String(Math.max(1, Math.round(Number(item.payload.sessionOrder) || 1)));
  if (item.itemType === 'training_set')
    suffix = JSON.stringify([item.payload.sessionOrder ?? item.sessionLabel, item.exerciseName, item.setIndex]);
  if (item.itemType === 'injury_record') suffix = String(item.payload.injuryName || '');
  if (item.itemType === 'scoring_rule')
    return JSON.stringify([
      'scoring_rule',
      item.payload.project,
      item.payload.gender,
      item.metricCode,
      item.payload.score,
      item.payload.ruleVersion,
    ]);
  return JSON.stringify([
    item.itemType,
    person,
    item.itemType === 'athlete_profile' ? '' : item.eventDate,
    suffix,
  ]);
}
export function importFieldValues(items: ImportReviewItem[], field: string): ReviewValue[] {
  const values = items
    .map((item) =>
      Object.prototype.hasOwnProperty.call(item.payload, field)
        ? item.payload[field]
        : reviewValue(item, field)
    )
    .filter(
      (value): value is ReviewValue =>
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.trim() !== '')
    );
  const distinct: ReviewValue[] = [];
  for (const value of values) {
    if (!distinct.some(previous => importReviewValuesEqual(previous, value))) distinct.push(value);
  }
  return distinct;
}

/** 只缩减展示列，原始来源与合并成员保持完整，序号仍对应批量选择。 */
export function reviewComparisonRecords<T extends ImportReviewItem>(items: T[], fields: string[]) {
  const result: Array<{ item: T; index: number }> = [];
  const provided = (value: unknown) => value !== null && value !== undefined && value !== '';
  items.forEach((item, index) => {
    const needsSession = importSessionChoices(item).length > 1;
    if (!needsSession && !fields.some(field => provided(item.payload[field]))) return;
    const duplicate = !needsSession && result.some(({ item: previous }) =>
      Boolean(previous.payload.reviewDatabase) === Boolean(item.payload.reviewDatabase) &&
      importSessionChoices(previous).length <= 1 &&
      fields.every(field => importReviewValuesEqual(previous.payload[field], item.payload[field])));
    if (!duplicate) result.push({ item, index });
  });
  return result;
}
export function importReviewGroups<T extends ImportReviewItem>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!reviewFields([item]).length || (item.quality === 'skipped' && item.resolution !== 'skip'))
      continue;
    if (
      item.resolution === 'skip' &&
      !item.payload.valueMergedInto &&
      !item.payload.valueReviewDecision
    )
      continue;
    const key = importReviewKey(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => {
    if (group.length < 2)
      return (
        group.some(requiresDatabaseReview) || group.some((item) => item.payload.valueReviewDecision)
      );
    if (
      group[0].itemType !== 'test_measurement' ||
      group.some((item) => item.payload.valueReviewDecision)
    )
      return true;
    return (
      group.some(requiresDatabaseReview) ||
      new Set(group.map(reviewMetricKey)).size < group.length ||
      ['protocol', 'durationMin'].some((field) => importFieldValues(group, field).length > 1)
    );
  });
}
export function reviewTitle(item: ImportReviewItem) {
  return (
    (
      {
        body_measurement: '身体测量',
        test_measurement: item.testType || '测试指标',
        wellness: '每日恢复',
        athlete_profile: '基本资料',
        training_session: '训练课次',
        training_set: '力量组次',
        injury_record: '伤病记录',
        competitive_state: '竞技评估',
        scoring_rule: '评分规则',
      } as Record<string, string>
    )[item.itemType] || '导入数据'
  );
}

/** 将数据库已有值投影为相同的审查字段；不做单位换算或精度舍入。 */
export function databaseReviewRecords<T extends ImportReviewItem>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (!item.conflict?.exists) return [];
    const conflict = item.conflict as NonNullable<ImportReviewItem['conflict']> & {
      entityType?: string;
      entityId?: number | null;
    };
    const identity = `${conflict.entityType}:${conflict.entityId ?? item.id}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const values: Record<string, ReviewValue> = {};
    const fields = reviewFields(items);
    for (const field of conflict.fields) {
      const key =
        item.itemType === 'test_measurement' && ['valueNum', 'targetValue', 'unit', 'note'].includes(field.field)
          ? `${field.field === 'valueNum' ? 'metric' : field.field === 'targetValue' ? 'target' : field.field}:${reviewMetricKey(item)}`
          : field.field;
      const definition = fields.find(([, name]) => name === key);
      if (!definition || field.oldValue === '') continue;
      const value = definition[5] === 'text' ? field.oldValue : Number(field.oldValue);
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      values[key] = value;
    }
    if (!Object.keys(values).length) return [];
    return [
      {
        ...item,
        id: -item.id,
        payload: { ...values, reviewDatabase: true },
        sourceSheet: '数据库已有',
        sourceAddress: String(conflict.entityId ?? ''),
        conflict: null,
      },
    ];
  });
}
/** 文件与数据库之间的非空差异统一按本次导入更新，不再产生人工选择。 */
export function requiresDatabaseReview(_item: ImportReviewItem): boolean {
  return false;
}

/** 保留行级排除；旧客户端传入的批次策略不改变统一更新规则。 */
export function importRecordPolicy(item: Pick<ImportReviewItem, 'itemType' | 'resolution'>, _batchPolicy: 'skip' | 'update' = 'update'): 'skip' | 'update' {
  return item.resolution === 'skip' ? 'skip' : 'update';
}


/** 按界面记录序号批量选择；缺少冲突值时保留待选，不按其他来源猜测。 */
export function selectImportReviewRecord<T extends ImportReviewItem>(groups: T[][], recordIndex: number) {
  if (!Number.isSafeInteger(recordIndex) || recordIndex < 0) return [];
  return groups.filter(group => !group.some(item => item.payload.valueReviewDecision)).flatMap(group => {
    const selected = group[recordIndex];
    if (!selected || group.some(item => importSessionChoices(item).length > 1)) return [];
    const includeDatabase = group.some(requiresDatabaseReview);
    const comparison = includeDatabase ? [...group, ...databaseReviewRecords(group)] : group;
    const selectedValues = reviewValues(selected, group);
    const values: Record<string, ReviewValue> = {};
    let remaining = false;
    for (const [, field] of reviewFields(comparison)) {
      const available = importFieldValues(comparison, field);
      if (!available.length) continue;
      if (available.length === 1) values[field] = available[0];
      else if (selectedValues[field] !== undefined) values[field] = selectedValues[field];
      else remaining = true;
    }
    const valueReview = remaining
      ? { action: 'draft', choices: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, String(value)])), manual: {} }
      : { action: 'merge', memberIds: group.map(item => item.id), values, includeDatabase };
    return [{ id: group[0].id, payload: { valueReview } }];
  });
}


/** 服务端生成的旧模板课次候选，仅展示有效序号。 */
export function importSessionChoices(item: ImportReviewItem): Array<{ sessionOrder: number; label: string }> {
  const choices: unknown = item.payload.sessionChoices;
  if (!Array.isArray(choices)) return [];
  return choices.flatMap((choice: unknown) => {
    if (!choice || typeof choice !== 'object' || !('sessionOrder' in choice) || typeof choice.sessionOrder !== 'number' || !Number.isSafeInteger(choice.sessionOrder) || choice.sessionOrder < 1) return [];
    return [{ sessionOrder: choice.sessionOrder, label: 'label' in choice && typeof choice.label === 'string' ? choice.label : '' }];
  });
}
