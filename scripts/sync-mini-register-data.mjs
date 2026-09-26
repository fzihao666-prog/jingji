import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROJECT_DEFINITIONS } from '../shared/projects.ts';
import { PROVINCES, PROVINCE_CITIES } from '../shared/regions.ts';
import { ROLE_META } from '../shared/access.ts';
import { STRENGTH_METRICS } from '../shared/strength-model.ts';

const target = fileURLToPath(new URL('../WeChat Mini Program/data/register-data.js', import.meta.url));
const payload = {
  projects: PROJECT_DEFINITIONS.map(({ code, nameZh }) => ({ code, label: nameZh })),
  provinces: PROVINCES,
  provinceCities: PROVINCE_CITIES,
};
const miniStrengthMetricKeys = new Set([
  'heightCm', 'weightKg', 'bodyFatPct', 'trainingYears', 'armSpanCm', 'sitReachCm',
  'verticalJumpCm', 'pullUpsReps', 'benchPressKg', 'benchPullKg', 'frontPlankSec',
  'leftPlankSec', 'rightPlankSec', 'squatKg', 'deadliftKg', 'highPullKg',
  'leftSingleLegSquatReps', 'rightSingleLegSquatReps', 'benchPressPeakPowerW',
  'benchPullPeakPowerW', 'wingatePeakPowerWkg',
]);
const formatTarget = fileURLToPath(new URL('../WeChat Mini Program/data/format-data.js', import.meta.url));
const formatPayload = {
  roleLabels: Object.fromEntries(Object.entries(ROLE_META).map(([code, meta]) => [code, meta.label])),
  strengthMetrics: Object.fromEntries(STRENGTH_METRICS.filter((metric) => miniStrengthMetricKeys.has(metric.key))
    .map((metric) => [metric.key, [metric.label, metric.unit]])),
};
for (const [path, data] of [[target, payload], [formatTarget, formatPayload]]) {
  const output = `// 由 scripts/sync-mini-register-data.mjs 从 shared/ 生成，请勿手工修改。\nmodule.exports = ${JSON.stringify(data, null, 2)};\n`;
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== output) {
      throw new Error('小程序字典已过期，请运行 npm run mini:dictionary-sync。');
    }
  } else {
    writeFileSync(path, output);
  }
}
