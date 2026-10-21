import { ImportConflictReview } from './ImportConflictReview';
import type { ReviewValue } from '../../shared/import-conflict-review';
import type { DataImportItem } from '../types';

function measurement(id: number, payload: Record<string, unknown>): DataImportItem {
  return {
    id,
    batchId: 'demo',
    itemType: 'body_measurement',
    athleteId: 1,
    rawAthleteName: '示例队员',
    athleteName: '示例队员',
    athleteProject: '赛艇',
    athleteTeam: '示例队伍',
    eventDate: '2026-09-03',
    sessionLabel: '',
    testType: '',
    metricCode: 'body_composition',
    metricLabel: '身体测量',
    side: 'center',
    valueNum: null,
    unit: '',
    exerciseName: '',
    setIndex: 0,
    targetReps: null,
    actualReps: null,
    actualWeightKg: null,
    intensityPercent: null,
    payload: { rawDate: '2026-09-03', personKey: 'demo', ...payload },
    sourceSheet: '身体测量',
    sourceAddress: `B${id}`,
    rawValue: JSON.stringify(payload),
    quality: 'error',
    messages: [],
    businessKey: `demo-${id}`,
    resolution: '',
    conflict: null,
    committedEntityType: '',
    committedEntityId: null,
  };
}
let lastMerge: Record<string, ReviewValue> | undefined;
let lastDatabase = false;
const recordedMerge = () => lastMerge;
const actions = {
  onMerge: (
    _id: number,
    _members: number[],
    values: Record<string, ReviewValue>,
    includeDatabase = false
  ) => {
    lastMerge = values;
    lastDatabase = includeDatabase;
  },
  onExclude: () => {},
  onDraft: () => {},
  onSplit: () => {},
};
const items = [
  measurement(2477, { weightKg: 85.94, bodyFatPct: 9.6 }),
  measurement(2710, { weightKg: 85.9, bodyFatPct: 33, skeletalMuscleKg: 38 }),
];
export default { title: '数据导入/统一值冲突审查', component: ImportConflictReview };
export const Conflict = {
  args: { items, disabled: false, ...actions },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    lastMerge = undefined;
    if (canvasElement.textContent?.includes('最终入库值') || canvasElement.textContent?.includes('确认最终值'))
      throw new Error('不应展示额外结果列或确认按钮');
    const controls = [...canvasElement.querySelectorAll<HTMLButtonElement>('.import-value-review-choice')];
    controls[0].focus();
    if (document.activeElement !== controls[0]) throw new Error('候选值必须可聚焦');
    controls[0].click();
    await new Promise(requestAnimationFrame);
    if (controls[0].getAttribute('aria-pressed') !== 'true') throw new Error('点击后必须选中');
    if (lastMerge) throw new Error('未选齐不能合并');
    controls[2].click();
    await new Promise(resolve => setTimeout(resolve, 500));
    if (
      recordedMerge()?.weightKg !== 85.94 ||
      recordedMerge()?.bodyFatPct !== 9.6 ||
      recordedMerge()?.skeletalMuscleKg !== 38
    )
      throw new Error('最终值必须保留选择和互补字段');
  },
};
export const Complementary = {
  args: {
    ...Conflict.args,
    items: [
      measurement(1, { weightKg: 80, bodyFatPct: 0 }),
      measurement(2, { skeletalMuscleKg: 30 }),
    ],
  },
};
export const MissingDate = {
  args: {
    ...Conflict.args,
    items: items.map((item) => ({ ...item, payload: { ...item.payload, rawDate: '' } })),
  },
};
export const Disabled = { args: { ...Conflict.args, disabled: true } };
export const Merged = {
  args: {
    ...Conflict.args,
    items: [
      {
        ...items[0],
        payload: {
          ...items[0].payload,
          valueReviewDecision: {
            sources: items.map((item) => ({ id: item.id, values: item.payload })),
            finalValues: { weightKg: 85.94, bodyFatPct: 9.6, skeletalMuscleKg: 38 },
          },
        },
      },
      {
        ...items[1],
        resolution: 'skip' as const,
        payload: { ...items[1].payload, valueMergedInto: items[0].id },
      },
    ],
  },
};

export const ArmSpan = {
  args: {
    ...Conflict.args,
    items: [185, 186].map((value, index) => ({
      ...measurement(index + 1, {}),
      itemType: 'test_measurement' as const,
      testType: '身体测量',
      metricCode: 'arm_span_cm',
      metricLabel: '臂展',
      valueNum: value,
      unit: 'cm',
    })),
  },
};
export const Protocol = {
  args: {
    ...Conflict.args,
    items: ['A', 'B'].map((protocol, index) => ({
      ...measurement(index + 1, { protocol }),
      itemType: 'test_measurement' as const,
      testType: '专项测试',
      metricCode: `metric_${index}`,
      metricLabel: `指标${index + 1}`,
      valueNum: 10 + index,
      unit: 'kg',
    })),
  },
};
export const ManyIndicators = {
  args: {
    ...Conflict.args,
    items: Array.from({ length: 65 }, (_, index): DataImportItem => ({
      ...measurement(index + 1, {}),
      itemType: 'test_measurement',
      testType: '专业综合评估',
      metricCode: index === 1 ? 'weight_kg' : `custom_${index}`,
      metricLabel: index === 1 ? '体重' : `指标${index + 1}`,
      valueNum: index === 1 ? 61.4 : index + 1,
      unit: index === 1 ? 'kg' : '分',
      quality: 'valid',
      conflict: {
        exists: true,
        entityType: 'test_measurement',
        entityId: index + 1,
        identical: index !== 1,
        fields: [{ field: 'valueNum', label: '数值', oldValue: String(index === 1 ? 61.3 : index + 1), newValue: String(index === 1 ? 61.4 : index + 1), overwrites: index === 1 }],
      },
    })),
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    lastMerge = undefined;
    const table = canvasElement.querySelector('table')!;
    if (table.querySelectorAll('thead th').length !== 3 || table.querySelectorAll('tbody tr').length !== 1)
      throw new Error('65项测试仅有体重冲突时应展示指标、记录2、数据库已有三列');
    const buttons = [...table.querySelectorAll<HTMLButtonElement>('button')];
    if (buttons.length !== 2 || table.textContent?.includes('未提供'))
      throw new Error('不应展示无关指标空列');
    buttons[1].click();
    await new Promise(resolve => setTimeout(resolve, 500));
    if (recordedMerge()?.['metric:weight_kg:center'] !== 61.3 || recordedMerge()?.['metric:custom_64:center'] !== 65 || !lastDatabase)
      throw new Error(`选择数据库值后必须保留其余64项测试：${JSON.stringify({ weight: recordedMerge()?.['metric:weight_kg:center'], last: recordedMerge()?.['metric:custom_64:center'], database: lastDatabase })}`);
    if (canvasElement.querySelector('.import-source-details')?.querySelectorAll('strong').length !== 130)
      throw new Error('必须完整保留原始来源');
  },
};
export const Text = {
  args: {
    ...Conflict.args,
    items: ['成绩A', '成绩B'].map((bestResult, index) => ({
      ...measurement(index + 1, { bestResult }),
      itemType: 'athlete_profile' as const,
      eventDate: '',
    })),
  },
};
export const Database = {
  args: {
    ...Conflict.args,
    items: [
      {
        ...measurement(1, { weightKg: 81, bodyFatPct: 21 }),
        conflict: {
          exists: true,
          entityType: 'athlete_body_measurement',
          entityId: 1,
          identical: false,
          fields: [
            { field: 'weightKg', label: '体重', oldValue: '80', newValue: '81', overwrites: true },
            {
              field: 'bodyFatPct',
              label: '体脂率',
              oldValue: '20',
              newValue: '21',
              overwrites: true,
            },
          ],
        },
      },
    ],
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const header = [...canvasElement.querySelectorAll('th')].find(
      (element) => element.textContent === '数据库已有'
    );
    if (!header) throw new Error('数据库已有值必须作为对比来源');
    lastDatabase = false;
    const controls = [...canvasElement.querySelectorAll<HTMLButtonElement>('.import-value-review-choice')];
    controls[0].click();
    await new Promise(requestAnimationFrame);
    controls[2].click();
    await new Promise(resolve => setTimeout(resolve, 500));
    if (!lastDatabase || recordedMerge()?.weightKg !== 81)
      throw new Error('数据库比较必须通过统一选择命令提交');
  },
};


let assignedSession: number | undefined;
export const SessionAmbiguity = {
  args: { ...Conflict.args,
    items: [{ ...measurement(1, { sessionChoices: [{ sessionOrder: 1, label: '力量课' }, { sessionOrder: 2, label: '力量课' }] }), itemType: 'training_set' as const, exerciseName: '深蹲', sessionLabel: '力量课', actualReps: 5, actualWeightKg: 80 }],
    onAssignSession: (_id: number, order: number) => { assignedSession = order; },
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    assignedSession = undefined;
    const select = canvasElement.querySelector<HTMLSelectElement>('select[aria-label="记录 1 所属课次"]');
    if (!select || select.options.length !== 3) throw new Error('同名课次必须提供明确选择');
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    if (assignedSession !== 2) throw new Error('应提交所选课次序号');
  },
};
