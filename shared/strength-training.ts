export const STRENGTH_TRAINING_CATEGORIES = ['基础力量', '功能性体能', '核心力量', '专项力量', '代谢训练'] as const;
export type StrengthTrainingCategory = typeof STRENGTH_TRAINING_CATEGORIES[number];

export const STRENGTH_BODY_POSITIONS = ['上肢', '下肢', '核心', '全身'] as const;
export type StrengthBodyPosition = typeof STRENGTH_BODY_POSITIONS[number];

export const STRENGTH_TRAINING_ENVIRONMENTS = ['水上', '陆上', '测功仪', '泳池', '场馆', '其他'] as const;
export type StrengthTrainingEnvironment = typeof STRENGTH_TRAINING_ENVIRONMENTS[number];

export const STRENGTH_INTENSITY_ZONES = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;
export type StrengthIntensityZone = typeof STRENGTH_INTENSITY_ZONES[number];

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
