import assert from 'node:assert/strict';
import { summarizeDailyRpe } from '../server/rpe-statistics.ts';

const row = (athleteId: number, rpe: number | null, sessionDemo = 0) => ({ athleteId, rpe, sessionDemo });
assert.deepEqual(summarizeDailyRpe([]), { averageRpe: null, stdRpe: null, lowerRpe: null, upperRpe: null, rpeCount: 0 });
assert.deepEqual(summarizeDailyRpe([row(1, 6)]), { averageRpe: 6, stdRpe: 0, lowerRpe: 6, upperRpe: 6, rpeCount: 1 });
assert.deepEqual(summarizeDailyRpe([row(1, 4), row(1, 8), row(2, 10)]), { averageRpe: 8, stdRpe: 2, lowerRpe: 6, upperRpe: 10, rpeCount: 2 });
assert.equal(summarizeDailyRpe([row(1, null), row(2, NaN), row(3, Infinity), row(4, -1), row(5, 11), row(6, 5, 1)]).rpeCount, 0);
assert.equal(summarizeDailyRpe([row(1, 0)]).averageRpe, 0, '真实0分有效，不应视为缺失');
assert.equal(summarizeDailyRpe([row(1, 0), row(2, 0), row(3, 10)]).lowerRpe, 0);
assert.equal(summarizeDailyRpe([row(1, 0), row(2, 10), row(3, 10)]).upperRpe, 10);
const precise = summarizeDailyRpe([row(1, 4), row(2, 5), row(3, 9)]);
assert.ok(Math.abs(precise.stdRpe! - Math.sqrt(14 / 3)) < 1e-12, '采用总体标准差，统计过程不提前舍入');
console.log('RPE统计检查通过：运动员等权、总体标准差、单人、空值、无效值、演示排除和上下界裁剪。');
