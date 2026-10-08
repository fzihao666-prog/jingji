import { z } from 'zod';
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
  direction: z.enum(['higher_better', 'lower_better']),
  sourceType: z.enum(['measured', 'public_reference', 'estimated']),
  sourceNote: z.string(),
});
const resultSchema = z.object({
  key: z.string(),
  value: nullableNumber,
  achievedPercent: nullableNumber,
  difference: nullableNumber,
  testDate: z.string().nullable(),
});
const athleteSchema = z.object({
  athleteId: z.number(),
  athleteName: z.string(),
  score: nullableNumber,
  coverage: z.number(),
  dimensions: z.array(resultSchema),
});
export const physicalChampionPayloadSchema = z.object({
  project: z.string(),
  from: z.string(),
  to: z.string(),
  canEdit: z.boolean(),
  excludedCount: z.number(),
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
      team: z.array(resultSchema.extend({ sampleCount: z.number() })),
      athletes: z.array(athleteSchema),
      trend: z.array(
        z.object({
          date: z.string(),
          score: nullableNumber,
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
  const comparison = buildRadarComparison(reference.direction, value, reference.value);
  return {
    value,
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
