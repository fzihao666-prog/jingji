export const STRENGTH_TRAINING_CATEGORIES = ['基础力量', '功能性体能', '核心力量', '专项力量', '代谢训练'] as const;
export type StrengthTrainingCategory = typeof STRENGTH_TRAINING_CATEGORIES[number];

export const STRENGTH_BODY_POSITIONS = ['上肢', '下肢', '核心', '全身'] as const;
export type StrengthBodyPosition = typeof STRENGTH_BODY_POSITIONS[number];

export const STRENGTH_TRAINING_ENVIRONMENTS = ['水上', '陆上', '测功仪', '泳池', '场馆', '其他'] as const;
export type StrengthTrainingEnvironment = typeof STRENGTH_TRAINING_ENVIRONMENTS[number];

export const STRENGTH_INTENSITY_ZONES = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;
export type StrengthIntensityZone = typeof STRENGTH_INTENSITY_ZONES[number];

export const TRAINING_INTENSITY_META: Record<StrengthIntensityZone, {
  label: string;
  strokeRate: string;
  lactate: string;
  purpose: string;
}> = {
  U3: { label: '低强度有氧恢复', strokeRate: '<18 spm', lactate: '<2.0 mmol/L', purpose: '恢复放松' },
  U2: { label: '中等强度有氧基础', strokeRate: '16–20 spm', lactate: '1.5–2.5 mmol/L', purpose: '有氧耐力' },
  U1: { label: '高强度有氧', strokeRate: '20–24 spm', lactate: '2.0–4.0 mmol/L', purpose: '有氧功率' },
  AT: { label: '无氧阈强度', strokeRate: '24–28 spm', lactate: '3.5–6.0 mmol/L', purpose: '提升乳酸阈' },
  TPT: { label: '专项耐力', strokeRate: '28–32 spm', lactate: '6.0–12.0 mmol/L', purpose: '比赛节奏' },
  AN: { label: '无氧爆发冲刺', strokeRate: '>32 spm', lactate: '>12.0 mmol/L', purpose: '起航冲刺' },
  ATP: { label: 'ATP既有强度区', strokeRate: '待业务确认', lactate: '待业务确认', purpose: '沿用原始强度字段，不自动推导或合并' }
};

export function isStrengthTrainingCategory(value: unknown): value is StrengthTrainingCategory {
  return STRENGTH_TRAINING_CATEGORIES.includes(value as StrengthTrainingCategory);
}

export function isStrengthBodyPosition(value: unknown): value is StrengthBodyPosition {
  return STRENGTH_BODY_POSITIONS.includes(value as StrengthBodyPosition);
}

export function isStrengthTrainingEnvironment(value: unknown): value is StrengthTrainingEnvironment {
  return STRENGTH_TRAINING_ENVIRONMENTS.includes(value as StrengthTrainingEnvironment);
}

export function isStrengthIntensityZone(value: unknown): value is StrengthIntensityZone {
  return STRENGTH_INTENSITY_ZONES.includes(value as StrengthIntensityZone);
}

export function inferStrengthCategory(exerciseName: string): StrengthTrainingCategory {
  const name = exerciseName.trim();
  if (/平板|支撑|核心|卷腹|抗旋|死虫|鸟狗/.test(name)) return '核心力量';
  if (/跑|冲刺|间歇|跳绳|自行车|游泳|测功|有氧|无氧|乳酸/.test(name)) return '代谢训练';
  if (/划|拉桨|专项|出发|船|艇|传球|挥拍/.test(name)) return '专项力量';
  if (/单腿|药球|壶铃|跳箱|平衡|敏捷|功能/.test(name)) return '功能性体能';
  return '基础力量';
}

export function inferStrengthBodyPosition(exerciseName: string): StrengthBodyPosition {
  const name = exerciseName.trim();
  if (/深蹲|硬拉|腿|蹬|跳|跑|弓步|提踵/.test(name)) return '下肢';
  if (/卧推|卧拉|引体|肩|臂|划船|推举|高拉/.test(name)) return '上肢';
  if (/平板|支撑|核心|卷腹|抗旋|死虫|鸟狗/.test(name)) return '核心';
  return '全身';
}
