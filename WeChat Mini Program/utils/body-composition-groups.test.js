import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadNumberFormatter() {
  const dataModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../data/format-data.js', import.meta.url), 'utf8'), { module: dataModule });
  const formatModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./format.js', import.meta.url), 'utf8'), {
    module: formatModule,
    require(path) {
      if (path === '../data/format-data') return dataModule.exports;
      throw new Error(`未预期的依赖：${path}`);
    },
  });
  return formatModule.exports.number;
}

const number = loadNumberFormatter();
const cjsModule = { exports: {} };
vm.runInNewContext(readFileSync(new URL('./body-composition-groups.js', import.meta.url), 'utf8'), {
  module: cjsModule,
  require(path) {
    if (path === './format') return { number };
    throw new Error(`未预期的依赖：${path}`);
  },
});
const { bodyCompositionSummary } = cjsModule.exports;

function loadWithoutIntl() {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./body-composition-groups.js', import.meta.url), 'utf8'), {
    module,
    exports: module.exports,
    Intl: undefined,
    require(path) {
      if (path === './format') return { number };
      throw new Error(`未预期的依赖：${path}`);
    },
  });
  return module.exports;
}

const history = [
  { measurementDate: '2026-09-01', items: [
    { key: 'weightKg', value: 73 }, { key: 'bodyFatPct', value: 13 },
    { key: 'skeletalMuscleKg', value: 32 }, { key: 'totalBodyWaterKg', value: 44 }
  ] },
  { measurementDate: '2026-10-01', items: [
    { key: 'weightKg', value: 72.4 }, { key: 'bodyFatPct', value: 12.8 },
    { key: 'skeletalMuscleKg', value: 32 }, { key: 'totalBodyWaterKg', value: 45 }
  ] }
];

describe('身体成分精简摘要', () => {
  it('运行环境没有 Intl 时仍可加载并格式化档案数值', () => {
    const { bodyCompositionSummary: summarize } = loadWithoutIntl();
    const view = summarize([{ measurementDate: '2026-10-08', items: [{ key: 'weightKg', value: 72.4 }] }]);

    expect(view.core[0].latestText).toBe('72.4');
  });

  it('默认三项核心指标，其他实测收进更多指标，按日期选最近记录', () => {
    const view = bodyCompositionSummary(history);
    expect(view.hasData).toBe(true);
    expect(view.latestDate).toBe('2026-10-01');
    expect(view.core.map((metric) => metric.key)).toEqual(['weightKg', 'bodyFatPct', 'skeletalMuscleKg']);
    expect(view.core[0].latestText).toBe('72.4');
    expect(view.core[0].deltaText).toBe('-0.6');
    expect(view.core[1].deltaText).toBe('-0.2');
    expect(view.core[1].deltaUnit).toBe('个百分点');
    expect(view.core[2].deltaText).toBe('持平');
    expect(view.core[2].deltaUnit).toBe('');
    expect(view.more.map((metric) => metric.key)).toEqual(['totalBodyWaterKg']);
    expect(view.more[0].deltaText).toBe('+1');
    expect(history[0].measurementDate).toBe('2026-09-01');
  });

  it('跳过缺测日期比较前一次同指标实测，并标记不同日期', () => {
    const view = bodyCompositionSummary([
      { measurementDate: '2026-10-08', items: [{ key: 'weightKg', value: 72.4 }] },
      { measurementDate: '2026-10-01', items: [{ key: 'bodyFatPct', value: 12.8 }] },
      { measurementDate: '2026-09-01', items: [{ key: 'weightKg', value: 73 }, { key: 'bodyFatPct', value: 13 }] }
    ]);
    expect(view.core[0].deltaText).toBe('-0.6');
    expect(view.core[0].previousDate).toBe('2026-09-01');
    expect(view.core[1].latestDate).toBe('2026-10-01');
    expect(view.core[1].isOlder).toBe(true);
    expect(view.core[2].latestText).toBe('—');
    expect(view.core[2].deltaText).toBe('—');
    expect(view.more).toEqual([]);
  });

  it('保留真实零，单次实测不计算变化，无效数值不展示', () => {
    const view = bodyCompositionSummary([{ measurementDate: '2026-10-08', items: [
      { key: 'weightKg', value: 0 }, { key: 'bodyFatPct', value: null },
      { key: 'skeletalMuscleKg', value: NaN }, { key: 'muscleMassKg', value: Infinity },
      { key: 'totalBodyWaterKg', value: -1 }
    ] }]);
    expect(view.core[0].latestText).toBe('0');
    expect(view.core[0].deltaText).toBe('—');
    expect(view.core[1].latestText).toBe('—');
    expect(view.more).toEqual([]);
    expect(view.core[0].previousDate).toBe('');
  });

  it('空记录与无有效数值显示空状态', () => {
    expect(bodyCompositionSummary(null).hasData).toBe(false);
    expect(bodyCompositionSummary([]).hasData).toBe(false);
    expect(bodyCompositionSummary([{ measurementDate: '2026-10-08', items: [] }]).hasData).toBe(false);
  });
});
