export const TRAINING_CONTENT_CATEGORIES = [
  '水上', '测功仪', '功能', '拉伸再生', '力量耐力',
  '最大力量', '速度力量', '跑步', '其它'
] as const;

export type TrainingContentCategory = typeof TRAINING_CONTENT_CATEGORIES[number];
export type WaterLandTrainingCategory = 'water' | 'land' | 'unclassified';

export type TrainingContentSource = {
  trainingType?: string | null;
  structureType?: string | null;
  content?: string | null;
};

// 这是统计展示口径：每个训练课次只归入一个固定类别，不改写原始训练字段。
export function trainingContentCategory(input: TrainingContentSource): TrainingContentCategory {
  const text = `${input.trainingType || ''} ${input.structureType || ''} ${input.content || ''}`.trim();
  if (!text) return '其它';
  if (/测功仪|划船机|ergometer|\berg\b/i.test(text)) return '测功仪';
  if (/跑步|慢跑|冲刺跑|折返跑|越野跑/.test(text)) return '跑步';
  if (/拉伸|再生|恢复|放松|泡沫轴|理疗/.test(text)) return '拉伸再生';
  if (/最大力量|大重量|深蹲|硬拉|卧推|卧拉/.test(text)) return '最大力量';
  if (/速度力量|爆发力|高拉|抓举|挺举|快速力量/.test(text)) return '速度力量';
  if (/力量耐力|循环力量|肌耐力|重复力量/.test(text)) return '力量耐力';
  if (/功能训练|功能性|核心稳定|协调|灵敏|平衡/.test(text)) return '功能';
  if (/水上|艇上|划行|划桨|竞速|门区|回旋|专项训练|静水/.test(text)) return '水上';
  return '其它';
}

// 水陆训练负荷统计复用训练课分类：明确的“其它”按当前业务约定归入陆上；
// 未出现任何可识别训练线索的记录保持未分类，避免为了凑比例而误归属。
export function waterLandTrainingCategory(input: TrainingContentSource): WaterLandTrainingCategory {
  const category = trainingContentCategory(input);
  if (category === '水上') return 'water';
  if (category !== '其它') return 'land';
  const text = `${input.trainingType || ''} ${input.structureType || ''} ${input.content || ''}`.trim();
  if (/其它|其他|力量训练|体能训练|恢复训练|陆上训练/.test(text)) return 'land';
  return 'unclassified';
}
