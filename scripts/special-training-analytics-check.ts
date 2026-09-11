import assert from 'node:assert/strict';
import { aggregateSpecialTraining, type SpecialSession } from '../shared/special-training.ts';

const row: SpecialSession = { id: 1, date: '2026-09-01', athleteId: 1, athleteName: '回归运动员', project: 'ROWING', team: '回归队伍', trainingType: '专项训练', structureType: '', content: '水上技术', intensityZone: 'UT2', durationMin: 60, distanceKm: 12, durationReported: true, distanceReported: true, srpe: 360, rpe: 6, sessionDemo: 0, sessionSource: 'manual' };
const result = aggregateSpecialTraining([row, { ...row, id: 2, content: '恢复拉伸' }, { ...row, id: 3, sessionDemo: 1 }, { ...row, id: 4, sessionSource: 'initial_seed' }]);
assert.equal(result.summary.sessionCount, 1);
assert.equal(result.summary.load, 360);
assert.equal(result.intensity[0].name, 'UT2', '原始强度不能转换为其他体系');
assert.equal(result.intensity[0].percentage, 100);
assert.deepEqual(result.content, [{ name: '水上', count: 1, percentage: 100 }]);
const missing = aggregateSpecialTraining([{ ...row, durationReported: false, distanceReported: false, rpe: null, srpe: 0 }]);
assert.equal(missing.summary.durationMin, null);
assert.equal(missing.summary.distanceKm, null);
assert.equal(missing.summary.load, null);
assert.equal(aggregateSpecialTraining([{ ...row, durationMin: 0, distanceKm: 0 }]).summary.durationMin, 0);
assert.deepEqual(aggregateSpecialTraining([]).days, []);
console.log('专项聚合检查通过：演示排除、专项隔离、原始强度、既有负荷、缺失/真实0值。');
