import assert from 'node:assert/strict';
import {
  ROWING_RADAR_DIMENSIONS,
  buildRadarComparison,
} from '../shared/athlete-radar-model.ts';

assert.deepEqual(
  Object.keys(ROWING_RADAR_DIMENSIONS),
  ['special', 'physical'],
);
assert.equal(ROWING_RADAR_DIMENSIONS.special.length, 5);
assert.equal(ROWING_RADAR_DIMENSIONS.physical.length, 6);
assert.deepEqual(
  [...ROWING_RADAR_DIMENSIONS.special, ...ROWING_RADAR_DIMENSIONS.physical],
  [
    { key: 'rowing_on_water_time', label: '主项水上计时', unit: 's', direction: 'lower_better' },
    { key: 'rowing_erg_2000_time', label: '2000m测功仪', unit: 's', direction: 'lower_better' },
    { key: 'rowing_erg_5000_time', label: '5000m测功仪', unit: 's', direction: 'lower_better' },
    { key: 'rowing_erg_30min_20spm_split', label: '30分钟20桨频分段', unit: 's/500m', direction: 'lower_better' },
    { key: 'rowing_erg_peak_power', label: '峰值功率', unit: 'W', direction: 'higher_better' },
    { key: 'relative_squat', label: '相对深蹲', unit: '倍体重', direction: 'higher_better' },
    { key: 'relative_bench_pull', label: '相对卧拉', unit: '倍体重', direction: 'higher_better' },
    { key: 'relative_high_pull', label: '相对高翻/高拉', unit: '倍体重', direction: 'higher_better' },
    { key: 'vertical_jump', label: '纵跳', unit: 'cm', direction: 'higher_better' },
    { key: 'bench_pull_2min', label: '2分钟卧拉', unit: '次', direction: 'higher_better' },
    { key: 'front_plank', label: '前支撑', unit: 's', direction: 'higher_better' },
  ],
);

assert.deepEqual(buildRadarComparison('lower_better', 388, 372), {
  achievedPercent: 95.9,
  signedDifference: 16,
  comparable: true,
});
assert.deepEqual(buildRadarComparison('higher_better', 1.7, 1.5), {
  achievedPercent: 113.3,
  signedDifference: 0.2,
  comparable: true,
});

for (const currentValue of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.deepEqual(buildRadarComparison('higher_better', currentValue, 1), {
    achievedPercent: null,
    signedDifference: null,
    comparable: false,
  });
}
assert.deepEqual(buildRadarComparison('higher_better', 1, 0), {
  achievedPercent: null,
  signedDifference: null,
  comparable: false,
});
assert.deepEqual(buildRadarComparison('lower_better', 0, 372), {
  achievedPercent: null,
  signedDifference: null,
  comparable: false,
});

console.log('athlete radar model checks passed');
