/** 兼容历史导入的基础指标，仅在数据库初始化时补齐缺失项。 */
export const IMPORT_BASE_METRICS = {
  height_cm: { label: '身高', unit: 'cm', domain: 'morphology', min: 100, max: 230 },
  weight_kg: { label: '体重', unit: 'kg', domain: 'morphology', min: 30, max: 200 },
  training_years: { label: '训练年限', unit: '年', domain: 'morphology', min: 0, max: 50 },
  arm_span_cm: { label: '臂展', unit: 'cm', domain: 'morphology', min: 100, max: 250 },
  sit_reach_cm: { label: '坐位体前屈', unit: 'cm', domain: 'flexibility', min: -30, max: 60 },
  supine_support_sec: { label: '仰卧支撑', unit: '秒', domain: 'core', min: 0, max: 900 },
  front_plank_sec: { label: '俯卧支撑', unit: '秒', domain: 'core', min: 0, max: 900 },
  side_plank_sec: { label: '侧支撑', unit: '秒', domain: 'core', min: 0, max: 900 },
  single_leg_squat_reps: {
    label: '单腿蹲',
    unit: '次',
    domain: 'strength_endurance',
    min: 0,
    max: 100,
  },
  pull_ups_reps: { label: '引体向上', unit: '次', domain: 'strength_endurance', min: 0, max: 100 },
  squat_kg: { label: '深蹲', unit: 'kg', domain: 'strength', min: 0, max: 450 },
  deadlift_kg: { label: '硬拉', unit: 'kg', domain: 'strength', min: 0, max: 500 },
  hip_thrust_kg: { label: '臀推', unit: 'kg', domain: 'strength', min: 0, max: 600 },
  bench_press_kg: { label: '卧推', unit: 'kg', domain: 'strength', min: 0, max: 350 },
  bench_pull_kg: { label: '卧拉', unit: 'kg', domain: 'strength', min: 0, max: 350 },
  clean_kg: { label: '高翻', unit: 'kg', domain: 'explosive', min: 0, max: 300 },
  vertical_jump_cm: { label: '纵跳', unit: 'cm', domain: 'explosive', min: 0, max: 120 },
} as const;

