import { projectCapability } from '../../shared/projects.ts';
import { projectRules } from '../../shared/sport-rules.ts';
import type { TeamTrainingColumnMapping } from '../../shared/team-training-stats.ts';

/** 仅识别明确的分项词，混合名称与含义不清的简称留待映射。 */
export function inferTeamTrainingGroups(project: string, name: string) {
  const category = name.normalize('NFKC').replace(/\s/g, '');
  const activityName = category.replace(/^陆[上地]/, '');
  const water = Boolean(projectCapability(project));
  const activities = projectRules(project)?.activities || [];
  const recovery = /^(?:热身|激活|放松|整理|拉伸|恢复|再生|冷身|补偿训练)/.test(activityName);
  const conditioning =
    /^(?:耐力|力量耐力|爆发力|功能训练|功能性体能|核心力量|核心训练|平衡训练)/.test(activityName);
  const strength = /^(?:大力量|最大力量|力量训练|速度力量)/.test(activityName);
  const onWater =
    water &&
    /^(?:水上|划船|划桨|阻力划|测功仪|[123]级有氧|乳酸阈|无氧能力|无氧功率)/.test(category);
  const land =
    water && !onWater && (/^陆[上地]/.test(category) || recovery || conditioning || strength);
  const specific =
    /^(?:专项训练|专项有氧|技战术|战术训练|对抗|比赛|测试)/.test(category) ||
    (activities.includes('cycling') && /^(?:(?:公路|场地)?骑行|自行车)/.test(category)) ||
    (activities.includes('volleyball_technique') &&
      /^(?:排球技术|排球训练|发球|接发球|扣球|拦网|垫球|传球)/.test(category));
  const lessonGroup =
    recovery || conditioning ? 'auxiliary' : specific || onWater || strength ? 'main' : undefined;
  const waterGroup = onWater ? 'water' : land ? 'land' : undefined;
  return { lessonGroup, waterGroup } satisfies Partial<TeamTrainingColumnMapping>;
}
