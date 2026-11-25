/** 简洁统一模板的展示字段与正式指标映射；旧专业模板定义保持独立。 */
export const COMPACT_ATHLETE_SHEET = '运动员基础体能测试';
export const COMPACT_ATHLETE_COLUMNS = [
  { key: '运动员编号', unit: '', group: 'identity', kind: 'identity' },
  { key: '姓名', unit: '', group: 'identity', kind: 'identity' },
  { key: '所属队伍', unit: '', group: 'identity', kind: 'identity' },
  { key: '测试日期', unit: 'YYYY-MM-DD', group: 'identity', kind: 'date' },
  {
    key: '身高',
    unit: 'cm',
    group: 'body',
    kind: 'body',
    code: 'height_cm',
    field: 'heightCm',
  },
  {
    key: '体重',
    unit: 'kg',
    group: 'body',
    kind: 'body',
    code: 'weight_kg',
    field: 'weightKg',
  },
  {
    key: '卧推最大力量',
    unit: 'kg',
    group: 'strength',
    kind: 'test',
    code: 'bench_press_kg',
    protocol: '实测1RM',
  },
  {
    key: '卧拉最大力量',
    unit: 'kg',
    group: 'strength',
    kind: 'test',
    code: 'bench_pull_kg',
    protocol: '实测1RM',
  },
  {
    key: '深蹲最大力量',
    unit: 'kg',
    group: 'strength',
    kind: 'test',
    code: 'squat_kg',
    protocol: '实测1RM',
  },
  {
    key: '硬拉最大力量',
    unit: 'kg',
    group: 'strength',
    kind: 'test',
    code: 'deadlift_kg',
    protocol: '实测1RM',
  },
  {
    key: '高翻最大力量',
    unit: 'kg',
    group: 'strength',
    kind: 'test',
    code: 'clean_kg',
    protocol: '实测1RM',
  },
  {
    key: '引体向上',
    unit: '次',
    group: 'fitness',
    kind: 'test',
    code: 'pull_ups_reps',
    protocol: '有效完成次数',
    integer: true,
  },
  {
    key: '纵跳 CMJ',
    unit: 'cm',
    group: 'fitness',
    kind: 'test',
    code: 'vertical_jump_cm',
    protocol: 'CMJ',
  },
  {
    key: '平板支撑',
    unit: 's',
    group: 'fitness',
    kind: 'test',
    code: 'front_plank_sec',
    protocol: '平板支撑',
  },
  {
    key: '坐位体前屈',
    unit: 'cm',
    group: 'fitness',
    kind: 'test',
    code: 'sit_reach_cm',
    protocol: '坐位体前屈',
  },
  { key: '备注', unit: '', group: 'note', kind: 'note' },
] as const;
export const compactAthleteHeader = (
  field: (typeof COMPACT_ATHLETE_COLUMNS)[number],
) => (field.unit ? `${field.key}（${field.unit}）` : field.key);
export function compactAthleteHeaderKey(value: string) {
  const normalize = (s: string) =>
    s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  return (
    COMPACT_ATHLETE_COLUMNS.find((field) =>
      [field.key, compactAthleteHeader(field)].some(
        (label) => normalize(label) === normalize(value),
      ),
    )?.key || value
  );
}
