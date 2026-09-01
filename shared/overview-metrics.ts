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
  { code: 'vo2max_ml_kg_min', label: 'VO2Max', domain: 'vo2max', unit: 'ml/kg/min', direction: 'higher_better', frequency: 'phase', projects: common, minimum: 20, maximum: 90 },
  { code: 'general_endurance_score', label: '一般耐力', domain: 'endurance', unit: '分', direction: 'higher_better', frequency: 'phase', projects: common, minimum: 0, maximum: 120 },
  { code: 'anaerobic_power_wkg', label: '无氧功率', domain: 'anaerobic', unit: 'W/kg', direction: 'higher_better', frequency: 'phase', projects: common, minimum: 0, maximum: 30 },
  { code: 'asymmetry_index_pct', label: '不对称指数', domain: 'asymmetry', unit: '%', direction: 'lower_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 40 },
  { code: 'core_strength_score', label: '核心力量综合', domain: 'core', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 120 },
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
  { code: 'fms_deep_squat', label: '深蹲', domain: 'fms', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 3 },
  { code: 'fms_hurdle_step', label: '跨栏步', domain: 'fms', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 3 },
  { code: 'fms_inline_lunge', label: '直线弓步蹲', domain: 'fms', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 3 },
  { code: 'fms_shoulder_mobility', label: '肩部灵活性', domain: 'fms', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 3 },
  { code: 'fms_active_straight_leg_raise', label: '主动直腿上抬', domain: 'fms', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 3 },
  { code: 'fms_trunk_stability_pushup', label: '躯干稳定俯卧撑', domain: 'fms', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 3 },
  { code: 'fms_rotary_stability', label: '旋转稳定性', domain: 'fms', unit: '分', direction: 'higher_better', frequency: 'monthly', projects: common, minimum: 0, maximum: 3 }
];

export const OVERVIEW_METRIC_MAP = Object.fromEntries(OVERVIEW_METRICS.map((metric) => [metric.code, metric]));
