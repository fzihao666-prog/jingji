import { BODY_TEMPLATE_FIELDS, FITNESS_TEMPLATE_METRICS, FMS_TEMPLATE_METRICS, EVALUATION_SCORE_METRICS, canonicalImportMetricCode } from './data-import-template.js';
import { normalizeProject } from './projects.js';

export type ImportMetricDefinition = { code: string; label: string; unit: string; projects?: readonly string[] };
const aliases: Record<string, string> = { verticalJumpCm: 'vertical_jump_cm', pullUpsReps: 'pull_ups_reps', benchPressKg: 'bench_press_kg', benchPullKg: 'bench_pull_kg', frontPlankSec: 'front_plank_sec', squatKg: 'squat_kg', deadliftKg: 'deadlift_kg', highPullKg: 'clean_kg' };
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').trim();
const choiceName = (metric: ImportMetricDefinition) => metric.unit ? `${metric.label}（${metric.unit}）` : metric.label;
function uniqueMetrics(metrics: readonly ImportMetricDefinition[]) {
  const result = new Map<string, ImportMetricDefinition>();
  for (const metric of metrics) {
    const code = aliases[metric.code] || canonicalImportMetricCode(metric.code);
    const key = `${code}|${normalized(metric.label)}|${normalized(metric.unit)}`;
    result.set(key, { ...metric, code });
  }
  return [...result.values()];
}
export function metricAppliesToProject(metric: { projects?: readonly string[] }, project: string) {
  return !metric.projects?.length || metric.projects.some(value => value === '*' || normalizeProject(value) === normalizeProject(project));
}
export function resolveImportMetricName(name: string, unit: string, definitions: readonly ImportMetricDefinition[]): { metric?: ImportMetricDefinition; error?: string } {
  const candidates = uniqueMetrics(definitions).filter(metric => normalized(name) === normalized(metric.label) || normalized(name) === normalized(choiceName(metric)));
  const matches = unit ? candidates.filter(metric => normalized(unit) === normalized(metric.unit)) : candidates;
  if (!matches.length) return { error: candidates.length ? '错误：测试项目的单位与所选项目不一致，请重新选择' : '错误：未识别测试项目，请从当前项目模板下拉列表选择；队内新增项目请先由管理员配置' };
  if (matches.length !== 1) return { error: '错误：测试项目对应多个定义，请选择带单位的完整项目名称；仍重名时请管理员确认' };
  return { metric: matches[0] };
}
export function importMetricChoices(definitions: readonly ImportMetricDefinition[]) {
  const metrics = uniqueMetrics(definitions);
  return metrics.filter(metric => resolveImportMetricName(choiceName(metric), '', metrics).metric).map(metric => ({ ...metric, name: choiceName(metric) }));
}
export const DEFAULT_IMPORT_METRICS: ImportMetricDefinition[] = [
  ...BODY_TEMPLATE_FIELDS.map(([, , code, label, unit]) => ({ code, label, unit })),
  ...FITNESS_TEMPLATE_METRICS.map(([, code, label, unit]) => ({ code, label, unit })),
  ...FMS_TEMPLATE_METRICS.map(([, code, label]) => ({ code, label, unit: '分' })),
  ...EVALUATION_SCORE_METRICS.map(([, code, label, unit]) => ({ code, label, unit })),
  ...[['squat_kg', '深蹲', 'kg'], ['deadlift_kg', '硬拉', 'kg'], ['bench_press_kg', '卧推', 'kg'], ['bench_pull_kg', '卧拉', 'kg'], ['vertical_jump_cm', '纵跳', 'cm']].map(([code, label, unit]) => ({ code, label, unit })),
];
