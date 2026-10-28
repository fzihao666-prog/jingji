import { allowedIntensitySystems, sessionQuantityRequirement, projectRules, isActivityCode, SPORT_RULES_VERSION, type TrainingCategory } from './sport-rules.js';
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
    if (!allowedIntensitySystems(project, activity).includes(system)) throw new TrainingInputError('该强度体系不适用于当前项目和训练活动。');
    const definition = INTENSITY_ZONE_SYSTEMS.find(item => item.code === system);
    if (!definition || (row.intensityZone && !definition.zones.some(zone => zone === row.intensityZone)))
      throw new TrainingInputError('强度分区与所选体系不一致。');
  }
  const category: TrainingCategory = row.trainingType === '专项训练' ? 'special' : row.trainingType === '恢复训练' ? 'recovery' : 'physical';
  return { project: rules.project, activity, category, system, version: SPORT_RULES_VERSION };
}

export function validateSessionQuantity(project: string, row: { activityCode?: string; duration: number | null; distance: number | null }) {
 if (row.duration != null && Number.isFinite(row.duration) && row.duration > 0) return;
 if (sessionQuantityRequirement(project,row.activityCode)==='duration|distance' && row.distance != null && Number.isFinite(row.distance) && row.distance>0) return;
 throw new TrainingInputError(sessionQuantityRequirement(project,row.activityCode)==='duration' ? '此训练活动必须填写有效时长。' : '请填写有效时长或大于0的距离。');
}
