import { STRENGTH_METRICS } from './strength-model';

export type MetricDirection = 'higher_better' | 'lower_better' | 'neutral';
export type MetricFrequency = 'daily' | 'session' | 'monthly' | 'phase';

export type OverviewMetricDefinition = {
  code: string;
  label: string;
  domain: string;
  unit: string;
  direction: MetricDirection;
  frequency: MetricFrequency;
  projects: string[];
  minimum: number | null;
  maximum: number | null;
};

const common = ['赛艇', '皮划艇', '激流'];

export const OVERVIEW_METRICS: OverviewMetricDefinition[] = [
  ...STRENGTH_METRICS.map((metric) => ({
    code: metric.key,
    label: metric.label,
    domain: metric.group,
    unit: metric.unit,
    direction: 'higher_better' as const,
    frequency: 'monthly' as const,
    projects: metric.projects || common,
    minimum: metric.min,
    maximum: metric.max
  })),
  { code: 'body_fat_pct', label: '体脂率', domain: 'morphology', unit: '%', direction: 'lower_better', frequency: 'monthly', projects: common, minimum: 2, maximum: 50 },
  { code: 'skeletal_muscle_kg', label: '骨骼肌量', domain: 'morphology', unit: 'kg', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 10, maximum: 80 },
  { code: 'cmj_peak_power_w', label: 'CMJ峰值功率', domain: 'explosive', unit: 'W', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 7000 },
  { code: 'imtp_peak_force_n', label: 'IMTP峰值力量', domain: 'foundation', unit: 'N', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 8000 },
  { code: 'dsd_ratio', label: '动态力量缺陷', domain: 'explosive', unit: '', direction: 'lower_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 2 },
  { code: 'seven_stroke_power_w', label: '7桨平均功率', domain: 'project', unit: 'W', direction: 'higher_better', frequency: 'phase', projects: ['赛艇'], minimum: 0, maximum: 1500 },
  { code: 'erg_2k_sec', label: '2km测功仪', domain: 'project', unit: 's', direction: 'lower_better', frequency: 'phase', projects: ['赛艇'], minimum: 300, maximum: 720 },
  { code: 'erg_6k_sec', label: '6km测功仪', domain: 'project', unit: 's', direction: 'lower_better', frequency: 'phase', projects: ['赛艇'], minimum: 900, maximum: 1800 },
  { code: 'boat_speed_mps', label: '专项航速', domain: 'technique', unit: 'm/s', direction: 'higher_better', frequency: 'phase', projects: ['赛艇', '皮划艇'], minimum: 0, maximum: 10 },
  { code: 'stroke_rate_spm', label: '桨频', domain: 'technique', unit: 'spm', direction: 'neutral', frequency: 'phase', projects: ['赛艇', '皮划艇'], minimum: 0, maximum: 180 },
  { code: 'distance_per_stroke_m', label: '单桨距离', domain: 'technique', unit: 'm', direction: 'higher_better', frequency: 'phase', projects: ['赛艇', '皮划艇'], minimum: 0, maximum: 20 },
  { code: 'sprint_200_sec', label: '200米竞速', domain: 'project', unit: 's', direction: 'lower_better', frequency: 'phase', projects: ['皮划艇'], minimum: 20, maximum: 180 },
  { code: 'sprint_500_sec', label: '500米竞速', domain: 'project', unit: 's', direction: 'lower_better', frequency: 'phase', projects: ['皮划艇'], minimum: 60, maximum: 300 },
  { code: 'left_paddle_power_w', label: '左侧划桨功率', domain: 'symmetry', unit: 'W', direction: 'higher_better', frequency: 'phase', projects: ['皮划艇'], minimum: 0, maximum: 1000 },
  { code: 'right_paddle_power_w', label: '右侧划桨功率', domain: 'symmetry', unit: 'W', direction: 'higher_better', frequency: 'phase', projects: ['皮划艇'], minimum: 0, maximum: 1000 },
  { code: 'lactate_threshold_mmol', label: '乳酸阈值', domain: 'metabolic', unit: 'mmol/L', direction: 'neutral', frequency: 'phase', projects: common, minimum: 0, maximum: 20 },
  { code: 'gate_technique_score', label: '门区技术评分', domain: 'technique', unit: '分', direction: 'higher_better', frequency: 'phase', projects: ['激流'], minimum: 0, maximum: 100 },
  { code: 'movement_squat_score', label: '双腿深蹲', domain: 'movement', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 100 },
  { code: 'movement_heel_lift_score', label: '足跟抬起控制', domain: 'movement', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 100 },
  { code: 'movement_pushup_score', label: '俯卧撑动作', domain: 'movement', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 100 },
  { code: 'movement_shoulder_score', label: '肩关节活动', domain: 'movement', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 100 },
  { code: 'movement_trunk_score', label: '躯干与腰椎控制', domain: 'movement', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 100 },
  { code: 'movement_cervical_score', label: '颈椎控制', domain: 'movement', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 100 }
];

export const OVERVIEW_METRIC_MAP = Object.fromEntries(OVERVIEW_METRICS.map((metric) => [metric.code, metric]));
