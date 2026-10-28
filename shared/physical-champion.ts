import { z } from 'zod';
import { isProject } from './projects.js';
import { buildRadarComparison } from './athlete-radar-model.js';

// 只选择现有测试事实支持的指标；测试协议必须与参考协议相同。
export const PHYSICAL_CHAMPION_DIMENSIONS = [
  {
    key: 'relative_squat',
    label: '相对深蹲',
    unit: '倍体重',
    measurementUnit: 'kg',
    codes: ['squat_kg', 'squatKg'],
    weightRelative: true,
    protocol: '深蹲1RM',
    direction: 'higher_better',
  },
  {
    key: 'relative_bench_pull',
    label: '相对卧拉',
    unit: '倍体重',
    measurementUnit: 'kg',
    codes: ['bench_pull_kg', 'benchPullKg'],
    weightRelative: true,
    protocol: '卧拉1RM',
    direction: 'higher_better',
  },
  {
    key: 'relative_high_pull',
    label: '相对高拉',
    unit: '倍体重',
    measurementUnit: 'kg',
    codes: ['high_pull_kg', 'highPullKg'],
    weightRelative: true,
    protocol: '高拉1RM',
    direction: 'higher_better',
  },
  {
    key: 'vertical_jump',
    label: '爆发力·纵跳',
    unit: 'cm',
    measurementUnit: 'cm',
    codes: ['vertical_jump_cm', 'verticalJumpCm'],
    weightRelative: false,
    protocol: 'CMJ双手叉腰',
    direction: 'higher_better',
  },
  {
    key: 'bench_pull_2min',
    label: '力量耐力·卧拉',
    unit: '次',
    measurementUnit: '次',
    codes: ['bench_pull_2_min_reps', 'bench_pull_2min_reps', 'bench_pull2_min_reps'],
    weightRelative: false,
    protocol: '卧拉2分钟40%1RM',
    direction: 'higher_better',
  },
  {
    key: 'front_plank',
    label: '核心稳定·前支撑',
    unit: 's',
    measurementUnit: '秒',
    codes: ['front_plank_sec', 'frontPlankSec'],
    weightRelative: false,
    protocol: '标准前臂平板支撑至力竭',
    direction: 'higher_better',
  },
  {
    key: 'wingate_peak',
    label: '无氧峰值功率',
    unit: 'W/kg',
    measurementUnit: 'W/kg',
    codes: ['wingate_peak_power_wkg'],
    weightRelative: false,
    protocol: '自行车Wingate30秒负荷7.5%体重',
    direction: 'higher_better',
  },
  {
    key: 'vo2max',
    label: '有氧能力·VO₂max',
    unit: 'ml/kg/min',
    measurementUnit: 'ml/kg/min',
    codes: ['vo2max_ml_kg_min'],
    weightRelative: false,
    protocol: '递增负荷测功仪直接气体分析',
    direction: 'higher_better',
  },
] as const;

const nullableNumber = z.number().finite().nullable();
export const physicalReferenceSchema = z.object({
  id: z.number().int(),
  revision: z.number().int(),
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  value: z.number().positive(),
  protocol: z.string(),
  protocolVersion: z.string(),
  testContext: z.string(),
  side: z.enum(['center', 'bilateral', 'left', 'right']),
  direction: z.enum(['higher_better', 'lower_better']),
  sourceType: z.enum(['measured', 'public_reference', 'estimated']),
  sourceNote: z.string(),
  project: z.string(),
  reviewStatus: z.enum(['draft', 'reviewed', 'disabled']),
  sourceNature: z.enum(['official_research', 'expert', 'team', 'estimated', 'unverified']),
  version: z.number().int().positive(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  position: z.string(),
  referenceLevel: z.string(),
  referenceLabel: z.string(),
  dimensionVersion: z.string(),
  measurementCodes: z.array(z.string()),
  measurementUnit: z.string(),
  weightRelative: z.boolean(),
  gender: z.string(),
  event: z.string(),
  weightClass: z.string(),
  ageGroup: z.string(),
});
const resultSchema = z.object({
  key: z.string(),
  value: nullableNumber,
  achievedPercent: nullableNumber,
  scoringEligible: z.boolean().default(false),
  difference: nullableNumber,
  testDate: z.string().nullable(),
  pendingReason: z.string().nullable(),
  referenceId: z.number().nullable(),
  referenceVersion: z.number().nullable(),
  factMeasurementId: z.number().nullable(),
  calculationVersion: z.string(),
  appliedReference: physicalReferenceSchema.nullable(),
});
const athleteSchema = z.object({
  athleteId: z.number(),
  athleteName: z.string(),
  score: nullableNumber,
  scoringEligible: z.boolean().default(false),
  coverage: z.number(),
  dimensions: z.array(resultSchema),
});
export const physicalModelDimensionSchema = z.object({
  id: z.number().int().positive().nullable(),
  revision: z.number().int().nonnegative(),
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  value: z.number().positive().nullable(),
  estimated: z.boolean(),
});
export type PhysicalModelDimension = z.infer<typeof physicalModelDimensionSchema>;
export const physicalChampionGroupScopeSchema = z.tuple([
  z.enum(['男', '女', 'open']),
  z.string().min(1).max(100),
  z.literal('open'),
  z.enum(['adult', 'open']),
  z.string().min(1).max(100),
  z.string().min(1).max(100),
]);
export function physicalChampionGroupScope(id: string) {
  try {
    const parsed = physicalChampionGroupScopeSchema.safeParse(JSON.parse(id));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const physicalChampionPayloadSchema = z.object({
  project: z.string(),
  from: z.string(),
  to: z.string(),
  canEdit: z.boolean(),
  excludedCount: z.number(),
  pendingReason: z.string().nullable(),
  managementReferences: z.array(physicalReferenceSchema),
  athletePendingReasons: z.array(z.object({ athleteId: z.number(), reason: z.string() })),
  measurements: z.array(
    z.object({
      measurementId: z.number(),
      athleteId: z.number(),
      sessionId: z.number(),
      date: z.string(),
      protocol: z.string().nullable(),
      protocolVersion: z.string().nullable(),
      testContext: z.string(),
      side: z.string(),
      code: z.string(),
      value: z.number(),
      unit: z.string(),
    })
  ),
  groups: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      gender: z.string(),
      event: z.string(),
      weightClass: z.string(),
      ageGroup: z.string(),
      referenceLevel: z.string(),
      references: z.array(physicalReferenceSchema),
      modelDimensions: z.array(physicalModelDimensionSchema).optional(),
      team: z.array(resultSchema.extend({ sampleCount: z.number() })),
      athletes: z.array(athleteSchema),
      trend: z.array(
        z.object({
          date: z.string(),
          score: nullableNumber,
          scoringEligible: z.boolean().default(false),
          sampleCount: z.number(),
          athleteId: z.number().nullable(),
          coverage: z.number(),
        })
      ),
    })
  ),
});
export type PhysicalChampionPayload = z.infer<typeof physicalChampionPayloadSchema>;
export type PhysicalReference = z.infer<typeof physicalReferenceSchema>;
export type PhysicalAthleteResult = z.infer<typeof athleteSchema>;
export function physicalComparison(value: number | null, reference: PhysicalReference) {
  const scoringEligible =
    reference.reviewStatus === 'reviewed' &&
    reference.sourceType !== 'estimated' &&
    !['estimated', 'unverified'].includes(reference.sourceNature);
  if (reference.reviewStatus === 'disabled')
    return { value, achievedPercent: null, difference: null, scoringEligible: false };
  const comparison = buildRadarComparison(reference.direction, value, reference.value);
  return {
    value,
    scoringEligible,
    achievedPercent: comparison.achievedPercent,
    difference:
      comparison.comparable && value !== null
        ? Math.round((value - reference.value) * 1000) / 1000
        : null,
  };
}
export function mean(values: number[]): number | null {
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000000) /
        1000000
    : null;
}

const text = (max: number) => z.string().trim().min(1).max(max);
export const physicalReferenceDraftSchema = z
  .strictObject({
    project: z.enum([
      'ROWING',
      'CANOE_SPRINT',
      'CANOE_SLALOM',
      'CYCLING_ROAD',
      'CYCLING_TRACK',
      'VOLLEYBALL',
    ]),
    key: text(80),
    referenceLabel: text(120),
    value: z.number().finite().positive().max(10000),
    unit: text(40),
    protocol: text(200),
    protocolVersion: z.string().trim().max(80).default(''),
    testContext: z.string().trim().max(200).default(''),
    side: z.enum(['center', 'bilateral', 'left', 'right']).default('center'),
    direction: z.enum(['higher_better', 'lower_better']),
    sourceType: z.enum(['measured', 'public_reference', 'estimated']),
    sourceNature: z.enum(['official_research', 'expert', 'team', 'estimated']),
    sourceNote: text(500),
    gender: z.enum(['男', '女', 'open']),
    event: text(100),
    weightClass: z.literal('open'),
    ageGroup: z.enum(['adult', 'open']),
    position: text(100),
    referenceLevel: text(100),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    dimensionVersion: text(80),
    measurementCodes: z.array(text(80)).min(1).max(20),
    measurementUnit: text(40),
    weightRelative: z.boolean(),
  })
  .refine((value) => !value.effectiveTo || value.effectiveFrom <= value.effectiveTo, {
    message: '有效日期无效',
  })
  .refine(
    (value) =>
      value.weightRelative
        ? value.measurementUnit === 'kg' && value.unit === '倍体重'
        : value.measurementUnit === value.unit ||
          (value.measurementUnit === '秒' && value.unit === 's'),
    { message: '单位与换算维度不符' }
  )
  .refine((value) => value.sourceType !== 'estimated' || value.sourceNature === 'estimated', {
    message: '估算来源性质必须明确',
  });
export type PhysicalReferenceDraft = z.infer<typeof physicalReferenceDraftSchema>;

/** 快捷编辑只接收冠军数值，不接收团队均值或适用条件。 */
export const physicalChampionValuesSchema = z.strictObject({
  project: z.string().max(80).refine(isProject),
  groupId: z.string().max(1000).optional(),
  effectiveFrom: z.iso.date().optional(),
  values: z
    .array(
      z.union([
        z.strictObject({
          id: z.number().int().positive(),
          expectedRevision: z.number().int().nonnegative(),
          value: z.number().finite().positive(),
        }),
        z.strictObject({
          key: z.enum(PHYSICAL_CHAMPION_DIMENSIONS.map((item) => item.key)),
          value: z.number().finite().positive(),
        }),
      ])
    )
    .min(1)
    .max(64)
    .refine(
      (values) =>
        new Set(values.map((item) => ('id' in item ? `id:${item.id}` : `key:${item.key}`))).size ===
        values.length
    ),
});
export type PhysicalChampionValuesInput = z.infer<typeof physicalChampionValuesSchema>;
