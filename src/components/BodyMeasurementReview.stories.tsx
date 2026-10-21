import { BodyMeasurementReview } from './BodyMeasurementReview';
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
let lastMerge: Record<string, number> | undefined;
const actions = {
  onMerge: (_id: number, _members: number[], values: Record<string, number>) => {
    lastMerge = values;
  },
  onReopen: () => {},
  onExclude: () => {},
  onDraft: () => {},
  onSplit: () => {},
  onPolicy: () => {},
};
const items = [
  measurement(2477, { weightKg: 85.94, bodyFatPct: 9.6 }),
  measurement(2710, { weightKg: 85.9, bodyFatPct: 33, skeletalMuscleKg: 38 }),
];
export default { title: '数据导入/身体测量集中审查', component: BodyMeasurementReview };
export const Conflict = {
  args: { items, disabled: false, ...actions },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const button = [...canvasElement.querySelectorAll('button')].find((entry) =>
      entry.textContent?.includes('确认合并')
    )!;
    if (canvasElement.querySelector('input[aria-label="骨骼肌kg最终值"]'))
      throw new Error('单方有值应自动补齐，不展示输入框');
    if (!button.disabled) throw new Error('尚未选择冲突字段时必须阻止确认');
    const select = canvasElement.querySelector<HTMLSelectElement>(
      'select[aria-label="体重kg最终值"]'
    )!;
    select.focus();
    if (document.activeElement !== select) throw new Error('字段选择必须可聚焦');
    for (const control of canvasElement.querySelectorAll<HTMLSelectElement>('select')) {
      control.value = control.options[1].value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(requestAnimationFrame);
    if (button.disabled) throw new Error('所有冲突字段选择后必须可确认');
    button.click();
    if (
      lastMerge?.weightKg !== 85.94 ||
      lastMerge?.bodyFatPct !== 9.6 ||
      lastMerge?.skeletalMuscleKg !== 38
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
          bodyMergeDecision: {
            sources: items.map((item) => ({ id: item.id, values: item.payload })),
            finalValues: { weightKg: 85.94, bodyFatPct: 9.6, skeletalMuscleKg: 38 },
          },
        },
      },
      {
        ...items[1],
        resolution: 'skip' as const,
        payload: { ...items[1].payload, bodyMergedInto: items[0].id },
      },
    ],
  },
};
