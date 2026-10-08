import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const cjsModule = { exports: {} };
const sourceUrl = new URL('./body-composition-groups.js', import.meta.url);
vm.runInNewContext(readFileSync(sourceUrl, 'utf8'), { module: cjsModule });
const { bodyCompositionGroups } = cjsModule.exports;

describe('身体成分分组', () => {
  it('合并同类指标，仅展开第一组，并保留明细索引与原始数值', () => {
    const metrics = [
      { key: 'weightKg', label: '体重', latest: 72.4, delta: 0, points: [] },
      { key: 'bodyFatPct', label: '体脂率', latest: 0, delta: null, points: [] },
      { key: 'skeletalMuscleKg', label: '骨骼肌', latest: 30, points: [] },
      { key: 'muscleMassKg', label: '肌肉量', latest: 40, points: [] },
      { key: 'totalBodyWaterKg', label: '体水分', latest: 45, points: [] },
      { key: 'visceralFatLevel', label: '内脏脂肪等级', latest: 3, points: [] },
      { key: 'basalMetabolismKcal', label: '基础代谢', latest: 1700, points: [] }
    ];
    const groups = bodyCompositionGroups(metrics);
    expect(groups.map((group) => group.label)).toEqual(['体重与脂肪', '肌肉', '水分与代谢']);
    expect(groups.map((group) => group.expanded)).toEqual([true, false, false]);
    expect(groups[0].metrics.map((metric) => metric.metricIndex)).toEqual([0, 1, 5]);
    expect(groups[0].metrics[1].latest).toBe(0);
    expect(groups[0].metrics[0].delta).toBe(0);
    expect(groups[1].summary).toBe('骨骼肌 · 肌肉量');
    expect(metrics[0]).not.toHaveProperty('metricIndex');
  });

  it('忽略空组，展开首个有数据的分组', () => {
    const groups = bodyCompositionGroups([{ key: 'totalBodyWaterKg', label: '体水分', latest: 45 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('water-metabolism');
    expect(groups[0].expanded).toBe(true);
  });

  it('无数据时保留空状态，未分类指标也可查看', () => {
    expect(bodyCompositionGroups([])).toEqual([]);
    expect(bodyCompositionGroups(null)).toEqual([]);
    expect(bodyCompositionGroups([{ key: 'other', label: '其他指标' }])[0].label).toBe('其他指标');
  });
});
