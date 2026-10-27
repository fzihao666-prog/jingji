import { projectRules, isActivityCode, SPORT_RULES_VERSION, type TrainingCategory } from './sport-rules.js';
import { INTENSITY_ZONE_SYSTEMS } from './training-intensity.js';

export class TrainingInputError extends Error {
  constructor(message: string, readonly code = 'INVALID_TRAINING_CONTEXT') { super(message); }
}

export function trainingContext(project: string, row: {
  trainingType: string; activityCode?: string; intensityZone?: string; intensitySystem?: string;
  rulesVersion?: string; cadenceRpm?: number | null; strokeRateSpm?: number | null; averagePowerW?: number | null;
}) {
  const rules = projectRules(project);
  if (!rules) throw new TrainingInputError('运动员项目无效，请先核实档案。');
  if (row.rulesVersion && row.rulesVersion !== SPORT_RULES_VERSION)
    throw new TrainingInputError('项目规则已更新，请刷新后核对训练内容。', 'CLIENT_RULES_OUTDATED');
  const activity = row.activityCode || 'unknown';
  if (!isActivityCode(activity) || !rules.activities.includes(activity))
    throw new TrainingInputError('该训练活动不适用于当前项目。');
  if (row.cadenceRpm != null && activity !== 'cycling')
    throw new TrainingInputError('踏频仅适用于骑行训练。');
  if (row.averagePowerW != null && !['on_water', 'ergometer', 'cycling'].includes(activity)) {
    if (activity !== 'unknown' || !rules.activities.includes('on_water'))
      throw new TrainingInputError('平均功率仅适用于水上、测功仪或骑行训练。');
  }
  if (row.strokeRateSpm != null && !['on_water', 'ergometer'].includes(activity)) {
    if (activity !== 'unknown' || !rules.activities.includes('on_water'))
      throw new TrainingInputError('桨频仅适用于水上或测功仪训练。');
  }
  const system = row.intensitySystem || '';
  if (system) {
    const definition = INTENSITY_ZONE_SYSTEMS.find(item => item.code === system);
    if (!definition || (row.intensityZone && !definition.zones.some(zone => zone === row.intensityZone)))
      throw new TrainingInputError('强度分区与所选体系不一致。');
  }
  const category: TrainingCategory = row.trainingType === '专项训练' ? 'special' : row.trainingType === '恢复训练' ? 'recovery' : 'physical';
  return { project: rules.project, activity, category, system, version: SPORT_RULES_VERSION };
}
